/**
 * READ-ONLY: what the "Review checks" queue would show against the REAL dev
 * database, using the real service. Not a test — a way to check the queue against
 * actual records rather than trusting the screen.
 *
 *   npx ts-node scripts/check-review-queue.ts
 *
 * It also prints every task's visibility verdict and WHO settled it, because the
 * queue is defined by that one field and "why is this task not in the list" is
 * otherwise unanswerable without reading JSONB by hand.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { toEngineTask } from '../src/tasks/task.mapper';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const tasks = app.get(TaskService);
  const prisma = app.get(PrismaService);

  const { items, total } = await tasks.listAwaitingReviewCheck();
  console.log(`\nReviews waiting for a person to look: ${total}\n`);
  for (const i of items) {
    console.log(
      [
        i.taskId.slice(0, 8),
        i.state.padEnd(9),
        i.platform.padEnd(9),
        `star ${i.rating ?? '-'}`.padEnd(8),
        i.confirmedVisible ? 'CONFIRMED' : 'waiting  ',
        i.productUrl ?? '(no product page on file)',
      ].join(' | '),
    );
    console.log(`           ${i.whyNoMachineCheck}`);
  }

  console.log('\nEvery task, and who settled its visibility verdict:\n');
  const rows = await prisma.task.findMany({ orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    const review = toEngineTask(row, []).review;
    console.log(
      [
        row.id.slice(0, 8),
        row.platform.padEnd(9),
        row.state.padEnd(9),
        review ? `published=${String(review.published)}` : 'no review on file',
        review ? `by ${review.publishedSource ?? 'NOBODY'}` : '',
      ].join(' | '),
    );
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
