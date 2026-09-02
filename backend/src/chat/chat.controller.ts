import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ChatService } from './chat.service';
import { ChatError, ChatNotFoundError } from './chat.store';
import { toChat, type ChatResponse } from './chat.response';
import { SayDto } from './dto/say.dto';

/**
 * "CHAT WITH US", FROM THE PHONE.
 *
 * Two things: read my conversation, and say something in it. Everything else —
 * who answers, whether it goes to a person, what the state is — is decided by the
 * service, because the phone deciding any of that would mean a second copy of the
 * rules that could disagree with the first.
 *
 * EVERY ROUTE IS SCOPED TO THE PERSON HOLDING THE PHONE. There is no route here
 * that takes somebody else's name for anything. The conversation returned is the
 * one belonging to the signed-in account and there is no way to ask for another.
 *
 * READING IS CHEAP ON PURPOSE. The app reads this every few seconds while the
 * screen is open, so that a reply written by a person appears without anybody
 * having to do anything. That is a deliberate choice over a live connection: a
 * connection that has to be kept alive is a connection that breaks on a train,
 * and the thing it would buy us is a few seconds.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * I TAPPED "CHAT WITH US". Start a new, empty conversation.
   *
   * THE OWNER'S RULE, 2 September 2026: nobody is ever shown their own older
   * conversations. Every time somebody opens the chat screen they start fresh.
   * Staff see every conversation that person has ever had, in the staff panel.
   *
   * NOTHING IS DELETED. The conversation they were in is left exactly as it is,
   * with every message in it. It simply stops being the newest, and the newest is
   * the only one this controller can ever hand back.
   *
   * ONE EXCEPTION, AND IT IS NOT HISTORY: a conversation a person at Fayr has
   * taken, or one waiting in the queue for one, is the conversation that person is
   * about to write a reply into. See startsANewConversation in chat.rules.ts.
   */
  @Post('open')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async open(@CurrentUser() user: AuthenticatedUser): Promise<ChatResponse> {
    const chat = await this.translate(() => this.chat.startScreenFor(user.id));
    return toChat(chat, await this.chat.helpfulByQuestion(chat.id));
  }

  /**
   * The conversation I am in right now, oldest message first.
   *
   * THE NEWEST, AND NEVER AN OLDER ONE. This is what the screen polls while it is
   * open, so it must hand back the same conversation every time rather than
   * starting one. There is no route here that takes a conversation's name, so
   * there is no way for a phone to ask for an older conversation even on purpose.
   */
  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<ChatResponse> {
    const chat = await this.translate(() =>
      this.chat.conversationForOwner(user.id),
    );
    return toChat(chat, await this.chat.helpfulByQuestion(chat.id));
  }

  /** Say something. Returns the whole conversation, reply included. */
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async say(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SayDto,
  ): Promise<ChatResponse> {
    const said = await this.translate(() => this.chat.say(user.id, dto.message));
    return toChat(said.chat, await this.chat.helpfulByQuestion(said.chat.id));
  }

  /**
   * Our own errors, turned into the right refusal.
   *
   * A missing conversation is a 404 and a bad message is a 400; anything we did
   * not name ourselves is left alone so a real fault is never dressed up as the
   * caller's mistake.
   */
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
