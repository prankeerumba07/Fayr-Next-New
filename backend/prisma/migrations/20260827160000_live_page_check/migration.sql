-- The live page check: whether an offer's real shop page opens the way a shopper
-- would see it. Separate from the nightly offer check, which only reads Fayr's own
-- records.
--
-- The two columns on campaigns are a PROJECTION of the newest run, so the app's
-- feed can draw a greyed-out card without joining to a history table. The runs are
-- the record; the columns are the shortcut.


-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "liveCheckedAt" TIMESTAMP(3),
ADD COLUMN     "liveState" TEXT;

-- CreateTable
CREATE TABLE "live_page_check_runs" (
    "id" UUID NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedByStaffId" UUID NOT NULL,
    "checked" INTEGER NOT NULL,
    "opened" INTEGER NOT NULL,
    "expired" INTEGER NOT NULL,
    "soldOut" INTEGER NOT NULL,
    "unavailable" INTEGER NOT NULL,
    "couldNotOpen" INTEGER NOT NULL,
    "noLink" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,

    CONSTRAINT "live_page_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_page_check_runs_ranAt_idx" ON "live_page_check_runs"("ranAt");


-- The state has to be one of the six the code knows about. A seventh would mean
-- the app quietly ignores it and the offer silently stays on the feed.
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_live_state_known"
  CHECK ("liveState" IS NULL OR "liveState" IN
    ('opened','expired','sold-out','unavailable','could-not-open','no-link'));

-- A state with no date is unreadable: nothing can tell a look from this morning
-- from one nobody remembers taking.
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_live_state_needs_a_date"
  CHECK (("liveState" IS NULL) = ("liveCheckedAt" IS NULL));
