-- CreateTable
CREATE TABLE "campaign_check_runs" (
    "id" UUID NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "checked" INTEGER NOT NULL,
    "blocking" INTEGER NOT NULL,
    "attention" INTEGER NOT NULL,
    "unchecked" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,

    CONSTRAINT "campaign_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_check_runs_ranAt_idx" ON "campaign_check_runs"("ranAt");
