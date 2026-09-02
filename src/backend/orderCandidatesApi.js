// THE ORDERS THE PHONE FOUND, HANDED TO THE SERVER TO JUDGE.
//
// Three endpoints, all on the caller's own task:
//
//   POST /tasks/:id/orders-found                  the text of each order found
//   GET  /tasks/:id/orders-found                  what we have already asked about
//   POST /tasks/:id/orders-found/:oid/mine        "yes, that is mine"
//
// THIS CLIENT SENDS TEXT AND NOTHING ELSE. Not an order number, not a price, and
// above all not an opinion about whether anything matched. The server reads the
// text and decides, and the endpoint refuses any other field outright — see
// backend/src/tasks/dto/found-orders.dto.ts. A second opinion on this side is
// exactly the defect this project keeps finding.
import { authedFetch } from './http.js';

/** Hand over the text of every order the phone found. Never throws. */
export async function sendFoundOrders(taskId, pages) {
  if (!taskId) return { ok: false, status: 0, orders: [] };
  const list = Array.isArray(pages) ? pages.filter((p) => typeof p === 'string') : [];
  const res = await authedFetch(`/tasks/${taskId}/orders-found`, {
    method: 'POST',
    body: JSON.stringify({ pages: list }),
  });
  if (res.ok && Array.isArray(res.body)) {
    return { ok: true, status: res.status, orders: res.body };
  }
  return { ok: false, status: res.status, orders: [] };
}

/** What we have already asked about, newest first. Never throws. */
export async function listFoundOrders(taskId) {
  if (!taskId) return { ok: false, status: 0, orders: [] };
  const res = await authedFetch(`/tasks/${taskId}/orders-found`);
  if (res.ok && Array.isArray(res.body)) {
    return { ok: true, status: res.status, orders: res.body };
  }
  return { ok: false, status: res.status, orders: [] };
}

/** The person says this one is their order. Never throws. */
export async function thisOrderIsMine(taskId, orderId) {
  if (!taskId || !orderId) return { ok: false, status: 0, task: null, error: null };
  const res = await authedFetch(`/tasks/${taskId}/orders-found/${orderId}/mine`, {
    method: 'POST',
  });
  if (res.ok) return { ok: true, status: res.status, task: res.body, error: null };
  return {
    ok: false,
    status: res.status,
    task: null,
    // The server's own words beat any guess this client could make.
    error: (res.body && (res.body.message || res.body.error)) || null,
  };
}
