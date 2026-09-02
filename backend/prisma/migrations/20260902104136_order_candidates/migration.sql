-- CreateEnum
CREATE TYPE "OrderCandidateSource" AS ENUM ('ORDER_LIST', 'SCREENSHOT', 'HAND_TYPED');

-- CreateTable
CREATE TABLE "order_candidates" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "OrderCandidateSource" NOT NULL DEFAULT 'ORDER_LIST',
    "orderNumber" TEXT,
    "orderDate" TIMESTAMP(3),
    "totalPaise" BIGINT,
    "items" JSONB NOT NULL,
    "shipments" INTEGER NOT NULL DEFAULT 0,
    "matches" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "chosenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_candidates_taskId_matches_idx" ON "order_candidates"("taskId", "matches");

-- CreateIndex
CREATE UNIQUE INDEX "order_candidates_taskId_position_key" ON "order_candidates"("taskId", "position");

-- AddForeignKey
ALTER TABLE "order_candidates" ADD CONSTRAINT "order_candidates_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
