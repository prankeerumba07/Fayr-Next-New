import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './admin.constants';

/**
 * Solves the chicken-and-egg of the first staff account: with no staff, nobody
 * can log in to create one. If STAFF_BOOTSTRAP_EMAIL and STAFF_BOOTSTRAP_PASSWORD
 * are both set, this ensures an ADMIN account with that email exists at boot.
 *
 * IDEMPOTENT and SAFE: it creates the account only when absent, and NEVER
 * overwrites an existing one (so rotating a leaked bootstrap password happens
 * through the app, not by editing env and restarting). Safe to run on every
 * replica's boot — a lost create race just means one instance wins and the
 * others find it already present.
 */
@Injectable()
export class StaffBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(StaffBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBootstrapAdmin();
  }

  /** Extracted from the lifecycle hook so it's directly unit-testable. */
  async ensureBootstrapAdmin(): Promise<'created' | 'exists' | 'skipped'> {
    const rawEmail = this.config.get('STAFF_BOOTSTRAP_EMAIL', { infer: true });
    const password = this.config.get('STAFF_BOOTSTRAP_PASSWORD', {
      infer: true,
    });
    if (!rawEmail || !password) {
      // No bootstrap configured — normal in environments that provision staff
      // another way. Say nothing noisy.
      return 'skipped';
    }
    const email = normalizeEmail(rawEmail);

    const existing = await this.prisma.staffUser.findUnique({
      where: { email },
    });
    if (existing) {
      this.logger.log(`bootstrap admin already present (${email})`);
      return 'exists';
    }

    try {
      const passwordHash = await argon2.hash(password);
      await this.prisma.staffUser.create({
        data: { email, passwordHash, name: 'Bootstrap Admin', role: 'ADMIN' },
      });
      this.logger.log(`bootstrap admin created (${email})`);
      return 'created';
    } catch (err) {
      // Lost the create race with another replica — the account now exists,
      // which is exactly the desired end state.
      if (isUniqueViolation(err)) {
        this.logger.log(`bootstrap admin created concurrently (${email})`);
        return 'exists';
      }
      throw err;
    }
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}
