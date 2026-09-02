import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage } from '@prisma/client';
import { AnswerEngine } from '../assistant/answer-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectLanguage } from '../assistant/language';
import { plainLanguageProblems } from '../assistant/plain-language';
import {
  ChatError,
  ChatNotFoundError,
  ChatStore,
  type ChatWithMessages,
  type QueueFilter,
  type QueuePage,
} from './chat.store';
import {
  checkMessage,
  mayReply,
  mayTake,
  type StaffFacts,
} from './chat.rules';
import { AssistantStore } from '../assistant/assistant.store';
import { draftEmail, type Draft } from './email-draft';
import {
  keyFromQuestion,
  whatToWriteNext,
  type ToWrite,
} from './what-to-write-next';
import { OPENING_QUESTIONS, type OpeningQuestion } from './opening-questions';
import {
  LANGUAGE_CHOSEN,
  LANGUAGE_OFFER,
  STILL_WAITING,
  SUPPORT_EMAIL,
  WAITING_NOTE_AFTER_MS,
  greetingFor,
  handOverWords,
  isOnlyAGreeting,
  languageChoiceFrom,
  saysTheyDoNotUnderstand,
} from './chat-words';

/** What happened when somebody said something. */
export interface SaidResult {
  chat: ChatWithMessages;
  /** The message that was written down for what they typed. */
  theirs: ChatMessage;
  /** What Fayr said back, when the assistant was the one handling it. */
  reply: ChatMessage | null;
}

/** What is wrong with the way a reply is written, if anything. */
export interface ReplyWarnings {
  ok: boolean;
  problems: string[];
}

/**
 * A CONVERSATION, WITH BOTH SIDES ABLE TO SPEAK.
 *
 * Before this, a question went in and an answer came back and that was the end of
 * it. Nobody at Fayr could say anything, and the shopper could not say "that is
 * not what I meant" — every message started a new question with no memory of the
 * last one.
 *
 * ONE FUNNEL, NOT TWO. Everything a shopper types goes through say() below,
 * whichever door it came in at, and everything a member of staff types goes
 * through reply(). The assistant is not a separate system that happens to write
 * to the same table: it is what say() does when nobody has taken the conversation
 * yet.
 *
 * THE QUESTION RECORD IS UNCHANGED AND STILL THE THING WE LEARN FROM. Every
 * shopper message still becomes an AssistantQuestion, still snapshotted with what
 * they were doing, still counted in the answer book's statistics. The conversation
 * is a layer on top of that record, never instead of it.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly store: ChatStore,
    private readonly engine: AnswerEngine,
    private readonly prisma: PrismaService,
    private readonly book: AssistantStore,
  ) {}

  /**
   * A shopper says something.
   *
   * WHO ANSWERS DEPENDS ON WHO HAS IT. While the assistant is handling the
   * conversation it answers; once a person has taken it, or it is waiting for
   * one, the assistant stays quiet. Two replies to one message — one from the
   * answer book and one from a person, minutes apart, possibly disagreeing — is
   * the failure this rule exists to prevent.
   */
  async say(userId: string, text: string): Promise<SaidResult> {
    const checked = checkMessage(text);
    if (!checked.ok) throw new ChatError(checked.reason as string);

    const chat = await this.store.openChatFor(userId);
    const theirLanguage = detectLanguage(checked.body).language;

    // WHICH LANGUAGE WE ANSWER IN. English until this person says otherwise, and
    // then whatever they said, for the rest of the conversation. A decision, not
    // a fallback: replying in a language somebody did not ask for reads as a
    // machine guessing at them, and guessing wrong is worse than asking.
    const replyIn = chat.chosenLanguage ?? 'en';

    if (chat.state !== 'ASSISTANT') {
      // A person has it, or is about to. Write it down and leave it for them.
      const theirs = await this.store.addMessage({
        chatId: chat.id,
        author: 'PERSON',
        body: checked.body,
        language: theirLanguage,
      });
      return { chat: await this.after(chat.id), theirs, reply: null };
    }

    const theirs = await this.store.addMessage({
      chatId: chat.id,
      author: 'PERSON',
      body: checked.body,
      language: theirLanguage,
    });

    // ── they are picking a language we offered ──────────────────────────────
    const offered = chat.languageOfferedAt !== null && chat.chosenLanguage === null;
    if (offered) {
      const picked = languageChoiceFrom(checked.body);
      if (picked) {
        await this.store.rememberLanguage(chat.id, picked);
        const reply = await this.store.addMessage({
          chatId: chat.id,
          author: 'ASSISTANT',
          body: LANGUAGE_CHOSEN[picked],
          language: picked,
        });
        return { chat: await this.after(chat.id), theirs, reply };
      }
    }

    // ── it is only a greeting ───────────────────────────────────────────────
    //
    // Not written down as a question. "hi" in the queue of things nobody could
    // answer would bury the questions that really do need writing an answer for.
    //
    // AND IT ANSWERS WITH REAL QUESTIONS, which the owner asked for by name:
    // "whenever I say 'hi,' it should reply with basic questions and answers."
    // The four are looked up in the answer bank FIRST, and one the bank cannot
    // answer is not offered. Four questions where one dead ends is worse than
    // three that all work.
    if (isOnlyAGreeting(checked.body)) {
      const offer = await this.questionsTheBankCanAnswer();
      const reply = await this.store.addMessage({
        chatId: chat.id,
        author: 'ASSISTANT',
        body: greetingFor(this.now(), offer),
        language: 'en',
      });
      return { chat: await this.after(chat.id), theirs, reply };
    }

    // ── they cannot follow us, so offer to change language. ONCE ────────────
    if (chat.languageOfferedAt === null && chat.chosenLanguage === null) {
      const lost = saysTheyDoNotUnderstand(checked.body);
      const twiceInAnother =
        theirLanguage !== replyIn &&
        (await this.wroteInTheSameOtherLanguageBefore(chat.id, theirLanguage));
      if (lost || twiceInAnother) {
        await this.store.markLanguageOffered(chat.id);
        const reply = await this.store.addMessage({
          chatId: chat.id,
          author: 'ASSISTANT',
          // Offered in BOTH: the language we have been using, so it follows on
          // from what they were reading, and theirs, so it is readable by
          // somebody who could not follow the last thing we said. Offering it
          // only in the language they already told us they cannot read would be
          // the joke this whole rule exists to avoid.
          body:
            replyIn === theirLanguage
              ? LANGUAGE_OFFER[replyIn]
              : `${LANGUAGE_OFFER[replyIn]}\n\n${LANGUAGE_OFFER[theirLanguage] ?? ''}`.trim(),
          language: replyIn,
        });
        return { chat: await this.after(chat.id), theirs, reply };
      }
    }

    // ── an ordinary question ────────────────────────────────────────────────
    const asked = await this.engine.ask(userId, checked.body, { replyIn });

    await this.prisma.assistantQuestion
      .update({ where: { id: asked.questionId }, data: { chatId: chat.id } })
      .catch((err: unknown) => {
        const why = err instanceof Error ? err.message : String(err);
        this.log.warn(`could not attach question ${asked.questionId}: ${why}`);
      });
    await this.prisma.chatMessage.update({
      where: { id: theirs.id },
      data: { assistantQuestionId: asked.questionId },
    });

    if (asked.answered) {
      const reply = await this.store.addMessage({
        chatId: chat.id,
        author: 'ASSISTANT',
        body: asked.answer,
        language: asked.language,
        assistantQuestionId: asked.questionId,
      });
      return { chat: await this.after(chat.id), theirs, reply };
    }

    // We do not know. Say what happens next, in words that say how long and what
    // else they can do, then put it where people look.
    const reply = await this.store.addMessage({
      chatId: chat.id,
      author: 'ASSISTANT',
      body: handOverWords(replyIn, SUPPORT_EMAIL),
      language: replyIn,
      assistantQuestionId: asked.questionId,
    });
    await this.store.handOver(chat.id);
    return { chat: await this.after(chat.id), theirs, reply };
  }

  /**
   * Did they already write to us in this language, and get answered in another?
   *
   * TWICE IN A ROW, which is what makes it a signal rather than a slip. One
   * message in Hindi is somebody typing the way they think; two in a row after
   * being answered in English is somebody who cannot read what we sent back.
   */
  private async wroteInTheSameOtherLanguageBefore(
    chatId: string,
    language: string,
  ): Promise<boolean> {
    const theirs = await this.prisma.chatMessage.findMany({
      where: { chatId, author: 'PERSON' },
      orderBy: { sentAt: 'desc' },
      take: 2,
      select: { language: true },
    });
    return theirs.length === 2 && theirs.every((m) => m.language === language);
  }

  /**
   * The conversation as it now stands, with the one apology for a slow queue
   * added if it has come due.
   *
   * Checked on every read as well as every message, because somebody waiting is
   * not typing — the note has to arrive while they are sitting there looking at
   * the screen, and that is a read.
   */
  private async after(chatId: string): Promise<ChatWithMessages> {
    await this.sayItIsTakingLongerIfDue(chatId);
    return this.store.getChat(chatId);
  }

  /**
   * Send the one "this is taking longer than usual" note, if it is due.
   *
   * ONCE. The claim is a single conditional write, so two requests arriving
   * together cannot both decide it is unsent — see ChatStore.claimWaitingNote.
   * A queue that keeps apologising is worse than a quiet one.
   */
  private async sayItIsTakingLongerIfDue(chatId: string): Promise<void> {
    const notBefore = new Date(this.now().getTime() - WAITING_NOTE_AFTER_MS);
    const mine = await this.store.claimWaitingNote(chatId, notBefore);
    if (!mine) return;
    const chat = await this.store.getChat(chatId);
    const language = chat.chosenLanguage ?? 'en';
    await this.store.addMessage({
      chatId,
      author: 'SYSTEM',
      body: STILL_WAITING[language] ?? STILL_WAITING.en,
      language,
    });
  }

  /**
   * WHICH OF THE OPENING QUESTIONS THE ANSWER BANK CAN REALLY ANSWER.
   *
   * Asked before the greeting is written, so nothing is offered that dead ends.
   * A question whose answer is not published in the bank is simply left out.
   *
   * THERE IS NO SECOND SET OF ANSWERS. This reads the bank; it does not carry
   * words of its own. Tapping one of these sends its words back as an ordinary
   * message and the ordinary path answers it, with the same search and the same
   * record of what was asked.
   */
  private async questionsTheBankCanAnswer(): Promise<OpeningQuestion[]> {
    try {
      const found = await this.book.wordingsFor(
        OPENING_QUESTIONS.map((q) => q.key),
        'en',
      );
      return OPENING_QUESTIONS.filter((q) => found.has(q.key));
    } catch (err) {
      // The bank being unreachable must not stop somebody being greeted. They
      // get the greeting with no questions under it, which still asks them what
      // they need. See greetingWords.
      const why = err instanceof Error ? err.message : String(err);
      this.log.warn(`could not read the opening questions: ${why}`);
      return [];
    }
  }

  /** The clock, in one place, so a test can hold it still. */
  protected now(): Date {
    return new Date();
  }

  /**
   * THE CONVERSATION THIS PERSON IS IN RIGHT NOW, and never an older one.
   *
   * The newest, always. See ChatStore.openChatFor for why that is enough on its
   * own to keep somebody's history off their phone.
   */
  async conversationForOwner(userId: string): Promise<ChatWithMessages> {
    const chat = await this.store.openChatFor(userId);
    return this.after(chat.id);
  }

  /**
   * THEY TAPPED "CHAT WITH US". A NEW, EMPTY CONVERSATION, ALMOST ALWAYS.
   *
   * Called once when the screen opens, and never by the polling that follows it.
   * If the polling called this, a new conversation would be started every few
   * seconds and a shopper's words would disappear as they typed them.
   */
  async startScreenFor(userId: string): Promise<ChatWithMessages> {
    const chat = await this.store.startScreenFor(userId);
    return this.after(chat.id);
  }

  /**
   * Which questions in a conversation have already been answered with a yes or a
   * no. Read separately from the messages because it lives on the question row,
   * where it has always lived and where the answer book reads it from.
   */
  async helpfulByQuestion(chatId: string): Promise<Map<string, boolean | null>> {
    const rows = await this.prisma.assistantQuestion.findMany({
      where: { chatId },
      select: { id: true, helpful: true },
    });
    return new Map(rows.map((r) => [r.id, r.helpful]));
  }

  /** One of their own conversations, by name. */
  async oneForOwner(userId: string, chatId: string): Promise<ChatWithMessages> {
    return this.store.getChatForOwner(userId, chatId);
  }

  // ── the staff side ────────────────────────────────────────────────────────

  async queue(filter: QueueFilter): Promise<QueuePage> {
    // ONE PERSON'S WHOLE HISTORY, when staff ask for one person. Newest first,
    // every state including closed, so whoever is helping can read the lot.
    if (filter.userId) {
      return this.store.historyFor(filter.userId, filter.limit, filter.offset);
    }
    return this.store.listQueue(filter);
  }

  async one(chatId: string): Promise<ChatWithMessages> {
    return this.store.getChat(chatId);
  }

  /** Put a member of staff's name on a conversation. */
  async take(chatId: string, staff: StaffFacts): Promise<ChatWithMessages> {
    const chat = await this.store.getChat(chatId);
    const said = mayTake(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);
    await this.store.take(chatId, staff.id);
    return this.store.getChat(chatId);
  }

  /**
   * A member of staff replies.
   *
   * THE PLAIN LANGUAGE RULE WARNS HERE, IT DOES NOT BLOCK. An answer in the
   * answer book is read by thousands of people and is refused until it reads
   * plainly. A reply in a live conversation is read by one person who is waiting,
   * and refusing to send it because it contains a word we do not like would be
   * putting our own tidiness above answering them. So the warning goes back with
   * the reply, and the agent decides.
   */
  async reply(
    chatId: string,
    staff: StaffFacts,
    text: string,
  ): Promise<{ chat: ChatWithMessages; message: ChatMessage; warnings: ReplyWarnings }> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);

    const checked = checkMessage(text);
    if (!checked.ok) throw new ChatError(checked.reason as string);

    const language = detectLanguage(checked.body).language;
    const message = await this.store.addMessage({
      chatId,
      author: 'AGENT',
      body: checked.body,
      language,
      staffUserId: staff.id,
      assistantQuestionId: await this.latestQuestionOn(chatId),
    });

    // An administrator replying to a conversation nobody has taken takes it by
    // replying. Leaving it unowned after somebody has answered in it would put
    // it back in the queue for a second person to answer again.
    if (chat.takenByStaffId === null) await this.store.take(chatId, staff.id);

    return {
      chat: await this.store.getChat(chatId),
      message,
      warnings: this.checkWords(checked.body, language),
    };
  }

  /** Finish a conversation. */
  async close(chatId: string, staff: StaffFacts): Promise<ChatWithMessages> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);
    await this.store.close(chatId);
    return this.store.getChat(chatId);
  }

  /**
   * A SUGGESTED EMAIL, FOR AN AGENT TO COPY.
   *
   * Only once a person has the conversation. Before that there is nobody to sign
   * it, and an email signed "Fayr" from a conversation the assistant is still
   * handling would be a person's letter with no person behind it.
   *
   * The middle of it is either an answer already in the answer book, word for
   * word, or an honest line saying somebody is looking. There is no third case,
   * because the third case is Fayr inventing a promise in writing.
   *
   * FAYR DOES NOT SEND IT. Nothing here talks to a mail server. It is words and a
   * copy button, and the agent sends it from their own email.
   */
  async emailDraftFor(chatId: string, staff: StaffFacts): Promise<Draft> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);

    const theirs = [...chat.messages]
      .reverse()
      .find((m) => m.author === 'PERSON');
    const question = theirs ? theirs.body : '';

    // The answer that was actually shown, if one was. Read off the question row
    // rather than searched again: what went out is what we write about, and a
    // fresh search could find something different a week later.
    const answered = await this.prisma.assistantQuestion.findFirst({
      where: { chatId, answerOrigin: 'ANSWER_BOOK' },
      orderBy: { askedAt: 'desc' },
      select: { answerText: true },
    });

    const person = await this.prisma.staffUser.findUnique({
      where: { id: staff.id },
      select: { name: true },
    });
    const account = await this.prisma.user.findUnique({
      where: { id: chat.userId },
      select: { name: true },
    });

    return draftEmail({
      question,
      answer: answered?.answerText ?? null,
      agentName: person?.name ?? '',
      accountName: account?.name ?? null,
      language: chat.chosenLanguage ?? 'en',
    });
  }

  /**
   * WHAT THE TEAM SHOULD WRITE AN ANSWER FOR NEXT.
   *
   * The questions nobody could answer, grouped and counted, most asked first.
   * The count is out of a real, reported number of questions rather than out of
   * everything ever asked, because a screen that implies it has read everything
   * is a screen that will one day be lying.
   */
  async whatToWrite(limit: number): Promise<{
    readFrom: number;
    groups: ToWrite[];
  }> {
    const { read, questions } = await this.book.unanswered(2000);
    return { readFrom: read, groups: whatToWriteNext(questions, limit) };
  }

  /**
   * TURN A REPLY AN AGENT WROTE INTO A NEW ANSWER.
   *
   * One button, and what comes out is a DRAFT like every other new answer: it
   * needs a person to approve it before anybody else is ever shown it. The person
   * who wrote the words is not automatically the person who decides they are
   * Fayr's official answer, and one button that did both would make them the
   * same person by accident.
   *
   * The question that caused the reply becomes a way of asking it, so the next
   * person who types those words finds it.
   */
  async saveReplyAsAnswer(
    chatId: string,
    messageId: string,
    staff: StaffFacts,
    topic: string,
  ): Promise<{
    key: string;
    language: string;
    plainLanguage: { ok: boolean; problems: string[] };
  }> {
    const chat = await this.store.getChat(chatId);
    const said = mayReply(chat, staff);
    if (!said.allowed) throw new ChatError(said.reason as string);

    const message = chat.messages.find((m) => m.id === messageId);
    if (!message) throw new ChatNotFoundError('no such message');
    if (message.author !== 'AGENT') {
      throw new ChatError(
        'only a reply a person at Fayr wrote can become an answer',
      );
    }

    // What was asked, so the answer can be found again by somebody asking the
    // same thing. The newest question before the reply, which is what it answered.
    const question = [...chat.messages]
      .filter((m) => m.author === 'PERSON' && m.sentAt <= message.sentAt)
      .pop();
    const asked = question ? question.body : '';

    const key = await this.freeKey(keyFromQuestion(asked));
    const title = asked !== '' ? asked.slice(0, 120) : message.body.slice(0, 120);

    await this.book.saveAnswer({
      key,
      language: message.language,
      title,
      body: message.body,
      topic,
      // DRAFT, always. A person approves before anybody is shown it.
      status: 'DRAFT',
      origin: 'STAFF',
      phrases: asked !== '' ? [asked] : [],
    });

    const problems = plainLanguageProblems(message.body, message.language);
    return {
      key,
      language: message.language,
      plainLanguage: { ok: problems.length === 0, problems },
    };
  }

  /**
   * A name nothing else is using, in this language.
   *
   * An answer's name plus its language is unique, so saving under a name already
   * taken would overwrite somebody else's answer instead of adding one. Numbered
   * rather than refused: the agent pressed one button and should not have to
   * think about names at all.
   */
  private async freeKey(wanted: string): Promise<string> {
    for (let n = 0; n < 50; n += 1) {
      const key = n === 0 ? wanted : `${wanted}-${n + 1}`.slice(0, 80);
      const taken = await this.prisma.answerEntry.findFirst({
        where: { key },
        select: { id: true },
      });
      if (!taken) return key;
    }
    throw new ChatError(
      'could not find a free name for this answer. Write it in the answer book '
      + 'instead and give it a name yourself.',
    );
  }

  /** What is wrong with the way something is written, without sending it. */
  checkWords(text: string, language?: string): ReplyWarnings {
    const lang = language ?? detectLanguage(text).language;
    const problems = plainLanguageProblems(text, lang);
    return { ok: problems.length === 0, problems };
  }

  /**
   * The question a reply is answering: the newest one in the conversation.
   *
   * Newest and not "the one with no answer", because an agent's reply is very
   * often a correction to an answer the assistant already gave, and hanging it
   * off an older unanswered question would file it under the wrong words.
   */
  private async latestQuestionOn(chatId: string): Promise<string | null> {
    const found = await this.prisma.assistantQuestion.findFirst({
      where: { chatId },
      orderBy: { askedAt: 'desc' },
      select: { id: true },
    });
    return found?.id ?? null;
  }
}
