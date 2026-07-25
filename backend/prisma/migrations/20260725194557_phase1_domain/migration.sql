-- Phase 1 — domain schema: campaigns, tasks (+ event log, visibility checks),
-- the double-entry wallet ledger, and the ticket ledger. Plus the human-friendly
-- User.displayId (FAYR-1000xx).
--
-- Two statements below are HAND-ADDED to the Prisma diff (Prisma can't model
-- them) and are load-bearing — do not drop them:
--   1. CREATE SEQUENCE user_display_seq  — backs the displayId default. Starts at
--      an OFFSET (100001) so the value never reveals signup order/count, and is
--      OWNED BY the column so it drops with it.
--   2. wallet_accounts unique index uses NULLS NOT DISTINCT — so the system
--      accounts (userId = NULL) are enforced as singletons at the DB level, not
--      merely by application convention.

-- Sequence backing User.displayId (must exist before the users ALTER below).
CREATE SEQUENCE "user_display_seq" START WITH 100001;

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('AMAZON', 'FLIPKART', 'MEESHO', 'MYNTRA', 'BLINKIT', 'ZEPTO', 'INSTAMART');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('CLAIMED', 'PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WalletAccountKind" AS ENUM ('USER', 'HOUSE', 'PAYOUT');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('REFUND', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TicketReason" AS ENUM ('SIGNUP_GRANT', 'CLAIM', 'EXPIRY_RETURN', 'COMPLETION_RETURN', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "displayId" TEXT NOT NULL DEFAULT ('FAYR-' || lpad(nextval('user_display_seq'::regclass)::text, 6, '0'));

-- Tie the sequence's lifetime to the column it feeds.
ALTER SEQUENCE "user_display_seq" OWNED BY "users"."displayId";

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'AMAZON',
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "category" TEXT,
    "productPricePaise" BIGINT NOT NULL,
    "payoutPercent" INTEGER NOT NULL DEFAULT 100,
    "payoutCapPaise" BIGINT,
    "ticketCost" INTEGER NOT NULL DEFAULT 5,
    "returnWindowDays" INTEGER,
    "minRating" INTEGER,
    "totalSlots" INTEGER,
    "asin" TEXT,
    "productUrl" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'CLAIMED',
    "category" TEXT,
    "targetAsin" TEXT,
    "targetProduct" TEXT,
    "targetReviewId" TEXT,
    "returned" BOOLEAN,
    "itemPaise" BIGINT,
    "deliveredAt" TIMESTAMP(3),
    "reviewPublished" BOOLEAN,
    "windowEndsAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "blocker" TEXT,
    "blockerReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromState" "TaskState" NOT NULL,
    "toState" "TaskState" NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_checks" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "published" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "visibility_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" UUID NOT NULL,
    "kind" "WalletAccountKind" NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "TicketReason" NOT NULL,
    "taskId" UUID,
    "balanceAfter" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_platform_status_idx" ON "campaigns"("platform", "status");

-- CreateIndex
CREATE INDEX "tasks_userId_state_idx" ON "tasks"("userId", "state");

-- CreateIndex
CREATE INDEX "tasks_campaignId_idx" ON "tasks"("campaignId");

-- CreateIndex
CREATE INDEX "tasks_state_windowEndsAt_idx" ON "tasks"("state", "windowEndsAt");

-- CreateIndex
CREATE INDEX "tasks_state_claimExpiresAt_idx" ON "tasks"("state", "claimExpiresAt");

-- CreateIndex
CREATE INDEX "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "task_events_taskId_idempotencyKey_key" ON "task_events"("taskId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "visibility_checks_taskId_checkedAt_idx" ON "visibility_checks"("taskId", "checkedAt");

-- CreateIndex
-- NULLS NOT DISTINCT (Postgres 15+): with userId NULL for system accounts, this
-- enforces exactly one HOUSE and one PAYOUT account, alongside one USER account
-- per user. A plain unique index would let duplicate system accounts slip in
-- (NULLs are distinct by default).
CREATE UNIQUE INDEX "wallet_accounts_userId_kind_key" ON "wallet_accounts"("userId", "kind") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transactions_referenceType_referenceId_idx" ON "ledger_transactions"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "wallet_entries_accountId_idx" ON "wallet_entries"("accountId");

-- CreateIndex
CREATE INDEX "wallet_entries_transactionId_idx" ON "wallet_entries"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_entries_idempotencyKey_key" ON "ticket_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ticket_entries_userId_createdAt_idx" ON "ticket_entries"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_displayId_key" ON "users"("displayId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visibility_checks" ADD CONSTRAINT "visibility_checks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_entries" ADD CONSTRAINT "ticket_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
