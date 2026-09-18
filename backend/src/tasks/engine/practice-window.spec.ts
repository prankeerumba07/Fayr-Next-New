import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORDER_WINDOW_GRACE_MS, checkOrderWindow, orderWindow,
} from './order-window';
import {
  PRACTICE_WINDOW_MAX_DAYS, PRACTICE_WINDOW_OFF, isAPracticeDatabase,
  practiceCampaignFloor, practiceGraceMs, practiceWindowDays, widenTheHold,
} from './practice-window';
import { checkOrderAgainstTheVisit, theHold } from './shop-visit';

/**
 * THE PRACTICE ORDER WINDOW, AND THE TWO THINGS IT MUST NEVER DO.
 *
 * It exists because the owner's test campaigns point at products he ALREADY
 * BOUGHT months ago, and the date rule refuses every one of them — correctly. So
 * the reading cannot be tested at all without widening the window.
 *
 * THE TWO THINGS IT MUST NEVER DO, and both are checked below by name:
 *
 *   1. IT MUST NOT REACH A REAL DATABASE. Not with the setting on, not with the
 *      setting very large, not with a name that merely looks like a practice one.
 *   2. IT MUST NOT WEAKEN THE RULE. checkOrderWindow and
 *      checkOrderAgainstTheVisit are handed a different window and are otherwise
 *      untouched — no flag, no skip, no early return. The last block here reads
 *      both files off disk and refuses a version of them that knows this file
 *      exists at all.
 */
const DAY = 24 * 60 * 60 * 1000;
const REPO = join(__dirname, '..', '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

/**
 * Comments stripped, so a rule EXPLAINED at length is not read as a breach of
 * itself. Every file in this change explains why it does NOT parse DATABASE_URL,
 * and the first writing of the check below read that sentence as the thing it
 * forbids.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the practice order window', () => {
  describe('IT REFUSES ON ANYTHING THAT IS NOT A PRACTICE DATABASE', () => {
    it('accepts only a name ending _dev or _test', () => {
      for (const yes of [
        'fayr_next_dev', 'fayr_next_test', 'fayr_dev', 'fayr_test', 'x_dev', 'x_test',
      ]) {
        expect(isAPracticeDatabase(yes)).toBe(true);
      }
    });

    it('AND REFUSES EVERYTHING ELSE, including names that look close', () => {
      for (const no of [
        'fayr',                 // the real one
        'fayr_prod',
        'fayr_production',
        'fayr_dev_backup',      // ends _backup, not _dev
        'fayr_test_copy',
        'dev',                  // no underscore before it
        'test',
        'fayr_development',     // the word, not the suffix
        'fayr_testing',
        'FAYR_DEV',             // shouted: the real name is lower case
        'fayr_DEV',
        '_dev_fayr',            // the suffix at the front
        '',
      ]) {
        expect({ no, practice: isAPracticeDatabase(no) })
          .toEqual({ no, practice: false });
      }
    });

    it('and refuses anything that is not a name at all', () => {
      for (const junk of [null, undefined, 42, {}, [], true]) {
        expect(isAPracticeDatabase(junk as unknown as string)).toBe(false);
      }
    });

    it('SO A SETTING ON A REAL DATABASE WIDENS NOTHING, however large', () => {
      // The whole point. Somebody sets this in a real deployment's environment,
      // by copying a file or by hand, and it must do nothing at all.
      for (const setting of [1, 30, 365, 3650, 999999]) {
        expect(practiceWindowDays(setting, 'fayr')).toBe(PRACTICE_WINDOW_OFF);
        expect(practiceWindowDays(setting, 'fayr_production')).toBe(PRACTICE_WINDOW_OFF);
        expect(practiceWindowDays(setting, null)).toBe(PRACTICE_WINDOW_OFF);
      }
    });

    it('and on a practice database it is off until it is turned on', () => {
      for (const off of [0, -1, -365, null, undefined, NaN, Infinity]) {
        expect(practiceWindowDays(off as unknown as number, 'fayr_next_dev'))
          .toBe(PRACTICE_WINDOW_OFF);
      }
      expect(practiceWindowDays(1, 'fayr_next_dev')).toBe(1);
      expect(practiceWindowDays(365, 'fayr_next_test')).toBe(365);
    });

    it('clamps a wrong number rather than refusing it', () => {
      // A refusal would read on a screen exactly like a working practice window,
      // which is the one outcome nobody would notice.
      expect(practiceWindowDays(999999, 'fayr_next_dev')).toBe(PRACTICE_WINDOW_MAX_DAYS);
      expect(practiceWindowDays(PRACTICE_WINDOW_MAX_DAYS + 1, 'fayr_next_dev'))
        .toBe(PRACTICE_WINDOW_MAX_DAYS);
      expect(practiceWindowDays(3.9, 'fayr_next_dev')).toBe(3);
    });
  });

  describe('what it does to the window, and only to the window', () => {
    it('is the normal grace when it is off', () => {
      expect(practiceGraceMs(0, ORDER_WINDOW_GRACE_MS)).toBe(ORDER_WINDOW_GRACE_MS);
      expect(practiceGraceMs(-5, ORDER_WINDOW_GRACE_MS)).toBe(ORDER_WINDOW_GRACE_MS);
      for (const junk of [null, undefined, NaN, 'ten']) {
        expect(practiceGraceMs(junk as unknown as number, ORDER_WINDOW_GRACE_MS))
          .toBe(ORDER_WINDOW_GRACE_MS);
      }
    });

    it('reaches back by the days asked for', () => {
      expect(practiceGraceMs(1, ORDER_WINDOW_GRACE_MS)).toBe(DAY);
      expect(practiceGraceMs(365, ORDER_WINDOW_GRACE_MS)).toBe(365 * DAY);
    });

    it('IS NEVER NARROWER THAN NORMAL, which would make the rule stricter', () => {
      // The normal grace is two hours. A practice window of "0 days" must not
      // become "no grace at all" — that would refuse the very case the two hours
      // exist for, somebody who bought before they tapped claim.
      expect(practiceGraceMs(0, ORDER_WINDOW_GRACE_MS)).toBeGreaterThanOrEqual(
        ORDER_WINDOW_GRACE_MS,
      );
      // And a fractional day under two hours cannot narrow it either.
      expect(practiceGraceMs(0.01, ORDER_WINDOW_GRACE_MS)).toBe(ORDER_WINDOW_GRACE_MS);
    });

    it('MAKES A MONTHS OLD ORDER MATCH, which is the whole requirement', () => {
      const claimedAt = Date.UTC(2026, 8, 9, 10, 0);
      // His real case: bought in June, campaign made long before, claimed today.
      const boughtInJune = Date.UTC(2026, 5, 14, 16, 30);
      const campaignMade = Date.UTC(2026, 0, 1);

      const normal = orderWindow({
        claimedAt, campaignCreatedAt: campaignMade, claimExpiresAt: null,
      });
      expect(checkOrderWindow(boughtInJune, normal)).toBe('before-claim');

      const practice = orderWindow({
        claimedAt,
        campaignCreatedAt: campaignMade,
        claimExpiresAt: null,
        graceMs: practiceGraceMs(365, ORDER_WINDOW_GRACE_MS),
      });
      expect(checkOrderWindow(boughtInJune, practice)).toBe('ok');
    });

    it('THE GRACE ALONE IS NOT ENOUGH — the campaign clamp threw all of it away', () => {
      // THE DEFECT THIS PAIR OF CHECKS EXISTS FOR, kept as a check rather than
      // deleted, because it is the thing that made the setting look like it was
      // working while it did nothing.
      //
      // orderWindow's floor is the LATER of (claim less grace) and the campaign's
      // own creation. Widen only the grace and the clamp discards every day of it
      // for any campaign younger than the setting — which is every practice
      // campaign, because it was made for the test the day before.
      const claimedAt = Date.UTC(2026, 8, 9, 10, 0);
      const campaignMadeYesterday = Date.UTC(2026, 8, 8, 10, 0);
      const boughtInJune = Date.UTC(2026, 5, 14);

      const graceOnly = orderWindow({
        claimedAt,
        campaignCreatedAt: campaignMadeYesterday,
        claimExpiresAt: null,
        graceMs: practiceGraceMs(365, ORDER_WINDOW_GRACE_MS),
      });
      expect(graceOnly.floor).toBe(campaignMadeYesterday);
      expect(checkOrderWindow(boughtInJune, graceOnly)).toBe('before-claim');
    });

    it('SO BOTH HALVES MOVE, and only then does the months old order match', () => {
      // The same campaign, the same order, the same setting — with the clamp
      // widened by the same number of days. THIS is the case the owner is
      // testing: a campaign made for the test, and a purchase from months before
      // it existed.
      const claimedAt = Date.UTC(2026, 8, 9, 10, 0);
      const campaignMadeYesterday = Date.UTC(2026, 8, 8, 10, 0);
      const boughtInJune = Date.UTC(2026, 5, 14);

      const both = orderWindow({
        claimedAt,
        campaignCreatedAt: practiceCampaignFloor(campaignMadeYesterday, 365),
        claimExpiresAt: null,
        graceMs: practiceGraceMs(365, ORDER_WINDOW_GRACE_MS),
      });
      expect(checkOrderWindow(boughtInJune, both)).toBe('ok');
      // ONE NUMBER, NOT TWO. With the setting at 365 the floor is 365 days
      // before the claim whatever the campaign's age — not "before the campaign,
      // or before the claim, depending which is older".
      expect(both.floor).toBe(claimedAt - 365 * DAY);
    });

    it('and the campaign floor is OFF unless somebody asked for it', () => {
      const madeAt = Date.UTC(2026, 8, 8, 10, 0);
      expect(practiceCampaignFloor(madeAt, 0)).toBe(madeAt);
      expect(practiceCampaignFloor(madeAt, -5)).toBe(madeAt);
      for (const junk of [null, undefined, NaN, 'ten']) {
        expect(practiceCampaignFloor(madeAt, junk as unknown as number)).toBe(madeAt);
      }
      // A fraction of a day is truncated to nothing, the same as the grace.
      expect(practiceCampaignFloor(madeAt, 0.9)).toBe(madeAt);
    });

    it('reaches back by exactly the days asked for, and can only move EARLIER', () => {
      const madeAt = Date.UTC(2026, 8, 8, 10, 0);
      expect(practiceCampaignFloor(madeAt, 1)).toBe(madeAt - DAY);
      expect(practiceCampaignFloor(madeAt, 400)).toBe(madeAt - 400 * DAY);
      for (const days of [1, 30, 365, 400, PRACTICE_WINDOW_MAX_DAYS]) {
        expect(practiceCampaignFloor(madeAt, days)).toBeLessThanOrEqual(madeAt);
      }
    });

    it('NULL STAYS NULL — it never invents a floor where there was none', () => {
      // orderWindow reads null as "no second bound". Widening it into a real
      // instant would ADD a clamp to a campaign that had none, which is the one
      // direction this must never move.
      expect(practiceCampaignFloor(null, 400)).toBeNull();
      expect(practiceCampaignFloor(undefined, 400)).toBeNull();
      expect(practiceCampaignFloor(NaN, 400)).toBeNull();
      const claimedAt = Date.UTC(2026, 8, 9, 10, 0);
      const window = orderWindow({
        claimedAt,
        campaignCreatedAt: practiceCampaignFloor(null, 400),
        claimExpiresAt: null,
        graceMs: practiceGraceMs(400, ORDER_WINDOW_GRACE_MS),
      });
      expect(window.floor).toBe(claimedAt - 400 * DAY);
    });

    it('and the deadline end of the window is untouched', () => {
      // Only the floor moves. An order placed after the time to buy ran out is
      // still refused, because that is a different rule and nobody asked for it.
      const claimedAt = Date.UTC(2026, 8, 9, 10, 0);
      const deadline = claimedAt + 30 * 60 * 1000;
      const window = orderWindow({
        claimedAt,
        campaignCreatedAt: Date.UTC(2026, 0, 1),
        claimExpiresAt: deadline,
        graceMs: practiceGraceMs(365, ORDER_WINDOW_GRACE_MS),
      });
      expect(checkOrderWindow(deadline + 1, window)).toBe('after-deadline');
      expect(window.ceiling).toBe(deadline);
    });
  });

  describe('the two hour hold, for the day it is consulted', () => {
    it('is untouched when the window is off', () => {
      const hold = theHold(Date.UTC(2026, 8, 9, 10, 0));
      expect(widenTheHold(hold, 0)).toEqual(hold);
      expect(widenTheHold(hold, -1)).toEqual(hold);
      for (const junk of [null, undefined, NaN]) {
        expect(widenTheHold(hold, junk as unknown as number)).toEqual(hold);
      }
    });

    it('moves only the START, never the end', () => {
      const tappedAt = Date.UTC(2026, 8, 9, 10, 0);
      const hold = theHold(tappedAt);
      const wider = widenTheHold(hold, 30);
      expect(wider.tappedAt).toBe(tappedAt - 30 * DAY);
      expect(wider.endsAt).toBe(hold.endsAt);
    });

    it('so a months old order stops being "before the tap"', () => {
      const tappedAt = Date.UTC(2026, 8, 9, 10, 0);
      const boughtInJune = Date.UTC(2026, 5, 14);
      const hold = theHold(tappedAt);
      expect(checkOrderAgainstTheVisit(boughtInJune, hold)).toBe('before-the-tap');
      expect(checkOrderAgainstTheVisit(boughtInJune, widenTheHold(hold, 365)))
        .toBe('ok');
      // AND AN ORDER AFTER THE HOLD IS STILL AFTER THE HOLD.
      expect(checkOrderAgainstTheVisit(hold.endsAt + 1, widenTheHold(hold, 365)))
        .toBe('after-the-hold');
    });
  });

  describe('THE RULES THEMSELVES DO NOT KNOW THIS FILE EXISTS', () => {
    it('checkOrderWindow has no flag, no skip and no early return for it', () => {
      // The owner's instruction: "DO NOT WEAKEN checkOrderAgainstTheVisit. The
      // setting feeds it a different window. The rule itself does not change."
      // The same holds for checkOrderWindow, which is the one actually consulted.
      const src = withoutComments(read('backend/src/tasks/engine/order-window.ts'));
      for (const wrong of [
        'practice', 'PRACTICE', 'isAPracticeDatabase', 'practiceWindowDays',
        'practiceGraceMs',
      ]) {
        expect(src).not.toContain(wrong);
      }
    });

    it('and neither does checkOrderAgainstTheVisit', () => {
      const src = withoutComments(read('backend/src/tasks/engine/shop-visit.ts'));
      for (const wrong of ['practice', 'PRACTICE', 'widenTheHold']) {
        expect(src).not.toContain(wrong);
      }
    });

    it('the widening is a NUMBER handed in, at both real call sites', () => {
      // Both callers of orderWindow. Widening only the enforcement side would
      // produce the worst of both: an old order that would now be accepted, and
      // never offered to anybody to accept.
      for (const file of [
        'backend/src/tasks/task.service.ts',
        'backend/src/tasks/order-candidates.service.ts',
      ]) {
        const src = read(file);
        expect(src).toContain('await this.practiceWindow.daysAllowed()');
        expect(src).toContain(
          'graceMs: practiceGraceMs(practiceDays, ORDER_WINDOW_GRACE_MS)',
        );
        // AND THE OTHER HALF OF THE FLOOR. Widening the grace alone is the
        // defect two checks above: the campaign clamp discarded all of it. A
        // call site that passes a raw campaign date has the same bug back.
        // THE SECOND ARGUMENT IS PINNED, not just the function name. Calling it
        // with a literal 0 would compile, read correctly at a glance, and
        // reinstate the whole defect.
        expect(withoutComments(src)).toMatch(
          /campaignCreatedAt: practiceCampaignFloor\(\s*[\w.()]+,\s*practiceDays,?\s*\)/,
        );
        expect(withoutComments(src)).not.toMatch(
          /campaignCreatedAt:\s*\w+\.campaign\.createdAt\.getTime\(\)/,
        );
        expect(withoutComments(src)).not.toMatch(
          /campaignCreatedAt:\s*campaign\.createdAt\.getTime\(\)/,
        );
      }
    });

    it('and the guard asks the DATABASE, not the settings', () => {
      const src = read('backend/src/tasks/practice-window.service.ts');
      const code = withoutComments(src);
      // The same shape as scripts/free-practice-claims.ts, and for the reason
      // recorded there. Reading the setting the connection was made FROM would
      // agree with the very mistake this guard exists to catch: a connection
      // string edited to point somewhere else.
      expect(code).toContain('SELECT current_database()');
      expect(code).not.toContain('DATABASE_URL');
      expect(code).not.toMatch(/config\.get\(\s*['"]DATABASE/);
      // AND IT FAILS CLOSED.
      expect(code).toMatch(/catch[\s\S]{0,200}this\.databaseName = '';/);
    });

    it('the free-claims script and this one share ONE spelling of the rule', () => {
      // Two spellings of one rule is how one of them ends up wrong. The script
      // predates this file; both must test the same thing.
      const script = read('backend/scripts/free-practice-claims.ts');
      expect(script).toContain('/_dev$|_test$/');
      const engine = read('backend/src/tasks/engine/practice-window.ts');
      expect(engine).toContain('/_dev$|_test$/');
    });
  });

  describe('AND THE MARK, so a widened match is never mistaken for a real one', () => {
    it('is on the task response as a number', () => {
      const src = read('backend/src/tasks/task.response.ts');
      expect(src).toContain('practiceWindowDays: number | null;');
      expect(src).toContain('practiceWindowDays: row.practiceWindowDays ?? null,');
    });

    it('is written at the moment it is used, and only when something got through', () => {
      const src = read('backend/src/tasks/task.service.ts');
      // Only when the order was NOT refused: a widened window that refused the
      // order anyway let nothing through, so marking it would warn about a task
      // nothing was let through on.
      expect(src).toContain(
        'if (practiceDays > 0 && !screened.refused && event.evidence.order != null)',
      );
      expect(src).toContain('data: { practiceWindowDays: practiceDays },');
    });

    it('and the staff panel shows it, loudly', () => {
      const panel = read('admin-panel/index.html');
      expect(panel).toContain('function practiceMark(t)');
      expect(panel).toContain('pill("PRACTICE WINDOW " + String(days) + "d", "bad")');
      // BESIDE THE STATE, not in the quiet line underneath: a grey note in a meta
      // row can be mistaken for a real match, which is the thing forbidden.
      //
      // UPDATED 17 September 2026, when the user page was rebuilt as a dashboard
      // and the task list became one card per offer. The mark moved with the
      // state pill and now sits DIRECTLY after it, which is what this line pins:
      // not the old markup, the placement the paragraph above asks for.
      expect(panel).toContain(
        'pill(t.state, TASK_PILL[t.state]),\n          practiceMark(t),',
      );
      // AND IT READS THE TASK, never a setting.
      expect(panel).toContain('var days = t && t.practiceWindowDays;');
    });

    it('the column is additive only, so no existing task is rewritten', () => {
      const sql = read(
        'backend/prisma/migrations/20260909104500_practice_order_window/migration.sql',
      );
      expect(sql).toContain('ADD COLUMN "practiceWindowDays" INTEGER');
      for (const destructive of ['DROP', 'DELETE', 'UPDATE', 'NOT NULL', 'DEFAULT']) {
        expect(sql).not.toContain(destructive);
      }
    });

    it('and the setting is off by default, so none of this happens unasked', () => {
      const env = read('backend/src/config/env.validation.ts');
      expect(env).toMatch(
        /PRACTICE_ORDER_WINDOW_DAYS: z\.coerce[\s\S]{0,120}\.default\(0\)/,
      );
    });
  });
});
