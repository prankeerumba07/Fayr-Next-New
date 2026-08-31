import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { AssistantStore } from './assistant.store';
import { AssistantError, AssistantNotFoundError } from './assistant.types';
import {
  toAnswerSummary,
  toQuestionDetail,
  toQuestionSummary,
  toStatsResponse,
  type AnswerSummaryResponse,
  type AssistantQuestionDetail,
  type AssistantQuestionSummary,
  type StatsResponse,
} from './assistant.response';
import { plainLanguageProblems } from './plain-language';
import { CheckWordsDto, SaveAnswerDto } from './dto/save-answer.dto';
import { ListAnswersQueryDto } from './dto/list-answers.query';
import { ListAssistantQuestionsQueryDto } from './dto/list-questions.query';
import { AssistantStatsQueryDto } from './dto/stats.query';

interface QuestionPageResponse {
  total: number;
  limit: number;
  offset: number;
  questions: AssistantQuestionSummary[];
}

/** A saved answer, and what is wrong with the way it is written. */
interface SavedAnswerResponse {
  answer: AnswerSummaryResponse;
  plainLanguage: { ok: boolean; problems: string[] };
}

interface AnswerPageResponse {
  total: number;
  limit: number;
  offset: number;
  answers: AnswerSummaryResponse[];
}

/**
 * WHAT STAFF CAN READ OF WHAT THE ASSISTANT HAS BEEN ASKED.
 *
 * Read-only, all of it. Phase 1 is the record; writing and correcting answers is
 * the staff screens later, and putting a write here now would mean shipping an
 * endpoint with no screen behind it and no test of the thing it is for.
 *
 * SUPPORT owns this — it is the customer-support team's queue — with ADMIN passing
 * through the super-role, exactly like the existing question endpoints next door.
 * FINANCE and OPERATIONS get nothing: none of this is money or offers.
 *
 * WHAT IS AUDITED, AND WHY ONLY THAT. Listing the queue is a tab loading, many
 * times an hour, and recording it would bury the trail in noise. Opening ONE
 * question is different: it shows one named person's own words, their phone
 * number, and the record of what they were doing at the time. That is the act
 * worth being able to account for afterwards.
 */
@Controller('admin/assistant')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminAssistantController {
  constructor(
    private readonly store: AssistantStore,
    private readonly audit: AdminAuditService,
  ) {}

  /** The queue. Ask for UNRESOLVED to get the list somebody has to act on. */
  @Get('questions')
  async questions(
    @Query() query: ListAssistantQuestionsQueryDto,
  ): Promise<QuestionPageResponse> {
    const page = await this.translate(() =>
      this.store.listQuestions({
        status: query.status,
        userId: query.userId,
        limit: query.limit,
        offset: query.offset,
      }),
    );
    return {
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      questions: page.questions.map((q) => toQuestionSummary(q, q.user)),
    };
  }

  /** One question, with what that person was doing when they asked. Audited. */
  @Get('questions/:id')
  async question(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssistantQuestionDetail> {
    const q = await this.translate(() => this.store.getQuestion(id));
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_QUESTION_VIEW,
      targetUserId: q.userId,
      metadata: {
        questionId: q.id,
        language: q.detectedLanguage,
        status: q.status,
        // Whether the record of their movements was there to read. Never the
        // record itself — the audit trail says who looked, not what they saw.
        journeyCaptured: q.journey !== null,
      },
    });
    return toQuestionDetail(q, q.user);
  }

  /** The answer book. */
  @Get('answers')
  async answers(
    @Query() query: ListAnswersQueryDto,
  ): Promise<AnswerPageResponse> {
    const page = await this.translate(() =>
      this.store.listAnswers({
        language: query.language,
        status: query.status,
        topic: query.topic,
        limit: query.limit,
        offset: query.offset,
      }),
    );
    return {
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      answers: page.answers.map(toAnswerSummary),
    };
  }

  /**
   * Write an answer, or correct one.
   *
   * A new answer is saved as a DRAFT and marked as written by a person; approving
   * is a separate act, below, because approving is what lets it reach somebody.
   * Correcting one that is ALREADY approved leaves it approved: somebody trusted
   * to let an answer out is trusted to fix it, and the alternative is a person
   * fixing a bad answer and watching nothing change.
   *
   * THE PLAIN-LANGUAGE PROBLEMS COME BACK AS A WARNING, NOT A REFUSAL. Somebody
   * halfway through rewriting an answer must not lose the work because the wording
   * is not finished. The refusal is at the approve step, where it matters.
   */
  @Post('answers')
  async saveAnswer(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: SaveAnswerDto,
  ): Promise<SavedAnswerResponse> {
    const saved = await this.translate(() =>
      this.store.saveAnswer({
        key: dto.key,
        language: dto.language,
        title: dto.title,
        body: dto.body,
        topic: dto.topic,
        // NO status passed on purpose. A NEW answer starts as a draft. Correcting
        // one that is already approved LEAVES IT APPROVED, so the fix is live for
        // the next person who asks — which is the whole promise of this screen.
        // Sending it back for approval every time would mean a person fixes a bad
        // answer, watches nothing change, and stops bothering.
        origin: 'STAFF',
        phrases: dto.phrases,
        updatedByStaffId: staff.id,
      }),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_ANSWER_SAVE,
      metadata: {
        key: saved.key,
        language: saved.language,
        revision: saved.revision,
      },
    });
    const full = await this.translate(() => this.store.getAnswer(saved.id));
    return {
      answer: toAnswerSummary(full),
      plainLanguage: this.checkWords(dto.title, dto.body, dto.language),
    };
  }

  /** Check the words without saving anything. What the screen warns from. */
  @Post('answers/check')
  @HttpCode(HttpStatus.OK)
  check(@Body() dto: CheckWordsDto): { ok: boolean; problems: string[] } {
    return this.checkWords(dto.title ?? '', dto.body, dto.language);
  }

  /**
   * Approve an answer, so the assistant may start giving it.
   *
   * REFUSED if it does not read plainly. Not out of tidiness: the engine holds
   * back an answer that breaks the rule whatever its state, so publishing one
   * would leave staff believing they had fixed something while every person who
   * asks still gets "I could not answer this yet". Better to refuse here, with the
   * list of what to change.
   */
  @Post('answers/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SavedAnswerResponse> {
    const existing = await this.translate(() => this.store.getAnswer(id));
    const words = this.checkWords(
      existing.title,
      existing.body,
      existing.language,
    );
    if (!words.ok) {
      throw new BadRequestException([
        'This answer cannot be approved until it reads plainly.',
        ...words.problems,
      ]);
    }
    const updated = await this.translate(() =>
      this.store.setAnswerStatus(id, 'PUBLISHED', staff.id),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_ANSWER_APPROVE,
      metadata: {
        key: updated.key,
        language: updated.language,
        revision: updated.revision,
      },
    });
    const full = await this.translate(() => this.store.getAnswer(id));
    return { answer: toAnswerSummary(full), plainLanguage: words };
  }

  /** Withdraw an answer. Kept, not deleted, so old questions still make sense. */
  @Post('answers/:id/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SavedAnswerResponse> {
    const updated = await this.translate(() =>
      this.store.setAnswerStatus(id, 'RETIRED', staff.id),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_ANSWER_RETIRE,
      metadata: { key: updated.key, language: updated.language },
    });
    const full = await this.translate(() => this.store.getAnswer(id));
    return {
      answer: toAnswerSummary(full),
      plainLanguage: this.checkWords(
        updated.title,
        updated.body,
        updated.language,
      ),
    };
  }

  /** Close a question a person has dealt with. */
  @Post('questions/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssistantQuestionDetail> {
    const closed = await this.translate(() =>
      this.store.resolveByStaff(id, staff.id),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_QUESTION_RESOLVE,
      targetUserId: closed.userId,
      metadata: { questionId: closed.id },
    });
    const full = await this.translate(() => this.store.getQuestion(id));
    return toQuestionDetail(full, full.user);
  }

  /** How long questions are taking to settle. */
  @Get('stats')
  async stats(@Query() query: AssistantStatsQueryDto): Promise<StatsResponse> {
    const stats = await this.translate(() =>
      this.store.resolutionStats({ windowDays: query.days }),
    );
    return toStatsResponse(stats);
  }

  /**
   * Turn the store's own errors into the right status code.
   *
   * By CLASS, not by the text of a message: a 404 that depends on a sentence
   * somebody may reword is a 404 that stops working silently.
   */
  /**
   * The plain-language problems for a title and a body, as lines a screen can put
   * in front of a person. One place, so the warning on the way in and the refusal
   * at the approve step can never disagree.
   */
  private checkWords(
    title: string,
    body: string,
    language: string,
  ): { ok: boolean; problems: string[] } {
    const problems = [
      ...plainLanguageProblems(body, language),
      ...plainLanguageProblems(title, language).map(
        (p) => `In the title: ${p}`,
      ),
    ];
    return { ok: problems.length === 0, problems };
  }

  private async translate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof AssistantNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof AssistantError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
