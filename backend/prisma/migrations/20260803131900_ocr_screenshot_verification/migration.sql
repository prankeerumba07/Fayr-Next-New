-- CreateEnum
CREATE TYPE "ScreenshotKind" AS ENUM ('PURCHASE', 'DELIVERY', 'REVIEW');

-- CreateEnum
CREATE TYPE "EvidenceSubmissionStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'APPROVED', 'REJECTED', 'NEEDS_MORE');

-- CreateEnum
CREATE TYPE "EvidenceVerdict" AS ENUM ('MATCH', 'PARTIAL', 'MISMATCH', 'UNKNOWN');

-- CreateTable
CREATE TABLE "screenshot_uploads" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ScreenshotKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "screenshot_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_submissions" (
    "id" UUID NOT NULL,
    "screenshotUploadId" UUID NOT NULL,
    "status" "EvidenceSubmissionStatus" NOT NULL DEFAULT 'UPLOADED',
    "model" TEXT,
    "extraction" JSONB,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costMicroUsd" INTEGER,
    "error" TEXT,
    "match" JSONB,
    "verdict" "EvidenceVerdict",
    "confidence" INTEGER,
    "reviewedByStaffId" UUID,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screenshot_uploads_sha256_idx" ON "screenshot_uploads"("sha256");

-- CreateIndex
CREATE INDEX "screenshot_uploads_taskId_idx" ON "screenshot_uploads"("taskId");

-- CreateIndex
CREATE INDEX "screenshot_uploads_userId_idx" ON "screenshot_uploads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_submissions_screenshotUploadId_key" ON "evidence_submissions"("screenshotUploadId");

-- CreateIndex
CREATE INDEX "evidence_submissions_status_createdAt_idx" ON "evidence_submissions"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "screenshot_uploads" ADD CONSTRAINT "screenshot_uploads_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshot_uploads" ADD CONSTRAINT "screenshot_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_submissions" ADD CONSTRAINT "evidence_submissions_screenshotUploadId_fkey" FOREIGN KEY ("screenshotUploadId") REFERENCES "screenshot_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

