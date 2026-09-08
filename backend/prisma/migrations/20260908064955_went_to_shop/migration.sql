-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "shopHoldEndsAt" TIMESTAMP(3),
ADD COLUMN     "shopVisitNoticeText" TEXT,
ADD COLUMN     "wentToShopAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_state_shopHoldEndsAt_idx" ON "tasks"("state", "shopHoldEndsAt");
