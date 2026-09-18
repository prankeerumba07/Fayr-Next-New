import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './auth.constants';
import type { AuthenticatedUser, IssuedTokens, TokenMeta } from './auth.types';
import { UserEventService } from '../events/user-event.service';
import { SMS_SENDER, type SmsSender } from './sms/sms-sender';
import { TokenService } from './token.service';

/** Result of a successful OTP verification — a session plus the principal. */
export interface AuthResult extends IssuedTokens {
  user: AuthenticatedUser;
}

/**
 * The OTP login/registration flow.
 *
 * Mobile-only auth: requesting a code creates a short-lived, single-use, hashed
 * challenge; verifying the correct code upserts the user (first login == signup)
 * and mints a session. Every rejection path returns ONE generic message so an
 * attacker can't probe which numbers exist or which state a challenge is in.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly tickets: TicketService,
    private readonly events: UserEventService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async requestOtp(
    mobile: string,
  ): Promise<{ expiresInSeconds: number; resendInSeconds: number }> {
    // Per-number cooldown (in addition to the per-IP throttle on the route):
    // block if a code was issued within the cooldown window.
    const cooldownStart = new Date(
      Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000,
    );
    const recent = await this.prisma.otpChallenge.findFirst({
      where: { mobile, createdAt: { gt: cooldownStart } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const waitSeconds = Math.max(
        1,
        Math.ceil(
          (recent.createdAt.getTime() +
            OTP_RESEND_COOLDOWN_SECONDS * 1000 -
            Date.now()) /
            1000,
        ),
      );
      throw new HttpException(
        {
          message: 'Please wait before requesting a new code',
          resendInSeconds: waitSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const codeHash = await argon2.hash(code);
    // Link the challenge to an existing user when there is one; a brand-new
    // number has no user yet (created on first successful verify).
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    await this.prisma.otpChallenge.create({
      data: {
        mobile,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
        userId: user?.id,
      },
    });

    // A BLOCKED account gets NO code. The block check used to live only in
    // verifyOtp — i.e. strictly AFTER delivery — so this row was loaded, its
    // `status` thrown away, and a real SMS spent on an account the fraud team had
    // already blocked. On a metered or free-tier SMS route that is money, and it
    // is repeatable every cooldown window.
    //
    // The response below is returned UNCHANGED, and the challenge row above is
    // written either way: identical body, identical timing (the argon2 hash is the
    // expensive part), identical cooldown. Anything else would turn this endpoint
    // into a way to find out which numbers are blocked. The user id is logged, not
    // the number.
    if (user?.status === 'BLOCKED') {
      this.logger.warn(`OTP request for blocked account ${user.id} — no code sent`);
      return {
        expiresInSeconds: OTP_TTL_SECONDS,
        resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      };
    }

    // Await delivery so a send failure surfaces as an error to the caller rather
    // than a code that silently never arrives.
    await this.sms.sendOtp(mobile, code);

    // RECORDED HERE AND NOT A LINE EARLIER. A blocked account returns above with
    // no code sent, and counting that as "asked for a code" would put a person
    // into the funnel who was never going to receive one — which shows up later
    // as delivery getting worse.
    //
    // No number goes into the row. Whether a code was ASKED for is already
    // countable from otp_challenges; what this row adds is a step on the same
    // timeline as the screens in front of it.
    await this.events.record({ type: 'OTP_REQUESTED', userId: user?.id ?? null });

    return {
      expiresInSeconds: OTP_TTL_SECONDS,
      resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyOtp(
    mobile: string,
    code: string,
    meta: TokenMeta = {},
  ): Promise<AuthResult> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { mobile, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // One generic failure for "no code", "expired", and "wrong code" alike.
    const invalid = (): never => {
      throw new UnauthorizedException('Invalid or expired code');
    };

    if (!challenge) return invalid();
    if (challenge.expiresAt <= new Date()) return invalid();
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — request a new code');
    }

    const ok = await argon2.verify(challenge.codeHash, code);
    if (!ok) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return invalid();
    }

    // Correct code. First successful login for a number creates the user.
    //
    // Asked for FIRST so that "was this a new account" is answerable. An upsert
    // cannot tell you afterwards which of the two things it did, and the funnel
    // needs to separate somebody signing up from somebody coming back.
    const existing = await this.prisma.user.findUnique({
      where: { mobile },
      select: { id: true },
    });
    const isNew = existing === null;
    const user = await this.prisma.user.upsert({
      where: { mobile },
      create: { mobile },
      update: {},
    });

    // Consume the challenge unconditionally now, so a correct code is strictly
    // single-use even for a blocked account.
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), userId: user.id },
    });

    if (user.status === 'BLOCKED') {
      throw new ForbiddenException('Account is blocked');
    }

    // Grant the one-time signup tickets (per CLAUDE.md: users start with 15).
    // Idempotent per user, so it lands exactly once (first login) and re-logins
    // are no-ops. Never let a ticket hiccup block authentication.
    try {
      await this.tickets.grantSignup(user.id);
    } catch (err) {
      this.logger.error(
        `signup ticket grant failed for ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Both steps, in the order a person takes them. Recorded AFTER the block
    // check above, so a blocked account never appears in the funnel as somebody
    // who got in.
    await this.events.record({
      type: 'OTP_VERIFIED',
      userId: user.id,
      payload: { created: isNew },
    });
    if (isNew) {
      await this.events.record({ type: 'ACCOUNT_CREATED', userId: user.id });
    }

    const issued = await this.tokens.issueTokens(user, meta);
    this.logger.log(`OTP login succeeded for user ${user.id}`);
    return { user: { id: user.id, mobile: user.mobile }, ...issued };
  }

  /** Fresh read of the authenticated user (reflects current block status). */
  async getMe(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.status === 'BLOCKED') {
      throw new ForbiddenException('Account is blocked');
    }
    return { id: user.id, mobile: user.mobile };
  }

  /** Cryptographically-random zero-padded numeric code. */
  private generateCode(): string {
    return randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
  }
}
