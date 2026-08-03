import {
  toUserScreenshot,
  type UserScreenshotSource,
} from './screenshot.response';

/**
 * The user-facing mapper must surface the staff reason ONLY for the two
 * actionable outcomes (rejected / needs_more) so the user knows what to fix —
 * and never for approved or pending. It must never leak verdict/confidence/diff
 * (the shape simply has no such fields).
 */

function src(over: Partial<UserScreenshotSource> = {}): UserScreenshotSource {
  return {
    id: 'sub-1',
    status: 'EXTRACTED',
    reviewReason: null,
    reviewedAt: null,
    screenshot: {
      taskId: 'task-1',
      kind: 'PURCHASE',
      uploadedAt: new Date('2026-07-02T10:00:00Z'),
    },
    ...over,
  };
}

describe('toUserScreenshot', () => {
  it('surfaces the reason for REJECTED', () => {
    const r = toUserScreenshot(
      src({
        status: 'REJECTED',
        reviewReason: 'Blurry — retake it',
        reviewedAt: new Date('2026-07-03T09:00:00Z'),
      }),
    );
    expect(r.status).toBe('rejected');
    expect(r.reviewReason).toBe('Blurry — retake it');
    expect(r.reviewedAt).toBe('2026-07-03T09:00:00.000Z');
  });

  it('surfaces the reason for NEEDS_MORE', () => {
    const r = toUserScreenshot(
      src({
        status: 'NEEDS_MORE',
        reviewReason: 'Send the order-summary page',
      }),
    );
    expect(r.status).toBe('needs_more');
    expect(r.reviewReason).toBe('Send the order-summary page');
  });

  it('hides the reason for APPROVED (even if one was stored)', () => {
    const r = toUserScreenshot(
      src({
        status: 'APPROVED',
        reviewReason: 'internal note',
        reviewedAt: new Date('2026-07-03T09:00:00Z'),
      }),
    );
    expect(r.status).toBe('approved');
    expect(r.reviewReason).toBeNull();
    expect(r.reviewedAt).toBe('2026-07-03T09:00:00.000Z'); // timestamp is fine to show
  });

  it('has no reason while pending, and never carries verdict/confidence/match', () => {
    const r = toUserScreenshot(src({ status: 'EXTRACTED' }));
    expect(r.status).toBe('pending_review');
    expect(r.reviewReason).toBeNull();
    expect(r.reviewedAt).toBeNull();
    expect(r).not.toHaveProperty('verdict');
    expect(r).not.toHaveProperty('confidence');
    expect(r).not.toHaveProperty('match');
  });
});
