/**
 * WHAT THE ASSISTANT OFFERS WHEN SOMEBODY SAYS HELLO.
 *
 * THE OWNER ASKED FOR THIS ON 2 SEPTEMBER 2026: "whenever I say 'hi,' it should
 * reply with basic questions and answers." Before this, saying hello got a
 * greeting and the words "How can I assist you today?", which puts the whole
 * problem back on somebody who came to the chat precisely because they did not
 * know what to ask.
 *
 * FOUR QUESTIONS, AND THEY ARE THE FOUR HE NAMED: where is my refund, how long
 * does it take, my order was not found, how do tickets work.
 *
 * ── EVERY ANSWER COMES FROM THE ANSWER BANK. THERE IS NO SECOND SET ─────────
 *
 * This file holds NO ANSWERS. It holds four questions and the name of the answer
 * the bank already keeps for each. Tapping one sends those exact words back as an
 * ordinary message, and the ordinary path answers it: the same search, the same
 * plain language check, the same record of what was asked. There is no special
 * case anywhere that answers a tapped question differently from a typed one.
 *
 * WHY THE WORDS ARE HERE AND NOT READ OUT OF THE BANK. The bank's own ways of
 * asking are written to be MATCHED, not to be read: "refund not received" and
 * "money not received" are the shapes people type, and neither is a sentence you
 * would offer somebody. So the words offered are chosen to read well, and there
 * is a check that proves the bank really answers each one, by asking it. A
 * question the bank cannot answer is never offered.
 *
 * IT NEVER OFFERS SOMETHING IT CANNOT ANSWER. The names below are looked up in
 * the bank before the greeting is written, and one that is not published is left
 * out. Four questions where one of them dead ends is worse than three.
 */

/** One thing somebody can tap, and the answer the bank keeps for it. */
export interface OpeningQuestion {
  /** The answer in the bank this asks for. */
  key: string;
  /** The words on screen, and the words sent back when it is tapped. */
  ask: string;
}

/**
 * The four, in the order somebody would think of them: my money first, then how
 * long, then the thing that goes wrong most, then the one about tickets.
 */
export const OPENING_QUESTIONS: readonly OpeningQuestion[] = [
  { key: 'refund-not-arrived', ask: 'Where is my refund' },
  { key: 'how-long-does-a-refund-take', ask: 'How long does a refund take' },
  { key: 'order-not-found', ask: 'My order was not found' },
  { key: 'tickets', ask: 'How do tickets work' },
];

/**
 * WHAT THE GREETING SAYS ABOVE THE QUESTIONS.
 *
 * Short on purpose. A greeting, one line about what we can help with, and then
 * get out of the way so the questions are the thing being read.
 *
 * ENGLISH ONLY, AND THAT IS THE OWNER'S INSTRUCTION: "If someone is sharing
 * their messages in Hindi, then it should reply in English, not in Hindi." One
 * set of answers, one language out. See how-to-answer.ts.
 */
export const GREETING_OPENING = 'Thank you for writing to Fayr.';

export const GREETING_WHAT_WE_HELP_WITH =
  'We can help with your money, your offers, your review and your tickets.';

export const GREETING_PICK_ONE = 'Here are the things people ask us most.';

/**
 * The whole greeting, as one piece of writing.
 *
 * `hello` is the time of day line, handed in, so this stays pure and a test can
 * hold the clock still. `offer` are the questions that survived being looked up
 * in the bank.
 */
export function greetingWords(hello: string, offer: readonly OpeningQuestion[]): string {
  const lines = [
    `${hello}. ${GREETING_OPENING}`,
    GREETING_WHAT_WE_HELP_WITH,
  ];
  if (offer.length > 0) {
    lines.push(GREETING_PICK_ONE);
    for (const one of offer) lines.push(`• ${one.ask}`);
    lines.push('Tap one, or just type your own question.');
  } else {
    // Nothing in the bank to offer. Still never says nothing: it asks.
    lines.push('Tell us what you need and we will help.');
  }
  return lines.join('\n');
}
