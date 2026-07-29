-- CreateEnum
CREATE TYPE "PayoutMethodType" AS ENUM ('UPI', 'BANK');

-- CreateEnum
CREATE TYPE "PayoutMethodStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pan" TEXT;

-- CreateTable
CREATE TABLE "payout_methods" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "PayoutMethodType" NOT NULL,
    "upiId" TEXT,
    "bankAccount" TEXT,
    "ifsc" TEXT,
    "accountName" TEXT,
    "status" "PayoutMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "payoutMethodId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "reserveTxnId" UUID,
    "reversalTxnId" UUID,
    "utr" TEXT,
    "failureReason" TEXT,
    "decidedByStaffId" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_methods_userId_idx" ON "payout_methods"("userId");

-- CreateIndex
CREATE INDEX "payout_methods_upiId_idx" ON "payout_methods"("upiId");

-- CreateIndex
CREATE INDEX "payout_methods_bankAccount_ifsc_idx" ON "payout_methods"("bankAccount", "ifsc");

-- CreateIndex
CREATE INDEX "withdrawals_userId_requestedAt_idx" ON "withdrawals"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_pan_key" ON "users"("pan");

-- AddForeignKey
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payoutMethodId_fkey" FOREIGN KEY ("payoutMethodId") REFERENCES "payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

