-- Phase 1 of the assistant — the answer book, and the record of every real
-- question. Three tables: the answers people read, the many wordings that lead to
-- one of them, and what a real person typed plus what we said back.
--
-- Everything below the Prisma-generated section is hand-written and cannot be
-- expressed in schema.prisma: two search index families and five CHECK
-- constraints. Prisma does not model either, so there is no schema drift — the
-- same arrangement as the wallet and ticket ledger guards.


-- CreateEnum
CREATE TYPE "AnswerStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AnswerOrigin" AS ENUM ('SEED', 'STAFF');

-- CreateEnum
CREATE TYPE "AssistantAnswerOrigin" AS ENUM ('ANSWER_BOOK', 'MODEL', 'STAFF', 'NONE');

-- CreateEnum
CREATE TYPE "AssistantQuestionStatus" AS ENUM ('ANSWERED', 'UNRESOLVED', 'RESOLVED');

-- CreateTable
CREATE TABLE "answer_entries" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "AnswerStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "AnswerOrigin" NOT NULL DEFAULT 'SEED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByStaffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answer_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_phrases" (
    "id" UUID NOT NULL,
    "answerEntryId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_phrases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_questions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rawText" TEXT NOT NULL,
    "detectedLanguage" TEXT NOT NULL,
    "languageConfidence" INTEGER NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answerEntryId" UUID,
    "answerText" TEXT,
    "answerOrigin" "AssistantAnswerOrigin" NOT NULL DEFAULT 'NONE',
    "matchScore" INTEGER,
    "answerRevision" INTEGER,
    "status" "AssistantQuestionStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "helpful" BOOLEAN,
    "helpfulAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" UUID,
    "journey" JSONB,

    CONSTRAINT "assistant_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "answer_entries_status_language_idx" ON "answer_entries"("status", "language");

-- CreateIndex
CREATE INDEX "answer_entries_topic_idx" ON "answer_entries"("topic");

-- CreateIndex
CREATE UNIQUE INDEX "answer_entries_key_language_key" ON "answer_entries"("key", "language");

-- CreateIndex
CREATE INDEX "answer_phrases_answerEntryId_idx" ON "answer_phrases"("answerEntryId");

-- CreateIndex
CREATE INDEX "answer_phrases_language_idx" ON "answer_phrases"("language");

-- CreateIndex
CREATE INDEX "assistant_questions_status_askedAt_idx" ON "assistant_questions"("status", "askedAt");

-- CreateIndex
CREATE INDEX "assistant_questions_userId_askedAt_idx" ON "assistant_questions"("userId", "askedAt");

-- CreateIndex
CREATE INDEX "assistant_questions_answerEntryId_idx" ON "assistant_questions"("answerEntryId");

-- CreateIndex
CREATE INDEX "assistant_questions_askedAt_idx" ON "assistant_questions"("askedAt");

-- AddForeignKey
ALTER TABLE "answer_phrases" ADD CONSTRAINT "answer_phrases_answerEntryId_fkey" FOREIGN KEY ("answerEntryId") REFERENCES "answer_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_answerEntryId_fkey" FOREIGN KEY ("answerEntryId") REFERENCES "answer_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- SEARCHING WITHOUT READING EVERY ROW
-- ===========================================================================
--
-- There are a handful of answers today. In a year there will be thousands, and
-- the matching may never read them all to find one. These indexes are what makes
-- that true, and they are the reason this stays inside Postgres instead of
-- needing a second service.
--
-- Two different kinds, because they fail in different places:
--
--   WORDS (full text). Splits the text into words and indexes each. Finds
--   "refund not received" from "my refund has not been received yet". Useless
--   against a typo: "refnud" shares no word with anything.
--
--   NEAR-MISSES (trigram). Indexes every run of three letters, so "refnud"
--   still overlaps "refund" heavily. This is what carries the questions people
--   actually type on a phone.
--
-- WHY 'simple' AND NOT 'english': the english configuration stems words and
-- throws away English stop words. Most of our questions are Hindi typed in
-- English letters, where stemming does nothing useful and stop-word removal
-- deletes words that carry the meaning. 'simple' only lowercases and splits,
-- which behaves the same way in all three languages, and it keeps Devanagari
-- text as words instead of discarding it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "answer_phrases_words_idx"
  ON "answer_phrases" USING GIN (to_tsvector('simple', "text"));

CREATE INDEX "answer_entries_words_idx"
  ON "answer_entries" USING GIN (to_tsvector('simple', "title" || ' ' || "body"));

CREATE INDEX "answer_phrases_near_misses_idx"
  ON "answer_phrases" USING GIN ("text" gin_trgm_ops);

-- ===========================================================================
-- WHAT THE DATABASE ITSELF REFUSES
-- ===========================================================================
--
-- The service validates all of this and returns a clean error. These are the
-- backstop for any writer that does not go through it — the same reasoning as the
-- ledger guards: a rule that only exists in one function is a rule until somebody
-- writes a second function.

-- A guess is a percentage. Anything outside 0-100 is a bug, not a low score.
ALTER TABLE "assistant_questions"
  ADD CONSTRAINT "assistant_questions_language_confidence_range"
  CHECK ("languageConfidence" BETWEEN 0 AND 100);

ALTER TABLE "assistant_questions"
  ADD CONSTRAINT "assistant_questions_match_score_range"
  CHECK ("matchScore" IS NULL OR "matchScore" BETWEEN 0 AND 100);

-- An empty question is not a question. Storing one would put a blank row in the
-- queue that no person could ever action.
ALTER TABLE "assistant_questions"
  ADD CONSTRAINT "assistant_questions_raw_text_present"
  CHECK (length(btrim("rawText")) > 0);

-- An answer with no words in it would be returned to a real person.
ALTER TABLE "answer_entries"
  ADD CONSTRAINT "answer_entries_body_present"
  CHECK (length(btrim("body")) > 0 AND length(btrim("title")) > 0);

-- Revisions count up from the first wording.
ALTER TABLE "answer_entries"
  ADD CONSTRAINT "answer_entries_revision_positive"
  CHECK ("revision" >= 1);
