import type { SupportQuestion, SupportReply } from '@prisma/client';
import { toQuestionResponse } from './support.response';

/**
 * Pure unit test for the support shaper. Pins the one bit of derived data:
 * a reply's author is 'staff' iff it carries a staffUserId, else 'user'.
 */

function reply(id: string, staffUserId: string | null): SupportReply {
  return {
    id,
    questionId: 'q1',
    body: `body ${id}`,
    staffUserId,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
  };
}

const question = {
  id: 'q1',
  userId: 'u1',
  subject: 'Where is my refund?',
  body: 'It has been 20 days.',
  status: 'ANSWERED',
  createdAt: new Date('2026-02-28T00:00:00.000Z'),
  updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  replies: [reply('r1', null), reply('r2', 'staff-1')],
} as unknown as SupportQuestion & { replies: SupportReply[] };

describe('toQuestionResponse', () => {
  it('infers reply author from staffUserId and renders ISO dates', () => {
    const r = toQuestionResponse(question);
    expect(r.status).toBe('ANSWERED');
    expect(r.createdAt).toBe('2026-02-28T00:00:00.000Z');
    expect(r.replies).toHaveLength(2);
    expect(r.replies[0].author).toBe('user'); // staffUserId null
    expect(r.replies[0].staffUserId).toBeNull();
    expect(r.replies[1].author).toBe('staff'); // staffUserId set
    expect(r.replies[1].staffUserId).toBe('staff-1');
  });
});
