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
   * ONCE ONE HAS BEEN CHOSEN, LOOKING AGAIN IS REFUSED. The task already has its
   * order and is past this question; replacing the list would delete the row that
   * says which order somebody said was theirs.
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
    if (already) return this.list(userId, taskId);

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
}
