import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnswerEngine } from './answer-engine.service';
import { AssistantStore } from './assistant.store';
import { AssistantError, AssistantNotFoundError } from './assistant.types';
import { AskDto, HelpfulDto } from './dto/ask.dto';
import { languageName } from './language';
import { BadRequestException } from '@nestjs/common';

/** What "Chat with us" shows after a question is asked. */
interface AskResponse {
  questionId: string;
  answer: string;
  language: string;
  languageName: string;
  /** False means we said we do not know and somebody will look at it. */
  answered: boolean;
}

/** One earlier exchange, for the conversation on screen. */
interface ChatTurnResponse {
  questionId: string;
  askedAt: string;
  question: string;
  answer: string | null;
  answered: boolean;
  helpful: boolean | null;
}

/**
 * "CHAT WITH US", FROM THE APP'S SIDE.
 *
 * Three things a person can do: ask, say whether the reply helped, and read what
 * they asked before. Nothing else.
 *
 * EVERY ONE IS SCOPED TO THE PERSON HOLDING THE PHONE. The list only ever returns
 * their own questions, and saying "that helped" on somebody else's question is
 * refused exactly as if the question did not exist. Not "that is not yours" —
 * which would confirm that it is somebody's.
 *
 * WHY THE REASON IS NOT IN THE REPLY. The engine explains its own choice, and that
 * explanation is for staff. Telling a person "this is the closest stored answer we
 * had" undermines the answer without helping them.
 */
@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(
    private readonly engine: AnswerEngine,
    private readonly store: AssistantStore,
  ) {}

  /**
   * Ask something.
   *
   * Rate limited harder than an ordinary read: it writes a row and runs a search,
   * and it is the one endpoint somebody could use to fill the staff queue with
   * rubbish.
   */
  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AskDto,
  ): Promise<AskResponse> {
    const result = await this.translate(() =>
      this.engine.ask(user.id, dto.question),
    );
    return {
      questionId: result.questionId,
      answer: result.answer,
      language: result.language,
      languageName: languageName(result.language),
      answered: result.answered,
    };
  }

  /** Say whether the reply helped. */
  @Post('questions/:id/helpful')
  @HttpCode(HttpStatus.OK)
  async helpful(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HelpfulDto,
  ): Promise<{ recorded: true }> {
    await this.translate(() =>
      this.engine.sayItHelped(user.id, id, dto.helpful),
    );
    return { recorded: true };
  }

  /** What this person asked before, newest first. */
  @Get('questions')
  async mine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChatTurnResponse[]> {
    const rows = await this.translate(() =>
      this.store.listForOwner(user.id, 50),
    );
    return rows.map((q) => ({
      questionId: q.id,
      askedAt: q.askedAt.toISOString(),
      question: q.rawText,
      answer: q.answerText,
      answered: q.answerOrigin !== 'NONE',
      helpful: q.helpful,
    }));
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
