// How to reach Fayr — read from our side, never written down here.
//
//   GET /me/how-to-reach-us → { phone, title, words, button }
//
// Thin transport. The number lives in backend/.env and this asks for it each time
// the Help screen opens, so changing it is a restart on the laptop and nothing at
// all on the phone.
//
// A FAILURE IS NOT A GAP. When the call cannot be made, nothing is returned and the
// Help screen simply has no call row. It never shows half an answer.
import { authedFetch } from './http.js';

/** GET /me/how-to-reach-us → { ok, contact } */
export async function howToReachUs() {
  const res = await authedFetch('/me/how-to-reach-us', { method: 'GET' });
  return res.ok && res.body && typeof res.body === 'object'
    ? { ok: true, status: res.status, contact: res.body }
    : { ok: false, status: res.status, contact: null };
}
