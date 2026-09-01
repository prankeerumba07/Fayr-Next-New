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
