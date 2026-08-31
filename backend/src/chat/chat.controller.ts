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

  /** My conversation, oldest message first. Opens an empty one if I have none. */
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
