// TELLING OUR SIDE THAT SOMEBODY GOT SIGNED IN AT A SHOP.
//
//   POST /me/shop-sign-ins  { platform, howWeKnew } -> { platform, recorded }
//
// Thin transport, and DELIBERATELY UNABLE TO FAIL LOUDLY. A report that does not
// arrive is a number missing from a report staff read. It is not a person stuck
// on a shop's page, so nothing here ever throws and nothing waits on it.
//
// WHAT IT SENDS: which shop, and in words how the phone knew. There is no field
// for a password, a code, a cookie or an account number, and there is nothing on
// the phone that has one: the person types on the shop's own page and Fayr never
// sees a single thing they type.
import { authedFetch } from './http.js';

/** The seven shops our side will accept, as its own enum spells them. */
const AS_OUR_SIDE_SPELLS_IT = {
  amazon: 'AMAZON',
  flipkart: 'FLIPKART',
  meesho: 'MEESHO',
  myntra: 'MYNTRA',
  blinkit: 'BLINKIT',
  zepto: 'ZEPTO',
  instamart: 'INSTAMART',
};

/**
 * Write it down, once.
 *
 * Safe to call more than once: our side holds one row per person per shop for
 * ever and a second call updates nothing at all.
 */
export async function reportShopSignIn(platformKey, howWeKnew) {
  const platform = AS_OUR_SIDE_SPELLS_IT[String(platformKey || '').toLowerCase()];
  // A shop our side does not know is not reported. Sending one would be a
  // rejection nobody sees, in exchange for nothing.
  if (!platform) return { ok: false, recorded: false };
  try {
    const res = await authedFetch('/me/shop-sign-ins', {
      method: 'POST',
      body: JSON.stringify({
        platform,
        howWeKnew: typeof howWeKnew === 'string' && howWeKnew.trim() !== ''
          ? howWeKnew.trim().slice(0, 200)
          : undefined,
      }),
    });
    return {
      ok: !!res.ok,
      recorded: !!(res.ok && res.body && res.body.recorded === true),
    };
  } catch (e) {
    return { ok: false, recorded: false };
  }
}
