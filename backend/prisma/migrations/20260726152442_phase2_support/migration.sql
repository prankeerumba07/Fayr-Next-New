-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "support_questions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_replies" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "staffUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_questions_userId_createdAt_idx" ON "support_questions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_questions_status_createdAt_idx" ON "support_questions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "support_replies_questionId_createdAt_idx" ON "support_replies"("questionId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_questions" ADD CONSTRAINT "support_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_replies" ADD CONSTRAINT "support_replies_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "support_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_replies" ADD CONSTRAINT "support_replies_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

