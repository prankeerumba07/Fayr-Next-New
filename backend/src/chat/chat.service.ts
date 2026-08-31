import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage } from '@prisma/client';
import { AnswerEngine } from '../assistant/answer-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectLanguage } from '../assistant/language';
import { plainLanguageProblems } from '../assistant/plain-language';
import {
  ChatError,
  ChatStore,
  type ChatWithMessages,
  type QueueFilter,
  type QueuePage,
} from './chat.store';
import {
  checkMessage,
  mayReply,
  mayTake,
  type StaffFacts,
} from './chat.rules';

/** What happened when somebody said something. */
export interface SaidResult {
  chat: ChatWithMessages;
  /** The message that was written down for what they typed. */
  theirs: ChatMessage;
  /** What Fayr said back, when the assistant was the one handling it. */
  reply: ChatMessage | null;
}

/** What is wrong with the way a reply is written, if anything. */
export interface ReplyWarnings {
  ok: boolean;
  problems: string[];
}

/**
 * A CONVERSATION, WITH BOTH SIDES ABLE TO SPEAK.
 *
 * Before this, a question went in and an answer came back and that was the end of
 * it. Nobody at Fayr could say anything, and the shopper could not say "that is
 * not what I meant" — every message started a new question with no memory of the
 * last one.
 *
 * ONE FUNNEL, NOT TWO. Everything a shopper types goes through say() below,
 * whichever door it came in at, and everything a member of staff types goes
 * through reply(). The assistant is not a separate system that happens to write
 * to the same table: it is what say() does when nobody has taken the conversation
 * yet.
 *
 * THE QUESTION RECORD IS UNCHANGED AND STILL THE THING WE LEARN FROM. Every
 * shopper message still becomes an AssistantQuestion, still snapshotted with what
 * they were doing, still counted in the answer book's statistics. The conversation
 * is a layer on top of that record, never instead of it.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly store: ChatStore,
    private readonly engine: AnswerEngine,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * A shopper says something.
   *
   * WHO ANSWERS DEPENDS ON WHO HAS IT. While the assistant is handling the
   * conversation it answers; once a person has taken it, or it is waiting for
   * one, the assistant stays quiet. Two replies to one message — one from the
   * answer book and one from a person, minutes apart, possibly disagreeing — is
   * the failure this rule exists to prevent.
   */
  async say(userId: string, text: string): Promise<SaidResult> {
    const checked = checkMessage(text);
    if (!checked.ok) throw new ChatError(checked.reason as string);

    const chat = await this.store.openChatFor(userId);
    const language = detectLanguage(checked.body).language;

    if (chat.state !== 'ASSISTANT') {
      // A person has it, or is about to. Write it down and leave it for them.
      const theirs = await this.store.addMessage({
        chatId: chat.id,
        author: 'PERSON',
        body: checked.body,
        language,
      });
      return {
        chat: await this.store.getChat(chat.id),
        theirs,
        reply: null,
      };
    }

    // The assistant has it. Ask, and record the question the way it has always
    // been recorded — the answer book learns from these rows and nothing about
    // that changes because there is a conversation around them now.
    const asked = await this.engine.ask(userId, checked.body);

    // The question row belongs to this conversation. Written after the ask so a
    // failure to link can never lose the question itself.
    await this.prisma.assistantQuestion
      .update({ where: { id: asked.questionId }, data: { chatId: chat.id } })
      .catch((err: unknown) => {
        const why = err instanceof Error ? err.message : String(err);
        this.log.warn(`could not attach question ${asked.questionId}: ${why}`);
      });

    const theirs = await this.store.addMessage({
      chatId: chat.id,
      author: 'PERSON',
      body: checked.body,
      language,
      assistantQuestionId: asked.questionId,
    });
    const reply = await this.store.addMessage({
      chatId: chat.id,
      author: 'ASSISTANT',
      body: asked.answer,
      language: asked.language,
      assistantQuestionId: asked.questionId,
    });

    // Nothing matched. It is a person's now, and the queue is where people look.
    if (!asked.answered) await this.store.handOver(chat.id);

    return { chat: await this.store.getChat(chat.id), theirs, reply };
  }

  /** The conversation this person is having, opening an empty one if they have none. */
  async conversationForOwner(userId: string): Promise<ChatWithMessages> {
    const chat = await this.store.openChatFor(userId);
    return this.store.getChat(chat.id);
  }

  /**
   * Which questions in a conversation have already been answered with a yes or a
   * no. Read separately from the messages because it lives on the question row,
   * where it has always lived and where the answer book reads it from.
   */
  async helpfulByQuestion(chatId: string): Promise<Map<string, boolean | null>> {
    const rows = await this.prisma.assistantQuestion.findMany({
      where: { chatId },
      select: { id: true, helpful: true },
    });
    return new Map(rows.map((r) => [r.id, r.helpful]));
  }

  /** One of their own conversations, by name. */
  async oneForOwner(userId: string, chatId: string): Promise<ChatWithMessages> {
    return this.store.getChatForOwner(userId, chatId);
  }

  // ── the staff side ────────────────────────────────────────────────────────

  async queue(filter: QueueFilter): Promise<QueuePage> {
    return this.store.listQueue(filter);
  }

  async one(chatId: string): Promise<ChatWithMessages> {
    return this.store.getChat(chatId);
  }

  /** Put a member of staff's name on a conversation. */
  async take(chatId: string, staff: StaffFacts): Promise<ChatWithMessages> {
    const chat = await this.store.getChat(chatId);
    const said = mayTake(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);
    await this.store.take(chatId, staff.id);
    return this.store.getChat(chatId);
  }

  /**
   * A member of staff replies.
   *
   * THE PLAIN LANGUAGE RULE WARNS HERE, IT DOES NOT BLOCK. An answer in the
   * answer book is read by thousands of people and is refused until it reads
   * plainly. A reply in a live conversation is read by one person who is waiting,
   * and refusing to send it because it contains a word we do not like would be
   * putting our own tidiness above answering them. So the warning goes back with
   * the reply, and the agent decides.
   */
  async reply(
    chatId: string,
    staff: StaffFacts,
    text: string,
  ): Promise<{ chat: ChatWithMessages; message: ChatMessage; warnings: ReplyWarnings }> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);

    const checked = checkMessage(text);
    if (!checked.ok) throw new ChatError(checked.reason as string);

    const language = detectLanguage(checked.body).language;
    const message = await this.store.addMessage({
      chatId,
      author: 'AGENT',
      body: checked.body,
      language,
      staffUserId: staff.id,
      assistantQuestionId: await this.latestQuestionOn(chatId),
    });

    // An administrator replying to a conversation nobody has taken takes it by
    // replying. Leaving it unowned after somebody has answered in it would put
    // it back in the queue for a second person to answer again.
    if (chat.takenByStaffId === null) await this.store.take(chatId, staff.id);

    return {
      chat: await this.store.getChat(chatId),
      message,
      warnings: this.checkWords(checked.body, language),
    };
  }

  /** Finish a conversation. */
  async close(chatId: string, staff: StaffFacts): Promise<ChatWithMessages> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);
    await this.store.close(chatId);
    return this.store.getChat(chatId);
  }

  /** What is wrong with the way something is written, without sending it. */
  checkWords(text: string, language?: string): ReplyWarnings {
    const lang = language ?? detectLanguage(text).language;
    const problems = plainLanguageProblems(text, lang);
    return { ok: problems.length === 0, problems };
  }

  /**
   * The question a reply is answering: the newest one in the conversation.
   *
   * Newest and not "the one with no answer", because an agent's reply is very
   * often a correction to an answer the assistant already gave, and hanging it
   * off an older unanswered question would file it under the wrong words.
   */
  private async latestQuestionOn(chatId: string): Promise<string | null> {
    const found = await this.prisma.assistantQuestion.findFirst({
      where: { chatId },
      orderBy: { askedAt: 'desc' },
      select: { id: true },
    });
    return found?.id ?? null;
  }
}
