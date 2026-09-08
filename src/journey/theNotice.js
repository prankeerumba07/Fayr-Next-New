// THE POP-UP BEFORE THEY LEAVE, AND THE CLOCK AFTERWARDS. Both as plain answers.
//
// ── WHY THIS IS A FILE AND NOT A FEW LINES IN THE SCREEN ────────────────────
//
// Because a phone cannot be made to produce these situations on demand. A task
// whose two hours ran out a second ago, a task nobody took to the shop, a server
// that answered without the words in it: each of those is one object here and
// every one of them can be walked under node. That is the same reason
// src/connect/gate.js exists, and its header says so.
//
// NOTHING IN HERE WRITES A WORD OF ITS OWN.
//
//   the pop-up's sentences   come from the SERVER, on task.shopVisitNoticeText,
//                            already built with the real clock time inside them
//   the button's label       src/ui/journeyWords.js
//   the clock's units        src/ui/journeyWords.js
//
// So there is no third copy of any sentence, which is the whole rule.

import { takeMeThere, timeLeftInWords } from '../ui/journeyWords.js';

/**
 * THE POP-UP, FROM THE TASK, or null when there is nothing to show.
 *
 * ── NULL IS THE SAFE ANSWER AND IT IS RETURNED OFTEN ────────────────────────
 *
 * No recorded tap, or no words from the server, means NO POP-UP. It does not mean
 * an empty pop-up, and it must never mean a pop-up the screen filled in itself: a
 * notice that promises two hours nothing recorded is worse than no notice, which
 * is exactly why the screen refuses to open the shop in that case rather than
 * drawing something.
 *
 * The sentences are split on the blank lines the server joined them with, so the
 * screen draws paragraphs without knowing what any of them say.
 */
export function noticeFromTask(task, shopName) {
  const t = task && typeof task === 'object' ? task : null;
  if (t == null) return null;
  if (t.wentToShopAt == null) return null;
  const text = typeof t.shopVisitNoticeText === 'string' ? t.shopVisitNoticeText : '';
  if (text.trim() === '') return null;
  const lines = text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  if (lines.length === 0) return null;
  const name = typeof shopName === 'string' && shopName.trim() !== '' ? shopName : null;
  return { lines, button: name == null ? null : takeMeThere(name) };
}

/**
 * HOW LONG IS LEFT, or null when there is no hold to count.
 *
 * ── NEVER A COUNTDOWN FOR A TASK WITH NO RECORDED TAP ───────────────────────
 *
 * The owner said it in those words, and it is not a detail. A clock counting down
 * beside an offer nobody has started tells somebody they are losing time they
 * have not begun to spend, which would push them to buy in a hurry for no reason.
 * Both halves are required: the tap AND the hold. One without the other is a row
 * we do not understand, and the honest answer to that is nothing rather than a
 * guess.
 */
export function countdownFor(task, now) {
  const t = task && typeof task === 'object' ? task : null;
  if (t == null) return null;
  if (t.wentToShopAt == null) return null;
  if (t.shopHoldEndsAt == null) return null;
  const ends = Date.parse(t.shopHoldEndsAt);
  if (!Number.isFinite(ends)) return null;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  return timeLeftInWords(ends - at);
}

/**
 * IS THE HOLD OVER? Asked separately from the words, because the two are used at
 * different moments: the words go on the screen, this decides whether the offer
 * is finished.
 *
 * A task with no hold is NOT over. It never started, and calling it finished
 * would close an offer somebody could still act on.
 */
export function holdIsOver(task, now) {
  const t = task && typeof task === 'object' ? task : null;
  if (t == null) return false;
  if (t.wentToShopAt == null || t.shopHoldEndsAt == null) return false;
  const ends = Date.parse(t.shopHoldEndsAt);
  if (!Number.isFinite(ends)) return false;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  return at > ends;
}

/**
 * WHAT THE THREE PLACES SHOW, AND IT IS ONE RECORD READ THREE WAYS.
 *
 * `which` is 'short' for the bar above the navigation and for the list, and
 * 'long' for the opened screen. There is no third form and no screen may pass
 * anything else: an unknown name answers null rather than falling back to
 * something, because a silent fallback is how a screen ends up showing its own
 * idea of the wording.
 */
export function messageText(task, which) {
  const t = task && typeof task === 'object' ? task : null;
  const m = t && t.message && typeof t.message === 'object' ? t.message : null;
  if (m == null) return null;
  if (which === 'short') return typeof m.short === 'string' ? m.short : null;
  if (which === 'long') return typeof m.long === 'string' ? m.long : null;
  return null;
}
