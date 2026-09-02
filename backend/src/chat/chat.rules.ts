/**
 * WHO MAY DO WHAT TO A CONVERSATION, AS PURE CODE.
 *
 * Every rule here is a decision, not a database read, so it can be tested on its
 * own and read by anybody. Nothing in this file touches the database, the network
 * or the clock unless the clock is handed to it.
 */

export const CHAT_STATES = [
  'ASSISTANT',
  'WAITING_FOR_PERSON',
  'TAKEN',
  'CLOSED',
] as const;

export type ChatStateName = (typeof CHAT_STATES)[number];

export const CHAT_AUTHORS = ['PERSON', 'ASSISTANT', 'AGENT', 'SYSTEM'] as const;
export type ChatAuthorName = (typeof CHAT_AUTHORS)[number];

/** The longest one message may be. The same limit the question box already has. */
export const MESSAGE_MAX_LENGTH = 2000;

/**
 * Just enough of a conversation to decide something about it. Deliberately not
 * the database row: these rules must be readable without knowing the schema.
 */
export interface ChatFacts {
  state: ChatStateName;
  takenByStaffId: string | null;
}

/** Just enough of a member of staff to decide what they may do. */
export interface StaffFacts {
  id: string;
  role: string;
}

/**
 * What to put on the screen for a state, in words a person would say out loud.
 *
 * The name of whoever has it is part of the state, not a separate line: "Taken"
 * on its own is the answer to the wrong question. What anybody looking at a queue
 * wants to know is whether it is theirs.
 */
export function plainStateName(
  state: ChatStateName,
  agentName?: string | null,
): string {
  switch (state) {
    case 'ASSISTANT':
      return 'The assistant is handling this';
    case 'WAITING_FOR_PERSON':
      return 'Waiting for a person';
    case 'TAKEN':
      return agentName ? `Taken by ${agentName}` : 'Taken';
    case 'CLOSED':
      return 'Closed';
  }
}

/** Whether this conversation is anybody's to act on right now. */
export function isOpen(state: ChatStateName): boolean {
  return state !== 'CLOSED';
}

/**
 * SHOULD OPENING THE CHAT SCREEN START A NEW CONVERSATION?
 *
 * THE OWNER'S RULE, 2 September 2026: "whenever a user comes to chat, like when
 * they click on 'Chat with us,' they should not be able to see their previous
 * conversations. Our agents can see them in the admin, but the user cannot see
 * anything." So the answer is yes, a new one, almost always.
 *
 * ONE EXCEPTION, AND IT IS NOT HISTORY. If a person at Fayr has the conversation,
 * or it is sitting in the queue waiting for one, that person is about to write a
 * reply INTO IT. Starting a new conversation would send their reply to a place
 * the shopper is not looking, and the shopper would sit waiting for an answer
 * that had already been written. That is not somebody being shown their old
 * chats. It is somebody being shown the one they are still in.
 *
 * SO THE LINE IS: a conversation the ASSISTANT was handling is finished business
 * the moment they leave the screen, and they get a fresh one. A conversation a
 * PERSON is handling is live, and they come back to it.
 *
 * NOTHING IS EVER DELETED either way. This decides what the phone is shown, and
 * never what is kept. Every conversation and every message stays exactly as it
 * is, and staff see all of them.
 */
export function startsANewConversation(chat: ChatFacts | null): boolean {
  if (!chat) return true;
  if (chat.state === 'CLOSED') return true;
  // A person has it, or is queued to take it. They come back to that one.
  if (chat.state === 'TAKEN' || chat.state === 'WAITING_FOR_PERSON') return false;
  return true;
}

/** The answer to "may I reply to this", and why not when the answer is no. */
export interface MayReply {
  allowed: boolean;
  /** Plain words, shown to the member of staff who tried. */
  reason: string | null;
}

/**
 * ONLY THE PERSON WHO TOOK IT, OR AN ADMINISTRATOR.
 *
 * The reason this is a rule and not a convention: two people typing different
 * answers into the same conversation is worse than nobody answering at all, and
 * the shopper cannot tell which one is Fayr's answer. Taking it is the act that
 * says "this one is mine", so replying without taking it is refused rather than
 * being treated as taking it — an accidental reply must not silently claim work.
 *
 * An administrator passes through, the same super-role every other staff rule
 * uses, because somebody has to be able to finish a conversation when the person
 * who took it has gone home.
 */
export function mayReply(chat: ChatFacts, staff: StaffFacts): MayReply {
  if (chat.state === 'CLOSED') {
    return {
      allowed: false,
      reason: 'This conversation is closed. Nobody can add to it.',
    };
  }
  if (staff.role === 'ADMIN') return { allowed: true, reason: null };
  if (chat.takenByStaffId === null) {
    return {
      allowed: false,
      reason: 'Take this conversation first, so your name is on it.',
    };
  }
  if (chat.takenByStaffId !== staff.id) {
    return {
      allowed: false,
      reason:
        'Somebody else has taken this conversation. Only they, or an '
        + 'administrator, can reply to it.',
    };
  }
  return { allowed: true, reason: null };
}

/** Whether this conversation can be taken, and why not when it cannot. */
export function mayTake(chat: ChatFacts, staff: StaffFacts): MayReply {
  if (chat.state === 'CLOSED') {
    return {
      allowed: false,
      reason: 'This conversation is closed. There is nothing to take.',
    };
  }
  if (chat.takenByStaffId === staff.id) {
    return { allowed: false, reason: 'You already have this one.' };
  }
  if (chat.takenByStaffId !== null && staff.role !== 'ADMIN') {
    return {
      allowed: false,
      reason:
        'Somebody else has taken this conversation. An administrator can move '
        + 'it if they have gone.',
    };
  }
  return { allowed: true, reason: null };
}

/** What a message is worth checking for before it is written down. */
export interface MessageCheck {
  ok: boolean;
  reason: string | null;
  body: string;
}

/**
 * The one place a message is checked before it is stored.
 *
 * Trimmed, because trailing spaces are not a message. Refused when empty or too
 * long, in words the person who typed it can act on.
 */
export function checkMessage(raw: unknown): MessageCheck {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'A message has to be text.', body: '' };
  }
  const body = raw.trim();
  if (body === '') {
    return { ok: false, reason: 'There is nothing in that message.', body: '' };
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      reason: `That is longer than ${MESSAGE_MAX_LENGTH} letters. Please shorten it.`,
      body,
    };
  }
  return { ok: true, reason: null, body };
}

/** How a message should be labelled on screen, whoever is reading it. */
export function authorLabel(
  author: ChatAuthorName,
  staffName?: string | null,
): string {
  switch (author) {
    case 'PERSON':
      return 'Them';
    case 'ASSISTANT':
      return 'Fayr assistant';
    case 'AGENT':
      return staffName ? staffName : 'Fayr';
    case 'SYSTEM':
      return 'Fayr';
  }
}
