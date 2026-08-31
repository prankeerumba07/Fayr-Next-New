// The live page check — the transport, and a staff sign-in that lives nowhere.
//
// WHY THIS DOES NOT USE authedFetch. Every other call in the app carries the
// user's own sign-in. This one must not: marking offers as no longer working hides
// them from every user's feed, so the server requires a STAFF sign-in for it. The
// person running this each morning signs in with their Fayr staff email, and the
// token they get back is kept in memory for as long as the screen is open and
// written down nowhere. Close the screen and it is gone.
import { API_BASE } from './config';
import { refuseWhileShowing } from './showing';

async function call(path, { method, token, body }) {
  // Marking offers as no longer working hides them from every user's feed, which
  // is the last thing that should happen from a screen being demonstrated. This
  // file answers in its own shape, so the refusal is translated into it.
  const refused = refuseWhileShowing(method, path);
  if (refused) return { ok: false, status: 0, error: refused.body.message };

  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach Fayr. Check the address and try again.' };
  }
  const txt = await res.text();
  let data = null;
  if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
  if (!res.ok) {
    const m = (data && data.message) || 'That did not work.';
    return { ok: false, status: res.status, error: Array.isArray(m) ? m.join('; ') : String(m) };
  }
  return { ok: true, status: res.status, body: data };
}

/** Sign in as staff. The token comes back and is never stored anywhere. */
export async function staffSignIn(email, password) {
  const res = await call('/admin/auth/login', {
    method: 'POST',
    body: { email: String(email || '').trim(), password: String(password || '') },
  });
  if (!res.ok) {
    return {
      ok: false,
      // Never says which half was wrong: that would tell somebody guessing which
      // email addresses exist.
      error: res.status === 401 ? 'That email and password did not work.' : res.error,
    };
  }
  return { ok: true, token: res.body && res.body.accessToken, staff: res.body && res.body.staff };
}

/** Every live offer, and the shop page to open for it. */
export async function offersToCheck(token) {
  const res = await call('/admin/live-check/todo', { method: 'GET', token });
  return res.ok
    ? { ok: true, offers: Array.isArray(res.body) ? res.body : [] }
    : { ok: false, error: res.error, offers: [] };
}

/** This morning's findings. */
export async function submitResults(token, results) {
  const res = await call('/admin/live-check/run', { method: 'POST', token, body: { results } });
  return res.ok ? { ok: true, report: res.body } : { ok: false, error: res.error };
}
