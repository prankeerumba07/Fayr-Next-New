// THE POP-UP IN FRONT OF SOMEBODY BEFORE THEY LEAVE FOR THE SHOP.
//
// ── WHY THE WORDS ARE HERE AND NOT ON THE SCREEN THAT DRAWS THEM ────────────
//
// Because a sentence on a screen is a sentence nothing checks. Fayr's own plain
// language rule lives in assistant/plain-language.ts, it reads words off disk,
// and for most of this project's life it had only ever been pointed at the
// assistant's answers. Three sentences about somebody's own refund carried a long
// dash for weeks because they sat in the middle of a service instead of in a
// words file. That is written down in refusal-words.ts and this file follows it.
//
// So every sentence a person reads on that pop-up is below, and
// shop-visit-words.spec.ts puts each one through the real rule.
//
// ── AND THE TIME IS WORKED OUT, NOT LEFT AS WORDS ───────────────────────────
//
// The owner was explicit: the clock time is shown for real. "Your place is held
// until 4:45 pm today" is a promise with a number in it, and a promise whose
// number is a placeholder is worse than no promise. So the sentence is a function
// of the hold, and the hold comes from the task's own recorded tap.
//
// IT IS WORKED OUT IN INDIA'S TIME, always, and not in the phone's. Fayr is an
// Indian product, the shops are Indian, and a person reading "4:45 pm" means
// their own afternoon. A server in another zone must not change what the sentence
// says, so the offset is applied here rather than left to whatever Date happens
// to do where this runs.

// AND THE OFFSET ITSELF LIVES IN ONE PLACE — Phase 8B-c, 20 September 2026. It
// was written here first and then wanted a second time, by the reader that turns
// "25 Aug 2026, 9:02 PM" off a shop's own page into an instant. Two copies of the
// number that decides what hour somebody is told about their money is one copy
// too many, so it moved to common/india-clock.ts and this reads it from there.
import { INDIA_OFFSET_MS } from '../../common/india-clock';

const A_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The clock face in India, as somebody would say it out loud.
 *
 * Twelve hour with am or pm, because that is how the time is spoken and written
 * in India. Midnight reads as 12 am and noon as 12 pm, which is the one place a
 * naive twelve hour conversion prints 0.
 */
export function clockInIndia(at: number): string {
  const shifted = new Date(at + INDIA_OFFSET_MS);
  const hour24 = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minutes} ${hour24 < 12 ? 'am' : 'pm'}`;
}

/**
 * Today or tomorrow, in India, and it is not decoration.
 *
 * A two hour hold started at eleven at night ends the NEXT day, and printing
 * "held until 1:00 am today" at half past eleven is simply false. Compared by
 * India's own calendar day rather than by the raw span, because the day boundary
 * is what the word refers to.
 */
export function dayInIndia(at: number, from: number): 'today' | 'tomorrow' | null {
  const dayOf = (t: number): number => Math.floor((t + INDIA_OFFSET_MS) / A_DAY_MS);
  const gap = dayOf(at) - dayOf(from);
  if (gap === 0) return 'today';
  if (gap === 1) return 'tomorrow';
  return null;
}

/** The heading. The number of hours is the promise, so it is said first. */
export const HOW_LONG_YOU_HAVE = 'You have 2 hours';

/** What to do, in one sentence, naming the shop they are going to. */
export function whatToDo(shopName: string): string {
  return `Buy the product at ${shopName}, then come back here and tell us.`;
}

/**
 * THE PROMISE, WITH THE REAL TIME IN IT.
 *
 * `from` is the moment the sentence is being written, and it decides only whether
 * the word is today or tomorrow. When the hold ends further away than tomorrow
 * the day word is dropped rather than guessed at, which cannot happen with a two
 * hour hold but would if the hold were ever lengthened.
 */
export function yourPlaceIsHeldUntil(endsAt: number, from: number): string {
  const day = dayInIndia(endsAt, from);
  const when = clockInIndia(endsAt);
  return day == null
    ? `Your place is held until ${when}.`
    : `Your place is held until ${when} ${day}.`;
}

/** What happens if they do not come back. Two sentences, because it is two facts. */
export const IF_YOU_DO_NOT_COME_BACK =
  'If you do not come back by then, this offer goes to somebody else.';

/**
 * AND THE SECOND FACT, WHICH IS THE ONE THAT COSTS THEM MONEY.
 *
 * It is separate on purpose. "The offer goes to somebody else" sounds like losing
 * a queue place; "we cannot pay you even if you bought it" is the actual
 * consequence, and somebody about to spend their own money is owed it plainly.
 */
export const WE_CANNOT_PAY_YOU_AFTER_THAT =
  'We cannot pay you after that, even if you bought the product.';

/** The one button. Tapping it is the leaving and the agreeing, both. */
export function theOneButton(shopName: string): string {
  return `OK, take me to ${shopName}`;
}

/** Everything the pop-up says, in the order it says it. */
export interface TheNotice {
  heading: string;
  whatToDo: string;
  heldUntil: string;
  ifYouDoNot: string;
  weCannotPay: string;
  button: string;
  /** The whole thing as one block, which is what gets frozen onto the task. */
  wholeThing: string;
}

/**
 * THE POP-UP, BUILT FROM ONE HOLD.
 *
 * Returns the pieces AND the whole thing joined, because two callers need
 * different halves and neither should join it for itself: the screen draws the
 * pieces, and the recorded tap freezes `wholeThing` so what they agreed to is
 * kept word for word. Two joins would be two versions of one promise.
 */
export function theNotice(input: {
  shopName: string;
  endsAt: number;
  from: number;
}): TheNotice {
  const pieces = {
    heading: HOW_LONG_YOU_HAVE,
    whatToDo: whatToDo(input.shopName),
    heldUntil: yourPlaceIsHeldUntil(input.endsAt, input.from),
    ifYouDoNot: IF_YOU_DO_NOT_COME_BACK,
    weCannotPay: WE_CANNOT_PAY_YOU_AFTER_THAT,
    button: theOneButton(input.shopName),
  };
  return {
    ...pieces,
    wholeThing: [
      pieces.heading,
      pieces.whatToDo,
      pieces.heldUntil,
      `${pieces.ifYouDoNot} ${pieces.weCannotPay}`,
    ].join('\n\n'),
  };
}

/**
 * Every sentence in this file, for the walk that checks them.
 *
 * Built by calling the real functions rather than typed out again, so a sentence
 * cannot be changed above and left unchecked here. The shop name and the times
 * are examples; the rule cares about the shape of the sentence, not the values.
 */
export function everySentence(shopName = 'Amazon'): readonly string[] {
  const at = Date.UTC(2026, 8, 8, 11, 15);
  const notice = theNotice({ shopName, endsAt: at, from: at });
  return [
    notice.heading,
    notice.whatToDo,
    notice.heldUntil,
    notice.ifYouDoNot,
    notice.weCannotPay,
    notice.button,
  ];
}
