-- An answer the ASSISTANT drafted, as opposed to one a person wrote or one that
-- shipped with the app.
--
-- Why this is worth its own value rather than being inferred from "it shipped and
-- it is still a draft": the staff screen has to tell somebody, in words, that no
-- human has read these yet. A screen that works that out from two other fields is
-- a screen that quietly stops saying it the first time either field changes
-- meaning. This is the one fact it needs, stored as a fact.
ALTER TYPE "AnswerOrigin" ADD VALUE IF NOT EXISTS 'ASSISTANT' AFTER 'SEED';
