import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { ListAnswersQueryDto } from './dto/list-answers.query';
import { ListAssistantQuestionsQueryDto } from './dto/list-questions.query';
import { AssistantStatsQueryDto } from './dto/stats.query';

interface QuestionPageResponse {
  total: number;
  limit: number;
  offset: number;
  questions: AssistantQuestionSummary[];
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
