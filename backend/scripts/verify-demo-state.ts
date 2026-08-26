/**
 * ONE COMMAND THAT SAYS WHETHER THE DEMO IS INTACT.
 *
 * Run it before and after anything that touches the demo database, and diff the
 * two outputs. It exists because the reconciliation of the demo account needed a
 * before/after comparison, and the ad-hoc scripts that did that job the first time
 * lived in a temp directory and were gone the next day.
 *
 * It reads through the SAME queries the staff panel and the app use — the services,
 * not hand-written SQL — so a figure here is a figure a screen would show. Where it
 * reads a table directly (ticket and wallet ledgers) it says so.
 *
 *   npx ts-node scripts/verify-demo-state.ts            # every account
 *   npx ts-node scripts/verify-demo-state.ts FAYR-100036  # one, in detail
 *
 * Read-only. It never writes.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { WithdrawalService } from '../src/withdrawals/withdrawal.service';
import { SupportQuestionService } from '../src/support/support-question.service';
import { StaffVerificationService } from '../src/ocr/staff-verification.service';
import { CampaignService } from '../src/campaigns/campaign.service';

const rupees = (paise: bigint | number | string): string => {
  const n = BigInt(paise);
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? '-' : ''}₹${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};

async function main(): Promise<void> {
  const target = process.argv[2] ?? null;
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const tasks = app.get(TaskService);
    const tickets = app.get(TicketService);
    const wallet = app.get(WalletService);
    const withdrawals = app.get(WithdrawalService);
    const questions = app.get(SupportQuestionService);
    const verifications = app.get(StaffVerificationService);
    const campaigns = app.get(CampaignService);

    const db = (
      await prisma.$queryRawUnsafe<{ current_database: string }[]>(
        'SELECT current_database()',
      )
    )[0]?.current_database;
    console.log(`\n=== database: ${db} ===`);

    // ── the nine staff-panel queues, through their own services ──────────────
    const active = await campaigns.listActive();
    const seats = await campaigns.claimedSeats(active.map((c) => c.id));
    console.log('\nSTAFF PANEL');
    console.log(`  Withdrawals waiting   ${(await withdrawals.listAll('REQUESTED')).length}`);
    console.log(`  Questions open        ${(await questions.listAll()).filter((q) => q.status !== 'CLOSED').length}`);
    console.log(`  Screenshots pending   ${(await verifications.listQueue({ limit: 200, offset: 0 })).total}`);
    console.log(`  Unit counts held      ${(await tasks.listAwaitingAmount()).total}`);
    console.log(`  Review checks         ${(await tasks.listAwaitingReviewCheck()).total}`);
    console.log(`  Staff accounts        ${await prisma.staffUser.count()}`);
    console.log(`  Campaigns (active)    ${await prisma.campaign.count()} (${active.length})`);
    console.log(`  Users                 ${await prisma.user.count()}`);

    // The feed, in the order the app receives it — the run-sheet quotes a position.
    console.log('\nFEED (newest first, as GET /campaigns returns it)');
    active.forEach((c, i) => {
      const taken = seats.get(c.id) ?? 0;
      console.log(
        `  ${String(i + 1).padStart(2)}. ${c.platform.padEnd(9)} ${c.title.slice(0, 46).padEnd(46)} ${taken} claimed`,
      );
    });

    // ── the refunds a person must decide, which the run-sheet tabulates ───────
    const held = await tasks.listAwaitingAmount();
    // Owners are named by displayId, never by mobile — not even the last digits.
    // A partial phone number is still a phone number, and this output gets pasted
    // into reports.
    const idByUser = new Map(
      (await prisma.user.findMany({ select: { id: true, displayId: true } })).map(
        (u) => [u.id, u.displayId],
      ),
    );
    console.log(`\nREFUNDS HELD FOR A PERSON: ${held.total}`);
    for (const h of held.items) {
      console.log(
        `  ${h.taskId.slice(0, 8)} ${h.platform.padEnd(9)} ${h.state.padEnd(9)} `
          + `${h.action.padEnd(14)} ${idByUser.get(h.user.id) ?? '?'}`,
      );
    }

    // ── per account ──────────────────────────────────────────────────────────
    const users = await prisma.user.findMany({
      where: target ? { displayId: target } : {},
      orderBy: { createdAt: 'asc' },
    });
    console.log('\nACCOUNTS (mobile intentionally not printed)');
    for (const u of users) {
      const list = await tasks.listForUser(u.id);
      const live = list.filter((t) => t.closedAt == null);
      const states = live.map((t) => t.state).sort().join(',');
      const bal = await wallet.getUserBalance(u.id);
      const tk = await tickets.getBalance(u.id);
      const wds = await withdrawals.listForUser(u.id);
      const methods = await prisma.payoutMethod.count({
        where: { userId: u.id, status: 'ACTIVE' },
      });
      if (!target && list.length === 0) continue; // only accounts with history
      console.log(
        `  ${u.displayId}  tasks ${String(list.length).padStart(2)} (${live.length} live)  `
          + `tickets ${String(tk).padStart(3)}  wallet ${rupees(bal).padStart(11)}  `
          + `withdrawals ${wds.length}  payout methods ${methods}  pan ${u.pan ? 'set' : 'none'}  `
          + `setup ${u.setupDoneAt ? 'done' : 'not done'}`,
      );
      if (target) {
        console.log(`      live states: ${states || '(none)'}`);
        for (const t of list) {
          console.log(
            `      ${t.state.padEnd(9)} ${t.closedAt ? 'closed' : 'live  '} `
              + `${(t.campaign.title || '').slice(0, 40).padEnd(40)} `
              + `refund ${t.refund.amountPaise != null ? rupees(t.refund.amountPaise) : '—'}`,
          );
        }
        for (const w of wds) {
          console.log(`      withdrawal ${w.status.padEnd(9)} ${rupees(w.amountPaise)} ${w.utr ?? ''}`);
        }
      }
    }

    // ── the ledger invariant, read from the table on purpose ─────────────────
    const legs = await prisma.walletEntry.groupBy({
      by: ['transactionId'],
      _sum: { amountPaise: true },
    });
    const unbalanced = legs.filter((l) => l._sum.amountPaise !== 0n).length;
    console.log(
      `\nLEDGER: ${legs.length} transactions, ${unbalanced} unbalanced `
        + `${unbalanced === 0 ? '(every one sums to zero)' : '<<< BROKEN'}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
