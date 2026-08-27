import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AssistantStore } from './assistant.store';
import { PrismaService } from '../prisma/prisma.service';
import { ANSWER_DRAFTS, DRAFT_LANGUAGES } from './answer-drafts';
import { checkPlainLanguage } from './plain-language';

export interface SeedDraftsReport {
  created: number;
  updated: number;
  /** Left alone because a person had already worked on them. */
  leftAlone: number;
  /** Refused because the words did not read plainly. Should always be zero. */
  refused: string[];
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
  ) {}

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

    for (const draft of ANSWER_DRAFTS) {
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
}
