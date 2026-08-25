-- WHICH LINE of the order a task is about.
--
-- The one-purchase-one-refund gate was keyed on (platform, orderId) alone, which
-- is wrong in both directions: a merged cart is two real products under one order
-- number (both legitimate tasks, every one needing a staff override), and two
-- claims on the SAME line — the actual fraud — looked identical to it.
ALTER TABLE "tasks" ADD COLUMN     "itemId" TEXT;

-- Backfill from the evidence JSONB, exactly as the orderId migration did. The
-- gate reads this column and not the JSONB, so a NULL left here would keep every
-- existing task in the coarse, order-level world for no reason.
--
-- Only rows that actually carry a stated line id are touched. Nothing is
-- inferred: a task whose evidence names no line stays NULL, which the gate reads
-- as "cannot prove these are different lines" and holds.
UPDATE "tasks"
   SET "itemId" = "evidence" -> 'order' ->> 'itemId'
 WHERE "evidence" -> 'order' ->> 'itemId' IS NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_platform_itemId_idx" ON "tasks"("platform", "itemId");
