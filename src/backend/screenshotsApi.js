// Screenshot proof — the tier-3 fallback when the scraper cannot read an order.
//
// ── BROKEN ON THE RUNTIME THIS APP SHIPS, AND NOT FIXED HERE — 19 SEPTEMBER 2026
//
// MEASURED ON THE OWNER'S OWN PHONE, 18 SEPTEMBER 2026: every picture chosen on
// the screenshot screens failed to send. uploadScreenshot below does
//
//   form.append('file', { uri, name, type });
//
// which is the React Native FormData idiom — a file part given as a plain object
// with a uri, never read into memory. On the React Native that Expo 57 ships
// that call throws "Unsupported format data part implementation" for EVERY
// picture, so nothing built on this function has ever uploaded anything from
// this app on that runtime. The screens that call it (src/screens/proofprimer.js
// through ProofUpload, delivery.js, reviewproof.js) are therefore offering a
// fallback that cannot complete.
//
// IT IS WRITTEN DOWN AND LEFT, on the owner's instruction for Phase 8A:
// "screenshotsApi.js is NOT fixed here. Write at the top of that file what is
// wrong and on which runtime." The reason it can wait is that Phase 8A takes the
// photograph steps off the journey for a shop inside Fayr altogether — the
// watched order is read off its own page instead — so the runtime failure is
// reached only from the four other shops' fallback. What a fix would need is a
// file part the shipped FormData accepts (a Blob or a File built from the uri,
// or the runtime's own uploadAsync), and it is its own change.
//
// Two endpoints, both already live on the backend:
//   POST /tasks/:id/screenshot   multipart: file + kind
//   GET  /tasks/:id/screenshots  the caller's OWN uploads for that task
//
// The upload is multipart, which is why authedFetch now leaves content-type
// alone for a FormData body — only the runtime knows the boundary it generated.
import { authedFetch } from './http.js';

/** The three stages a screenshot can attest to (mirrors the backend enum). */
export const KINDS = {
  PURCHASE: { key: 'PURCHASE', label: 'order', title: 'Order' },
  DELIVERY: { key: 'DELIVERY', label: 'delivery', title: 'Delivery' },
  REVIEW: { key: 'REVIEW', label: 'review', title: 'Review' },
};

/**
 * Upload one image as proof.
 *
 * `asset` is an expo-image-picker asset ({ uri, mimeType, fileName }). React
 * Native's FormData takes {uri, name, type} directly — the bytes are never read
 * into JS, so a large screenshot does not have to fit in memory.
 */
export async function uploadScreenshot(taskId, kind, asset) {
  if (!taskId || !asset || !asset.uri) {
    return { ok: false, status: 0, error: 'Nothing to upload.' };
  }
  const type = asset.mimeType || 'image/jpeg';
  const name = asset.fileName || `proof.${type.includes('png') ? 'png' : 'jpg'}`;

  const form = new FormData();
  form.append('kind', kind);
  form.append('file', { uri: asset.uri, name, type });

  const res = await authedFetch(`/tasks/${taskId}/screenshot`, {
    method: 'POST',
    body: form,
  });
  if (res.ok) return { ok: true, status: res.status, upload: res.body };
  return {
    ok: false,
    status: res.status,
    // The server's own words (file too big, not an image, wrong task) beat any
    // guess this client could make.
    error: (res.body && (res.body.message || res.body.error)) || 'That upload did not go through.',
  };
}

/** The caller's own uploads for a task, newest first. Never throws. */
export async function listScreenshots(taskId) {
  if (!taskId) return { ok: false, status: 0, uploads: [] };
  const res = await authedFetch(`/tasks/${taskId}/screenshots`, { method: 'GET' });
  return {
    ok: res.ok,
    status: res.status,
    uploads: res.ok && Array.isArray(res.body) ? res.body : [],
  };
}
