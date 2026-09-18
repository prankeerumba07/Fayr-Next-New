-- THE REVIEW A PERSON WROTE INSIDE FAYR.
--
-- Zepto, Blinkit and Swiggy Instamart have no review form -- all they take is a
-- private star rating on the order, which nobody but the buyer can ever see. So
-- for those shops the written review is written in Fayr and stays in Fayr. The
-- shop gets the stars; the descriptive feedback is what a brand is paying for,
-- and until now there was nowhere to put it.
--
-- ITS OWN TABLE, NOT COLUMNS ON "tasks". The promoted columns on that table are
-- projections of the evidence JSONB, kept in sync on every write. This is not
-- that: it is new primary data in somebody's own words, it is read far less
-- often than a task row, and there is no reason for every feed query to carry a
-- paragraph of text it will not use.
--
-- ONE PER TASK, by a unique index rather than by convention. A review is
-- evidence about ONE purchase of ONE campaign; a second row for the same task
-- would be two opinions with no way to say which is theirs.
--
-- ON DELETE CASCADE, because a review about a task that no longer exists is a
-- paragraph of somebody's writing with nothing to attach it to.
--
-- AND NOTHING HERE MOVES MONEY. No refund, no state, no wallet entry reads this
-- table. The refund still waits on the shop's own page saying the rating is
-- still there after the return window closes.
CREATE TABLE "task_reviews" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    -- EXACTLY WHAT THEY TYPED. TEXT and not VARCHAR(n): a length limit here
    -- would be the database quietly deciding a review was long enough.
    "text" TEXT NOT NULL,
    -- How DESCRIPTIVE it is, 0-100, never how positive. Worked out by the server
    -- from the text beside it.
    "score" INTEGER NOT NULL,
    -- The same answer in a word, stored because the band is what the person was
    -- actually shown and a later change to the band edges must not rewrite that.
    "band" TEXT NOT NULL,
    "writtenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_reviews_taskId_key" ON "task_reviews"("taskId");

ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
