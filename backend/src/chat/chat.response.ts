import { authorLabel, plainStateName, type ChatAuthorName, type ChatStateName } from './chat.rules';
import type { ChatInQueue, ChatWithMessages } from './chat.store';

/** One message, as either side sees it. */
export interface ChatMessageResponse {
  id: string;
  author: ChatAuthorName;
  /** What to put above the words. Already resolved to a name where there is one. */
  from: string;
  body: string;
  language: string;
  sentAt: string;
  /** True when a person at Fayr wrote it, so the app can say so. */
  fromAPerson: boolean;
  /**
   * The question this message belongs to, when there is one. The app needs it to
   * ask "did that help" against the right thing — and that answer is what the
   * answer book learns from, so it cannot be dropped just because there is a
   * conversation around it now.
   */
  questionId: string | null;
  /** Whether they already said it helped. Null until they say. */
  helpful: boolean | null;
}

/** A whole conversation. */
export interface ChatResponse {
  chatId: string;
  state: ChatStateName;
  /** The state in words, with the name of whoever has it. */
  stateInWords: string;
  /** Who has it, when somebody does. */
  takenBy: { id: string; name: string } | null;
  startedAt: string;
  lastMessageAt: string;
  messages: ChatMessageResponse[];
  /** True while nobody at Fayr has to do anything. */
  withTheAssistant: boolean;
  /** True once it has been handed over and nobody has taken it. */
  waitingForAPerson: boolean;
  closed: boolean;
}

/** One row of the staff queue. */
export interface ChatQueueRow {
  chatId: string;
  state: ChatStateName;
  stateInWords: string;
  takenBy: { id: string; name: string } | null;
  user: { id: string; displayId: string };
  startedAt: string;
  lastMessageAt: string;
  handedOverAt: string | null;
  messageCount: number;
  /** The newest message, so the queue reads like conversations and not names. */
  latest: { body: string; author: ChatAuthorName; sentAt: string } | null;
}

export function toMessage(
  m: {
    id: string;
    author: ChatAuthorName;
    body: string;
    language: string;
    sentAt: Date;
    assistantQuestionId: string | null;
    staffUser: { id: string; name: string } | null;
  },
  helpfulByQuestion?: Map<string, boolean | null>,
): ChatMessageResponse {
  return {
    id: m.id,
    author: m.author,
    from: authorLabel(m.author, m.staffUser?.name ?? null),
    body: m.body,
    language: m.language,
    sentAt: m.sentAt.toISOString(),
    fromAPerson: m.author === 'AGENT',
    questionId: m.assistantQuestionId,
    helpful:
      m.assistantQuestionId && helpfulByQuestion
        ? helpfulByQuestion.get(m.assistantQuestionId) ?? null
        : null,
  };
}

export function toChat(
  chat: ChatWithMessages,
  helpfulByQuestion?: Map<string, boolean | null>,
): ChatResponse {
  return {
    chatId: chat.id,
    state: chat.state,
    stateInWords: plainStateName(chat.state, chat.takenBy?.name ?? null),
    takenBy: chat.takenBy ? { id: chat.takenBy.id, name: chat.takenBy.name } : null,
    startedAt: chat.startedAt.toISOString(),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    messages: chat.messages.map((m) => toMessage(m, helpfulByQuestion)),
    withTheAssistant: chat.state === 'ASSISTANT',
    waitingForAPerson: chat.state === 'WAITING_FOR_PERSON',
    closed: chat.state === 'CLOSED',
  };
}

/**
 * A queue row. NOTE what is missing: the shopper's phone number.
 *
 * The queue is on screen all day, so it carries the account name a member of
 * staff can search on and nothing more. Their number is on the one screen that
 * opens one conversation, which is the act that gets recorded.
 */
export function toQueueRow(chat: ChatInQueue): ChatQueueRow {
  const latest = chat.messages[0];
  return {
    chatId: chat.id,
    state: chat.state,
    stateInWords: plainStateName(chat.state, chat.takenBy?.name ?? null),
    takenBy: chat.takenBy ? { id: chat.takenBy.id, name: chat.takenBy.name } : null,
    user: { id: chat.user.id, displayId: chat.user.displayId },
    startedAt: chat.startedAt.toISOString(),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    handedOverAt: chat.handedOverAt ? chat.handedOverAt.toISOString() : null,
    messageCount: chat._count.messages,
    latest: latest
      ? { body: latest.body, author: latest.author, sentAt: latest.sentAt.toISOString() }
      : null,
  };
}
