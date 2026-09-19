-- THE BILL LINES THE PAGE PRINTED, BESIDE THE ORDER THEY WERE PRINTED ON.
--
-- Phase 8B-a, 19 September 2026. A refund on a purchase Fayr watched is paid on
-- what the person paid FOR THAT PRODUCT, capped at what the offer listed. Three
-- figures are needed to work that out honestly and to be able to explain it
-- afterwards, and all three were being read by the parser and then dropped:
--
--   itemTotalPaise     what the products alone came to
--   feesPaise          delivery, handling and shipping, added up. ZERO is a real
--                      answer; NULL means the page named no such line at all
--   billDiscountPaise  a discount taken off the whole bill, as a positive figure
--
-- ADDITIVE AND NULLABLE, so every row already written keeps saying exactly what
-- it said. Nothing backfills them: the pages those rows were read from are gone,
-- and inventing a figure for a row nobody can re-read is the one thing a money
-- column must never do.
--
-- NOT MONEY THAT MOVES. The refund base is built from the product's own price in
-- `items`, and engine/watched-price.ts is the only reader of these three.
ALTER TABLE "order_candidates" ADD COLUMN "itemTotalPaise" BIGINT;
ALTER TABLE "order_candidates" ADD COLUMN "feesPaise" BIGINT;
ALTER TABLE "order_candidates" ADD COLUMN "billDiscountPaise" BIGINT;
