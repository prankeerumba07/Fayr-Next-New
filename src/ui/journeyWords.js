// EVERY WORD THE JOURNEY'S OWN SCREENS SAY, IN ONE PLACE ON OUR SIDE.
//
// ── WHY THESE ARE HERE AND NOT ON THE SCREENS ───────────────────────────────
//
// Because a sentence written on a screen is a sentence nothing checks. This is
// the same arrangement src/connect/gateWords.js already uses: the words live in a
// file of their own, and backend/src/shops/journey-words.spec.ts reads this file
// OFF DISK and puts every sentence through Fayr's real plain language rule. A
// sentence added below cannot reach a person without that walk reading it first.
//
// ── WHAT IS NOT IN HERE, AND THAT IS THE IMPORTANT PART ─────────────────────
//
// NOT ONE WORD ABOUT A CAMPAIGN'S STATE. The owner's rule, in his words: "There
// should not be any different messages for the same campaign on different
// pages." Those sentences are built ONCE on the server, in
// backend/src/tasks/engine/journey-message.ts, and arrive on the task as
// `message.short` and `message.long`. The screens READ them.
//
// So what lives here is only what the SCREEN itself owns and the server cannot
// know: what went wrong with a request, what a button is called, and the units of
// a clock that ticks on the phone.

/**
 * WE COULD NOT RECORD THE VISIT, SO WE ARE NOT SENDING THEM SHOPPING.
 *
 * ── WHY THIS REFUSES INSTEAD OF CARRYING ON ─────────────────────────────────
 *
 * A visit our own side does not know about is a visit that can never be paid.
 * Opening the shop anyway would send somebody to spend their own money on a
 * promise nothing recorded, and they would come back to an offer that had never
 * heard of them. Making them tap twice is the smaller harm by a long way.
 *
 * It does not say "error" and it does not name a status code. It says what did
 * not happen and what to do.
 */
export const COULD_NOT_START = 'We could not start your two hours just now.';
export const NOTHING_WAS_SPENT = 'You have not lost your place, and nothing was spent.';
export const TRY_AGAIN = 'Try again';

/** The one control on the notice. Its label is the shop's, so it takes a name. */
export function takeMeThere(shopName) {
  return `OK, take me to ${shopName}`;
}

/**
 * THE QUESTION WHEN THEY COME BACK. Step seven, and it has two answers.
 *
 * "Have you bought the product?" and not "did you buy it": the first is about
 * the state of the world now, which is what we are actually asking. Yes and No
 * are the whole vocabulary, because a third option is a way of not answering.
 */
export const HAVE_YOU_BOUGHT_IT = 'Have you bought the product?';
export const YES_I_HAVE = 'Yes, I have';
export const NOT_YET = 'Not yet';


/**
 * THE SHOP WILL NOT LET US LOOK, AND THIS IS NOT "WE COULD NOT FIND YOUR ORDER".
 *
 * ── WHY THE TWO MUST NEVER BE THE SAME SENTENCE ─────────────────────────────
 *
 * They send a person to two different places. "We could not find your order"
 * means work: look again, send a photograph, check you bought the right thing —
 * and worry, because it is about whether their money is coming. This one means
 * wait a few minutes. Saying the first when the second is true tells somebody
 * their purchase might not count when there is nothing wrong with it at all.
 *
 * MEASURED. On 9 September 2026 Amazon answered our second visit in four minutes
 * with a page reading only "Click the button below to continue shopping", then
 * 503, then its robot puzzle. Three faces of one meaning: slow down.
 *
 * ── AND IT NEVER NAMES THE SHOP ─────────────────────────────────────────────
 *
 * The owner's rule: never blame Amazon by name. It also happens to be the honest
 * wording, because we do not know that the shop is at fault. We asked twice in
 * four minutes; a shop that then declines is behaving reasonably.
 */
export const SHOP_WILL_NOT_LET_US_LOOK = 'The shop is not letting us look just now.';
export const NOTHING_IS_WRONG_WITH_YOUR_ORDER =
  'Nothing is wrong with your order, and you have not lost your place.';
export const TRY_IN_A_FEW_MINUTES = 'Please try again in a few minutes.';

/**
 * IT IS TAKING LONGER THAN IT SHOULD, said lightly and without a reason.
 *
 * The read is normally five to ten seconds. Past that a person needs to know the
 * screen has not died, and needs to be told nothing else: the rule on the waiting
 * screen is that it never says a shop account is being looked at, so this says
 * only that it is slow.
 */
export const TAKING_LONGER = 'This is taking a little longer than usual.';

/**
 * HOW LONG IS LEFT, IN WORDS, and it ticks on the phone.
 *
 * ── WHY THIS IS ON THIS SIDE AND THE MESSAGE IS NOT ─────────────────────────
 *
 * A number that changes every second cannot come from a record built on a server.
 * So the message that says "your place is held until 1:30 pm" is the server's,
 * and this running count is the phone's, and they are two different things
 * rather than two versions of one thing.
 *
 * SINGULAR AND PLURAL ARE BOTH WRITTEN OUT. "1 minutes left" is the kind of
 * sentence that makes somebody trust the rest of the screen less.
 *
 * ZERO IS ITS OWN ANSWER, not "0 minutes left". Once the hold is gone the count
 * is not a count any more, and the message beside it has already changed to the
 * one that says the two hours ran out.
 */
export const TIME_IS_UP = 'No time left';

export function timeLeftInWords(msLeft) {
  const ms = typeof msLeft === 'number' && Number.isFinite(msLeft) ? msLeft : 0;
  if (ms <= 0) return TIME_IS_UP;
  // ROUNDED UP, and that is deliberate. With 30 seconds left, "1 minute left" is
  // true and "0 minutes left" is not, and somebody reading zero would reasonably
  // stop trying.
  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const say = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (hours <= 0) return `${say(minutes, 'minute')} left`;
  if (rest === 0) return `${say(hours, 'hour')} left`;
  return `${say(hours, 'hour')} and ${say(rest, 'minute')} left`;
}

/**
 * Every sentence this file can put in front of somebody, for the walk.
 *
 * The clock lines are produced by calling the real function at spans that
 * exercise every branch of it, so the walk reads what a person would really see
 * rather than a sample somebody typed.
 */
export const EVERY_SENTENCE = [
  COULD_NOT_START,
  NOTHING_WAS_SPENT,
  TRY_AGAIN,
  takeMeThere('Amazon'),
  HAVE_YOU_BOUGHT_IT,
  YES_I_HAVE,
  NOT_YET,
  SHOP_WILL_NOT_LET_US_LOOK,
  NOTHING_IS_WRONG_WITH_YOUR_ORDER,
  TRY_IN_A_FEW_MINUTES,
  TAKING_LONGER,
  TIME_IS_UP,
  timeLeftInWords(30 * 1000),
  timeLeftInWords(60 * 1000),
  timeLeftInWords(45 * 60 * 1000),
  timeLeftInWords(60 * 60 * 1000),
  timeLeftInWords(2 * 60 * 60 * 1000),
  timeLeftInWords(119 * 60 * 1000),
];
