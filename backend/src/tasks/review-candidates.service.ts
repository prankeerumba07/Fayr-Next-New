import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dayFromText } from '../ocr/order-comparison';
import {
  matchReviewToCampaign,
  type ReviewMatchReason,
} from '../ocr/review-comparison';
import { parseReviewText, type ParsedReview } from '../ocr/review-text';
import { SOURCES } from './engine/states';
import { TaskService } from './task.service';
import type { TaskResponse } from './task.response';
import type { SubmitEvidenceDto } from './dto/submit-evidence.dto';

/**
 * THE REVIEWS THE PHONE FOUND, READ AND JUDGED HERE.
 *
 * THE PHONE LOOKS. THE SERVER JUDGES AND REMEMBERS. Exactly the division the
 * order read already keeps, and for the same reason: the person is signed in to
 * the shop inside Fayr's own web view and that sign in lives on the device, so
 * only the phone can open somebody's own list of reviews. It sends TEXT. Whether
 * any of that text is a review of the campaign's product is decided here.
 *
 * ── WHY `published` IS SETTLED HERE AND NOWHERE ELSE ──────────────────────
 *
 * `published` is the payout signal. It is the one fact that separates a task
 * that gets paid from one that does not, and the DTO has no field for it for
 * exactly that reason.
 *
 * WHAT ESTABLISHES IT: the permalink was readable and stated a review of this
 * product. SOURCES.REVIEW_PUBLIC already describes itself as "a machine
 * established that the review is PUBLICLY VISIBLE — either by fetching the public
 * permalink (Amazon...)", so this is that source doing the thing it was named
 * for, not a new authority invented here.
 *
 * ── AND WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * IT DOES NOT REFUSE A BAD REVIEW. Not on the star, not on the length, not on
 * the words. Fayr pays for an honest review and has no opinion about what it
 * says. matchReviewToCampaign carries the same rule and a check that fails if
 * anybody adds one.
 *
 * IT DOES NOT PAY ANYBODY. A matched review moves the task to REVIEWED through
 * the ordinary evidence funnel. The hold, the return window and the re-check
 * that follows are unchanged and still decide the money.
 */
export interface ReviewLookAnswer {
  /** True when one of the pages was a review of this campaign's product. */
  matched: boolean;
  /** Why, in one word. Named even on success, so a log line always says. */
  reason: ReviewMatchReason | 'nothing_readable';
  /** What was read off the matching page. Absent when nothing matched. */
  review?: {
    title: string | null;
    rating: number | null;
    reviewDay: string | null;
    verifiedPurchase: boolean;
  };
  /** The task as it stands after the evidence was applied. */
  task?: TaskResponse;
}

@Injectable()
export class ReviewCandidatesService {
  private readonly log = new Logger(ReviewCandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
  ) {}

  /** The caller's own task, with its campaign. 404 if it is not theirs. */
  private async ownTask(userId: string, taskId: string) {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Task not found');
    }
    return row;
  }

  /**
   * Read every review page the phone opened and answer whether one of them is
   * this campaign's.
   *
   * THE FIRST MATCH WINS AND THE REST ARE NOT READ FURTHER. A person cannot
   * write two reviews of one product on Amazon, so a second match would be the
   * same review reached twice.
   */
  async record(
    userId: string,
    taskId: string,
    pages: string[],
  ): Promise<ReviewLookAnswer> {
    const task = await this.ownTask(userId, taskId);

    // COUNTS AND LENGTHS ONLY, NEVER THE WORDS. The argument in hand is what
    // somebody wrote under their own name, and none of it belongs in a log.
    this.log.log(
      `reviews-found task=${taskId} pages=${pages.length} `
      + `lens=[${pages.map((p) => (typeof p === 'string' ? p.length : 0)).join(',')}]`,
    );

    let readAnything = false;
    for (const raw of pages) {
      const text = typeof raw === 'string' ? raw : '';
      const parsed: ParsedReview = parseReviewText(text, dayFromText);
      if (parsed.product != null) readAnything = true;

      const answer = matchReviewToCampaign(parsed, {
        productName: task.campaign.productName,
      });
      if (!answer.matches) continue;

      const after = await this.applyIt(userId, taskId, parsed);
      this.log.log(
        `reviews-found task=${taskId} matched=yes star=${parsed.rating ?? 'none'} `
        + `verified=${parsed.verifiedPurchase} day=${parsed.reviewDay ?? 'none'}`,
      );
      return {
        matched: true,
        reason: 'matched',
        review: {
          title: parsed.title,
          rating: parsed.rating,
          reviewDay: parsed.reviewDay,
          verifiedPurchase: parsed.verifiedPurchase,
        },
        task: after,
      };
    }

    // TWO DIFFERENT EMPTY ANSWERS, TOLD APART. "We could not read any of these
    // pages" and "we read them and none was this product" are opposite problems
    // with opposite fixes, and one silence covering both is what cost a whole
    // afternoon on the order read.
    const reason: ReviewLookAnswer['reason'] = readAnything
      ? 'product_name_not_found'
      : 'nothing_readable';
    this.log.log(`reviews-found task=${taskId} matched=no reason=${reason}`);
    return { matched: false, reason };
  }

  /**
   * Hand the matched review to the evidence funnel, the same road every other
   * fact about this task travels.
   *
   * THE KEY CARRIES THE DAY, so re-posting the same review on a later look
   * collapses to one event instead of a run of them, while a review EDITED on a
   * different day is a new fact and applies.
   */
  private async applyIt(
    userId: string,
    taskId: string,
    parsed: ParsedReview,
  ): Promise<TaskResponse> {
    const dto: SubmitEvidenceDto = {
      key: `review-public:${taskId}:${parsed.reviewDay ?? 'na'}`,
      review: {
        published: true,
        // THE ONLY SOURCE THAT MAY SETTLE `published` WITHOUT A PERSON, and it
        // is settled by the permalink having been readable — which is what that
        // source already says of itself in states.ts.
        publishedSource: SOURCES.REVIEW_PUBLIC,
        ...(parsed.product == null ? {} : { product: parsed.product }),
        ...(parsed.rating == null ? {} : { rating: parsed.rating }),
        ...(parsed.reviewDay == null
          ? {}
          : { reviewDate: Date.parse(`${parsed.reviewDay}T12:00:00.000Z`) }),
      },
    };
    const after = await this.tasks.submitEvidence(userId, taskId, dto);

    // ── AND THE TWO EVENTS THAT ACTUALLY MOVE THE TASK ──────────────────────
    //
    // EVIDENCE ALONE DOES NOT. transition() moves a task to PURCHASED on an
    // order and to DELIVERED on a delivery, and stops there: REVIEWED is reached
    // by MARK_REVIEWED and HOLDING by START_HOLD, both separate events. A
    // service that submitted the review and walked away would leave a task that
    // KNOWS about a public review and is still sitting on DELIVERED — which
    // looks, from the phone, exactly like nothing having happened.
    //
    // ATTEMPTED, NEVER ASSUMED, for the reason chooseMine records at the same
    // seam: if a gate refuses either step there is nothing to move, and the
    // journey works its own step out from the record either way.
    //
    // AND START_HOLD IS THE ONE THAT CHECKS. It refuses unless the review is
    // published NOW — see onStartHold — so a review that was read but not
    // established as public leaves the task at REVIEWED with the blocker on it
    // rather than quietly entering a hold that ends in a payout.
    let moved = after;
    try {
      moved = await this.tasks.markReviewed(userId, taskId);
    } catch {
      return moved;
    }
    try {
      return await this.tasks.startHold(userId, taskId);
    } catch {
      return moved;
    }
  }
}
