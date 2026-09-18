import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { theFayrScore } from './fayr-score';
import { toReviewResponse, type ReviewResponse } from './review.response';

/**
 * THE REVIEW A PERSON WROTE INSIDE FAYR.
 *
 * ── THIS SERVICE MOVES NO MONEY, AND THAT IS NOT AN OVERSIGHT ──────────────
 *
 * Writing a review here releases no refund, advances no task state, writes no
 * ledger entry and touches no wallet. There is deliberately no call to the task
 * engine in this file and there must never be one.
 *
 * The refund still waits on exactly what it waited on before: the shop's own
 * page still showing the rating after the return window closes. A review is the
 * thing a brand is paying for; it is not the thing that proves a purchase, and
 * letting it become one would mean anybody who can type can be paid.
 *
 * ── AND THE TEXT IS STORED EXACTLY AS IT WAS TYPED ─────────────────────────
 *
 * No trim, no whitespace collapsing, no case folding, no correction, no reflow —
 * on the way in or the way out. The score is worked out from a throwaway tidied
 * COPY inside fayr-score.ts; the copy never leaves that file and what lands in
 * the column is the original string.
 *
 * ── THE SERVER SCORES WHAT IT STORES ───────────────────────────────────────
 *
 * The app has its own copy of the scorer so it can answer as somebody types, and
 * it never sends the number. A score arriving from a phone is a score somebody
 * can set to whatever they like, and a number nobody can vouch for is not worth
 * a column.
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The task, if it is really theirs.
   *
   * A task belonging to somebody else reads as 404 and never as 403, so this
   * cannot be used to find out whether a task id exists — the same rule every
   * other task route in this project follows.
   */
  private async ownTask(userId: string, taskId: string) {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw new NotFoundException('Task not found');
    return row;
  }

  /** What they have written so far, or null. */
  async read(userId: string, taskId: string): Promise<ReviewResponse | null> {
    await this.ownTask(userId, taskId);
    const row = await this.prisma.taskReview.findUnique({ where: { taskId } });
    return row ? toReviewResponse(row) : null;
  }

  /**
   * Write it, or write over it.
   *
   * ── ONLY FOR A TASK WHOSE ORDER THE SERVER HAS ALREADY MATCHED ───────────
   *
   * `orderId` is the promoted column set when an order is chosen for this task.
   * With none, nobody has confirmed that this person bought this product — and a
   * review about a purchase nobody has confirmed is a review about nothing. It
   * would also be the obvious way to fill the table with writing about things
   * that were never bought.
   *
   * REWRITING IS ALLOWED, and on purpose: somebody who thinks of something else
   * an hour later should be able to add it. One row per task, so the last thing
   * they wrote is what is theirs.
   */
  async write(
    userId: string,
    taskId: string,
    text: string,
    stars: number | null,
  ): Promise<ReviewResponse> {
    const task = await this.ownTask(userId, taskId);
    if (task.orderId == null) {
      throw new ConflictException(
        'We have not matched an order for this task yet',
      );
    }

    // THE STARS ARE STORED AND NOTHING IS DECIDED FROM THEM. No branch in this
    // file reads the number, and nothing downstream may: a one-star rating is
    // paid exactly as a five-star one is. Null when they have not said, which is
    // never read as a zero.
    //
    // THE SERVER'S OWN ANSWER, from the text it is about to store. Nothing the
    // phone sent is read here, because nothing the phone sent could be trusted.
    const scored = theFayrScore(text);

    const row = await this.prisma.taskReview.upsert({
      where: { taskId },
      // EXACTLY WHAT THEY TYPED, on both branches. No .trim() anywhere in this
      // file, and there is a check that refuses one.
      create: { taskId, text, score: scored.score, band: scored.band, stars },
      update: { text, score: scored.score, band: scored.band, stars },
    });
    return toReviewResponse(row);
  }
}
