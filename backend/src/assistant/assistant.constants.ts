/**
 * Limits and audit tags for the assistant. Product policy, in one place, so the
 * service, the screens and the tests all read the same numbers.
 */

/** Longer than anybody types into a help box on a phone. */
export const QUESTION_MAX_LENGTH = 2_000;

export const ANSWER_TITLE_MAX_LENGTH = 200;
export const ANSWER_BODY_MAX_LENGTH = 4_000;
export const PHRASE_MAX_LENGTH = 300;
export const TOPIC_MAX_LENGTH = 60;

/** One answer with more stored wordings than this is a sign of a different problem. */
export const MAX_PHRASES_PER_ANSWER = 200;

/**
 * An answer's key: lowercase letters, numbers and single dashes. Short enough to
 * read in a list and stable enough to be referred to in writing.
 */
export const ANSWER_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * How many stored wordings the database hands back before the scoring picks
 * between them. Bounded on purpose: the indexes find the candidates, and the
 * judging happens on a short list, so neither half grows with the answer book.
 */
export const SEARCH_CANDIDATE_CAP = 200;

/**
 * How close the letters have to be before the database calls two texts a near
 * miss. Postgres's own default for this is 0.6, which is far too strict for the
 * thing it is here to catch — these are the measured values on real wordings:
 *
 *   refnud not recieved   vs  refund not received        0.41
 *   when will my refund arive vs when will my refund arrive  0.89
 *   mera refund kab ayega vs  mera refund kab aayega     0.88
 *   do you deliver to Nepal vs when will my refund arrive    0.04
 *   refnud not recieved   vs  an unrelated parcel phrase 0.00
 *
 * At 0.6 the first line — two typos in three words, which is an ordinary thing to
 * type on a phone — finds nothing at all. At 0.35 it is found, and unrelated text
 * is still eight times further away than the cut. Set explicitly on every search
 * rather than left to the database's default, so this number is a decision
 * somebody made and can change, not an accident of a version.
 */
export const NEAR_MISS_THRESHOLD = 0.35;

export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 25;

/** Default window for the "how long is this taking" figures. */
export const DEFAULT_STATS_WINDOW_DAYS = 30;
export const MAX_STATS_WINDOW_DAYS = 730;

/** Page sizes for the staff lists. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Reading a queue is not audited — that is a tab loading. Opening ONE question is,
 * because it shows one named person's own words and the record of what they were
 * doing. The tag itself lives with every other audit tag in
 * admin/admin.constants.ts rather than in a second list here, so the trail can be
 * filtered by one vocabulary.
 */

/**
 * Characters a database text column physically cannot hold.
 *
 * A null character is the one that matters. Postgres refuses it outright — the
 * error is "invalid byte sequence for encoding UTF8: 0x00" — so a question
 * containing one cannot be stored AND cannot be searched for. Found by sending
 * one at the search: it came back as a raw database complaint, which is both an
 * unhandled failure and a free lesson for whoever sent it about how the query is
 * built.
 *
 * Nobody types a null character. It arrives only in a request somebody crafted.
 * So the answer is an honest refusal rather than quietly stripping it: stripping
 * would break the promise that a question is stored exactly as typed, and that
 * promise is worth more than accepting a character no keyboard produces.
 *
 * The other C0 control characters go with it, except tab, newline and carriage
 * return, which somebody really does type.
 */
const UNSTORABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function hasUnstorableCharacters(text: unknown): boolean {
  return typeof text === 'string' && UNSTORABLE.test(text);
}
