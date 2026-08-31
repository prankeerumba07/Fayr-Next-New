-- CreateEnum
CREATE TYPE "ChatState" AS ENUM ('ASSISTANT', 'WAITING_FOR_PERSON', 'TAKEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMessageAuthor" AS ENUM ('PERSON', 'ASSISTANT', 'AGENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "assistant_questions" ADD COLUMN     "chatId" UUID;

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "state" "ChatState" NOT NULL DEFAULT 'ASSISTANT',
    "takenByStaffId" UUID,
    "takenAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "author" "ChatMessageAuthor" NOT NULL,
    "staffUserId" UUID,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "assistantQuestionId" UUID,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chats_state_handedOverAt_idx" ON "chats"("state", "handedOverAt");

-- CreateIndex
CREATE INDEX "chats_userId_lastMessageAt_idx" ON "chats"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chats_takenByStaffId_lastMessageAt_idx" ON "chats"("takenByStaffId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_messages_chatId_sentAt_idx" ON "chat_messages"("chatId", "sentAt");

-- CreateIndex
CREATE INDEX "chat_messages_assistantQuestionId_idx" ON "chat_messages"("assistantQuestionId");

-- CreateIndex
CREATE INDEX "assistant_questions_chatId_askedAt_idx" ON "assistant_questions"("chatId", "askedAt");

-- AddForeignKey
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_assistantQuestionId_fkey" FOREIGN KEY ("assistantQuestionId") REFERENCES "assistant_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules the code must not be able to break, written where the code cannot
-- reach them. Every one of these is a real mistake that would otherwise be a
-- quiet wrong answer on a screen rather than a loud refusal here.
-- ─────────────────────────────────────────────────────────────────────────────

-- A conversation somebody has taken must say who took it and when. "Taken by
-- nobody" is the state that makes the only-that-agent-may-reply rule unenforceable.
ALTER TABLE "chats" ADD CONSTRAINT "chats_taken_has_an_owner"
  CHECK ("state" <> 'TAKEN' OR ("takenByStaffId" IS NOT NULL AND "takenAt" IS NOT NULL));

-- A conversation in the queue must say when it got there, or nobody can be told
-- how long it has been waiting.
ALTER TABLE "chats" ADD CONSTRAINT "chats_waiting_has_a_since"
  CHECK ("state" <> 'WAITING_FOR_PERSON' OR "handedOverAt" IS NOT NULL);

-- Closed means closed at a time.
ALTER TABLE "chats" ADD CONSTRAINT "chats_closed_has_a_when"
  CHECK ("state" <> 'CLOSED' OR "closedAt" IS NOT NULL);

-- A message from a member of staff must name them. An unattributed reply is
-- worse than no reply: it is a promise nobody can be asked about.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_agent_is_named"
  CHECK ("author" <> 'AGENT' OR "staffUserId" IS NOT NULL);

-- And nothing else may carry a member of staff's name, so a shopper's own words
-- can never be shown as though Fayr said them.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_only_agents_are_named"
  CHECK ("author" = 'AGENT' OR "staffUserId" IS NULL);

-- An empty message is not a message.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_not_empty"
  CHECK (length(btrim("body")) > 0);
