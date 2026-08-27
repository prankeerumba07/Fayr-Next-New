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
 * One exchange: what was asked, and what came back.
 *
 * Defensive about the reply's shape on purpose. A question a person typed must
 * never disappear because the answer arrived in a shape nobody expected.
 */
export function turnFromAsk(question, reply) {
  const r = reply && typeof reply === 'object' ? reply : {};
  const answered = r.answered === true;
  return {
    questionId: text(r.questionId) || 'unsent',
    question: text(question).trim() || '(no question)',
    answer: text(r.answer) || null,
    language: text(r.language) || 'en',
    languageName: text(r.languageName) || null,
    answered,
    waitingForAPerson: !answered,
    helpful: typeof r.helpful === 'boolean' ? r.helpful : null,
  };
}

/** An earlier exchange as the backend stores it, turned into one of ours. */
export function turnFromStored(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    questionId: text(r.questionId) || 'unsent',
    question: text(r.question).trim() || '(no question)',
    answer: text(r.answer) || null,
    language: 'en',
    languageName: null,
    answered: r.answered === true,
    waitingForAPerson: r.answered !== true,
    helpful: typeof r.helpful === 'boolean' ? r.helpful : null,
  };
}

function messagesFor(turns) {
  const out = [];
  for (const [i, raw] of turns.entries()) {
    const turn = raw && typeof raw === 'object' ? raw : {};
    const id = text(turn.questionId) || `turn-${i}`;
    out.push({
      id: `${id}:you`,
      who: 'you',
      text: text(turn.question) || '(no question)',
      tone: 'question',
      label: null,
    });
    // A turn with no reply yet is a question in flight. It still shows, so the
    // person can see their own words went somewhere.
    if (text(turn.answer) !== '') {
      out.push({
        id: `${id}:fayr`,
        who: 'fayr',
        text: text(turn.answer),
        tone: turn.answered === true ? 'answer' : 'waiting',
        label: turn.answered === true ? null : WAITING_LABEL,
      });
    }
  }
  return out;
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
  const turns = Array.isArray(s.turns) ? s.turns : [];
  const draft = text(s.draft);
  const busy = s.busy === true;
  const loading = s.loading === true;

  const messages = messagesFor(turns);

  // Asked after EVERY reply, answered or not. Somebody who only wanted to reach a
  // person can still say that helped, and a no puts it back in the queue either
  // way. Only ever about the newest reply, and only until they say.
  const newest = turns.length > 0 ? turns[turns.length - 1] : null;
  const askAbout =
    newest &&
    typeof newest === 'object' &&
    text(newest.answer) !== '' &&
    newest.helpful !== true &&
    newest.helpful !== false
      ? newest
      : null;

  const check = validateQuestion(draft);
  return {
    title: SCREEN_TITLE,
    intro: INTRO,
    loading,
    empty: messages.length === 0 && !loading,
    messages,
    feedback: askAbout
      ? {
          questionId: text(askAbout.questionId) || 'unsent',
          prompt: FEEDBACK_PROMPT,
          yes: FEEDBACK_YES,
          no: FEEDBACK_NO,
        }
      : null,
    input: {
      value: draft,
      placeholder: PLACEHOLDER,
      canSend: check.ok && !busy && !loading,
      // Only shown once there is something wrong with what was typed, so an empty
      // box is not nagged at.
      hint: draft !== '' && !check.ok ? check.reason : null,
      busy,
    },
    error: text(s.error) || null,
  };
}
