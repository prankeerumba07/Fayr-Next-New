import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What came back, so the caller can say whether this was the first time. */
export interface ShopSignInRecorded {
  platform: Platform;
  firstAt: Date;
  /** False when a row for this person and this shop was already there. */
  wasTheFirstTime: boolean;
}

/**
 * WRITING DOWN THAT SOMEBODY SIGNED IN AT A SHOP.
 *
 * ONE OF THE TWO STEPS IN THE WHOLE JOURNEY THAT NOTHING RECORDED. Until this,
 * Fayr could not tell somebody who never went to the shop from somebody who went
 * and gave up: both looked identical from our side, because signing in happens on
 * the shop's own page and nothing about it reached us.
 *
 * ONCE, FOR EVER, AND THE DATABASE IS WHAT MAKES THAT TRUE. There is one row per
 * person per shop, held by a rule on the table itself, so however many times the
 * shop's page is opened there is one row. `firstAt` is never moved, because the
 * question the row answers is "did they get this far", and a moment that keeps
 * sliding forward cannot answer it.
 *
 * WHAT IT DELIBERATELY DOES NOT STORE: no password, no code, no cookie, no token,
 * no account number. Fayr never sees a single thing somebody types on a shop's
 * page, so there is nothing of that kind to store even by mistake.
 *
 * IT MOVES NO MONEY. A row here does not advance a task, does not release a
 * refund, and is not evidence of anything about an order.
 *
 * ── IT DOES NOW OPEN ONE GATE, AND THAT LINE USED TO SAY IT OPENED NONE ─────
 *
 * It decides whether to ASK A SHOP FOR ITS SIGN IN PAGE AGAIN, and that turned
 * out to matter more than anything else this table does. Measured from the
 * owner's own log on 9 September 2026: Amazon connect succeeded at 19:06, the app
 * asked Amazon for its sign in page again four minutes later for a second
 * campaign, and Amazon answered with a page reading only "Click the button below
 * to continue shopping", then 503 on /gp/sign-in.html, then its robot puzzle.
 * Amazon had decided we were a machine.
 *
 * The app was asking because it did not know. It kept its own note of having
 * connected in a file on the phone, keyed by CAMPAIGN, so a second campaign at
 * the same shop looked like a shop nobody had ever signed in to. This table has
 * held the real answer since 4 September — one row per person per shop, for ever
 * — and nothing had ever read it back. So `platformsConnected` exists, and the
 * gate reads it.
 *
 * A row still opens no gate about MONEY, and that part of the old note stands.
 */
@Injectable()
export class ShopSignInService {
  private readonly log = new Logger(ShopSignInService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write it down, or leave the row that is already there exactly as it is.
   *
   * IDEMPOTENT BY THE DATABASE AND NOT BY A READ FIRST. Looking for a row and
   * then writing one is two steps, and two requests arriving together both find
   * nothing and both write. This is one statement: the rule on the table decides,
   * and a second call updates nothing at all.
   */
  /**
   * WHICH SHOPS THIS PERSON IS ALREADY SIGNED IN AT.
   *
   * ── WHY THE ANSWER IS A LIST OF SHOPS AND NOT THE ROWS ─────────────────────
   *
   * The caller's question is "do we need to ask this shop for its sign in page",
   * and the only thing that answers it is which shops are in the list. Handing
   * back the rows would hand back `firstAt` as well, and a moment is exactly the
   * sort of thing a screen starts drawing once it can see it — at which point
   * this table's one honest fact, "they got this far at least once", has quietly
   * become a claim about when, which is not what it means.
   *
   * ORDERED, so two calls cannot answer the same thing in two orders and make a
   * check that compares them flap.
   */
  async platformsConnected(userId: string): Promise<Platform[]> {
    const rows = await this.prisma.shopSignIn.findMany({
      where: { userId },
      select: { platform: true },
      orderBy: { platform: 'asc' },
    });
    return rows.map((r) => r.platform);
  }

  async record(
    userId: string,
    platform: Platform,
    howWeKnew: string,
  ): Promise<ShopSignInRecorded> {
    const before = await this.prisma.shopSignIn.findUnique({
      where: { userId_platform: { userId, platform } },
      select: { firstAt: true },
    });

    const row = await this.prisma.shopSignIn.upsert({
      where: { userId_platform: { userId, platform } },
      create: { userId, platform, howWeKnew },
      // NOTHING. Not the moment, not the reason. A second sign in at the same
      // shop is the same fact, and moving the moment forward would lose the
      // answer to the only question this row exists for.
      update: {},
      select: { platform: true, firstAt: true },
    });

    const wasTheFirstTime = before == null;
    if (wasTheFirstTime) {
      this.log.log(`shop sign in recorded: ${platform}`);
    }
    return { platform: row.platform, firstAt: row.firstAt, wasTheFirstTime };
  }
}
