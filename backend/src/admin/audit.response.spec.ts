import type { AuditWithStaff } from './audit.response';
import { toAuditEntry } from './audit.response';

/** Pure unit test for the audit shaper: staff embedded, ISO date, metadata passthrough. */
describe('toAuditEntry', () => {
  it('embeds the acting staff and renders the date as ISO', () => {
    const row = {
      id: 'a1',
      action: 'USER_VIEW',
      targetUserId: 'u1',
      metadata: { found: true },
      createdAt: new Date('2026-04-05T06:07:08.000Z'),
      staffUser: { id: 's1', email: 'admin@fayr.local', name: 'Admin' },
    } as unknown as AuditWithStaff;

    const e = toAuditEntry(row);
    expect(e.action).toBe('USER_VIEW');
    expect(e.staff).toEqual({
      id: 's1',
      email: 'admin@fayr.local',
      name: 'Admin',
    });
    expect(e.targetUserId).toBe('u1');
    expect(e.metadata).toEqual({ found: true });
    expect(e.createdAt).toBe('2026-04-05T06:07:08.000Z');
  });

  it('passes a null target and metadata through as null', () => {
    const row = {
      id: 'a2',
      action: 'STAFF_LOGIN',
      targetUserId: null,
      metadata: null,
      createdAt: new Date('2026-04-05T06:07:08.000Z'),
      staffUser: { id: 's1', email: 'admin@fayr.local', name: 'Admin' },
    } as unknown as AuditWithStaff;

    const e = toAuditEntry(row);
    expect(e.targetUserId).toBeNull();
    expect(e.metadata).toBeNull();
  });
});
