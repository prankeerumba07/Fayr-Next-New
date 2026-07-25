-- Phase 1.2 — database-level guards for the wallet ledger.
--
-- These are the ledger's SECOND, independent line of defense: they hold even if
-- a future writer bypasses WalletService. Prisma can't model triggers/functions,
-- so this is a hand-authored, raw-SQL-only migration (it changes no table shape,
-- so it introduces no schema drift — Prisma ignores triggers/functions entirely).
--
-- Column names are Prisma's quoted camelCase ("amountPaise", "transactionId").

-- ---------------------------------------------------------------------------
-- 1. Append-only: a posted ledger row is NEVER updated or deleted. Corrections
--    are new, balancing entries — never edits of history.
CREATE OR REPLACE FUNCTION fayr_forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only ledger: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER wallet_entries_append_only
  BEFORE UPDATE OR DELETE ON "wallet_entries"
  FOR EACH ROW EXECUTE FUNCTION fayr_forbid_mutation();

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION fayr_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. Balanced double-entry: at COMMIT, every transaction's legs must number at
--    least 2 and sum to exactly 0 (debits == credits). A DEFERRED constraint
--    trigger is what lets all legs be inserted first and checked once at commit;
--    it also means legs can only ever be written inside a single transaction
--    (inserting them one-per-autocommit fails the first, unbalanced, commit).
CREATE OR REPLACE FUNCTION fayr_wallet_txn_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  leg_count INT;
  leg_sum   BIGINT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM("amountPaise"), 0)
    INTO leg_count, leg_sum
    FROM "wallet_entries"
    WHERE "transactionId" = NEW."transactionId";

  IF leg_count < 2 THEN
    RAISE EXCEPTION
      'ledger transaction % has % leg(s); double-entry requires at least 2',
      NEW."transactionId", leg_count USING ERRCODE = 'check_violation';
  END IF;

  IF leg_sum <> 0 THEN
    RAISE EXCEPTION
      'ledger transaction % is unbalanced: legs sum to % paise (must be 0)',
      NEW."transactionId", leg_sum USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_entries_balanced
  AFTER INSERT ON "wallet_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fayr_wallet_txn_balanced();
