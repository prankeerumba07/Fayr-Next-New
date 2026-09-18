/**
 * WHICH CAMPAIGN A PERSON SEES FIRST.
 *
 * Pure. Hand it the campaigns and what we know about the person, and it hands
 * back the same campaigns in a different order. No database, no clock.
 *
 * ── THREE RULES, AND DELIBERATELY NO FOURTH ───────────────────────────────
 *
 *   1. A marketplace they have actually CONNECTED. Not one they said they shop
 *      on in setup — one they proved by signing in. A campaign on a shop they
 *      have not connected is a dead end: they would claim a seat, spend tickets,
 *      and only then be asked to sign in somewhere before they could do anything.
 *   2. A category they chose during setup. Stated rather than proved, so it
 *      ranks below the above — but on somebody's first day it is the only thing
 *      we know about them at all.
 *   3. Newest first, which is what every person saw before this file existed and
 *      is the right tie-break.
 *
 * No scoring model, and none until the numbers say ranking is worth investing
 * in. Every campaign's position is explainable in one sentence, which at this
 * stage is worth more than being clever: when somebody asks why they were shown
 * a thing, there is an answer.
 *
 * ── RULE 2 HARDLY FIRES TODAY, AND THAT IS NOT A BUG HERE ─────────────────
 *
 * Measured on 17 September 2026: the two sides are not the same vocabulary.
 *
 *   Setup offers eight fixed choices   "Fashion & Apparel", "Beauty & Personal
 *                                      Care", "Electronics & Mobile", ...
 *   A campaign's category is free text "Apparel", "Home/Decor", "Accessories",
 *     an operator types                "Personal Care", "Electronics", ...
 *
 * Only "Home & Kitchen" matches on both sides. So rule 2 is real, correct, and
 * almost never applies — and the honest fix is NOT a lookup table in this file,
 * which would rot the first time an operator invents a new label. It is a second
 * field on Campaign, constrained to the same eight values the setup screen
 * offers, set when a campaign is created. Campaign.category has a job already
 * (it decides the return-window policy) and must not be made to do two.
 *
 * Until that field exists this file behaves exactly as if rule 2 were absent,
 * which is why it is written to degrade quietly rather than to guess.
 *
 * ── AND ONE THING IT REFUSES TO DO ────────────────────────────────────────
 *
 * It never removes anything. Ordering and filtering look similar and behave
 * completely differently when the inputs are thin: a filter would show an EMPTY
 * feed to a new person with nothing connected and nothing chosen, which reads as
 * a broken app. They get the feed everybody used to get.
 */

/** What we know about the person the feed is for. */
export interface FeedReader {
  /** Marketplaces they have connected. Case does not matter. */
  connected: readonly string[];
  /** Categories they chose in setup. Case does not matter. */
  categories: readonly string[];
}

/** Everything of a campaign this ordering looks at. */
export interface Rankable {
  platform: string;
  category: string | null;
}

/** The ordering a signed-out or unknown reader gets: exactly what it was. */
export const NO_READER: FeedReader = { connected: [], categories: [] };

/** Lower-cased and trimmed, so "Amazon", "AMAZON" and " amazon " are one thing. */
const same = (a: string): string => a.trim().toLowerCase();

/** 0 is the front of the feed. Lower sorts earlier. */
export function rankOf(campaign: Rankable, reader: FeedReader): number {
  const connected = reader.connected.map(same);
  const chosen = reader.categories.map(same);
  const onTheirShop = connected.includes(same(campaign.platform));
  const inTheirCategory =
    campaign.category !== null && chosen.includes(same(campaign.category));
  if (onTheirShop && inTheirCategory) return 0;
  if (onTheirShop) return 1;
  if (inTheirCategory) return 2;
  return 3;
}

/**
 * The feed, in the order one person should see it.
 *
 * A COPY. The caller's array comes out of a database read that other things also
 * look at, and sorting it in place is the kind of shared-state bug that is very
 * hard to find afterwards.
 *
 * Stable within a rank. The incoming order is newest-first and equal ranks keep
 * it, which is rule 3 — Array.prototype.sort is required to be stable, so
 * nothing extra is needed to hold that.
 */
export function orderFeedFor<T extends Rankable>(
  campaigns: readonly T[],
  reader: FeedReader,
): T[] {
  return [...campaigns].sort((a, b) => rankOf(a, reader) - rankOf(b, reader));
}
