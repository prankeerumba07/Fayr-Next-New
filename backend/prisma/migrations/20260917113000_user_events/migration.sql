-- CreateEnum
CREATE TYPE "UserEventType" AS ENUM ('APP_OPENED', 'ONBOARDING_DONE', 'PHONE_ENTRY_SEEN', 'OTP_REQUESTED', 'OTP_VERIFIED', 'ACCOUNT_CREATED', 'SETUP_STEP_DONE', 'SETUP_DONE', 'FEED_OPENED', 'FIRST_CLAIM', 'LOGGED_OUT', 'SESSION_RENEWED');

-- CreateTable
CREATE TABLE "user_events" (
    "id" UUID NOT NULL,
    "type" "UserEventType" NOT NULL,
    "userId" UUID,
    "anonymousId" TEXT,
    "payload" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_events_type_at_idx" ON "user_events"("type", "at");

-- CreateIndex
CREATE INDEX "user_events_userId_at_idx" ON "user_events"("userId", "at");

-- CreateIndex
CREATE INDEX "user_events_anonymousId_at_idx" ON "user_events"("anonymousId", "at");

-- AddForeignKey
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
