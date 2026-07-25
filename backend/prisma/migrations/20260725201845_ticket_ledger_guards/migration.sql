-- Phase 1.3 — database-level guards for the ticket ledger. Same rigor as the
-- wallet guards: they hold even if a future writer bypasses TicketService.
-- Raw-SQL-only (Prisma can't model triggers), so no schema drift.

-- ---------------------------------------------------------------------------
-- 1. Append-only: a posted ticket entry is never updated or deleted. Reuses the
--    shared fayr_forbid_mutation() created in the wallet guards migration.
CREATE TRIGGER ticket_entries_append_only
  BEFORE UPDATE OR DELETE ON "ticket_entries"
  FOR EACH ROW EXECUTE FUNCTION fayr_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. Non-negative balance: at COMMIT, a user's ticket balance (SUM of delta)
--    must never be below zero. The application already checks this under a
--    per-user row lock (for a clean error + exact balanceAfter); this DEFERRED
--    constraint trigger is the independent backstop for any path that doesn't.
CREATE OR REPLACE FUNCTION fayr_ticket_balance_nonnegative() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  balance INT;
BEGIN
  SELECT COALESCE(SUM(delta), 0) INTO balance
    FROM "ticket_entries" WHERE "userId" = NEW."userId";

  IF balance < 0 THEN
    RAISE EXCEPTION
      'ticket balance for user % would go negative (% tickets)',
      NEW."userId", balance USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ticket_entries_nonnegative
  AFTER INSERT ON "ticket_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fayr_ticket_balance_nonnegative();
