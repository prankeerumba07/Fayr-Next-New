// "Chat with us" — every decision the screen makes, in one pure file.
//
// Same reason as the other ui/ helpers: a React Native screen cannot be imported
// under node, so the deciding lives here where it can be checked, and the screen
// is a thin mapper over it.
//
// What this screen is for, and what it is not. It is the fastest way to get an
// answer to a question Fayr already knows how to answer. It is NOT a replacement
// for Help: when the assistant does not know, the question goes to a person, and
// the screen says so plainly instead of pretending.

/** The screen's name. In one place, so the title and the route cannot drift. */
export const SCREEN_TITLE = 'Chat with us';

/**
 * The longest question the app will send. Mirrors the backend exactly: letting
 * somebody type more than the backend accepts turns a careful question into a
 * rejection they cannot do anything about.
 */
export const QUESTION_MAX = 2000;

/** One simple question after every reply, and two plain answers to it. */
export const FEEDBACK_PROMPT = 'Did that help?';
export const FEEDBACK_YES = 'Yes, that helped';
export const FEEDBACK_NO = 'No, I still need help';

/** What the empty screen says, so a first-time user knows what to type. */
export const INTRO =
  'Ask us anything about your offers, your review, your tickets or your money. '
  + 'If we cannot answer it, a person from Fayr will.';

const PLACEHOLDER = 'Type your question';

/** Short label on a reply that is waiting for a person. */
const WAITING_LABEL = 'Waiting for a person';

function text(value) {
  return typeof value === 'string' ? value : '';
}

/** Can this be sent? Mirrors the backend limits so a refusal is never the first news. */
export function validateQuestion(question) {
  const q = text(question).trim();
  if (q === '') {
    return { ok: false, reason: 'Type your question first.', question: '' };
  }
  if (q.length > QUESTION_MAX) {
    return {
      ok: false,
      reason: `That is longer than ${QUESTION_MAX} letters. Please shorten it.`,
      question: q,
    };
  }
  return { ok: true, reason: null, question: q };
}

/**
 * WHAT ONE MESSAGE LOOKS LIKE ON SCREEN.
 *
 * Four kinds, and the difference between them matters to the person reading:
 * their own words, an answer from the answer book, a note saying a person is
 * coming, and a reply written by an actual person at Fayr with their name on it.
 *
 * The last one is the whole reason this screen changed. Somebody who has been
 * told "a person will get back to you" has to be able to tell, at a glance, that
 * the next thing they are reading IS that person.
 */
function messageFrom(m, index) {
  const id = text(m && m.id) || `message-${index}`;
  const body = text(m && m.body);
  const author = text(m && m.author);
  // WHEN IT WAS SENT, IN WORDS, EXACTLY AS OUR SIDE SENT IT. Never worked out
  // here: the phone's own clock could be a day out, and a sentence written in the
  // app is a sentence the plain language check never reads. Null when our side
  // sent nothing, and then the line simply carries no time rather than a guess.
  const when = text(m && m.sentAtInWords).trim() || null;

  if (author === 'PERSON') {
    return { id, who: 'you', text: body, tone: 'question', label: null, when,
             questionId: text(m && m.questionId) || null,
             helpful: m && typeof m.helpful === 'boolean' ? m.helpful : null };
  }
  if (author === 'AGENT') {
    return { id, who: 'fayr', text: body, tone: 'person', when,
             // The name goes on the message, not in a heading somewhere else.
             label: text(m && m.from) || 'Fayr',
             questionId: text(m && m.questionId) || null,
             helpful: m && typeof m.helpful === 'boolean' ? m.helpful : null };
  }
  if (author === 'SYSTEM') {
    return { id, who: 'fayr', text: body, tone: 'note', label: null, when,
             questionId: null, helpful: null };
  }
  // The assistant. Whether it knew the answer decides how it reads.
  const answered = !(m && m.waitingForAPerson === true);
  return {
    id, who: 'fayr', text: body, when,
    tone: answered ? 'answer' : 'waiting',
    label: answered ? null : WAITING_LABEL,
    questionId: text(m && m.questionId) || null,
    helpful: m && typeof m.helpful === 'boolean' ? m.helpful : null,
  };
}

/**
 * Every message in a conversation, in the order it was said.
 *
 * Defensive about the shape on purpose. A conversation somebody is in the middle
 * of must never disappear because one field came back in a shape we did not
 * expect — a blank screen is the worst possible answer to "where did my chat go".
 */
export function messagesFrom(chat) {
  const c = chat && typeof chat === 'object' ? chat : {};
  const raw = Array.isArray(c.messages) ? c.messages : [];
  const waiting = c.waitingForAPerson === true;

  // The assistant's LAST message is the one that triggered a hand over, so it is
  // the only one that reads as "waiting". Earlier ones were answers at the time.
  let lastAssistantAt = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] && raw[i].author === 'ASSISTANT') lastAssistantAt = i;
  }

  return raw.map((m, i) =>
    messageFrom(
      { ...m, waitingForAPerson: waiting && i === lastAssistantAt },
      i,
    ),
  );
}

/**
 * What to tell the person about who has their conversation.
 *
 * Only when it is worth saying. While the assistant is handling it there is
 * nothing to report, and a banner saying so would be noise on every screen.
 */
export function statusLine(chat) {
  const c = chat && typeof chat === 'object' ? chat : {};
  if (c.closed === true) return 'This conversation is closed.';
  if (c.waitingForAPerson === true) {
    return 'A person from Fayr will reply here.';
  }
  if (c.takenBy && text(c.takenBy.name) !== '') {
    return `${text(c.takenBy.name)} from Fayr is helping you.`;
  }
  return null;
}

/**
 * The whole screen, as data.
 *
 * Every state the screen can be in comes out of here, which is what makes the
 * render smoke test possible: it runs this over every realistic state and checks
 * that nothing missing reaches what would be drawn.
 */
export function chatView(state) {
  const s = state && typeof state === 'object' ? state : {};
  const chat = s.chat && typeof s.chat === 'object' ? s.chat : null;
  const draft = text(s.draft);
  const busy = s.busy === true;
  const loading = s.loading === true;

  const messages = messagesFrom(chat);
  const closed = chat ? chat.closed === true : false;

  // Asked after the newest reply, whoever wrote it, and only until they say. A
  // reply from a person is worth asking about just as much as one from the answer
  // book: "did that help" is what tells us whether the answer was any good.
  let askAbout = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.who !== 'fayr') continue;
    if (m.text !== '' && m.questionId && m.helpful !== true && m.helpful !== false) {
      askAbout = m;
    }
    break;
  }

  // QUESTIONS SOMEBODY CAN TAP INSTEAD OF TYPING.
  //
  // THE SERVER DECIDES WHETHER THERE ARE ANY, and this screen only draws what it
  // is handed. It sends them after the greeting and at no other moment, and only
  // questions the answer bank can really answer. Nothing is invented here and no
  // list is written here: a second list on the phone could offer a question the
  // answer bank has never heard of.
  //
  // TAPPING ONE SENDS THOSE WORDS AS AN ORDINARY MESSAGE. There is no special
  // path: a tapped question and a typed one are answered by the same thing.
  const suggestions = Array.isArray(chat && chat.suggestions)
    ? chat.suggestions.filter((one) => typeof one === 'string' && one.trim() !== '')
    : [];

  const check = validateQuestion(draft);
  return {
    title: SCREEN_TITLE,
    intro: INTRO,
    loading,
    empty: messages.length === 0 && !loading,
    messages,
    // Never while something is going out, and never on a finished conversation.
    suggestions: busy || closed ? [] : suggestions,
    status: statusLine(chat),
    feedback: askAbout
      ? {
          questionId: askAbout.questionId,
          prompt: FEEDBACK_PROMPT,
          yes: FEEDBACK_YES,
          no: FEEDBACK_NO,
        }
      : null,
    input: {
      value: draft,
      placeholder: PLACEHOLDER,
      // A closed conversation takes nothing more. Saying so beats a box that
      // silently throws away what somebody types into it.
      canSend: check.ok && !busy && !loading && !closed,
      hint: closed
        ? 'This conversation is closed.'
        : draft !== '' && !check.ok
          ? check.reason
          : null,
      busy,
    },
    error: text(s.error) || null,
  };
}
