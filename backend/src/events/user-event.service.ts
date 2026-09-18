import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UserEventName, UserEventPayload } from './user-event.types';

/** Everything a single recorded step can carry. All of it optional but the name. */
export interface RecordEvent {
  type: UserEventName;
  userId?: string | null;
  anonymousId?: string | null;
  payload?: UserEventPayload;
  /** The clock, handed in so a test never has to wait for one. */
  at?: Date;
}

/**
 * WRITING DOWN WHAT PEOPLE DID.
 *
 * One method, and the whole design is in one sentence: RECORDING A STEP CAN
 * NEVER FAIL A REQUEST.
 *
 * Every call is wrapped. If the database is slow, or the table is missing
 * because somebody has not run the migration yet, or the payload is somehow
 * wrong, this logs and returns. It does not throw, and it does not retry.
 *
 * That is not laziness about errors. It is the only defensible trade: the worst
 * case if this swallows a failure is a chart with a dip in it. The worst case if
 * it throws is that a person cannot sign in to Fayr because an analytics insert
 * timed out. Measurement is never allowed to be load-bearing.
 *
 * The same reasoning the signup ticket grant already uses in auth.service.ts,
 * written down here because this is the file where somebody will be tempted to
 * "fix" the swallowed error.
 */
@Injectable()
export class UserEventService {
  private readonly log = new Logger(UserEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one step down. Returns true if it landed, false if it did not — which
   * callers are free to ignore, and every caller in Fayr does.
   */
  async record(event: RecordEvent): Promise<boolean> {
    try {
      await this.prisma.userEvent.create({
        data: {
          type: event.type,
          userId: event.userId ?? null,
          anonymousId: event.anonymousId ?? null,
          payload: event.payload ? { ...event.payload } : undefined,
          ...(event.at ? { at: event.at } : {}),
        },
      });
      return true;
    } catch (err) {
      // The name of the step and nothing else. A payload could in principle
      // carry something we would rather not put in a log line, and a log line is
      // the easiest place in the system to leak from.
      const why = err instanceof Error ? err.message : String(err);
      this.log.warn(`could not record ${event.type}: ${why}`);
      return false;
    }
  }

  /**
   * Write one down only if this person has never had one of this kind before.
   *
   * For the steps that are about a FIRST time — the first claim, the first time
   * setup finished. Two calls a second apart must not become two rows, because
   * "how many people ever claimed" would then count one person twice.
   *
   * NOT a database constraint on purpose. A unique index on (userId, type) would
   * be wrong for APP_OPENED, which is supposed to repeat, and a partial index
   * naming individual enum values is a migration every time the list changes.
   * The race it leaves open — two genuinely simultaneous first claims by one
   * person — is not reachable through the app, and its cost is one duplicated
   * row in a chart rather than anything about money.
   */
  async recordOnce(event: RecordEvent): Promise<boolean> {
    if (!event.userId) return this.record(event);
    try {
      const already = await this.prisma.userEvent.findFirst({
        where: { userId: event.userId, type: event.type },
        select: { id: true },
      });
      if (already) return false;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.log.warn(`could not check for an earlier ${event.type}: ${why}`);
      return false;
    }
    return this.record(event);
  }
}
