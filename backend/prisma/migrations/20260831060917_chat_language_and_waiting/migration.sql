-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "chosenLanguage" TEXT,
ADD COLUMN     "languageOfferedAt" TIMESTAMP(3),
ADD COLUMN     "waitingNoteSentAt" TIMESTAMP(3);

-- A conversation can only be held in a language the assistant actually has
-- words for. Anything else would mean choosing a language and then being
-- answered in English anyway, with nothing saying why.
ALTER TABLE "chats" ADD CONSTRAINT "chats_language_is_one_we_have"
  CHECK ("chosenLanguage" IS NULL OR "chosenLanguage" IN ('en', 'hi', 'hi-en'));
