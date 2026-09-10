-- CARRY THE DELIVERY THROUGH, WITHOUT REWRITING ONE EXISTING ROW.
--
-- An order's own page states the day it arrived and whether it was sent back,
-- and both were being dropped: the reader read them and there was nowhere to
-- put them.
--
-- ADDITIVE, NULLABLE, NO DEFAULT — all three on purpose. Every candidate read
-- before today was read without these fields, and a default would write an
-- answer into rows nobody ever looked at. NULL here means "the page did not
-- say", which is exactly what is true of every existing row.
ALTER TABLE "order_candidates" ADD COLUMN "deliveryDate" TIMESTAMP(3);
ALTER TABLE "order_candidates" ADD COLUMN "returned" BOOLEAN;
