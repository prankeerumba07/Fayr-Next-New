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
/*
 * ── AND THE WORD IS "PURCHASED", WHICH IS THE OWNER'S OWN ─────────────────
 *
 * It read "Have you bought the product?" until 17 September 2026. The argument
 * above is about TENSE and is unchanged; what changed is one word, and it
 * changed because REVIEW-FLOW-PROMPT.md, written from the owner's own words,
 * states the sentence in full at step five: "Have you purchased the product?".
 * A specification that quotes a sentence is not a place to improve the sentence.
 */
export const HAVE_YOU_BOUGHT_IT = 'Have you purchased the product?';
export const YES_I_HAVE = 'Yes, I have';
export const NOT_YET = 'Not yet';

/**
 * PLAIN YES AND PLAIN NO, for the three questions that offer exactly those two.
 *
 * "Is the product delivered?" and "Have you posted the review?" are both written
 * in REVIEW-FLOW-PROMPT.md with Yes and No beneath them, in those words, so
 * these are the words. The buy question keeps "Yes, I have", which is what it
 * has always said and what the same file writes beside it.
 */
export const YES = 'Yes';
export const NO = 'No';

/**
 * WHAT WE SAY THE MOMENT SOMEBODY CONFIRMS THE ORDER IS THEIRS. Step seven.
 *
 * Quoted in full in REVIEW-FLOW-PROMPT.md. Two sentences rather than one because
 * they say two different things: the first closes the step they just finished,
 * and the second is the whole of what is being asked of them next.
 *
 * IT DOES NOT PROMISE A DATE. Nobody knows when the parcel arrives, and a screen
 * that guessed would be wrong most days.
 */
export const THANK_YOU_FOR_CONFIRMING = 'Thank you for confirming.';
export const USE_IT_AND_REVIEW_FAIRLY =
  'Once your product is delivered, use it and give a fair review.';

/**
 * THE DELIVERY QUESTION. Step eight, and it is a TRIGGER and never an answer.
 *
 * ── AND THAT DISTINCTION IS THE WHOLE OF WHY THIS IS ALLOWED TO EXIST ─────
 *
 * On 16 September 2026 this screen was told to stop asking, in those words:
 * "Fayr must confirm delivery by reading the user's own Amazon order page, with
 * no buttons and no user input." It was rebuilt to read on its own. On
 * 17 September the owner's written flow puts the question back, at step eight,
 * with "Yes reads the delivery off the shop's own page" at step nine.
 *
 * THE TWO INSTRUCTIONS DO NOT ACTUALLY CONFLICT, and it is worth being exact
 * about why. The thing the first one forbids is a TAP SETTLING A DELIVERY. This
 * tap settles nothing: it starts the same read, the shop's own page is still the
 * only evidence, and a person who taps Yes on a parcel that has not arrived gets
 * exactly what a person who taps nothing gets. What the question buys is that
 * Fayr does not go asking a shop for pages every time somebody opens the app.
 */
export const IS_THE_PRODUCT_DELIVERED = 'Is the product delivered?';

/**
 * THE CELEBRATION, WHICH IS THREE WORDS AND THEN GONE. Step ten.
 *
 * "A short celebration: Product delivered. for 3 to 4 seconds, then the next
 * screen by itself." The owner first wrote thirty four seconds and corrected it
 * the same evening to three to four; the correction is in the file this came
 * from, so there was nothing to ask about.
 */
export const PRODUCT_DELIVERED = 'Product delivered.';

/**
 * WHAT THE REVIEW STEP ASKS FOR. Step eleven, quoted in full.
 *
 * "after using the product" is doing real work in that sentence: it is the only
 * place the app says the review is meant to come after using the thing.
 *
 * ── IT IS AN ASK NOW, AND IT USED TO BE A RULE ────────────────────────────
 *
 * Until 18 September 2026 this sentence had a lock behind it: the step was shut
 * for twenty-four hours after the parcel arrived, and this line was the reason
 * given. The owner removed the lock — see src/journey/reviewStep.js for his
 * words — and the sentence stays, because asking somebody to use a thing before
 * writing about it is still the right thing to ask. It is simply no longer
 * enforced with a clock.
 *
 * TWO SENTENCES WENT WITH THE LOCK, and they are not replaced by anything:
 * "This opens one day after your product arrives." and "Use the product first.
 * We open this by itself when the day is up." Both promised a wait that no
 * longer happens, so keeping either would be the app describing a rule it does
 * not have.
 */
export const WRITE_A_FAIR_REVIEW = 'Write a fair review after using the product.';

/**
 * THE REVIEW QUESTION, ASKED WHEN THEY COME BACK FROM WRITING ONE. Steps
 * fifteen and twenty.
 *
 * ONE SENTENCE FOR BOTH, and that is deliberate. Step twenty puts a different
 * line ABOVE it — see REVIEW_CONFIRMATION_RECEIVED — and asks the same question
 * underneath. Two wordings of one question is how two screens end up seeming to
 * ask different things.
 */
export const HAVE_YOU_POSTED_THE_REVIEW = 'Have you posted the review?';

/**
 * THE WAIT, WHICH IS THE SHOP'S AND IS SAID TO BE THE SHOP'S. Steps sixteen to
 * eighteen.
 *
 * ── THIS IS NOT AN ERROR AND MUST NOT READ AS ONE ─────────────────────────
 *
 * The owner's own words: "On Yes, the app does NOT immediately claim failure."
 * A review that has just been written is not visible yet, and a screen that said
 * "we could not find it" would be telling somebody their work had not counted
 * when nothing at all is wrong.
 *
 * THE NUMBER IS THE SHOP'S AND IT IS ATTRIBUTED. Fayr is not promising 48 to 72
 * hours and cannot: the shop decides. So the shop's name goes in the sentence,
 * which is why these take one.
 */
export function reviewsGoLiveIn(shopName) {
  return `${shopName} reviews go live 48 to 72 hours after they are submitted.`;
}
export function waitThenComeBack(shopName) {
  return `Wait for that time and ${shopName} will send you a confirmation. `
    + 'Once you have it, come back to the app and continue.';
}
export const STILL_WANT_TO_CONTINUE = 'Still want to continue';
export const I_WILL_DO_IT_LATER = 'I’ll do it later';

/**
 * WHAT WE ALREADY KNOW, SAID BACK. Step seventeen.
 *
 * "If it finds nothing, it says the same thing again, but now naming what it
 * knows: they posted it at such a time, it takes 48 to 72 hours, please wait."
 *
 * THE TIME COMES OFF THE RECORD AND NOT OFF THE PHONE. It is the moment our own
 * side recorded them leaving to write the review, which is the only instant
 * anybody but the shop can vouch for.
 */
export function youPostedItAgo(howLong) {
  return `You told us you posted it ${howLong} ago.`;
}
export const PLEASE_WAIT_FOR_THAT_TIME =
  'Please wait for that time to pass, then come back and we will look again.';

/**
 * THE SECOND AND LATER VISITS. Step twenty.
 *
 * The screen must not repeat the first-time message to somebody who has already
 * been told and already tried. This line replaces it, and the question under it
 * is the same question as step fifteen.
 */
export const REVIEW_CONFIRMATION_RECEIVED = 'Review confirmation received.';

/**
 * THE MONEY, ONCE IT HAS MOVED. Section A of REVIEW-FLOW-PROMPT.md.
 *
 * ── THERE IS NO BUTTON HERE AND THERE MUST NOT BE ─────────────────────────
 *
 * The screen used to offer "Release ₹4,495.50 to wallet". Release is an
 * operator's verb: a person does not release their own refund, the scheduler
 * does, gated on the refund rules, and by the time anybody reads this the
 * decision has already been made and the money has already moved.
 *
 * So these three sentences REPORT. Nothing here asks for a tap, and the staff
 * panel keeps its own "Release refund" action, which is an operator doing an
 * operator's job and is correctly worded there.
 */
export const REFUND_CONFIRMED = 'Refund confirmed.';
export const REVIEW_LIVE_AND_WINDOW_CLOSED =
  'Your review is live and the return window has closed.';
export function addedToYourWallet(amount) {
  return `${amount} has been added to your wallet.`;
}

/**
 * HOW LONG AGO, IN WORDS. The other side of timeLeftInWords below.
 *
 * Same units, same singular and plural care, and the same reason for living on
 * the phone: a span measured against the clock right now cannot come from a
 * record built on our side. Days are added because this one counts a wait that
 * is expected to run into them, which the two hour hold never does.
 */
export function howLongAgoInWords(ms) {
  const span = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
  const minutes = Math.floor(span / 60000);
  const say = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (minutes < 1) return 'a moment';
  if (minutes < 60) return say(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return say(hours, 'hour');
  return say(Math.floor(hours / 24), 'day');
}


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
 * THE SHOP WANTS THEM TO SIGN IN AGAIN BEFORE IT WILL SHOW THE ORDERS.
 *
 * ── WHY THIS IS NOT THE SAME AS THE SHOP REFUSING ──────────────────────────
 *
 * Because there is something the person can DO, and it takes one tap. The
 * refusal above means wait; this means sign in. Telling somebody to wait when
 * they need to sign in leaves them waiting for ever.
 *
 * MEASURED, AND IT IS THE NORMAL CASE ON AMAZON, not an edge one. The orders
 * page redirects to a sign in demanding a FRESH password, which the review and
 * profile pages never do. So this will be seen often.
 *
 * IT DOES NOT NAME THE SHOP, because the sentence does not need to: the button
 * beside it does, through takeMeThere, and that is one place rather than two.
 */
export const SHOP_WANTS_A_SIGN_IN = 'The shop needs you to sign in again first.';
export const THEN_WE_CAN_LOOK = 'Then we can look for your order.';

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
  YES,
  NO,
  THANK_YOU_FOR_CONFIRMING,
  USE_IT_AND_REVIEW_FAIRLY,
  IS_THE_PRODUCT_DELIVERED,
  PRODUCT_DELIVERED,
  WRITE_A_FAIR_REVIEW,
  HAVE_YOU_POSTED_THE_REVIEW,
  reviewsGoLiveIn('Amazon'),
  waitThenComeBack('Amazon'),
  STILL_WANT_TO_CONTINUE,
  I_WILL_DO_IT_LATER,
  youPostedItAgo('2 hours'),
  PLEASE_WAIT_FOR_THAT_TIME,
  REVIEW_CONFIRMATION_RECEIVED,
  REFUND_CONFIRMED,
  REVIEW_LIVE_AND_WINDOW_CLOSED,
  addedToYourWallet('₹1,234.50'),
  howLongAgoInWords(30 * 1000),
  howLongAgoInWords(5 * 60 * 1000),
  howLongAgoInWords(60 * 60 * 1000),
  howLongAgoInWords(3 * 60 * 60 * 1000),
  howLongAgoInWords(26 * 60 * 60 * 1000),
  howLongAgoInWords(72 * 60 * 60 * 1000),
  SHOP_WILL_NOT_LET_US_LOOK,
  NOTHING_IS_WRONG_WITH_YOUR_ORDER,
  TRY_IN_A_FEW_MINUTES,
  TAKING_LONGER,
  SHOP_WANTS_A_SIGN_IN,
  THEN_WE_CAN_LOOK,
  TIME_IS_UP,
  timeLeftInWords(30 * 1000),
  timeLeftInWords(60 * 1000),
  timeLeftInWords(45 * 60 * 1000),
  timeLeftInWords(60 * 60 * 1000),
  timeLeftInWords(2 * 60 * 60 * 1000),
  timeLeftInWords(119 * 60 * 1000),
];
