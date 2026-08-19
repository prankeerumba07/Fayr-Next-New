import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** The signed-in user's own balances. Money is integer paise as a STRING. */
export interface MyWalletResponse {
  ticketBalance: number;
  walletBalancePaise: string;
}

/**
 * The signed-in user's own profile. `setupDone` is what the app checks to decide
 * whether to run the first-run setup sequence — deliberately not "is name set",
 * because a user may complete setup while declining to give a name.
 */
export interface MyProfileResponse {
  id: string;
  displayId: string;
  mobile: string;
  name: string | null;
  ageBand: string | null;
  gender: string | null;
  categories: string[];
  platforms: string[];
  setupDone: boolean;
  /** Which terms version is on record, and when it was agreed to. Null until then. */
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  /** Whether a PAN is on file — never the PAN itself. */
  hasPan: boolean;
}

/**
 * The authenticated user's own account reads and profile writes.
 *
 * `/me/wallet` gives the app the ticket count and refundable balance. `/me` is
 * the profile the first-run setup sequence fills in; PATCH is progressive, so a
 * user who abandons setup halfway keeps what they already answered.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('wallet')
  async wallet_(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyWalletResponse> {
    const [ticketBalance, paise] = await Promise.all([
      this.tickets.getBalance(user.id),
      this.wallet.getUserBalance(user.id),
    ]);
    return { ticketBalance, walletBalancePaise: paise.toString() };
  }

  @Get()
  async profile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyProfileResponse> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return toProfileResponse(row);
  }

  /**
   * Save setup answers. Only the fields present are written, so each step of the
   * sequence can save as it completes without resending earlier answers.
   */
  @Patch()
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MyProfileResponse> {
    const data: {
      name?: string;
      ageBand?: string;
      gender?: string;
      categories?: string[];
      platforms?: string[];
      setupDoneAt?: Date;
      termsVersion?: string;
      termsAcceptedAt?: Date;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.ageBand !== undefined) data.ageBand = dto.ageBand;
    if (dto.gender !== undefined) data.gender = dto.gender;
    // De-duplicated: the client sends a selection, and a repeated entry would
    // otherwise be stored twice and skew any later use of these lists.
    if (dto.categories !== undefined) data.categories = [...new Set(dto.categories)];
    if (dto.platforms !== undefined) data.platforms = [...new Set(dto.platforms)];

    // CONSENT, RECORDED. Only `true` counts; `false` is ignored rather than read as
    // a withdrawal, which is a separate deliberate act. The version is mandatory
    // because an unversioned record cannot show WHAT was agreed to, and the
    // timestamp is set HERE, on the server — a client-supplied one would prove
    // nothing. A later version replaces the record, which is the correct behaviour
    // when the terms change; nothing can clear it.
    if (dto.acceptTerms === true) {
      const version = (dto.termsVersion ?? '').trim();
      if (version.length === 0) {
        throw new BadRequestException(
          'termsVersion is required when acceptTerms is true: a consent record '
          + 'without a version cannot show what was agreed to.',
        );
      }
      data.termsVersion = version;
      data.termsAcceptedAt = new Date();
    }

    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { setupDoneAt: true },
    });
    // One-way latch: completing setup can be stamped but never cleared, so a
    // later profile edit cannot reopen onboarding for someone who finished it.
    if (dto.setupDone === true && row.setupDoneAt == null) {
      data.setupDoneAt = new Date();
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    return toProfileResponse(updated);
  }
}

function toProfileResponse(row: {
  id: string;
  displayId: string;
  mobile: string;
  name: string | null;
  ageBand: string | null;
  gender: string | null;
  categories: string[];
  platforms: string[];
  setupDoneAt: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  pan: string | null;
}): MyProfileResponse {
  return {
    id: row.id,
    displayId: row.displayId,
    mobile: row.mobile,
    name: row.name,
    ageBand: row.ageBand,
    gender: row.gender,
    categories: row.categories,
    platforms: row.platforms,
    setupDone: row.setupDoneAt != null,
    // Returned so the app can tell whether consent is on record and for WHICH
    // version — that is how a terms change becomes visible rather than assumed.
    termsVersion: row.termsVersion,
    termsAcceptedAt: row.termsAcceptedAt ? row.termsAcceptedAt.toISOString() : null,
    // The PAN itself never leaves the server on a profile read — only whether
    // one exists, which is all any screen needs to know.
    hasPan: row.pan != null,
  };
}
