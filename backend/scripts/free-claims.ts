/**
 * THE COMMAND ITSELF. The work is in scripts/free-practice-claims.ts.
 *
 *   npx ts-node scripts/free-claims.ts
 *
 * A different account can be named, and it is never printed back:
 *
 *   npx ts-node scripts/free-claims.ts +911234567890
 *
 * This file starts Fayr's own backend, runs the freeing, prints what it did and
 * stops again. It is deliberately thin, in the same way prisma/seed.ts is thin
 * next to prisma/demo-seed.ts, so that the part worth reading and the part worth
 * testing are one file and not buried under the plumbing.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { freePracticeClaims } from './free-practice-claims';

async function main(): Promise<void> {
  const mobile = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    await freePracticeClaims(app, mobile ? { mobile } : {});
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  // The message, not the stack. Every way this stops on purpose stops with a
  // sentence written to be read, and a page of internals underneath it would
  // only make that sentence harder to find.
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
