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
import { ChatService, type ReplyWarnings } from './chat.service';
import { ChatError, ChatNotFoundError } from './chat.store';
import {
  toChat,
  toQueueRow,
  type ChatQueueRow,
  type ChatResponse,
} from './chat.response';
import type { Draft } from './email-draft';
import { CheckReplyDto, ReplyDto } from './dto/say.dto';
import { SaveReplyAsAnswerDto } from './dto/save-as-answer.dto';
import type { ToWrite } from './what-to-write-next';
import { ListChatsQueryDto } from './dto/list-chats.query';

interface QueuePageResponse {
  total: number;
  limit: number;
  offset: number;
  chats: ChatQueueRow[];
}

/** A conversation, and what was wrong with the words just sent into it. */
interface RepliedResponse {
  chat: ChatResponse;
  plainLanguage: ReplyWarnings;
}

const DEFAULT_LIMIT = 25;

/**
 * CONVERSATIONS, FROM THE STAFF SIDE.
 *
 * SUPPORT owns this, with ADMIN passing through the super-role, exactly like the
 * question queue next door. Nobody in FINANCE or OPERATIONS has any business
 * reading a shopper's conversation: none of it is money or offers.
 *
 * WHAT IS AUDITED. Listing the queue is a tab loading, many times an hour, and
 * recording it would bury the trail. Opening ONE conversation shows one named
 * person's own words and their phone number, so that is recorded — the same line
 * the question queue already draws. Taking, replying and closing are recorded
 * because each of them is somebody at Fayr doing something a shopper will see.
 *
 * THE OWNERSHIP RULE IS ENFORCED HERE AND NOT ONLY ON THE SCREEN. Hiding the
 * reply box for a conversation somebody else has taken is a courtesy. The refusal
 * is in chat.rules.ts, checked by the service, and proved by a test that signs in
 * as the wrong person and is turned away.
 */
@Controller('admin/chats')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly audit: AdminAuditService,
  ) {}

  /** The queue, longest wait first. */
  @Get()
  async queue(
    @Query() query: ListChatsQueryDto,
  ): Promise<QueuePageResponse> {
    const page = await this.translate(() =>
      this.chat.queue({
        state: query.state,
        takenByStaffId: query.takenByStaffId,
        // One person's whole history, newest first, when staff ask for one
        // person. The shopper only ever sees the conversation they are in; this
        // is how whoever is helping them reads every one they have ever had.
        userId: query.userId,
        limit: query.limit ?? DEFAULT_LIMIT,
        offset: query.offset ?? 0,
      }),
    );
    return {
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      chats: page.chats.map(toQueueRow),
    };
  }

  /**
   * WHAT THE TEAM SHOULD WRITE AN ANSWER FOR NEXT.
   *
   * The questions nobody could answer, grouped and counted, most asked first.
   * Not audited: it is a list of what people typed with nobody's name on it, and
   * it is a tab loading many times a day.
   */
  @Get('what-to-write-next')
  async whatToWriteNext(): Promise<{ readFrom: number; groups: ToWrite[] }> {
    return this.translate(() => this.chat.whatToWrite(20));
  }

  /** One conversation, every message in it. Audited. */
  @Get(':id')
  async one(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatResponse> {
    const chat = await this.translate(() => this.chat.one(id));
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.CHAT_VIEW,
      targetUserId: chat.userId,
      metadata: {
        chatId: chat.id,
        state: chat.state,
        messages: chat.messages.length,
      },
    });
    return toChat(chat);
  }

  /** Take it. Puts this person's name on it and stops anybody else replying. */
  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  async take(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatResponse> {
    const chat = await this.translate(() =>
      this.chat.take(id, { id: staff.id, role: staff.role }),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.CHAT_TAKE,
      targetUserId: chat.userId,
      metadata: { chatId: chat.id },
    });
    return toChat(chat);
  }

  /**
   * Reply. Refused unless this is the person who took it, or an administrator.
   *
   * The plain-language warning comes back WITH the sent reply rather than
   * standing in its way. See ChatService.reply for why that is deliberate.
   */
  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  async reply(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ): Promise<RepliedResponse> {
    const done = await this.translate(() =>
      this.chat.reply(id, { id: staff.id, role: staff.role }, dto.message),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.CHAT_REPLY,
      targetUserId: done.chat.userId,
      metadata: {
        chatId: done.chat.id,
        messageId: done.message.id,
        // The number of problems, never the words. The audit trail is read by
        // people who do not need to see what a shopper was told.
        plainLanguageProblems: done.warnings.problems.length,
      },
    });
    return { chat: toChat(done.chat), plainLanguage: done.warnings };
  }

  /**
   * A suggested email, for this agent to copy and send from their own email.
   *
   * Refused unless this is the person who took the conversation, or an
   * administrator, for exactly the reason replying is: an email is a reply, sent
   * a different way.
   *
   * NOT AUDITED. Reading a draft is reading, and the conversation it is drawn
   * from was already recorded when it was opened. Recording every look at a
   * suggestion would bury the trail in the same noise the queue was kept out of.
   */
  @Get(':id/email-draft')
  async emailDraft(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Draft> {
    return this.translate(() =>
      this.chat.emailDraftFor(id, { id: staff.id, role: staff.role }),
    );
  }

  /**
   * Turn a reply this agent wrote into a new answer.
   *
   * It arrives as a DRAFT and needs approving like every other new answer. The
   * person who wrote the words does not automatically decide they are Fayr's
   * official answer, and one button that did both would make them the same
   * person by accident.
   */
  @Post(':id/messages/:messageId/save-as-answer')
  @HttpCode(HttpStatus.OK)
  async saveAsAnswer(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: SaveReplyAsAnswerDto,
  ): Promise<{
    key: string;
    language: string;
    plainLanguage: { ok: boolean; problems: string[] };
  }> {
    const saved = await this.translate(() =>
      this.chat.saveReplyAsAnswer(
        id,
        messageId,
        { id: staff.id, role: staff.role },
        dto.topic,
      ),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.ASSISTANT_ANSWER_SAVE,
      metadata: {
        key: saved.key,
        language: saved.language,
        fromChatId: id,
        fromMessageId: messageId,
      },
    });
    return saved;
  }

  /** What is wrong with these words, without sending them. */
  @Post('reply/check')
  @HttpCode(HttpStatus.OK)
  check(@Body() dto: CheckReplyDto): ReplyWarnings {
    return this.chat.checkWords(dto.message);
  }

  /** Finish it. */
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatResponse> {
    const chat = await this.translate(() =>
      this.chat.close(id, { id: staff.id, role: staff.role }),
    );
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.CHAT_CLOSE,
      targetUserId: chat.userId,
      metadata: { chatId: chat.id },
    });
    return toChat(chat);
  }

  private async translate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ChatNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof ChatError) throw new BadRequestException(err.message);
      throw err;
    }
  }
}
