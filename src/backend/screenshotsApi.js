// Screenshot proof — the tier-3 fallback when the scraper cannot read an order.
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
