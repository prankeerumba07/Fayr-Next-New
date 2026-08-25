import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { seedDemo } from './demo-seed';

/**
 * `npx prisma db seed` — the whole demo database, built by the product itself.
 *
 * This is a thin entry point on purpose. It boots the real application context so
 * the seed can call the real services (claim, evidence, hold, release, request,
 * approve, mark paid) rather than writing state columns, and everything worth
 * reading lives in demo-seed.ts next to the reasoning for it.
 *
 * Safe to re-run: every write is an upsert or is skipped when already present.
 * Refuses outright on any database not named *_dev or *_test.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // The seed's own log is the interesting one; Nest's module banner is not.
    logger: ['warn', 'error'],
  });
  try {
    console.log('Seeding the demo database…');
    const report = await seedDemo(app);
    console.log(
      `Done. ${report.campaigns} campaigns, ${report.staff} staff, `
        + `${report.users} users.`,
    );
    for (const j of report.journeys) console.log(`  built    ${j}`);
    for (const s of report.skipped) console.log(`  present  ${s}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
