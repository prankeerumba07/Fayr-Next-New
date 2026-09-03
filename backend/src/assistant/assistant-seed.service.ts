import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AnswerDraftSet } from './answer-drafts';
import { AssistantStore } from './assistant.store';
import { PrismaService } from '../prisma/prisma.service';
import { ANSWER_DRAFTS, DRAFT_LANGUAGES, howToReachUsDraft } from './answer-drafts';
import { ContactService } from '../contact/contact.service';
import { checkPlainLanguage } from './plain-language';

export interface SeedDraftsReport {
  created: number;
  updated: number;
  /** Left alone because a person had already worked on them. */
  leftAlone: number;
  /** Refused because the words did not read plainly. Should always be zero. */
  refused: string[];
}

export interface PublishForPracticeReport {
  /** Untouched assistant drafts that are now readable in the chat. */
  published: number;
  /** Skipped because a person had already decided about them. */
  leftAlone: number;
}

/**
 * PUTTING THE DRAFTED ANSWERS INTO THE ANSWER BOOK.
 *
 * Every one goes in as a DRAFT, marked as written by the assistant. Nothing here
 * is ever shown to a person until a member of staff reads it and approves it.
 *
 * IT NEVER OVERWRITES SOMEBODY'S WORK. This runs on every boot, so the one thing
 * it must not do is quietly undo a correction. An answer is left completely alone
 * if a person has touched it — that is, if its origin is STAFF, or if somebody has
 * approved it. Only an untouched assistant draft is refreshed, so improving the
 * wording in the code still reaches the book, and a person's fix always wins.
 *
 * AND IT CHECKS ITS OWN WORDS ON THE WAY IN. The drafts are already checked by a
 * test, so this should never refuse anything. It refuses anyway, because the test
 * runs on my machine and this runs on the real one.
 */
@Injectable()
export class AssistantSeedService implements OnModuleInit {
  private readonly log = new Logger(AssistantSeedService.name);

  constructor(
    private readonly store: AssistantStore,
    private readonly prisma: PrismaService,
    private readonly contact: ContactService,
  ) {}

  /**
   * Every answer that goes in the book, including the one that carries the
   * support number.
   *
   * The number is a setting, so its answer is built here rather than written into
   * answer-drafts.ts. It goes through the same plain-language check, the same
   * "leave a person's work alone" rule and the same row as all the others.
   */
  private allDrafts(): AnswerDraftSet[] {
    return [...ANSWER_DRAFTS, howToReachUsDraft(this.contact.phoneNumber())];
  }

  async onModuleInit(): Promise<void> {
    // Not under test: the e2e suite decides for itself when the answer book has
    // anything in it, and a seed running behind its back makes every count wrong.
    if (process.env.NODE_ENV === 'test') return;
    const report = await this.seedDrafts();
    if (report.created > 0 || report.updated > 0 || report.refused.length > 0) {
      this.log.log(
        `answer book: ${report.created} added, ${report.updated} refreshed, ` +
          `${report.leftAlone} left alone because a person had worked on them` +
          (report.refused.length > 0
            ? `, ${report.refused.length} REFUSED for not reading plainly`
            : ''),
      );
    }
  }

  async seedDrafts(): Promise<SeedDraftsReport> {
    const report: SeedDraftsReport = {
      created: 0,
      updated: 0,
      leftAlone: 0,
      refused: [],
    };

    for (const draft of this.allDrafts()) {
      for (const language of DRAFT_LANGUAGES) {
        const wording = draft.wordings[language];
        const where = { key: draft.key, language };

        const bodyOk = checkPlainLanguage(wording.body, language).ok;
        const titleOk = checkPlainLanguage(wording.title, language).ok;
        if (!bodyOk || !titleOk) {
          report.refused.push(`${draft.key} (${language})`);
          continue;
        }

        const existing = await this.prisma.answerEntry.findUnique({
          where: { key_language: where },
        });

        if (existing) {
          const personHasTouchedIt =
            existing.origin === 'STAFF' || existing.status !== 'DRAFT';
          if (personHasTouchedIt) {
            report.leftAlone += 1;
            continue;
          }
        }

        await this.store.saveAnswer({
          key: draft.key,
          language,
          title: wording.title,
          body: wording.body,
          topic: draft.topic,
          // DRAFT, always. Never PUBLISHED from here.
          status: 'DRAFT',
          origin: 'ASSISTANT',
          phrases: wording.phrases,
        });
        if (existing) report.updated += 1;
        else report.created += 1;
      }
    }
    return report;
  }

  /**
   * PRACTICE AND DEVELOPMENT DATABASES ONLY — make the drafted answers readable.
   *
   * Without this, a fresh practice database has seventy five answers in it and
   * "Chat with us" cannot answer a single question, because every one of them is
   * waiting for a person. Nobody is going to approve seventy five answers by hand
   * before a screen can be shown working, so on a practice database we do it here
   * and the chat is usable the moment the app opens.
   *
   * A REAL DEPLOYMENT MUST NEVER COME THROUGH HERE. The drafts were written by the
   * assistant from the policy screens. No person has read them, and the Hindi ones
   * have not been read by a Hindi speaker at all. Publishing them to real people
   * would be putting unchecked words in Fayr's mouth. So this refuses outright on
   * any database not named *_dev or *_test — the same guard the demo seed makes
   * before it writes users and ledger entries, repeated here so the rule travels
   * with the method rather than depending on who calls it.
   *
   * IT ONLY EVER TOUCHES AN UNTOUCHED ASSISTANT DRAFT. Something a person wrote,
   * or retired, or already decided about, is left exactly as they left it.
   */
  async publishDraftsForPractice(
    staffUserId: string,
    databaseNameOverride?: string,
  ): Promise<PublishForPracticeReport> {
    await this.assertPracticeDatabase(databaseNameOverride);

    const untouchedDrafts = await this.prisma.answerEntry.findMany({
      where: { origin: 'ASSISTANT', status: 'DRAFT' },
      select: { id: true },
    });
    const decidedByAPerson = await this.prisma.answerEntry.count({
      where: { NOT: { origin: 'ASSISTANT', status: 'DRAFT' } },
    });

    for (const entry of untouchedDrafts) {
      await this.store.setAnswerStatus(entry.id, 'PUBLISHED', staffUserId);
    }

    return {
      published: untouchedDrafts.length,
      leftAlone: decidedByAPerson,
    };
  }

  private async assertPracticeDatabase(override?: string): Promise<void> {
    let name = override;
    if (name == null) {
      const rows = await this.prisma.$queryRawUnsafe<
        { current_database: string }[]
      >('SELECT current_database()');
      name = rows[0]?.current_database ?? '';
    }
    if (!/_dev$|_test$/.test(name)) {
      throw new Error(
        `Refused to publish the drafted answers: "${name}" is not a practice `
          + 'or development database. On a real one a person has to read every '
          + 'answer and approve it.',
      );
    }
  }
}
