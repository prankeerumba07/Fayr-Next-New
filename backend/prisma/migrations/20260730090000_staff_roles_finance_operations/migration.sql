-- Add the FINANCE and OPERATIONS staff roles (Phase 4 — expanded staff roles).
-- Postgres 12+ allows adding multiple enum values in one migration; neither new
-- value is USED in this migration, so there's no in-transaction-usage concern.
ALTER TYPE "StaffRole" ADD VALUE 'FINANCE';
ALTER TYPE "StaffRole" ADD VALUE 'OPERATIONS';
