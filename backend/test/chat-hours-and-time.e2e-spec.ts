import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { ChatService } from '../src/chat/chat.service';
import { STILL_WAITING } from '../src/chat/chat-words';
import { OPEN_HOURS_BY_DEFAULT, outsideHoursWords } from '../src/chat/when-words';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * FAYR'S HOURS, AND THE TIME ON EVERY MESSAGE.
 *
 * THE CLOCK IS HELD STILL. Both things being checked here depend on what time it
 * is, so a suite that used the real clock would pass all morning and fail after
 * six in the evening. The service keeps its clock behind one method for exactly
 * this, and this holds it.
 *
 * AND THE MOMENTS ARE WORKED OUT, NOT WRITTEN DOWN, AND THIS SUITE ALREADY PROVED
 * WHY THE HARD WAY. They used to be two fixed dates in September 2026, and this
 * whole suite began failing two days after it was written. The reason is that only
 * ONE of the two clocks here can be held still: Fayr's. The conversation itself is
 * written by the database, at the real moment, and the note about a slow queue is
 * due when enough time has passed BETWEEN the two. Once the calendar walked past
 * the fixed date, Fayr's clock was two days BEHIND the conversation, no time had
 * passed at all, and the note was never due.
 *
 * SO EVERY MOMENT BELOW IS THE NEXT TIME THAT HOUR COMES ROUND IN INDIA, counted
 * from now. It is always in the future of the conversation, whatever day the suite
 * is run on, and it is always the hour of the day the check is about.
 */
const HALF_HOURS_AHEAD_OF_UNIVERSAL_TIME = 330 * 60 * 1000;
const A_DAY = 24 * 60 * 60 * 1000;

/** The next time it is `hour` o'clock in India, at or after `from`. */
function nextInIndia(hour: number, from: Date = new Date()): Date {
  const inIndia = new Date(from.getTime() + HALF_HOURS_AHEAD_OF_UNIVERSAL_TIME);
  const thatHourToday = Date.UTC(
    inIndia.getUTCFullYear(),
    inIndia.getUTCMonth(),
    inIndia.getUTCDate(),
    hour,
  ) - HALF_HOURS_AHEAD_OF_UNIVERSAL_TIME;
  return new Date(
    thatHourToday >= from.getTime() ? thatHourToday : thatHourToday + A_DAY,
  );
}

/** Something the answer book cannot answer, so the chat hands it to a person. */
const SOMETHING_NOBODY_HAS_WRITTEN_DOWN =
  'who is the district manager for the northern warehouse';

describe('Fayr’s hours and the time on a message (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let seed: AssistantSeedService;
  let chats: ChatService;
  let clock: jest.SpyInstance<Date, []>;
  let seq = 0;

  const server = () => app.getHttpServer();
  const HOURS_NOTE = outsideHoursWords(OPEN_HOURS_BY_DEFAULT, 'en');

  /** Move Fayr's clock. Everything the chat decides about time follows this. */
  function itIsNow(moment: Date): void {
    clock.mockReturnValue(moment);
  }

  async function aShopper(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({
      data: { mobile: `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}` },
    });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  async function anAgent(): Promise<{ id: string; token: string }> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `agent${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: 'Asha',
        role: 'SUPPORT',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { id: staff.id, token: session.accessToken };
  }

  async function say(token: string, message: string): Promise<any> {
    const res = await request(server())
      .post('/chat/messages')
      .set('authorization', `Bearer ${token}`)
      .send({ message })
      .expect(200);
    return res.body;
  }

  async function readChat(token: string): Promise<any> {
    const res = await request(server())
      .get('/chat')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  }

  async function anAnswerBook(): Promise<void> {
    await seed.seedDrafts();
    await prisma.answerEntry.updateMany({
      where: { origin: 'ASSISTANT' },
      data: { status: 'PUBLISHED' },
    });
  }

  /** Everything the assistant and the notes said, as one piece of text. */
  const whatFayrSaid = (chat: any): string =>
    chat.messages
      .filter((m: any) => m.author !== 'PERSON')
      .map((m: any) => m.body)
      .join('\n');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    staffTokens = app.get(StaffTokenService);
    seed = app.get(AssistantSeedService);
    chats = app.get(ChatService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Hours e2e aborted: non-test database');
    }
    // The one seam the service keeps for this.
    clock = jest.spyOn(chats as unknown as { now(): Date }, 'now');
  });

  afterAll(async () => {
    clock.mockRestore();
    await app.close();
  });

  // The two moments this suite works in, worked out afresh for each check so they
  // are always in the future of the conversation that check creates.
  let noonInIndia: Date;
  let tenAtNightInIndia: Date;

  beforeEach(async () => {
    await resetDatabase(prisma);
    noonInIndia = nextInIndia(12);
    tenAtNightInIndia = nextInIndia(22);
    itIsNow(noonInIndia);
  });

  /**
   * THE GUARD ON THIS SUITE'S OWN CLOCK.
   *
   * It failed silently two days after it was written, because the moments were
   * fixed dates and the calendar walked past them. This is the one line that makes
   * that impossible: Fayr's clock, in every check here, is at or after the real
   * moment the conversation is written by the database.
   */
  it('every moment this suite works in is in the future of the conversation', () => {
    const realNow = Date.now();
    for (const [name, moment] of [
      ['noon in India', noonInIndia],
      ['ten at night in India', tenAtNightInIndia],
      ['the next morning', nextInIndia(10, tenAtNightInIndia)],
    ] as const) {
      expect({ name, isAhead: moment.getTime() >= realNow }).toEqual({ name, isAhead: true });
      // And within a day and a half of it, so a wrong day cannot hide in here.
      expect({ name, within: moment.getTime() - realNow < 2 * A_DAY })
        .toEqual({ name, within: true });
    }
    // And each one really is the hour it says it is, in India.
    const hourInIndia = (m: Date): number =>
      new Date(m.getTime() + HALF_HOURS_AHEAD_OF_UNIVERSAL_TIME).getUTCHours();
    expect(hourInIndia(noonInIndia)).toBe(12);
    expect(hourInIndia(tenAtNightInIndia)).toBe(22);
    expect(hourInIndia(nextInIndia(10, tenAtNightInIndia))).toBe(10);
  });

  describe('inside our hours, nothing changes', () => {
    it('hands a question over without mentioning hours', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);

      expect(chat.waitingForAPerson).toBe(true);
      expect(whatFayrSaid(chat)).not.toContain(HOURS_NOTE);
      expect(whatFayrSaid(chat)).not.toContain('outside those hours');
    });

    it('still sends the one note about a slow queue when it comes due', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);

      // Three minutes later, still inside our hours, still nobody free.
      itIsNow(new Date(noonInIndia.getTime() + 3 * 60 * 1000));
      const later = await readChat(shopper.token);
      expect(whatFayrSaid(later)).toContain(STILL_WAITING.en);
    });
  });

  describe('outside our hours', () => {
    beforeEach(() => {
      itIsNow(tenAtNightInIndia);
    });

    it('says when we are open and that a person will read it when we do', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);

      expect(chat.waitingForAPerson).toBe(true);
      expect(whatFayrSaid(chat)).toContain(HOURS_NOTE);
    });

    it('promises no time we have not agreed', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);
      const note = whatFayrSaid(chat);
      const theHoursLine = note.slice(note.indexOf('Fayr is open from'));
      for (const promise of ['tomorrow', 'usually', 'minutes', 'first thing']) {
        expect(theHoursLine.toLowerCase()).not.toContain(promise);
      }
    });

    it('does NOT stack a second apology on top of it', async () => {
      // The queue's own note says a lot of people are writing to us right now,
      // which at ten at night is untrue and contradicts the line above it.
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);

      itIsNow(new Date(tenAtNightInIndia.getTime() + 30 * 60 * 1000));
      const later = await readChat(shopper.token);
      expect(whatFayrSaid(later)).not.toContain(STILL_WAITING.en);
      // And the honest line is still there.
      expect(whatFayrSaid(later)).toContain(HOURS_NOTE);
    });

    it('holds that note back rather than losing it, so it lands once we open', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);

      // Read while shut: nothing.
      itIsNow(new Date(tenAtNightInIndia.getTime() + 30 * 60 * 1000));
      await readChat(shopper.token);

      // Read the next morning, inside our hours, still waiting. Ten in the morning
      // AFTER that night, whichever day the suite is being run on.
      itIsNow(nextInIndia(10, tenAtNightInIndia));
      const morning = await readChat(shopper.token);
      expect(whatFayrSaid(morning)).toContain(STILL_WAITING.en);
    });

    it('the assistant still answers, at every hour of the day', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');

      expect(chat.waitingForAPerson).toBe(false);
      const said = whatFayrSaid(chat);
      expect(said.toLowerCase()).toContain('ticket');
      // A real answer, so no hours note: nothing is waiting.
      expect(said).not.toContain(HOURS_NOTE);
    });

    it('a person at Fayr can still reply', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);
      const agent = await anAgent();

      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('authorization', `Bearer ${agent.token}`)
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('authorization', `Bearer ${agent.token}`)
        .send({ message: 'I have looked at your order and your refund is on its way.' })
        .expect(200);

      const after = await readChat(shopper.token);
      const fromAPerson = after.messages.filter((m: any) => m.fromAPerson === true);
      expect(fromAPerson).toHaveLength(1);
      expect(fromAPerson[0].body).toContain('your refund is on its way');
    });

    it('a shopper can still write, and is not turned away', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, SOMETHING_NOBODY_HAS_WRITTEN_DOWN);
      const again = await say(shopper.token, 'is there any news please');
      const theirs = again.messages.filter((m: any) => m.author === 'PERSON');
      expect(theirs).toHaveLength(2);
    });
  });

  describe('the time on every message', () => {
    /**
     * WHY THE CLOCK IS MOVED TO THE MESSAGE AND NOT THE OTHER WAY ROUND.
     *
     * The moment a message was sent is written by the database, not by the
     * service's clock, and that is right: the record is the record, and holding a
     * clock still must not be able to change when something really happened. So
     * these move the READING clock to a known distance from the stored moment,
     * which is the only thing the words are allowed to depend on.
     */
    it('is on every single one, and says today when it is today', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');
      expect(chat.messages.length).toBeGreaterThan(1);

      const newest = new Date(chat.messages[chat.messages.length - 1].sentAt);
      itIsNow(newest);
      const read = await readChat(shopper.token);

      for (const message of read.messages) {
        expect(typeof message.sentAtInWords).toBe('string');
        expect(message.sentAtInWords).toMatch(
          /^Today at \d{1,2}:\d{2} in the (morning|afternoon|evening)$/,
        );
      }
    });

    it('puts the real minute of the stored moment in the words, in India', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');
      const newest = chat.messages[chat.messages.length - 1];
      itIsNow(new Date(newest.sentAt));
      const read = await readChat(shopper.token);
      const line = read.messages[read.messages.length - 1];

      // India is five and a half hours ahead. Worked out here by hand rather than
      // by calling the code being checked.
      const inIndia = new Date(new Date(line.sentAt).getTime() + 330 * 60 * 1000);
      const hour = inIndia.getUTCHours();
      const face = `${hour % 12 === 0 ? 12 : hour % 12}:${String(inIndia.getUTCMinutes()).padStart(2, '0')}`;
      expect(line.sentAtInWords).toContain(`at ${face} `);
    });

    it('says yesterday when it was yesterday, counted in India', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');
      const newest = new Date(chat.messages[chat.messages.length - 1].sentAt);

      // The same clock face, one day later.
      itIsNow(new Date(newest.getTime() + 24 * 60 * 60 * 1000));
      const read = await readChat(shopper.token);
      for (const message of read.messages) {
        expect(message.sentAtInWords).toMatch(
          /^Yesterday at \d{1,2}:\d{2} in the (morning|afternoon|evening)$/,
        );
      }
    });

    it('gives the day and the month for anything older, and never the year', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');
      const newest = new Date(chat.messages[chat.messages.length - 1].sentAt);

      itIsNow(new Date(newest.getTime() + 10 * 24 * 60 * 60 * 1000));
      const read = await readChat(shopper.token);
      for (const message of read.messages) {
        expect(message.sentAtInWords).toMatch(
          /^\d{1,2} [A-Z][a-z]+ at \d{1,2}:\d{2} in the (morning|afternoon|evening)$/,
        );
        expect(message.sentAtInWords).not.toMatch(/\d{4}/);
      }
    });

    it('never sends a bare stored moment as the words', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how many tickets do i start with');
      for (const message of chat.messages) {
        // The stored moment is still sent, under its own name, for anything that
        // needs to sort or compare. It is the WORDS that must never be one.
        expect(message.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(message.sentAtInWords).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    });

    it('reads the same for one conversation however many times it is read', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, 'how many tickets do i start with');
      const first = await readChat(shopper.token);
      const second = await readChat(shopper.token);
      expect(second.messages.map((m: any) => m.sentAtInWords)).toEqual(
        first.messages.map((m: any) => m.sentAtInWords),
      );
    });
  });
});
