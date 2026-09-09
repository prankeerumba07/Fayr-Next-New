import type { Platform } from '@prisma/client';

/**
 * A shop's name as a PERSON writes it.
 *
 * The database stores AMAZON. Nobody types that, nobody reads it, and a screen or a
 * comparison that shows it makes Fayr look like a database. This is the one place
 * the shouting form becomes the written form.
 *
 * The device has the same names, on the frozen src/platforms.js entries the reader
 * itself uses. They are kept in step by eye rather than by import, because that
 * file is a 2,578 line bundle of injected browser scripts and the backend has no
 * business loading it. If a name ever differs, the device's is the one a person
 * actually sees, so the device wins and this follows.
 */
const WRITTEN: Record<Platform, string> = {
  AMAZON: 'Amazon',
  FLIPKART: 'Flipkart',
  MEESHO: 'Meesho',
  MYNTRA: 'Myntra',
  BLINKIT: 'Blinkit',
  ZEPTO: 'Zepto',
  INSTAMART: 'Instamart',
};

/**
 * The written name, or null.
 *
 * Null rather than the raw value for anything unrecognised: a screen that printed
 * AMAZON_NEW because the enum grew would look broken, and a comparison that fell
 * back to the raw value would report a disagreement between "Amazon" and "AMAZON".
 */
export function platformDisplayName(
  platform: Platform | string | null | undefined,
): string | null {
  if (typeof platform !== 'string' || platform === '') return null;
  return WRITTEN[platform as Platform] ?? null;
}

/** Every shop, for anything that needs the whole list. */
export const EVERY_PLATFORM_NAME = WRITTEN;

/**
 * A shop's name AS THE APP'S OWN CODE SPELLS IT — the key, not the written name.
 *
 * ── WHY A THIRD SPELLING IS NOT BEING INVENTED HERE ────────────────────────
 *
 * There are already exactly two and they both already exist. The database says
 * AMAZON. The app says 'amazon': that is the key on src/platforms.js, the route
 * name every connect screen is registered under, and the list the profile's own
 * `platforms` field is validated against (SHOP_PLATFORMS in the me DTO). What has
 * been missing is one place that turns the first into the second.
 *
 * It was missing on this side only. The APP has had the map since the day the
 * sign-in report was built — AS_OUR_SIDE_SPELLS_IT in src/backend/shopApi.js goes
 * the other way, lower case to enum, for writing. This is the reading direction.
 *
 * ── AND WHY IT IS A TOTAL RECORD RATHER THAN toLowerCase() ─────────────────
 *
 * toLowerCase() is right for all seven of today's names and is right by accident.
 * It gives no answer at all for a name where the two sides genuinely differ, and
 * it would silently produce a key no screen has, which is a shop that can never
 * be recognised as connected. Typed against Platform, so the eighth shop does not
 * compile until it is written down here.
 */
export const AS_THE_APP_SPELLS_IT: Record<Platform, string> = {
  AMAZON: 'amazon',
  FLIPKART: 'flipkart',
  MEESHO: 'meesho',
  MYNTRA: 'myntra',
  BLINKIT: 'blinkit',
  ZEPTO: 'zepto',
  INSTAMART: 'instamart',
};
