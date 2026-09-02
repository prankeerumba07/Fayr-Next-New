import { Injectable } from '@nestjs/common';
import type { Chat, ChatMessage, Prisma, StaffUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MESSAGE_MAX_LENGTH,
  checkMessage,
  startsANewConversation,
  type ChatAuthorName,
  type ChatStateName,
} from './chat.rules';

/** A conversation with everything needed to draw it. */
export type ChatWithMessages = Chat & {
  messages: (ChatMessage & { staffUser: Pick<StaffUser, 'id' | 'name'> | null })[];
  takenBy: Pick<StaffUser, 'id' | 'name'> | null;
};

/** One row of the queue: enough to decide whether to open it. */
export type ChatInQueue = Chat & {
  takenBy: Pick<StaffUser, 'id' | 'name'> | null;
  user: { id: string; displayId: string; mobile: string };
  _count: { messages: number };
  messages: Pick<ChatMessage, 'body' | 'author' | 'sentAt'>[];
};

export interface QueueFilter {
  state?: ChatStateName;
  takenByStaffId?: string;
  /**
   * One person, when staff want that person's whole history rather than the
   * queue. Staff only: no route a shopper can reach accepts this.
   */
  userId?: string;
  limit: number;
  offset: number;
}

export interface QueuePage {
  total: number;
  limit: number;
  offset: number;
  chats: ChatInQueue[];
}

export interface NewMessage {
  chatId: string;
  author: ChatAuthorName;
  body: string;
  language: string;
  staffUserId?: string | null;
  assistantQuestionId?: string | null;
}

/** Something the caller did wrong, in words worth showing them. */
export class ChatError extends Error {}
export class ChatNotFoundError extends ChatError {}

const QUEUE_SUMMARY = {
  takenBy: { select: { id: true, name: true } },
  user: { select: { id: true, displayId: true, mobile: true } },
  _count: { select: { messages: true } },
  // The newest message only, so the queue reads like a list of conversations
  // rather than a list of identifiers. One row each, not the whole history.
  messages: {
    orderBy: { sentAt: 'desc' },
    take: 1,
    select: { body: true, author: true, sentAt: true },
  },
} satisfies Prisma.ChatInclude;

/**
 * THE ONLY WAY IN AND OUT OF A CONVERSATION.
 *
 * Every read and every write goes through here, for the same reason the answer
 * book has a store: the rules about who owns a conversation are worth nothing if
 * half the code reaches around them.
 *
 * NOTHING HERE DECIDES ANYTHING. Whether somebody may reply is chat.rules.ts, and
 * it is decided before anything in this file is called. This file's job is to
 * make the write correct once the decision is made — which mostly means keeping
 * the state, the owner and the timestamps honest together, because the database
 * refuses any combination of them that would not make sense.
 */
@Injectable()
export class ChatStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * THE CONVERSATION THIS PERSON IS IN RIGHT NOW, and never an older one.
   *
   * THE NEWEST, ALWAYS. Once a newer conversation exists, this can never hand
   * back the older one again, to anybody. That is what makes the owner's rule a
   * rule of the server rather than something the phone chooses to honour: there
   * is no route anywhere that takes a conversation's name from a shopper, so
   * there is no way to ask for an older one even on purpose.
   *
   * One open conversation per person at a time, deliberately. A shopper with
   * three of them would have their answer arrive in whichever one they were not
   * looking at, and a queue with three rows for one confused person is a queue
   * nobody trusts.
   */
  async openChatFor(userId: string): Promise<Chat> {
    const existing = await this.newestFor(userId);
    if (existing) return existing;
    return this.prisma.chat.create({ data: { userId } });
  }

  /** The newest conversation that is not finished, or nothing. */
  async newestFor(userId: string): Promise<Chat | null> {
    return this.prisma.chat.findFirst({
      where: { userId, state: { not: 'CLOSED' } },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * OPENING THE CHAT SCREEN. A NEW, EMPTY CONVERSATION, ALMOST ALWAYS.
   *
   * The decision itself is startsANewConversation in chat.rules.ts, where it is
   * pure and checked on its own. This is only the write.
   *
   * NOTHING IS DELETED AND NOTHING IS CLOSED HERE. The conversation they were in
   * is left exactly as it is. It simply stops being the newest, and the newest is
   * the only one the phone can ever be handed.
   */
  async startScreenFor(userId: string): Promise<Chat> {
    const current = await this.newestFor(userId);
    if (!startsANewConversation(current)) return current as Chat;
    return this.prisma.chat.create({ data: { userId } });
  }

  /** Write one message down and move the conversation's clock. */
  async addMessage(message: NewMessage): Promise<ChatMessage> {
    const checked = checkMessage(message.body);
    if (!checked.ok) throw new ChatError(checked.reason as string);
    if (message.author === 'AGENT' && !message.staffUserId) {
      throw new ChatError('a reply from Fayr has to say who wrote it');
    }
    if (message.author !== 'AGENT' && message.staffUserId) {
      throw new ChatError('only a reply from Fayr may carry a name');
    }

    // One transaction, because a message that is written down without moving the
    // conversation's clock sinks to the bottom of a queue ordered by that clock.
    const [written] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: {
          chatId: message.chatId,
          author: message.author,
          body: checked.body,
          language: message.language,
          staffUserId: message.staffUserId ?? null,
          assistantQuestionId: message.assistantQuestionId ?? null,
        },
      }),
      this.prisma.chat.update({
        where: { id: message.chatId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return written;
  }

  /** One conversation, oldest message first, which is how it is read. */
  async getChat(chatId: string): Promise<ChatWithMessages> {
    const found = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        takenBy: { select: { id: true, name: true } },
        messages: {
          orderBy: { sentAt: 'asc' },
          include: { staffUser: { select: { id: true, name: true } } },
        },
      },
    });
    if (!found) throw new ChatNotFoundError('no such conversation');
    return found;
  }

  /**
   * One conversation, but only if it belongs to this person.
   *
   * Separate from getChat rather than a flag on it, so that reading somebody
   * else's conversation is not one forgotten argument away.
   */
  async getChatForOwner(
    userId: string,
    chatId: string,
  ): Promise<ChatWithMessages> {
    const found = await this.getChat(chatId);
    if (found.userId !== userId) {
      throw new ChatNotFoundError('no such conversation');
    }
    return found;
  }

  /** The queue, longest wait first. */
  async listQueue(filter: QueueFilter): Promise<QueuePage> {
    const where: Prisma.ChatWhereInput = {
      state: filter.state,
      takenByStaffId: filter.takenByStaffId,
    };
    const [total, chats] = await this.prisma.$transaction([
      this.prisma.chat.count({ where }),
      this.prisma.chat.findMany({
        where,
        include: QUEUE_SUMMARY,
        // Whoever has waited longest is the one to open next. lastMessageAt and
        // not startedAt: a conversation somebody added to five minutes ago is
        // more live than one that has been sitting since this morning.
        orderBy: { lastMessageAt: 'asc' },
        take: filter.limit,
        skip: filter.offset,
      }),
    ]);
    return { total, limit: filter.limit, offset: filter.offset, chats };
  }

  /** Remember which language this conversation is being held in. */
  async rememberLanguage(chatId: string, language: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: { id: chatId },
      data: { chosenLanguage: language },
    });
  }

  /** Note that the offer to change language has been made. Made once. */
  async markLanguageOffered(chatId: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: { id: chatId },
      data: { languageOfferedAt: new Date() },
    });
  }

  /**
   * Send the one "this is taking longer than usual" note, if it is due.
   *
   * ONE WRITE, AND IT IS THE ONE THAT DECIDES. The condition is in the WHERE, so
   * two requests arriving together cannot both find it unsent and both send it —
   * the second updates nothing and the note goes out once, which is the whole
   * requirement. Doing this by reading first and then writing would be a race
   * that shows up as a shopper being apologised to twice.
   */
  async claimWaitingNote(chatId: string, notBefore: Date): Promise<boolean> {
    const done = await this.prisma.chat.updateMany({
      where: {
        id: chatId,
        state: 'WAITING_FOR_PERSON',
        waitingNoteSentAt: null,
        handedOverAt: { lte: notBefore },
      },
      data: { waitingNoteSentAt: new Date() },
    });
    return done.count === 1;
  }

  /** Hand a conversation to the queue. */
  async handOver(chatId: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: { id: chatId },
      data: { state: 'WAITING_FOR_PERSON', handedOverAt: new Date() },
    });
  }

  /** Put somebody's name on it. */
  async take(chatId: string, staffUserId: string): Promise<Chat> {
    const now = new Date();
    const before = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { handedOverAt: true },
    });
    if (!before) throw new ChatNotFoundError('no such conversation');
    return this.prisma.chat.update({
      where: { id: chatId },
      data: {
        state: 'TAKEN',
        takenByStaffId: staffUserId,
        takenAt: now,
        // A conversation taken straight from the assistant never passed through
        // the queue, so it has no waiting time of its own. Stamping one now keeps
        // "how long did this person wait" answerable for EVERY conversation
        // rather than most of them, and the answer it gives is nearly nothing,
        // which is the truth. An existing one is never overwritten: that would
        // quietly erase the wait we are trying to measure.
        handedOverAt: before.handedOverAt ?? now,
      },
    });
  }

  /** Finish it. */
  async close(chatId: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: { id: chatId },
      data: { state: 'CLOSED', closedAt: new Date() },
    });
  }

  /** Every conversation this person has had, newest first. */
  async listForOwner(userId: string, limit: number): Promise<Chat[]> {
    return this.prisma.chat.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
    });
  }

  /**
   * EVERY CONVERSATION ONE PERSON HAS EVER HAD, IN FULL, NEWEST FIRST. FOR STAFF.
   *
   * The other side of the owner's rule. The shopper is shown one conversation;
   * whoever is helping them has to be able to read the lot, including the closed
   * ones, or they will answer a question that was already answered last week.
   *
   * NEWEST FIRST here, and longest wait first in the queue, and both are right
   * for what they are for. A queue is a list of work and the oldest is the most
   * urgent. One person's history is a story and you read the latest chapter first.
   */
  async historyFor(userId: string, limit: number, offset: number): Promise<QueuePage> {
    const where: Prisma.ChatWhereInput = { userId };
    const [total, chats] = await this.prisma.$transaction([
      this.prisma.chat.count({ where }),
      this.prisma.chat.findMany({
        where,
        include: QUEUE_SUMMARY,
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);
    return { total, limit, offset, chats };
  }

  /** The longest a message may be, for whoever needs to say so on a screen. */
  get messageMaxLength(): number {
    return MESSAGE_MAX_LENGTH;
  }
}
