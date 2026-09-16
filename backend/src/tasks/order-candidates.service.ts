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
} from './order-candidates';
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
function theDeliveryFragment(
  row: { deliveryDate: Date | null; returnWindowEndsAt: Date | null },
): { delivery?: { at: number; raw?: string; returnWindowEndsAt?: number; source: string } } {
  if (row.deliveryDate == null) return {};
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
      await this.deliveryFromALaterLook(userId, task, already, pages);
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
    task: { id: string; campaign: { productName: string; productPricePaise: bigint } },
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
    if (fresh.deliveryDate == null && chosen.deliveryDate == null) return;

    // ONLY THE NULLS. What is already on the row is what the row keeps.
    const deliveryDate = chosen.deliveryDate ?? fresh.deliveryDate;
    const returnWindowEndsAt = chosen.returnWindowEndsAt ?? fresh.returnWindowEndsAt;
    const returned = chosen.returned ?? fresh.returned;
    if (deliveryDate == null) return;

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
      key: `delivery:${chosen.id}:${dayAsWritten(deliveryDate) ?? 'na'}`,
      ...theDeliveryFragment({ deliveryDate, returnWindowEndsAt }),
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
}
