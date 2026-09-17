-- THEY TAPPED THROUGH TO WRITE THE REVIEW, RECORDED ON OUR OWN SIDE.
--
-- REVIEW-FLOW-PROMPT.md step fourteen asks for the review visit on the record
-- rather than only on the phone, in the same way the shop visit for buying
-- already is. Nullable, because every row that exists today predates it and
-- "we never recorded one" is the truth about all of them.
ALTER TABLE "tasks" ADD COLUMN "wentToReviewAt" TIMESTAMP(3);
