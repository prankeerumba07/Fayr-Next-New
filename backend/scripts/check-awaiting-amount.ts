/**
 * READ-ONLY: what the "Amounts to confirm" queue would show against the REAL dev
 * database, using the real service. Not a test — a way to check the queue against
 * actual records rather than trusting the screen.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/check-awaiting-amount.ts
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
  await app.close();
}
void main();
