import type { AdminAuditLog, StaffUser } from '@prisma/client';

/**
 * Wire shape for an audit entry. The acting staff member is embedded (id + email
 * + name) so the trail reads without a second lookup; the target stays a bare
 * user id (staff resolve it via search when needed). Dates are ISO.
 */
export interface AuditEntryResponse {
  id: string;
  action: string;
  staff: { id: string; email: string; name: string };
  targetUserId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** A page of audit entries plus the unfiltered-by-page total, for pagination. */
export interface AuditListResponse {
  total: number;
  limit: number;
  offset: number;
  entries: AuditEntryResponse[];
}

export type AuditWithStaff = AdminAuditLog & {
  staffUser: Pick<StaffUser, 'id' | 'email' | 'name'>;
};

export function toAuditEntry(a: AuditWithStaff): AuditEntryResponse {
  return {
    id: a.id,
    action: a.action,
    staff: {
      id: a.staffUser.id,
      email: a.staffUser.email,
      name: a.staffUser.name,
    },
    targetUserId: a.targetUserId,
    metadata: a.metadata ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
