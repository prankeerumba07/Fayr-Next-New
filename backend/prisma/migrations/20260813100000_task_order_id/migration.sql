-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "orderId" TEXT;

-- Backfill from the evidence JSONB so existing tasks participate in the gate
-- immediately. The refund gate reads this column, not the JSONB, and a NULL here
-- would silently exempt every task that already has an order.
UPDATE "tasks"
   SET "orderId" = "evidence" -> 'order' ->> 'id'
 WHERE "evidence" -> 'order' ->> 'id' IS NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_platform_orderId_idx" ON "tasks"("platform", "orderId");
