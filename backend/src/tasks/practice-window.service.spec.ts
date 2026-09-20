import { PracticeWindowService } from './practice-window.service';
import {
  PRACTICE_HOLD_OFF, PRACTICE_WINDOW_MAX_DAYS, PRACTICE_WINDOW_OFF,
} from './engine/practice-window';

/**
 * THE GUARD ITSELF: THE SETTING AND THE DATABASE NAME, TOGETHER.
 *
 * ── WHY THIS IS A UNIT CHECK AND NOT AN END TO END ONE ─────────────────────
 *
 * Because the one case that matters most CANNOT be built end to end: a real
 * database. Proving "it refuses on a real database" by connecting to one would
 * mean pointing a test suite at somebody's real records, which is the exact thing
 * the guard exists to prevent.
 *
 * So both halves are handed in. The database is a stub that answers whatever name
 * the case needs, INCLUDING a real one, and the setting is a stub config. The
 * live question — that Postgres really does answer with its own name — is proved
 * in test/practice-window.e2e-spec.ts, which is the half that needs a database.
 */
describe('the practice window guard', () => {
  /** A database that answers one name, and counts how often it was asked. */
  function databaseCalled(name: string | null) {
    let asked = 0;
    return {
      asked: () => asked,
      prisma: {
        $queryRawUnsafe: async (): Promise<{ current_database: string }[]> => {
          asked += 1;
          if (name == null) throw new Error('could not read the name');
          return [{ current_database: name }];
        },
      },
    };
  }

  const configSaying = (days: unknown) => ({ get: () => days });

  function serviceFor(days: unknown, name: string | null) {
    const db = databaseCalled(name);
    const service = new PracticeWindowService(
      db.prisma as never,
      configSaying(days) as never,
    );
    return { service, db };
  }

  describe('IT REFUSES ON ANYTHING THAT IS NOT A PRACTICE DATABASE', () => {
    it('THE CASE THAT MATTERS MOST: the setting on, and a real database', async () => {
      // Somebody sets this in a real deployment's environment — by copying a
      // file, by hand, by a deploy tool carrying a variable it should not — and
      // it must do NOTHING.
      for (const real of ['fayr', 'fayr_prod', 'fayr_production', 'postgres', 'main']) {
        const { service } = serviceFor(400, real);
        await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
      }
    });

    it('and a very large setting on a real database is still nothing', async () => {
      const { service } = serviceFor(999999, 'fayr');
      await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
    });

    it('and a name that merely LOOKS like a practice one is refused', async () => {
      for (const close of [
        'fayr_dev_backup', 'fayr_development', 'fayr_testing', 'FAYR_DEV',
        'dev', 'test', '_dev_fayr',
      ]) {
        const { service } = serviceFor(400, close);
        await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
      }
    });

    it('IT FAILS CLOSED when the name cannot be read at all', async () => {
      // Not "probably a practice database", not "carry on and check later": off.
      // Being wrong that way costs the owner a test that does not match, and he
      // says so. Being wrong the other way pays for a real person's old purchase.
      const { service } = serviceFor(400, null);
      await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
    });
  });

  describe('and on a practice database it is off until somebody asks', () => {
    it('is off with the setting unset or zero', async () => {
      for (const off of [undefined, null, 0, '0', -1, NaN]) {
        const { service } = serviceFor(off, 'fayr_next_dev');
        await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
      }
    });

    it('AND DOES NOT EVEN ASK THE DATABASE WHEN THE SETTING IS OFF', async () => {
      // Which is what keeps the query off the busiest path in the product in a
      // real deployment, where the setting is always off.
      const { service, db } = serviceFor(0, 'fayr');
      await service.daysAllowed();
      await service.daysAllowed();
      expect(db.asked()).toBe(0);
    });

    it('widens by the days asked for once both halves agree', async () => {
      for (const [days, name] of [
        [1, 'fayr_next_dev'], [400, 'fayr_next_test'], [30, 'fayr_dev'],
      ] as [number, string][]) {
        const { service } = serviceFor(days, name);
        await expect(service.daysAllowed()).resolves.toBe(days);
      }
    });

    it('clamps a wrong number rather than refusing it', async () => {
      // A refusal would read exactly like a working practice window on a screen,
      // which is the one outcome nobody would notice.
      const { service } = serviceFor(999999, 'fayr_next_dev');
      await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_MAX_DAYS);
    });
  });

  describe('it asks the database once and remembers', () => {
    it('because a running process cannot change which database it is on', async () => {
      const { service, db } = serviceFor(400, 'fayr_next_dev');
      for (let i = 0; i < 5; i += 1) {
        await expect(service.daysAllowed()).resolves.toBe(400);
      }
      expect(db.asked()).toBe(1);
    });

    it('and remembers a refusal too, so a real database is asked once', async () => {
      const { service, db } = serviceFor(400, 'fayr');
      for (let i = 0; i < 5; i += 1) {
        await expect(service.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
      }
      expect(db.asked()).toBe(1);
    });

    it('and remembers a name it could not read, rather than retrying for ever', async () => {
      const { service, db } = serviceFor(400, null);
      await service.daysAllowed();
      await service.daysAllowed();
      expect(db.asked()).toBe(1);
    });
  });

  describe('the rehearsal hold, asked for without waiting', () => {
    // ── WHY THERE IS A SYNCHRONOUS WAY TO ASK AT ALL ────────────────────────
    //
    // toTaskResponse builds a screen's answer and cannot await anything. Without
    // this it recomputed the hold from the product's own rule, and on 21
    // September 2026 the app told the owner his refund was due at 3:57 am while
    // the money was released two minutes after delivery. See
    // task-response-window.spec.ts for the other half.
    //
    // NOTE THESE RUN UNDER NODE_ENV=test, where the rehearsal hold is switched
    // off on purpose — see holdMsAllowed. So what is checked here is the one
    // thing that is checkable under test and is the thing that mattered: the
    // synchronous answer is the SAME answer the awaited one gives, before
    // warming and after.
    it('is off before anything has warmed it, which is the failing-closed way', () => {
      const { service } = serviceFor(400, 'fayr_next_dev');
      expect(service.holdMsNow()).toBe(PRACTICE_HOLD_OFF);
    });

    it('and afterwards it is exactly what the awaited question answers', async () => {
      for (const name of ['fayr_next_dev', 'fayr_next_test', 'fayr', null]) {
        const { service } = serviceFor(2, name);
        await service.onModuleInit();
        expect(service.holdMsNow()).toBe(await service.holdMsAllowed());
      }
    });
  });
});
