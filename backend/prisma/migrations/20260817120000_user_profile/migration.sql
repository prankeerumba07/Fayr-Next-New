-- The first-run setup sequence (age band, gender, shopping categories, the
-- marketplaces they already use, and what to call them) had nowhere to be saved:
-- `users` held only identity and payout fields.
--
-- Every column is NULLABLE, and the array columns default to empty. That is
-- deliberate: an account is fully usable before setup runs, and a user who skips
-- or abandons the sequence must never be locked out or left in a half-state.
--
-- `setupDoneAt` — not a non-null name — is what marks the sequence complete, so
-- someone who finishes setup without giving a name is not asked again.
--
-- No age is stored, only a BAND. We have no use for a date of birth, so we do
-- not collect one.

ALTER TABLE "users"
  ADD COLUMN "name"        TEXT,
  ADD COLUMN "ageBand"     TEXT,
  ADD COLUMN "gender"      TEXT,
  ADD COLUMN "categories"  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "platforms"   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "setupDoneAt" TIMESTAMP(3);
