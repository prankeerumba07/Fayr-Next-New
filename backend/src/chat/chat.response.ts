import { GREETING_MARKER } from './chat-words';
import { whenItWasSent } from './when-words';
import { OPENING_QUESTIONS } from './opening-questions';
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
  /**
   * WHEN IT WAS SENT, IN PLAIN WORDS, IN INDIA'S TIME.
   *
   * "Today at 3:20 in the afternoon". Worked out on our side, out of the moment
   * stored against the message, and sent down ready to read. The app never turns
   * a stored moment into words itself: the phone's clock could be wrong, and a
   * sentence written in the app is a sentence the plain language check never
   * reads.
   */
  sentAtInWords: string;
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
  /**
   * WHOSE CONVERSATION IT IS, by the name staff can search on.
   *
   * Staff need it to open that person's whole history. A shopper reading their
   * own conversation gets their own name back, which is theirs to see, and never
   * a phone number.
   */
  user: { id: string; displayId: string };
  startedAt: string;
  lastMessageAt: string;
  messages: ChatMessageResponse[];
  /** True while nobody at Fayr has to do anything. */
  withTheAssistant: boolean;
  /** True once it has been handed over and nobody has taken it. */
  waitingForAPerson: boolean;
  closed: boolean;
  /**
   * QUESTIONS SOMEBODY CAN TAP INSTEAD OF TYPING.
   *
   * Only ever after the greeting, and only ever questions the answer bank can
   * really answer. Tapping one sends those exact words back as an ordinary
   * message: there is no route that answers a tapped question differently from a
   * typed one, so there is nothing here a phone could use to get a different
   * answer from anybody else.
   *
   * Empty at every other moment, which is what stops the screen becoming a menu.
   */
  suggestions: string[];
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
  now: Date = new Date(),
): ChatMessageResponse {
  return {
    id: m.id,
    author: m.author,
    from: authorLabel(m.author, m.staffUser?.name ?? null),
    body: m.body,
    language: m.language,
    sentAt: m.sentAt.toISOString(),
    // In the language the message itself was written in, which is the language
    // the person reading that line is reading.
    sentAtInWords: whenItWasSent(m.sentAt, now, m.language),
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
  now: Date = new Date(),
): ChatResponse {
  return {
    chatId: chat.id,
    state: chat.state,
    stateInWords: plainStateName(chat.state, chat.takenBy?.name ?? null),
    takenBy: chat.takenBy ? { id: chat.takenBy.id, name: chat.takenBy.name } : null,
    user: { id: chat.user.id, displayId: chat.user.displayId },
    startedAt: chat.startedAt.toISOString(),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    // ONE MOMENT FOR THE WHOLE CONVERSATION. Read once and handed to every line,
    // so a read that straddles midnight cannot say "today" on one message and
    // "yesterday" on the one above it.
    messages: chat.messages.map((m) => toMessage(m, helpfulByQuestion, now)),
    withTheAssistant: chat.state === 'ASSISTANT',
    waitingForAPerson: chat.state === 'WAITING_FOR_PERSON',
    closed: chat.state === 'CLOSED',
    suggestions: questionsToOffer(chat),
  };
}

/**
 * THE QUESTIONS TO PUT UNDER THE GREETING, or none.
 *
 * Only when the newest thing said is the assistant's greeting. Anywhere else
 * they would be a menu appearing in the middle of a conversation, and somebody
 * who has just been given a real answer does not want four buttons under it.
 *
 * KNOWN BY THE GREETING'S OWN LINE, not by a column on the message. The greeting
 * says "Here are the things people ask us most" and nothing else the assistant
 * ever says does. See GREETING_MARKER.
 *
 * AND ONLY WHILE THE ASSISTANT HAS IT. Once a person at Fayr is involved, four
 * buttons offering to search the answer bank would be talking over them.
 */
function questionsToOffer(chat: {
  state: ChatStateName;
  messages: { author: ChatAuthorName; body: string }[];
}): string[] {
  if (chat.state !== 'ASSISTANT') return [];
  const newest = chat.messages[chat.messages.length - 1];
  if (!newest || newest.author !== 'ASSISTANT') return [];
  if (!newest.body.includes(GREETING_MARKER)) return [];
  // The words offered are the words the greeting itself listed, so the two can
  // never disagree about what is on screen.
  return OPENING_QUESTIONS.filter((q) => newest.body.includes(q.ask)).map(
    (q) => q.ask,
  );
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
