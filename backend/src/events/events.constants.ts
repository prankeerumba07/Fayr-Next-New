/** How far back the dashboard looks when nobody says. */
export const DEFAULT_WINDOW_DAYS = 30;
/** The furthest back it will look. A year of rows read in one request is enough. */
export const MAX_WINDOW_DAYS = 365;

/**
 * How many trail entries one read hands back when nobody says.
 *
 * Five hundred is roughly a busy person's month. The panel is told what it did
 * not get rather than being left to assume it got everything, so the cap is a
 * page size and not a silence.
 */
export const DEFAULT_ACTIVITY_LIMIT = 500;

/**
 * The most it will ever hand back in one read.
 *
 * A ceiling rather than a clamp: a request for more is REFUSED with a 400, not
 * quietly served a smaller answer. A panel that asked for 10,000 and got 2,000
 * without being told would draw "showing 2,000 of 2,000" and be wrong.
 */
export const MAX_ACTIVITY_LIMIT = 2000;
