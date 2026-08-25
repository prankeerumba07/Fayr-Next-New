// What an uploaded screenshot's status means, and what the user can do next.
// Pure, so it is tested under node like the other ui/ helpers.
//
// The invariant this file encodes (CLAUDE.md, OCR section): a screenshot is
// SUPPORTING evidence only. It never approves itself, it never moves money, and
// a staff member decides. Every string below has to keep that true — an
// "Accepted" chip must not imply the refund is coming.

/** Backend EvidenceSubmission status → how the screen shows it. */
export const STATUS_UI = {
  pending_review: {
    label: 'Under review',
    tone: 'blue',
    note: 'A Fayr reviewer is checking your screenshot. We will update this page.',
    canReplace: true,
  },
  approved: {
    label: 'Accepted',
    tone: 'green',
    note: 'A reviewer accepted this proof. Your claim continues on the normal timeline.',
    canReplace: false,
  },
  needs_more: {
    label: 'More proof needed',
    tone: 'amber',
    note: 'A reviewer needs another screenshot before they can accept this.',
    canReplace: true,
  },
  rejected: {
    label: 'Not accepted',
    tone: 'red',
    note: 'A reviewer could not accept this screenshot.',
    canReplace: true,
  },
};

export function statusUi(status) {
  return STATUS_UI[status] || STATUS_UI.pending_review;
}

/**
 * The whole screen's state from the uploads for one kind.
 *
 * `latest` drives the banner; the reviewer's own note replaces the generic one
 * whenever they left one, because "a reviewer needs another screenshot" is much
 * less useful than "the order number is cut off".
 */
export function proofView(uploads, kind) {
  const mine = (Array.isArray(uploads) ? uploads : [])
    .filter((u) => u && u.kind === kind)
    .slice()
    .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));

  const latest = mine[0] || null;
  const ui = latest ? statusUi(latest.status) : null;
  const reviewerNote = latest && latest.reviewReason ? latest.reviewReason : null;

  return {
    uploads: mine,
    latest,
    status: latest ? latest.status : null,
    banner: latest
      ? {
        label: ui.label,
        tone: ui.tone,
        note: reviewerNote || ui.note,
        fromReviewer: !!reviewerNote,
      }
      : null,
    canUpload: !latest || ui.canReplace,
    uploadLabel: !latest
      ? 'Tap to choose your screenshot'
      : latest.status === 'approved'
        ? null
        : latest.status === 'pending_review'
          ? 'Add another screenshot'
          : 'Upload a new screenshot',
    history: mine.slice(1),
  };
}

/**
 * The standing disclaimer. Shown on every state, never conditionally hidden —
 * this is the sentence that stops a screenshot reading as an approved refund.
 */
export const SUPPORTING_ONLY =
  'A screenshot is supporting proof. A Fayr reviewer makes the final call, and '
  + 'your refund still waits out the normal return window.';

/** What to photograph, per stage. Vague instructions produce unusable proof. */
export const WHAT_TO_CAPTURE = {
  PURCHASE: 'Show the order page with the order number, the amount you paid and the product name all visible.',
  DELIVERY: 'Show the order showing “Delivered”, with the delivery date visible.',
  REVIEW: 'Show your review on the product page, as anyone else would see it.',
};
