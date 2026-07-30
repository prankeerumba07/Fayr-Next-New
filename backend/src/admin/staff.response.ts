import type { StaffUser } from '@prisma/client';

/** Wire shape for a staff account. Never carries the password hash. */
export interface StaffResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export function toStaffResponse(s: StaffUser): StaffResponse {
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    status: s.status,
    lastLoginAt: s.lastLoginAt ? s.lastLoginAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}
