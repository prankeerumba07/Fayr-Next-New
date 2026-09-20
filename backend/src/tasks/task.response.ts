import type { Campaign, Task } from '@prisma/client';
import { resolveChargedPaise } from './engine/charged-amount';
import { computeRefundPaise } from './engine/money';
import { policyForWindowDays } from './engine/return-policy';
import type { TaskStateName } from './engine/states';
import { refundEligibility } from './engine/transition';
import { toEngineTask } from './task.mapper';
import { messageFor } from './engine/journey-message';
import { platformDisplayName } from '../common/platform-name';

/**
 * The public shape of a task. Money is integer paise as decimal STRINGS (JSON
 * has no BigInt), dates are ISO strings — the 1.4 convention. Includes a compact
 * campaign summary so the client can render the task without a second fetch, and
 * a refund block that says whether it can release and, if not, exactly why.
 */
export interface TaskResponse {
  id: string;
  state: TaskStateName;
  campaign: {
    id: string;
    title: string;
    productName: string;
    platform: string;
    category: string | null;
    ticketCost: number;
    payoutPercent: number;
    imageUrl: string | null;
  };
  order: {
    id: string | null;
    itemPaise: string | null;
    /**
     * The two NAMED money fields, sent because the device runs its own copy of
     * resolveChargedPaise and these are two of its six inputs.
     *
     * They were stored, they decided the payout, and they were never sent — so a
     * staff-confirmed per-unit price paid a refund the screen could not show a
     * price for, and the device's resolver was answering a money question with
     * half its evidence missing. See src/chargedAmount.test.mjs, which reads the
     * resolver's inputs out of its own source and checks every one arrives.
     */
    unitPricePaise: string | null;
    lineTotalPaise: string | null;
    /** Units on the line. NULL = unknown, which is never read as 1. */
    quantity: number | null;
    orderTotalPaise: string | null;
    /**
     * WHAT THE SHOP'S PAGE STATED FOR THE OFFER'S OWN PRODUCT, or null.
     *
     * THE ROW THE SCREEN SHOWS AS THE PRODUCT'S PRICE, and the reason it exists.
     * On the owner's own order — a garment rack at ₹938.00 and a bathroom shelf
     * at ₹388.00 under one order number, ₹1,331.00 the bill — the task carried no
     * per-product figure at all, so the screen fell back to the only money it had
     * and printed "Order amount ₹1,331.00" beside a product that cost ₹938.00.
     *
     * NOT A RESOLVER INPUT, unlike the two named fields above it, and that is the
     * point. `refund.basedOnPaise` is the only figure a payout is worked out
     * from; this one is shown. See EvidenceOrder.matchedPricePaise for the rule
     * and for the check that keeps resolveChargedPaise away from it.
     *
     * IT IS PRESENT BEFORE THE AMOUNT IS VERIFIED, which is the whole point: a
     * task whose price is still with a staff member can show what the page said
     * the product cost, instead of showing the bill.
     */
    matchedPricePaise: string | null;
    /** Also a resolver input: more than one amount was found in the item's row. */
    itemAmountAmbiguous: boolean;
    /**
     * WHY WHAT THEY PAID IS NOT WHAT THE OFFER SAID, on a purchase Fayr watched.
     *
     * One of the names in engine/watched-price.ts, or null on every other task.
     * Carried so the staff user page can say it in words: until now the panel
     * could show a refund that was not the offer's percentage of the offer's
     * price and had nothing anywhere to explain the difference.
     *
     * SHOWN, AND NEVER READ TO DECIDE ANYTHING. See EvidenceOrder.priceGapReason.
     */
    priceGapReason: string | null;
    match?: {
      score?: number | null;
      amountOk?: boolean | null;
      ambiguous?: boolean;
      candidateCount?: number | null;
    } | null;
    /** True once the user has explicitly confirmed this is their order. */
    orderConfirmed?: boolean;
    product: string | null;
    date: string | null;
    /**
     * THE DAY THE SHOP PRINTED, AS IT PRINTED IT — "2026-06-02" — or null.
     *
     * A DIFFERENT FACT FROM `date` ABOVE, and the reason both are sent. `date` is
     * an instant precise enough to test against the purchase window, and a shop
     * that prints only a day very often cannot give one: dateToSubmit leaves it
     * off rather than inventing a time, which is right and is not weakened here.
     *
     * But the day was READ, and it was on the record all along in `dateRaw` — so
     * a screen showing "Order date: Not available" beside an order whose page
     * plainly says 2 June was telling somebody we had not read something we had.
     * Measured on the owner's own task, 16 September 2026.
     *
     * IT IS FOR SHOWING AND NEVER FOR DECIDING. No gate reads it, no window is
     * tested against it, and no refund is computed from it.
     */
    dateRaw: string | null;
    source: string | null;
    /**
     * The order's own product photo and marketplace status line. Collected by the
     * readers, sent, validated and STORED — but until now never returned, so the
     * Task screen rendered `task.order.image` / `task.order.statusText` that were
     * always undefined once the authoritative snapshot replaced the optimistic
     * copy. Same class of bug as `match`: dropped at the boundary, not at source.
     */
    image: string | null;
    statusText: string | null;
  } | null;
  delivery: { at: string; source: string | null } | null;
  review: {
    published: boolean;
    rating: number | null;
    product: string | null;
  } | null;
  returned: boolean | null;
  blocker: string | null;
  blockerReason: string | null;
  windowEndsAt: string | null;
  refund: {
    eligible: boolean;
    reasons: string[];
    /** What would be paid if released now, integer paise as a string, or null. */
    amountPaise: string | null;
    /**
     * WHICH price that was worked out from — the resolved charged amount, from the
     * same resolveChargedPaise call the payout uses.
     *
     * Sent so a screen can show the figure the refund is actually based on instead
     * of picking a raw field and hoping it is the same one. On a staff-confirmed
     * amount it is the only price the client has; on a discounted Flipkart order
     * it is the order total rather than the item's listed line. Null whenever no
     * figure could be decided, which is the same condition as amountPaise being
     * null — one resolver, one answer, never two.
     */
    basedOnPaise: string | null;
  };
  claimExpiresAt: string | null;
  /**
   * THEY TAPPED BUY AND WENT TO THE SHOP, or they have not. Null means not.
   *
   * The app needs this to know which of two things to draw: the button that sends
   * somebody to the shop, or the message asking whether they have bought it yet.
   */
  wentToShopAt: string | null;
  /** When the two hour hold ends. Null until the tap above is recorded. */
  shopHoldEndsAt: string | null;
  /**
   * THEY TAPPED THROUGH TO WRITE THE REVIEW, or they have not. Null means not.
   *
   * The review step draws three different things off this: the guide before they
   * have gone, the question when they come back, and the line that says how long
   * ago they told us they posted it.
   */
  wentToReviewAt: string | null;
  /**
   * THE KEY IN THE ADDRESS OF THE ORDER FAYR WATCHED BEING PLACED, or null.
   *
   * Sent so the phone can open THAT ONE order page for the order read, the
   * delivery read and the review read — from any phone, after any reinstall —
   * instead of walking the shop's list. It is an address fragment and not the
   * order number: `order.id` above is the number the page prints and the refund
   * gate compares. Neither goes in the other's place. See tasks.watchedOrderKey
   * in schema.prisma and engine/watched-order.ts.
   */
  watchedOrderKey: string | null;
  /**
   * The pop-up's own words, frozen at the tap, with the real time inside them.
   *
   * The screen draws THESE rather than writing its own, so the sentence kept as
   * the record and the sentence a person read are one sentence and not two.
   */
  shopVisitNoticeText: string | null;
  /**
   * HOW MANY DAYS THE ORDER WINDOW WAS WIDENED BY, FOR TESTING. Null on every
   * real task, and null is what it stays unless the setting is on AND the live
   * database's own name ends in _dev or _test.
   *
   * ── ON THE RESPONSE SO THE STAFF PANEL CAN SHOW IT ────────────────────────
   *
   * The owner's requirement, in his words: "every task it touches is MARKED as
   * having used it, and the staff panel shows the mark, so a widened match can
   * never be mistaken for a real one". The panel reads the same task response the
   * app does, so putting it here is what puts it in front of a person deciding
   * whether to release money.
   *
   * A NUMBER AND NOT A YES OR NO, because a window widened by one day and one
   * widened by three years are different claims about how much was let through.
   */
  practiceWindowDays: number | null;
  /**
   * ONE MESSAGE FOR THIS PERSON ABOUT THIS CAMPAIGN AT THIS MOMENT, or null.
   *
   * The owner's rule, in his words: "There should not be any different messages
   * for the same campaign on different pages." So it is written ONCE, here, and
   * the three places that show it READ it: the small bar above the bottom
   * navigation and the My Products list take `short`, and the opened My Products
   * screen takes `long`. No screen writes its own wording for a campaign's state.
   *
   * `short` is literally the opening of `long`, by construction. See
   * engine/journey-message.ts.
   *
   * NULL IS A REAL ANSWER: a task nobody has taken to the shop yet has no
   * message, and the screen for that has its own button instead.
   */
  message: { key: string; short: string; long: string } | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoEpoch = (ms: number | null | undefined): string | null =>
  ms != null ? new Date(ms).toISOString() : null;

/** Build the public task response from a row and its campaign. */
export function toTaskResponse(
  row: Task,
  campaign: Campaign,
  now: number = Date.now(),
  /**
   * THE REHEARSAL HOLD, AND IT IS THE THIRD ARGUMENT THE PAYOUT USES.
   *
   * ── MEASURED, 21 SEPTEMBER 2026 ──────────────────────────────────────────
   *
   * persist() writes windowEndsAt with this; this function did not take it, so
   * the screen recomputed the product's own three hours instead. A rehearsal
   * read "Your refund unlocks in 2 hours, due at 3:57 am" and the money landed
   * two minutes later. Two answers to one question, and the wrong one was the
   * one a person could see.
   *
   * ABSENT MEANS THE PRODUCT'S OWN HOLD, which is what every real deployment
   * gets: only PracticeWindowService produces a positive number here, and only
   * on a practice database. See policyForWindowDays.
   */
  practiceHoldMs: number | null = null,
): TaskResponse {
  const task = toEngineTask(row, []);
  // THE SAME THREE ARGUMENTS THE PAYOUT USES, so the date a screen shows is the
  // date the money actually waits for. See policyForWindowDays.
  const policy = policyForWindowDays(
    campaign.returnWindowDays,
    campaign.platform,
    practiceHoldMs,
  );
  const elig = refundEligibility(task, now, policy);

  // THE SCREEN MUST NEVER PROMISE A NUMBER THE PAYOUT WOULD REFUSE.
  //
  // This used to read task.order.itemPaise DIRECTLY — the one thing attemptRelease
  // explicitly warns against — so the amount shown bypassed every money rule. It
  // could show a listed price where the payout would pay the charged one (the live
  // Flipkart case: 367 shown, 328 paid), and with the quantity rule it would show a
  // line total's worth for an order whose units we cannot count.
  //
  // Both now come from the same resolver, so display and payout agree by
  // construction. needsStaff means no number is shown at all, which is honest: a
  // figure a human still has to confirm is not a promise we can make.
  const charged = resolveChargedPaise(task.order);
  const amountPaise =
    charged.paise != null
      ? computeRefundPaise(
          charged.paise,
          campaign.payoutPercent,
          campaign.payoutCapPaise,
        )
      : null;

  return {
    id: row.id,
    state: task.state,
    campaign: {
      id: campaign.id,
      title: campaign.title,
      productName: campaign.productName,
      platform: campaign.platform,
      category: campaign.category,
      ticketCost: campaign.ticketCost,
      payoutPercent: campaign.payoutPercent,
      imageUrl: campaign.imageUrl,
    },
    order: task.order
      ? {
          id: task.order.id,
          // The raw line figure, for display and support. Distinct from the refund
          // basis above on purpose: this is what the order says, that is what we
          // would actually pay.
          itemPaise:
            task.order.itemPaise != null ? task.order.itemPaise.toString() : null,
          unitPricePaise:
            task.order.unitPricePaise != null
              ? task.order.unitPricePaise.toString()
              : null,
          lineTotalPaise:
            task.order.lineTotalPaise != null
              ? task.order.lineTotalPaise.toString()
              : null,
          quantity: task.order.quantity ?? null,
          orderTotalPaise:
            task.order.orderTotalPaise != null
              ? task.order.orderTotalPaise.toString()
              : null,
          matchedPricePaise:
            task.order.matchedPricePaise != null
              ? task.order.matchedPricePaise.toString()
              : null,
          itemAmountAmbiguous: task.order.itemAmountAmbiguous === true,
          priceGapReason: task.order.priceGapReason ?? null,
          product: task.order.product ?? null,
          date: isoEpoch(task.order.date),
          // Straight off the record, unchanged. See the field's own comment: it
          // is shown and never decides anything.
          dateRaw: task.order.dateRaw ?? null,
          source: task.order.source ?? null,
          // Returned so the "is this your order?" screen can still warn AFTER the
          // authoritative response lands. Dropping it here is what silently
          // disarmed those warnings on every round trip.
          match: task.order.match ?? null,
          orderConfirmed: task.orderConfirmed === true,
          image: task.order.image ?? null,
          statusText: task.order.statusText ?? null,
        }
      : null,
    delivery: task.delivery
      ? {
          at: new Date(task.delivery.at).toISOString(),
          source: task.delivery.source,
        }
      : null,
    review: task.review
      ? {
          published: task.review.published,
          rating: task.review.rating ?? null,
          product: task.review.product ?? null,
        }
      : null,
    returned: task.returned,
    blocker: task.blocker,
    blockerReason: task.blockerReason,
    windowEndsAt: isoEpoch(elig.windowEndsAt),
    refund: {
      eligible: elig.eligible,
      reasons: elig.reasons,
      amountPaise: amountPaise != null ? amountPaise.toString() : null,
      basedOnPaise: charged.paise != null ? charged.paise.toString() : null,
    },
    claimExpiresAt: iso(row.claimExpiresAt),
    wentToShopAt: iso(row.wentToShopAt),
    shopHoldEndsAt: iso(row.shopHoldEndsAt),
    wentToReviewAt: iso(row.wentToReviewAt),
    watchedOrderKey: row.watchedOrderKey ?? null,
    shopVisitNoticeText: row.shopVisitNoticeText ?? null,
    practiceWindowDays: row.practiceWindowDays ?? null,
    // BUILT HERE AND NOWHERE ELSE. `now` is the same instant the rest of this
    // response was built from, so the message and the eligibility above cannot
    // disagree about what time it is.
    //
    // WHAT IS HONESTLY NOT WIRED YET: `lookedAndFoundNothing`. There is no record
    // of a completed unsuccessful look anywhere in the schema, so the
    // "we could not find your order" message is built and checked but cannot yet
    // be reached from a real task. It arrives with the checking screen in steps 8
    // to 12. Said here rather than faked with a guess.
    message: messageFor({
      wentToShopAt: row.wentToShopAt?.getTime() ?? null,
      shopHoldEndsAt: row.shopHoldEndsAt?.getTime() ?? null,
      shopName: platformDisplayName(campaign.platform) ?? campaign.platform,
      orderWaitingToBeConfirmed:
        task.order != null && task.orderConfirmed !== true,
      now,
    }),
    closedAt: iso(row.closedAt),
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
  };
}
