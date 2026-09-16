import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { matchOrderToCampaign } from '../ocr/order-comparison';
import { orderWindow } from './engine/order-window';
import { ORDER_WINDOW_GRACE_MS } from './engine/order-window';
import {
  practiceCampaignFloor,
  practiceGraceMs,
} from './engine/practice-window';
import { PracticeWindowService } from './practice-window.service';
import { SOURCES } from './engine/states';
import {
  dateToSubmit,
  dayAsWritten,
  itemPriceIsCertain,
  itemsFromJson,
  itemsToJson,
  judgeFoundOrders,
  whatTheOrderAlreadySays,
} from './order-candidates';
import { resolveChargedPaise } from './engine/charged-amount';
import type { EvidenceOrder } from './engine/evidence.types';
import { toEngineTask } from './task.mapper';
import {
  toOrderCandidateResponse,
  type OrderCandidateResponse,
} from './order-candidate.response';
import { TaskService } from './task.service';
import type { TaskResponse } from './task.response';
import type { SubmitEvidenceDto } from './dto/submit-evidence.dto';

/**
 * THE ORDERS WE ASK SOMEBODY ABOUT AFTER THEY SAY THEY BOUGHT IT.
 *
 * THE PHONE LOOKS. THE SERVER JUDGES AND REMEMBERS. The phone can open the
 * shop's own list of recent orders because the sign in lives on the device. It
 * sends the TEXT of each order it found. This reads that text, decides whether
 * any of it is the campaign's product at the campaign's price, writes down its
 * own answer, and offers the matching ones back for the person to say yes or no
 * to.
 *
 * NOTHING THE PHONE SAYS ABOUT MATCHING IS ACCEPTED. There is no field for it on
 * the way in (see FoundOrdersDto), and the answer stored is always the one worked
 * out here.
 *
 * SAYING "YES, THAT IS MINE" GOES THROUGH THE EXISTING FUNNEL and no other way.
 * It builds the evidence from the STORED order — the one the server read and
 * judged, never anything sent with the tap — and hands it to
 * TaskService.submitEvidence, which is the same road the on-device scraper takes:
 * the order window rule, the plausibility gate, the promoted columns and the
 * refund gate all still apply, unchanged.
 */
/**
 * THE ONE PRODUCT ON THIS ORDER THAT THE OFFER IS ABOUT, AND WHAT IT COST.
 *
 * Asked of the SAME function that decided whether the order matched at all, so
 * the figure on the card and the figure the match was made on cannot be two
 * different numbers. Nothing is stored: the products are already on the row and
 * which product an offer is for is already on the campaign, so this is a reading
 * of two things we have rather than a third copy of either.
 *
 * ANSWERS THE CARD UNCHANGED when no product on the order is the campaign's.
 */
function theCampaignsOwnProduct(
  card: OrderCandidateResponse,
  items: { name: string; pricePaise: bigint }[],
  campaign: { productName: string | null; productPricePaise: bigint | null },
): OrderCandidateResponse {
  const answer = matchOrderToCampaign(
    { items },
    {
      productName: campaign.productName,
      expectedPricePaise: campaign.productPricePaise,
    },
  );
  if (answer.item == null) return card;
  return {
    ...card,
    matchedPricePaise: String(answer.item.pricePaise),
    matchedName: answer.item.name,
  };
}

/**
 * THE DELIVERY, AS THE EVIDENCE FUNNEL WANTS IT, OR NOTHING AT ALL.
 *
 * Spread into a DTO — `...theDeliveryFragment(row)` — so "the page did not say"
 * is an ABSENT field rather than a null one. The two are not the same to the
 * engine: absent leaves whatever is already known alone, and a null would be a
 * statement that there is no delivery.
 *
 * ONE BUILDER FOR BOTH CALLERS, and that is the point of it existing. Choosing
 * an order and looking again later both have to put the same facts in the same
 * shape, and two copies of that shape would eventually be two different shapes.
 */
export function theDeliveryFragment(
  row: {
    deliveryDate: Date | null;
    returnWindowEndsAt: Date | null;
    returned?: boolean | null;
  },
): { delivery?: { at: number; raw?: string; returnWindowEndsAt?: number; source: string } } {
  if (row.deliveryDate != null) {
    const raw = dayAsWritten(row.deliveryDate);
    return {
      delivery: {
        at: row.deliveryDate.getTime(),
        ...(raw == null ? {} : { raw }),
        // THE DATE THE PAYOUT WAITS FOR, when the page stated one. windowEnd takes
        // the LATER of this and the operator's policy table, so it can only ever
        // lengthen a hold — which is also what makes carrying it safe.
        ...(row.returnWindowEndsAt == null
          ? {}
          : { returnWindowEndsAt: row.returnWindowEndsAt.getTime() }),
        source: SOURCES.ORDER_HISTORY,
      },
    };
  }

  // ── WHEN THE PAGE NEVER SAYS "DELIVERED", BUT SAYS SOMETHING THAT ONLY ────
  // ── A DELIVERED ORDER CAN HAVE ───────────────────────────────────────────
  //
  // MEASURED ON THE OWNER'S OWN ACCOUNT, 16 September 2026. His order
  // 408-5614193-1514764, placed 11 February 2026, prints no delivery line
  // anywhere on its page — not "Delivered", not a date, not a word. The pattern
  // is his and it is consistent: orders from June onward state a delivery date,
  // and older ones have had it dropped.
  //
  // What that page DOES print is:
  //
  //   Return window closed on 26 February 2026
  //
  // THE ARGUMENT, WHICH IS THE OWNER'S AND IS SOUND. A return window is the time
  // somebody has to send a thing BACK. It cannot exist for a thing that never
  // arrived, and a shop does not start one before it does. So a stated return
  // window is the shop's own statement that the order was delivered — a weaker
  // wording of the same fact, not an inference about one.
  //
  // ── WHAT DATE IS PUT ON IT, AND WHY IT IS THE LATEST POSSIBLE ONE ────────
  //
  // We did not read a delivery day and none is invented. The instant recorded is
  // the END OF THE RETURN WINDOW, which is the LATEST moment the delivery could
  // have happened — delivery is always on or before it, never after.
  //
  // THAT IS THE ONLY DIRECTION THAT IS SAFE, and the file next door already says
  // why in its own words: windowEnd takes the later of delivery-plus-policy and
  // the shop's stated end, "so the worst a forged value can do is hold somebody's
  // own refund longer". A date later than the truth lengthens a hold. The order
  // date, which is the other date on the page, would SHORTEN one whenever the
  // operator's policy runs longer than the shop's window — and that is money
  // paid sooner than it was promised.
  //
  // ── AND NO `raw` ─────────────────────────────────────────────────────────
  //
  // `raw` is the day AS WRITTEN on the page. Nothing was written, so nothing is
  // recorded there. The record says a delivery instant it derived, and does not
  // claim a shop printed a day it never printed.
  //
  // ── THE TWO GUARDS, AND BOTH ARE NEEDED ──────────────────────────────────
  //
  // A RETURNED ORDER IS NOT ONE TO PAY FOR, whatever its window said. Only
  // `true` refuses: the tri-state's `null` means the page said nothing either
  // way, which is not a statement that it went back.
  //
  // AND A CANCELLED ORDER NEVER REACHES HERE, because a cancelled order has no
  // return window to state — measured on his own cancelled order, which prints
  // "Cancelled" and a refund note and no window at all. Requiring the window is
  // what excludes it, which is worth writing down because `returned` alone would
  // NOT: RETURN_MENTIONED matches the word "cancel", so a cancelled order reads
  // as returned:false.
  if (row.returnWindowEndsAt == null) return {};
  if (row.returned === true) return {};
  return {
    delivery: {
      at: row.returnWindowEndsAt.getTime(),
      returnWindowEndsAt: row.returnWindowEndsAt.getTime(),
      // THE PAGE IT CAME OFF, which is the order's own detail page, and it is
      // attested: a machine read it off the marketplace and no claimant chose
      // it. Not a rank of its own — the same rank as a delivery date read in
      // words, so that a later look that DOES find one replaces this rather
      // than being refused by it.
      source: SOURCES.ORDER_HISTORY,
    },
  };
}

@Injectable()
export class OrderCandidatesService {
  /**
   * THE ONE HOLE THE DATABASE CANNOT COVER, and it is exactly the hole the
   * owner's 11 September attempt fell into.
   *
   * record() deletes the old candidates and then returns BEFORE createMany when
   * nothing was judged. So a request that arrived carrying no readable pages
   * leaves the database in precisely the state of a request that never arrived:
   * no order_candidates row, no task event, nothing. These two lines are the
   * only place that difference is ever written down.
   *
   * COUNTS AND REASON NAMES ONLY. The argument in hand is the TEXT of somebody's
   * order pages, carrying their name and their delivery address, and none of it
   * goes anywhere near this — only each page's character count and the reader's
   * own one word verdict.
   */
  private readonly log = new Logger(OrderCandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
    private readonly practiceWindow: PracticeWindowService,
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
   * Read and keep what the phone found. Returns them newest first.
   *
   * ONE LOOK REPLACES THE LAST. Looking again is the ordinary thing to do — the
   * person may have bought the product since — and two looks' worth of orders
   * side by side would show the same order twice.
   *
   * ONCE ONE HAS BEEN CHOSEN, THE LIST IS NOT REPLACED. The task already has its
   * order and is past this question; replacing the list would delete the row that
   * says which order somebody said was theirs.
   *
   * ── BUT THE LOOK IS NO LONGER THROWN AWAY, AND THAT IS THE DELIVERY ──────
   *
   * It used to return here and do nothing else, which meant the one read that
   * matters most could never happen. A delivery arrives DAYS after the order is
   * confirmed, so at the moment somebody says "that one is mine" the page very
   * often does not state a delivery yet. Every later look — which is exactly
   * what the delivery step runs — came back to this line and stopped.
   *
   * So a later look may now add to the chosen order, and only add:
   *
   *   THE ORDER NUMBERS MUST MATCH. The fresh page is matched to the chosen row
   *     by the shop's own order number, exactly. A chosen row with no order
   *     number takes nothing, because there is no way to be sure it is the same
   *     purchase and guessing here would attach one order's delivery to another.
   *   ONLY NULLS ARE FILLED. A fact already on the row is never rewritten, so a
   *     later read cannot move a delivery date that has already been acted on.
   *   NOTHING ELSE IS TOUCHED. Not the position, not the items, not the price,
   *     not matches, not chosenAt. The row's identity is frozen; what the shop
   *     says about it afterwards is not.
   */
  async record(
    userId: string,
    taskId: string,
    pages: string[],
  ): Promise<OrderCandidateResponse[]> {
    const task = await this.ownTask(userId, taskId);

    const already = await this.prisma.orderCandidate.findFirst({
      where: { taskId, chosenAt: { not: null } },
    });
    if (already) {
      await this.deliveryFromALaterLook(
        userId,
        task,
        // READ ONCE, HERE, because this is the only place that holds the whole
        // row. Both halves of a later look then judge the same order.
        toEngineTask(task, []).order,
        already,
        pages,
      );
      return this.list(userId, taskId);
    }

    this.log.log(
      `orders-found task=${taskId} pages=${pages.length} `
      + `lens=[${pages.map((p) => (typeof p === 'string' ? p.length : 0)).join(',')}]`,
    );

    const judged = judgeFoundOrders(pages, {
      productName: task.campaign.productName,
      productPricePaise: task.campaign.productPricePaise,
    });

    this.log.log(
      `orders-found task=${taskId} judged=${judged.length} `
      + `matched=${judged.filter((j) => j.matches).length} `
      + `reasons=[${judged.map((j) => j.reason).join(',')}]`,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.orderCandidate.deleteMany({ where: { taskId } });
      if (judged.length === 0) return;
      await tx.orderCandidate.createMany({
        data: judged.map((j) => ({
          taskId,
          position: j.position,
          source: 'ORDER_LIST' as const,
          orderNumber: j.orderNumber,
          orderDate: j.orderDate,
          totalPaise: j.totalPaise,
          deliveryDate: j.deliveryDate,
          returnWindowEndsAt: j.returnWindowEndsAt,
          returned: j.returned,
          items: itemsToJson(j.items),
          shipments: j.shipments,
          matches: j.matches,
          reason: j.reason,
        })),
      });
    });

    return this.list(userId, taskId);
  }

  /** What we have already asked about, newest first. */
  async list(
    userId: string,
    taskId: string,
  ): Promise<OrderCandidateResponse[]> {
    const task = await this.ownTask(userId, taskId);
    const rows = await this.prisma.orderCandidate.findMany({
      where: { taskId },
      orderBy: { position: 'asc' },
    });
    return rows.map((row) => theCampaignsOwnProduct(
      toOrderCandidateResponse(row), itemsFromJson(row.items), task.campaign,
    ));
  }

  /**
   * The person says this one is their order.
   *
   * Only an order the SERVER said matches can be chosen. That is not a formality:
   * confirming an order that is not the campaign's product would put a task on
   * the road to a refund for something nobody was asked to buy.
   */
  async chooseMine(
    userId: string,
    taskId: string,
    candidateId: string,
  ): Promise<TaskResponse> {
    const task = await this.ownTask(userId, taskId);
    const row = await this.prisma.orderCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!row || row.taskId !== taskId) {
      throw new NotFoundException('Order not found');
    }
    if (!row.matches) {
      throw new ConflictException(
        'That order is not the product this offer is for.',
      );
    }

    // WHICH PRODUCT ON THE ORDER, worked out again from the stored order rather
    // than remembered. The campaign could have been edited between the look and
    // the tap, and the answer must be true now.
    const items = itemsFromJson(row.items);
    const answer = matchOrderToCampaign(
      { items },
      {
        productName: task.campaign.productName,
        expectedPricePaise: task.campaign.productPricePaise,
      },
    );
    if (!answer.matches || answer.item == null) {
      throw new ConflictException(
        'That order is not the product this offer is for.',
      );
    }

    // IS THE PRICE CERTAIN? Only when the order holds one product and the whole
    // bill is exactly that product's price, so the quantity must be one. Any
    // other shape leaves the amount unknown on purpose, and the existing gate
    // holds the refund for a staff member rather than guessing at somebody's
    // money. See itemPriceIsCertain.
    const certain = itemPriceIsCertain(
      // The three fields the answer really depends on, and no invented nulls
      // beside them: itemPriceIsCertain now asks for exactly what it reads.
      { totalPaise: row.totalPaise, shipments: row.shipments, items },
      answer.item,
      // AND WHAT THE OFFER SAYS THE PRODUCT COSTS. On a page that prints a price
      // beside each product — which is every Amazon order page — this is what
      // makes a two-product order's price certain instead of sending a refund
      // that the page states in words to a staff member. See itemPriceIsCertain.
      task.campaign.productPricePaise,
    );
    const price = typeof answer.item.pricePaise === 'bigint'
      ? answer.item.pricePaise
      : BigInt(Math.trunc(answer.item.pricePaise));

    // THE DATE, AND WHY IT IS SOMETIMES LEFT OFF. All that was read was a day,
    // and the time to buy after claiming is measured in minutes, so a day only
    // settles the question when it falls entirely outside the window. See
    // dateToSubmit: the rule itself is not weakened, and the day is kept as
    // written either way.
    // THE PRACTICE WINDOW APPLIES HERE TOO, and it has to. This is the other
    // real caller of orderWindow: it decides which of a person's orders are even
    // OFFERED as candidates. Widening only the enforcement side would produce the
    // worst of both — an old order that would now be accepted, never shown to
    // anybody to accept. Zero on every real database, whatever the setting says.
    const practiceDays = await this.practiceWindow.daysAllowed();
    const window = orderWindow({
      claimedAt: task.createdAt.getTime(),
      // BOTH HALVES OF THE FLOOR, for the reason recorded at the other call
      // site: the campaign's own age is the later of the two bounds, so widening
      // only the grace changed nothing for a campaign made for the test.
      campaignCreatedAt: practiceCampaignFloor(
        task.campaign.createdAt.getTime(),
        practiceDays,
      ),
      claimExpiresAt: task.claimExpiresAt ? task.claimExpiresAt.getTime() : null,
      graceMs: practiceGraceMs(practiceDays, ORDER_WINDOW_GRACE_MS),
    });
    const date = dateToSubmit(row.orderDate, window);

    const dto: SubmitEvidenceDto = {
      key: `order-list:${row.id}`,
      order: {
        id: row.orderNumber ?? undefined,
        ...(date == null ? {} : { date }),
        ...(dayAsWritten(row.orderDate) == null
          ? {}
          : { dateRaw: dayAsWritten(row.orderDate) as string }),
        product: answer.item.name,
        // The whole bill is always true and is never read as an item price on its
        // own — resolveChargedPaise refuses to fall back to a bare total.
        orderTotalPaise: row.totalPaise == null ? undefined : String(row.totalPaise),
        // ── AND WHAT THE PAGE SAID THIS PRODUCT COST, CERTAIN OR NOT ───────
        //
        // UNCONDITIONAL, and that is the whole difference between this line and
        // the one below it. unitPricePaise is a REFUND BASIS and is sent only
        // when itemPriceIsCertain says so. This is A THING THE PAGE SAID, sent
        // always, because the screen has to be able to show the product's own
        // price on a task whose amount is still with a staff member — otherwise
        // it falls back to the bill, which on a two-product order is LARGER than
        // the product, and a figure larger than what was paid is the wrong
        // direction to be wrong in on a refund screen.
        //
        // The same figure the match was made on, carried rather than recomputed,
        // so the candidate card and the task cannot print two different numbers.
        matchedPricePaise: String(price),
        ...(certain
          ? { unitPricePaise: String(price), quantity: 1, amountSource: SOURCES.ORDER_HISTORY }
          : {}),
        source: SOURCES.ORDER_HISTORY,
      },
      // ── AND THE DELIVERY, WHICH THE SAME PAGE STATED ────────────────────
      //
      // It was read, written down, and then stopped: the parser produced it, the
      // row kept it, and nothing ever handed it to the engine. So a task that
      // found its order this way reached PURCHASED and sat there while the very
      // page it was read from said when the thing arrived.
      //
      // SOURCE IS ORDER_HISTORY, which is what the order beside it carries and
      // what the page actually is. preferByAuthority will then let it stand
      // against a later screenshot, which is right: a marketplace's own order
      // page is a stronger statement about a delivery date than a photograph of
      // one.
      //
      // NULL STAYS ABSENT. An order whose page never printed a delivery date —
      // or printed it with no year and no order date to borrow one from — sends
      // no delivery fragment at all, and the task waits exactly as it does
      // today until a later look finds one. See deliveryFromALaterLook.
      ...theDeliveryFragment(row),
      // ── AND WHETHER IT WENT BACK ────────────────────────────────────────
      //
      // Without this the refund gate can never pass on this path at all:
      // task.returned stays null and refundEligibility pushes "return status
      // unknown (no readable order data)" for ever. The page said it — a page
      // that discusses a return window has told us there was no return — and the
      // tri-state is preserved, so a page that said nothing still sends nothing.
      ...(row.returned == null ? {} : { returned: row.returned }),
    };

    const after = await this.tasks.submitEvidence(userId, taskId, dto);
    await this.prisma.orderCandidate.update({
      where: { id: row.id },
      data: { chosenAt: new Date() },
    });

    // AND THAT TAP IS THE CONFIRMATION. "Yes, that is mine" is the same answer
    // the order details screen asks for, so asking again on the next screen would
    // be the second time somebody confirmed the same thing — which is the exact
    // habit the owner had removed from the join flow.
    //
    // It is attempted rather than assumed: if the order window rule or any other
    // gate stopped the evidence from landing, there is nothing to confirm, and
    // the journey works its own step out from the record either way.
    try {
      return await this.tasks.confirmOrder(userId, taskId);
    } catch {
      return after;
    }
  }

  /**
   * A LATER LOOK AT AN ORDER SOMEBODY HAS ALREADY SAID IS THEIRS.
   *
   * This is the whole of "Fayr confirms the delivery by itself". Nobody is asked
   * anything: the delivery step re-runs the same read of the same order page,
   * and if the shop's page now says the thing arrived, that goes into the same
   * evidence funnel every other fact goes into, and transition() moves the task
   * to DELIVERED on its own.
   *
   * WHAT IT WILL NOT DO, and each of these is a way it could have gone wrong:
   *
   *   IT WILL NOT MATCH ON ANYTHING BUT THE ORDER NUMBER. Not position, not
   *     price, not the product. Position is the shop's, and the shop reorders
   *     its own list; a price matches a dozen orders. Attaching one order's
   *     delivery date to another is how a refund gets released against a window
   *     that never ran.
   *   IT WILL NOT REWRITE A FACT. Only a null on the row is filled. A delivery
   *     date already acted on cannot be moved by a later read of the same page.
   *   IT WILL NOT INVENT A RETURN WINDOW. The window date rides along only when
   *     the page stated one in full, and windowEnd takes the later of it and the
   *     operator's table, so it can only lengthen a hold.
   *   IT WILL NOT THROW INTO THE LOOK. The phone is posting pages in a loop with
   *     a twenty second ceiling on it, and a refused fragment — an order window,
   *     a plausibility rejection — is a normal answer, not a reason to fail the
   *     whole request. It is logged and the look carries on.
   */
  private async deliveryFromALaterLook(
    userId: string,
    task: {
      id: string;
      campaign: { productName: string; productPricePaise: bigint };
    },
    /**
     * WHAT THE TASK'S ORDER ALREADY SAYS, read once by the caller that has the
     * whole row. Passed down rather than looked up again so both halves of a
     * later look see the same order, and so this method's own narrow task type
     * does not have to widen to the whole Prisma shape.
     */
    existing: EvidenceOrder | null,
    chosen: {
      id: string;
      orderNumber: string | null;
      deliveryDate: Date | null;
      returnWindowEndsAt: Date | null;
      returned: boolean | null;
    },
    pages: string[],
  ): Promise<void> {
    // NO ORDER NUMBER IS NO MATCH. Said first because it is the guard that keeps
    // one purchase's delivery off another purchase.
    if (chosen.orderNumber == null || chosen.orderNumber === '') return;

    const judged = judgeFoundOrders(pages, {
      productName: task.campaign.productName,
      productPricePaise: task.campaign.productPricePaise,
    });
    const fresh = judged.find((j) => j.orderNumber === chosen.orderNumber) ?? null;
    if (fresh == null) return;

    // ── AND A PRICE THE TASK NEVER GOT, WHEN THIS READ CAN SETTLE ONE ──────
    //
    // WHY THIS IS HERE AT ALL. A task confirmed before itemPriceIsCertain
    // learned to ask about the product's own line carries no item price, and
    // nothing would ever give it one: the amount is written when the order is
    // chosen, and an order is chosen once. The owner's own task sat at "item
    // price unknown, a Fayr reviewer confirms it" with ₹938.00 printed on the
    // page it had been read from, and the only way out was to claim the offer
    // again — which is not a thing a real person can be asked to do.
    //
    // ONLY WHEN THERE IS NONE. A price already on the task is a price that may
    // already have been acted on: a refund computed from it, a person told what
    // they are getting, a staff member's own figure entered by hand. This fills
    // a null and never replaces an answer, exactly as the delivery does above.
    //
    // AND ONLY WHEN IT IS CERTAIN, by the same one function the first read asks.
    // There is no second rule about money here and no second idea of what
    // certain means.
    await this.priceFromALaterLook(userId, task, existing, fresh);

    // ONLY THE NULLS. What is already on the row is what the row keeps.
    const deliveryDate = chosen.deliveryDate ?? fresh.deliveryDate;
    const returnWindowEndsAt = chosen.returnWindowEndsAt ?? fresh.returnWindowEndsAt;
    const returned = chosen.returned ?? fresh.returned;

    // ── WHAT COUNTS AS THE PAGE HAVING SAID IT ARRIVED ──────────────────────
    //
    // A delivery date, OR the shop's own return window on an order it does not
    // say went back — see theDeliveryFragment for the whole argument, which is
    // the owner's: a return window cannot exist for a thing that never arrived.
    //
    // ASKED THROUGH THE ONE BUILDER rather than repeated here. This used to test
    // `deliveryDate == null` twice in its own words, and a second copy of "what
    // counts as delivered" is exactly how the two halves of this file end up
    // disagreeing about it.
    const fragment = theDeliveryFragment({ deliveryDate, returnWindowEndsAt, returned });
    if (fragment.delivery == null) return;

    if (
      chosen.deliveryDate == null
      || chosen.returnWindowEndsAt == null
      || chosen.returned == null
    ) {
      await this.prisma.orderCandidate.update({
        where: { id: chosen.id },
        data: { deliveryDate, returnWindowEndsAt, returned },
      });
    }

    this.log.log(
      `orders-found task=${task.id} later-look delivery=yes `
      + `window=${returnWindowEndsAt == null ? 'none' : 'stated'} `
      + `returned=${returned == null ? 'unknown' : String(returned)}`,
    );

    const dto: SubmitEvidenceDto = {
      // A KEY OF ITS OWN, AND ONE THAT DOES NOT MOVE. It is not the key the
      // order went in under — those are two different facts and both must apply
      // — and it carries the day, so re-posting the same delivery on the next
      // page of the same look collapses to one event instead of a run of them.
      // THE DAY IT CARRIES IS THE ONE THE FRAGMENT SETTLED ON, not the delivery
      // date, which may be null now that a stated return window also counts.
      key: `delivery:${chosen.id}:${dayAsWritten(new Date(fragment.delivery.at)) ?? 'na'}`,
      ...fragment,
      ...(returned == null ? {} : { returned }),
    };

    try {
      await this.tasks.submitEvidence(userId, task.id, dto);
    } catch (e) {
      // A REFUSAL IS AN ANSWER, NOT A FAILURE OF THE LOOK. The phone is mid-read
      // with a ceiling running; failing its request would cost the pages it has
      // not posted yet, to say nothing new.
      this.log.warn(
        `orders-found task=${task.id} later-look delivery refused: `
        + `${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /**
   * THE ITEM PRICE, WHEN A LATER READ OF THE SAME PAGE CAN SETTLE ONE AND THE
   * TASK HAS NONE.
   *
   * Nothing here decides what "certain" means: it asks itemPriceIsCertain, the
   * same function the first read asks, with the same campaign price. A second
   * rule about somebody's money is how the defects in this project started.
   */
  private async priceFromALaterLook(
    userId: string,
    task: {
      id: string;
      campaign: { productName: string; productPricePaise: bigint };
    },
    /**
     * WHAT THE TASK'S ORDER ALREADY SAYS. Two jobs, and both are load bearing:
     * it is how this decides the task has no price yet, and it is what the
     * evidence carries forward so a correction cannot erase the rest.
     */
    existing: EvidenceOrder | null,
    fresh: ReturnType<typeof judgeFoundOrders>[number],
  ): Promise<void> {
    // ── "ONLY WHEN THERE IS NONE", ASKED OF THE EVIDENCE AND NOT THE COLUMN ──
    //
    // This read `task.itemPaise` — the promoted COLUMN — and that guard never
    // fired. task.mapper.ts:23 says in as many words: DO NOT READ THE itemPaise
    // COLUMN, it is a legacy projection and is NULL on essentially every task
    // the current code produces. A task settled through unitPricePaise has a
    // real price and a null column, so the guard waved every one of them
    // through and this method overwrote them — including a figure a staff
    // member had entered by hand, which is the one thing it promises not to do.
    //
    // ASKED THE WAY THE MONEY IS ASKED. resolveChargedPaise is the product's
    // only definition of the figure a refund comes from, and every item-price
    // field is checked beside it, because that function answers null on purpose
    // wherever a human has to decide — and those tasks have real amounts on
    // them. The order TOTAL is not counted: chooseMine puts the bill on every
    // task it touches, so counting it would stop this method ever running.
    if (existing != null) {
      const charged = resolveChargedPaise(existing);
      if (charged.paise != null && charged.paise !== 0n) return;
      if (existing.unitPricePaise != null && existing.unitPricePaise !== 0n) return;
      if (existing.lineTotalPaise != null && existing.lineTotalPaise !== 0n) return;
      if (existing.itemPaise != null && existing.itemPaise !== 0n) return;
    }
    if (!fresh.matches || fresh.matchedItem == null) return;

    const certain = itemPriceIsCertain(
      { totalPaise: fresh.totalPaise, shipments: fresh.shipments, items: fresh.items },
      fresh.matchedItem,
      task.campaign.productPricePaise,
    );
    if (!certain) return;

    const price = typeof fresh.matchedItem.pricePaise === 'bigint'
      ? fresh.matchedItem.pricePaise
      : BigInt(Math.trunc(fresh.matchedItem.pricePaise));

    const dto: SubmitEvidenceDto = {
      // ITS OWN KEY, CARRYING THE FIGURE. A re-read that finds the same price
      // collapses to one event; a page that has genuinely changed its price is a
      // different fact and applies, where the ordinary gates then judge it.
      key: `order-price:${task.id}:${price.toString()}`,
      order: {
        // ── WHAT IS ALREADY ON THE TASK, CARRIED FIRST ──────────────────
        //
        // transition() REPLACES the order with the incoming one; it does not
        // merge. So a fragment naming five fields does not update five fields,
        // it deletes everything else — the order date, the product's own price,
        // the line id, the match warnings, the photo. Measured on this very
        // change: settling a price blanked the order date the same change had
        // been written to show. See whatTheOrderAlreadySays.
        ...whatTheOrderAlreadySays(existing),
        id: fresh.orderNumber ?? existing?.id ?? undefined,
        product: fresh.matchedItem.name,
        orderTotalPaise: fresh.totalPaise == null ? undefined : String(fresh.totalPaise),
        unitPricePaise: String(price),
        quantity: 1,
        // The page's own figure for this product, kept fresh rather than
        // inherited, since this read is what just looked at it.
        matchedPricePaise: String(price),
        amountSource: SOURCES.ORDER_HISTORY,
        source: SOURCES.ORDER_HISTORY,
      },
    };

    this.log.log(
      `orders-found task=${task.id} later-look price=settled source=order-history`,
    );
    try {
      await this.tasks.submitEvidence(userId, task.id, dto);
    } catch (e) {
      // A REFUSAL IS AN ANSWER. The phone is mid-read with a ceiling running and
      // the task keeps the amount it had, which is none — the staff route it is
      // already sitting in is the honest fallback.
      this.log.warn(
        `orders-found task=${task.id} later-look price refused: `
        + `${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
}
