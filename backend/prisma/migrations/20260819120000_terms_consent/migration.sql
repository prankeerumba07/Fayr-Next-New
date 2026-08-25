-- Consent has to be provable: what was agreed to, which version, and when.
-- Nullable because a user row exists before they have consented to anything, and
-- because backfilling a fake acceptance would be worse than having none.
ALTER TABLE "users" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
