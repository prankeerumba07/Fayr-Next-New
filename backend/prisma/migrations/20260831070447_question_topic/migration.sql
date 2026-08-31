-- AlterTable
ALTER TABLE "assistant_questions" ADD COLUMN     "topic" TEXT;

-- CreateIndex
CREATE INDEX "assistant_questions_answerOrigin_askedAt_idx" ON "assistant_questions"("answerOrigin", "askedAt");
