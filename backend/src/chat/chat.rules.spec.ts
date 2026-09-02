import {
  CHAT_STATES,
  MESSAGE_MAX_LENGTH,
  authorLabel,
  checkMessage,
  isOpen,
  mayReply,
  mayTake,
  plainStateName,
  startsANewConversation,
  type ChatFacts,
  type StaffFacts,
} from './chat.rules';

const ASHA: StaffFacts = { id: 'staff-asha', role: 'SUPPORT' };
const RAVI: StaffFacts = { id: 'staff-ravi', role: 'SUPPORT' };
const BOSS: StaffFacts = { id: 'staff-boss', role: 'ADMIN' };

const chat = (over: Partial<ChatFacts> = {}): ChatFacts => ({
  state: 'WAITING_FOR_PERSON',
  takenByStaffId: null,
  ...over,
});

describe('what a conversation state is called', () => {
  it('says it in words a person would say out loud', () => {
    expect(plainStateName('ASSISTANT')).toBe('The assistant is handling this');
    expect(plainStateName('WAITING_FOR_PERSON')).toBe('Waiting for a person');
    expect(plainStateName('CLOSED')).toBe('Closed');
  });

  it('puts the name in the state, because "taken" alone answers nothing', () => {
    expect(plainStateName('TAKEN', 'Asha')).toBe('Taken by Asha');
  });

  it('still says something when the name has gone', () => {
    // A member of staff can leave. Their conversations must still read.
    expect(plainStateName('TAKEN', null)).toBe('Taken');
    expect(plainStateName('TAKEN')).toBe('Taken');
  });

  it('has a name for every state there is', () => {
    for (const state of CHAT_STATES) {
      expect(plainStateName(state, 'Asha')).toMatch(/[a-z]/);
    }
  });

  it('knows which states still need somebody', () => {
    expect(isOpen('ASSISTANT')).toBe(true);
    expect(isOpen('WAITING_FOR_PERSON')).toBe(true);
    expect(isOpen('TAKEN')).toBe(true);
    expect(isOpen('CLOSED')).toBe(false);
  });
});

describe('who may reply', () => {
  it('lets the person who took it reply', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    expect(mayReply(c, ASHA)).toEqual({ allowed: true, reason: null });
  });

  it('REFUSES anybody else, which is the whole point', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    const said = mayReply(c, RAVI);
    expect(said.allowed).toBe(false);
    expect(said.reason).toMatch(/somebody else/i);
  });

  it('refuses a reply to a conversation nobody has taken', () => {
    // Replying without taking must not quietly claim the work: the next person
    // to open the queue would see it as free and answer it as well.
    const said = mayReply(chat(), ASHA);
    expect(said.allowed).toBe(false);
    expect(said.reason).toMatch(/take this conversation first/i);
  });

  it('lets an administrator in, because somebody has to finish it', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    expect(mayReply(c, BOSS).allowed).toBe(true);
  });

  it('refuses everybody once it is closed, an administrator included', () => {
    const c = chat({ state: 'CLOSED', takenByStaffId: ASHA.id });
    expect(mayReply(c, ASHA).allowed).toBe(false);
    expect(mayReply(c, BOSS).allowed).toBe(false);
    expect(mayReply(c, BOSS).reason).toMatch(/closed/i);
  });

  it('gives a reason whenever it says no', () => {
    for (const [c, who] of [
      [chat(), ASHA],
      [chat({ state: 'TAKEN', takenByStaffId: ASHA.id }), RAVI],
      [chat({ state: 'CLOSED' }), BOSS],
    ] as [ChatFacts, StaffFacts][]) {
      const said = mayReply(c, who);
      expect(said.allowed).toBe(false);
      expect(typeof said.reason).toBe('string');
      expect((said.reason as string).length).toBeGreaterThan(10);
    }
  });
});

describe('who may take one', () => {
  it('lets anybody take one nobody has', () => {
    expect(mayTake(chat(), ASHA).allowed).toBe(true);
  });

  it('refuses taking one somebody else has', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    expect(mayTake(c, RAVI).allowed).toBe(false);
  });

  it('lets an administrator move one, for when a person has gone', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    expect(mayTake(c, BOSS).allowed).toBe(true);
  });

  it('says so plainly when you already have it', () => {
    const c = chat({ state: 'TAKEN', takenByStaffId: ASHA.id });
    expect(mayTake(c, ASHA).reason).toMatch(/already have/i);
  });

  it('refuses taking a closed one', () => {
    expect(mayTake(chat({ state: 'CLOSED' }), ASHA).allowed).toBe(false);
  });
});

describe('checking a message before it is stored', () => {
  it('takes ordinary words', () => {
    expect(checkMessage('where is my refund')).toEqual({
      ok: true,
      reason: null,
      body: 'where is my refund',
    });
  });

  it('trims, because trailing spaces are not a message', () => {
    expect(checkMessage('  hello  ').body).toBe('hello');
  });

  it('refuses an empty one', () => {
    expect(checkMessage('').ok).toBe(false);
    expect(checkMessage('    ').ok).toBe(false);
    expect(checkMessage('\n\t ').ok).toBe(false);
  });

  it('refuses something that is not text at all', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(checkMessage(bad).ok).toBe(false);
    }
  });

  it('refuses one that is too long, and says how long is too long', () => {
    const said = checkMessage('a'.repeat(MESSAGE_MAX_LENGTH + 1));
    expect(said.ok).toBe(false);
    expect(said.reason).toContain(String(MESSAGE_MAX_LENGTH));
  });

  it('takes one that is exactly as long as allowed', () => {
    expect(checkMessage('a'.repeat(MESSAGE_MAX_LENGTH)).ok).toBe(true);
  });
});

describe('what a message is labelled', () => {
  it('names the agent who wrote it', () => {
    expect(authorLabel('AGENT', 'Asha')).toBe('Asha');
  });

  it('still says Fayr when the agent has gone', () => {
    expect(authorLabel('AGENT', null)).toBe('Fayr');
  });

  it('never labels the assistant as a person', () => {
    // Somebody reading their own conversation back has to be able to tell which
    // of those replies came from a person.
    expect(authorLabel('ASSISTANT')).toBe('Fayr assistant');
    expect(authorLabel('ASSISTANT')).not.toBe(authorLabel('AGENT', 'Asha'));
  });

  it('labels the shopper', () => {
    expect(authorLabel('PERSON')).toBe('Them');
  });
});

describe('opening the chat screen: a person never sees an older conversation', () => {
  // THE OWNER'S RULE, 2 September 2026: "whenever a user comes to chat, like when
  // they click on 'Chat with us,' they should not be able to see their previous
  // conversations. Our agents can see them in the admin, but the user cannot see
  // anything."
  it('somebody with no conversation at all gets a new one', () => {
    expect(startsANewConversation(null)).toBe(true);
  });

  it('a conversation the assistant was handling is finished business', () => {
    expect(
      startsANewConversation({ state: 'ASSISTANT', takenByStaffId: null }),
    ).toBe(true);
  });

  it('a finished conversation is never reopened', () => {
    expect(
      startsANewConversation({ state: 'CLOSED', takenByStaffId: null }),
    ).toBe(true);
  });

  it('a conversation a person at Fayr has taken is the one they come back to', () => {
    // NOT AN EXCEPTION TO THE RULE, because this is not history. Somebody at Fayr
    // is about to write a reply INTO this conversation. Starting a new one would
    // send that reply somewhere the shopper is not looking, and the shopper would
    // sit waiting for an answer that had already been written.
    expect(
      startsANewConversation({ state: 'TAKEN', takenByStaffId: 'staff-1' }),
    ).toBe(false);
  });

  it('and so is one sitting in the queue waiting for a person', () => {
    expect(
      startsANewConversation({
        state: 'WAITING_FOR_PERSON',
        takenByStaffId: null,
      }),
    ).toBe(false);
  });

  it('every state is decided, so a new state cannot fall through silently', () => {
    for (const state of CHAT_STATES) {
      const answer = startsANewConversation({ state, takenByStaffId: null });
      expect(typeof answer).toBe('boolean');
    }
  });
});
