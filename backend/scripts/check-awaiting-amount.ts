/**
 * READ-ONLY: what the "Amounts to confirm" queue would show against the REAL dev
 * database, using the real service. Not a test — a way to check the queue against
 * actual records rather than trusting the screen.
 *
 *   npx ts-node scripts/check-awaiting-amount.ts
 *
 * Optionally ask what a figure WOULD pay, without writing anything:
 *
 *   npx ts-node scripts/check-awaiting-amount.ts <task-id-prefix> count 1
 *   npx ts-node scripts/check-awaiting-amount.ts <task-id-prefix> amount 59900
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TaskService } from '../src/tasks/task.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const tasks = app.get(TaskService);
  const { items, total } = await tasks.listAwaitingAmount();
  console.log(`\nRefunds held for a person to decide: ${total}\n`);
  for (const i of items) {
    console.log(
      [
        i.taskId.slice(0, 8),
        i.state.padEnd(9),
        i.platform.padEnd(9),
        (i.orderId ?? '-').padEnd(22),
        `line ${i.itemPaise ?? '-'}`.padEnd(14),
        `needs ${i.action}`.padEnd(13),
        `qty ${i.quantity ?? '-'}`.padEnd(8),
        `max ${i.maxAmountPaise ?? 'NONE'}`.padEnd(14),
        `(${i.maxAmountAnchor ?? 'no anchor'})`,
      ].join(' | '),
    );
    console.log(`           ${i.heldExplanation}`);
  }

  // Optional dry run: what would this figure pay? Same resolver as the payout.
  const [prefix, kind, value] = process.argv.slice(2);
  if (prefix && kind && value) {
    const match = items.find((i) => i.taskId.startsWith(prefix));
    if (!match) {
      console.log(`\nNo held task starts with "${prefix}".`);
    } else {
      const preview = await tasks.previewRefund(
        match.taskId,
        kind === 'amount'
          ? { unitPricePaise: BigInt(value) }
          : { quantity: Number(value) },
      );
      console.log(`\nIf ${kind} = ${value} on ${match.taskId.slice(0, 8)}:`);
      console.log(`  refund       ${preview.refundPaise ?? 'NOT PAYABLE'} paise`);
      console.log(`  based on     ${preview.chargedPaise ?? '-'} paise charged`);
      console.log(`  payable      ${preview.payable}`);
      console.log(`  disagrees    ${preview.disagreesWithCampaign}`);
      if (!preview.payable) console.log(`  why          ${preview.heldExplanation}`);
    }
  }

  await app.close();
}
void main();
