import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { HOW_WE_KNEW_MAX } from '../src/shops/dto/record-shop-sign-in.dto';
import { resetDatabase } from './reset-db';

/**
 * SOMEBODY GOT SIGNED IN AT A SHOP, WRITTEN DOWN ONCE, END TO END.
 *
 * WHY THIS ROW EXISTS AT ALL. Signing in happens on the shop's own page, inside
 * the web view, and the thing every one of the seven shops keeps to say "this
 * person is signed in" cannot be read by anything running in that page. So our
 * side has no way to go and look. The phone can see the shop greeting somebody by
 * name, or the shop's own sign out control sitting on the page, and it tells our
 * side. That is the only signal there is.
 *
 * WHICH MAKES IT SOMEBODY'S WORD, AND THE WHOLE DESIGN LEANS ON THAT BEING SAID
 * OUT LOUD. A row here is not proof about an order, moves no money, and opens no
 * gate. It is a count, so the page that measures Fayr can stop saying "we are not
 * watching this yet" about a step every single person has to get through.
 *
 * WHAT THIS FILE PROVES, in the order it matters:
 *
 *   1. one call writes one row, and says it wrote it;
 *   2. five calls still write ONE row, and only the first says it wrote one;
 *   3. the first moment is kept and is never moved by a later call;
 *   4. a person and a shop TOGETHER are what a row is about, so two shops for
 *      one person are two rows and two people at one shop are two rows;
 *   5. nobody who is not signed in to Fayr can write anything;
 *   6. only the seven shops are accepted, and the name has to be exact;
 *   7. the reason is stored, is optional, and cannot be an essay;
 *   8. NOTHING SECRET CAN BE SMUGGLED IN. The owner's rule is that Fayr never
 *      sees a thing somebody types on a shop's page, so there must be no way to
 *      post one here even by accident;
 *   9. the row on the page that measures Fayr is now a real count, worked out by
 *      hand below, and the step above it is left exactly as it was;
 *  10. with nothing recorded it is a real nought and never "we are not watching".
 *
 * NO REAL PASSWORD, CODE OR NUMBER APPEARS ANYWHERE IN THIS FILE. The values
 * posted in check 8 are obvious nonsense, chosen so a failure message can be read
 * out loud in a room without anybody worrying about what it contains.
 */
describe('Signed in at a shop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let seq = 0;

  const server = () => app.getHttpServer();
  const ROUTE = '/me/shop-sign-ins';
  const RUNNING = '/admin/how-it-is-running';

  /** The step this whole feature exists to fill in, by the words a person reads. */
  const SIGNED_IN_STEP = 'Signed in at the shop';
  /** The step directly above it, which nothing records and which must stay so. */
  const WENT_TO_THE_SHOP_STEP = 'Went to the shop';

  interface Person {
    id: string;
    token: string;
  }

  async function newPerson(): Promise<Person> {
    const mobile = `+9190${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
    const user = await prisma.user.create({ data: { mobile } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  async function staffTokenFor(role: StaffRole): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: `Test ${role}`,
        role,
      },
    });
    const session = await staffTokens.issueSession(staff);
    return session.accessToken;
  }

  /** Say it once, the way the phone says it, and insist on the answer given. */
  function say(person: Person, body: unknown) {
    return request(server())
      .post(ROUTE)
      .set('authorization', `Bearer ${person.token}`)
      .send(body as object);
  }

  async function rowCount(): Promise<number> {
    return prisma.shopSignIn.count();
  }

  interface StepOnThePage {
    step: string;
    meaning: string;
    whatItWouldTake: string | null;
    onThePath: boolean;
    everythingSoFar: { kind: string; count?: number };
    lastThirtyDays: { kind: string; count?: number };
    dropSoFar: { kind: string } | null;
  }

  async function readTheRunningPage(): Promise<StepOnThePage[]> {
    const token = await staffTokenFor('ADMIN');
    const res = await request(server())
      .get(RUNNING)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.journey.steps as StepOnThePage[];
  }

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

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`shop sign in e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('writing it down', () => {
    it('takes one call and writes exactly one row', async () => {
      const person = await newPerson();
      const res = await say(person, { platform: 'AMAZON' }).expect(200);

      // The whole answer, not a part of it: a route that also handed back
      // something about the shop or the person would be a route that had started
      // telling the phone things it did not already know.
      expect(res.body).toEqual({ platform: 'AMAZON', recorded: true });

      expect(await rowCount()).toBe(1);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(row.userId).toBe(person.id);
      expect(row.platform).toBe('AMAZON');
    });

    it('WRITES ONE ROW HOWEVER MANY TIMES THE PAGE IS OPENED', async () => {
      // The owner's rule, in the owner's words: written down exactly once,
      // however many times the shop's page is opened. Opening a shop again is
      // ordinary. It is the same fact each time, and five rows saying it would
      // make the count on the running page mean nothing.
      const person = await newPerson();
      const answers: boolean[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await say(person, { platform: 'AMAZON' }).expect(200);
        expect(res.body.platform).toBe('AMAZON');
        answers.push(res.body.recorded);
      }

      // The first call did something. The four after it did not, and say so, so a
      // log can tell a real first sign in from the page simply being reopened.
      expect(answers).toEqual([true, false, false, false, false]);
      expect(await rowCount()).toBe(1);
    });

    it('KEEPS THE FIRST MOMENT AND NEVER MOVES IT', async () => {
      // The question this row answers is "did this person ever get this far", and
      // a moment that slides forward every time the page is reopened cannot
      // answer it. The service updates nothing at all on a second call, and this
      // is the check that would fail the day somebody makes it touch the moment.
      const person = await newPerson();
      await say(person, { platform: 'FLIPKART' }).expect(200);
      const first = await prisma.shopSignIn.findFirstOrThrow();

      await say(person, { platform: 'FLIPKART' }).expect(200);
      const second = await prisma.shopSignIn.findFirstOrThrow();

      expect(second.id).toBe(first.id);
      expect(second.firstAt.getTime()).toBe(first.firstAt.getTime());
      expect(second.firstAt.toISOString()).toBe(first.firstAt.toISOString());
      expect(await rowCount()).toBe(1);
    });

    it('a row is about a person AND a shop together, not one of the two', async () => {
      // Two ways of getting this wrong, and each one is a row that reads as a
      // fact about somebody it is not about:
      //   one row per person  would say somebody signed in everywhere the moment
      //                       they signed in anywhere;
      //   one row per shop    would say everybody signed in at Amazon the moment
      //                       one person did.
      const one = await newPerson();
      const other = await newPerson();

      // The same person at two different shops. Two separate facts.
      await say(one, { platform: 'AMAZON' }).expect(200);
      const second = await say(one, { platform: 'FLIPKART' }).expect(200);
      expect(second.body).toEqual({ platform: 'FLIPKART', recorded: true });
      expect(await rowCount()).toBe(2);

      // Two different people at the same shop. Two separate facts as well.
      const theirs = await say(other, { platform: 'AMAZON' }).expect(200);
      expect(theirs.body).toEqual({ platform: 'AMAZON', recorded: true });
      expect(await rowCount()).toBe(3);

      const pairs = await prisma.shopSignIn.findMany({
        select: { userId: true, platform: true },
      });
      const readable = pairs
        .map((p) => `${p.userId === one.id ? 'one' : 'other'} at ${p.platform}`)
        .sort();
      expect(readable).toEqual([
        'one at AMAZON',
        'one at FLIPKART',
        'other at AMAZON',
      ]);
    });
  });

  describe('who is allowed to say it', () => {
    it('refuses somebody who is not signed in to Fayr', async () => {
      await request(server()).post(ROUTE).send({ platform: 'AMAZON' }).expect(401);
      expect(await rowCount()).toBe(0);
    });

    it('refuses a made-up sign-in', async () => {
      await request(server())
        .post(ROUTE)
        .set('authorization', 'Bearer not-a-real-sign-in')
        .send({ platform: 'AMAZON' })
        .expect(401);
      expect(await rowCount()).toBe(0);
    });

    it('takes the person from the sign-in, so a phone cannot claim to be somebody else', async () => {
      // There is no field for who it was, and posting one is refused outright by
      // the whitelisting rule. This is the check that says the row was written
      // against the caller rather than against the name they sent.
      const person = await newPerson();
      const other = await newPerson();
      await say(person, { platform: 'AMAZON', userId: other.id }).expect(400);
      expect(await rowCount()).toBe(0);

      await say(person, { platform: 'AMAZON' }).expect(200);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(row.userId).toBe(person.id);
    });
  });

  describe('which shop', () => {
    it('refuses anything that is not one of the seven, and writes nothing', async () => {
      const person = await newPerson();
      // A shop Fayr does not work with, a blank, the right name in the wrong
      // letters, nothing at all, and a number. The stored value has to match one
      // of the seven exactly, because everything else in the system reads that
      // one list of names.
      for (const platform of ['GOOGLE', '', 'amazon', null, 7]) {
        const res = await say(person, { platform });
        expect({ platform, status: res.status }).toEqual({ platform, status: 400 });
      }
      // A call with no shop at all is refused for the same reason.
      await say(person, {}).expect(400);
      expect(await rowCount()).toBe(0);
    });

    it('accepts every one of the seven shops', async () => {
      // Named here in full rather than read from the list the route uses, so this
      // check would notice a shop quietly disappearing from that list.
      const person = await newPerson();
      const seven = [
        'AMAZON',
        'FLIPKART',
        'MEESHO',
        'MYNTRA',
        'BLINKIT',
        'ZEPTO',
        'INSTAMART',
      ];
      for (const platform of seven) {
        const res = await say(person, { platform }).expect(200);
        expect(res.body).toEqual({ platform, recorded: true });
      }
      expect(await rowCount()).toBe(7);
    });
  });

  describe('how Fayr knew', () => {
    it('stores the words it was given', async () => {
      const person = await newPerson();
      const words = 'the shop greeted them by name at the top of the page';
      await say(person, { platform: 'AMAZON', howWeKnew: words }).expect(200);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(row.howWeKnew).toBe(words);
    });

    it('works without any words, and still writes a reason down', async () => {
      // A row with an empty reason cannot be read a year later, so the route
      // fills in what it actually saw rather than leaving a blank.
      const person = await newPerson();
      await say(person, { platform: 'ZEPTO' }).expect(200);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(typeof row.howWeKnew).toBe('string');
      expect(row.howWeKnew.trim().length).toBeGreaterThan(10);
      expect(row.howWeKnew.toLowerCase()).toContain('signed in');
    });

    it('takes a reason right up to the limit and refuses one over it', async () => {
      const person = await newPerson();
      const justLongEnough = 'a'.repeat(HOW_WE_KNEW_MAX);
      const oneTooLong = 'a'.repeat(HOW_WE_KNEW_MAX + 1);

      await say(person, { platform: 'AMAZON', howWeKnew: justLongEnough }).expect(200);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(row.howWeKnew.length).toBe(HOW_WE_KNEW_MAX);

      // A second person, so the refusal is judged on its own and not on the row
      // that already exists for the first one.
      const other = await newPerson();
      await say(other, { platform: 'AMAZON', howWeKnew: oneTooLong }).expect(400);
      expect(await rowCount()).toBe(1);
    });

    it('a second call never rewrites the reason the first one gave', async () => {
      // The same rule as the moment, for the same reason: the row is the record
      // of the first time, so nothing about it is rewritten later.
      const person = await newPerson();
      await say(person, {
        platform: 'AMAZON',
        howWeKnew: 'the shop greeted them by name',
      }).expect(200);
      await say(person, {
        platform: 'AMAZON',
        howWeKnew: 'something completely different',
      }).expect(200);
      const row = await prisma.shopSignIn.findFirstOrThrow();
      expect(row.howWeKnew).toBe('the shop greeted them by name');
    });
  });

  describe('nothing secret can be smuggled in', () => {
    it('REFUSES A CALL CARRYING ANYTHING THE ROUTE DID NOT ASK FOR', async () => {
      // The owner's rule is that Fayr never types anything into a shop's page and
      // never sees anything typed there, which means the phone has no password,
      // code, cookie or token to send in the first place. This check is the second
      // wall: even if something on the phone one day had one, there is no way to
      // post it here. The whole application runs a whitelisting rule with
      // forbidNonWhitelisted turned on in src/app.setup.ts, so a field the route
      // does not declare is not stripped quietly, it is refused, and a refusal is
      // the answer we want because it would show up the day somebody tried.
      //
      // Every value below is obvious nonsense on purpose, so a failure message is
      // safe to read out loud.
      const person = await newPerson();
      const smuggled: Record<string, unknown>[] = [
        { platform: 'AMAZON', password: 'not-a-real-password' },
        { platform: 'AMAZON', cookie: 'not-a-real-cookie' },
        { platform: 'AMAZON', token: 'not-a-real-token' },
        { platform: 'AMAZON', otp: 'not-a-real-code' },
        { platform: 'AMAZON', session: 'not-a-real-session' },
        {
          platform: 'AMAZON',
          howWeKnew: 'the shop greeted them by name',
          password: 'not-a-real-password',
          cookie: 'not-a-real-cookie',
          token: 'not-a-real-token',
          otp: 'not-a-real-code',
        },
      ];
      for (const body of smuggled) {
        const res = await say(person, body);
        const sent = Object.keys(body).join(' and ');
        expect({ sent, status: res.status }).toEqual({ sent, status: 400 });
      }
      expect(await rowCount()).toBe(0);
    });

    it('a row holds which shop, when, and why in words, and nothing else', async () => {
      // Read the row back as the database has it, so a column added later that
      // could hold a secret has to come past this check. Named columns rather
      // than a shape, because a shape check passes the moment somebody adds a
      // field to it as well.
      const person = await newPerson();
      await say(person, {
        platform: 'AMAZON',
        howWeKnew: 'the shop greeted them by name',
      }).expect(200);

      const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM shop_sign_ins`,
      );
      expect(raw).toHaveLength(1);
      expect(Object.keys(raw[0]).sort()).toEqual([
        'createdAt',
        'firstAt',
        'howWeKnew',
        'id',
        'platform',
        'userId',
      ]);

      // And none of the nonsense from the check above reached the row, which is
      // what a refused call is supposed to mean.
      const written = JSON.stringify(raw[0]).toLowerCase();
      for (const word of ['password', 'cookie', 'token', 'otp', 'session']) {
        expect({ word, inTheRow: written.includes(word) }).toEqual({
          word,
          inTheRow: false,
        });
      }
    });
  });

  describe('the row on the page that measures Fayr', () => {
    /**
     * A SMALL KNOWN WORLD, AND EVERY NUMBER WORKED OUT BY HAND.
     *
     * The page counts PLACES, not people, because the rows above and below it on
     * that page count places and a number beside two it cannot be compared with
     * is worse than no number.
     *
     * THE WORLD:
     *
     *   person A, three places, all of them on AMAZON
     *   person A, one place, on FLIPKART
     *   person B, two places, both on AMAZON
     *                                             six places in total
     *
     * And ONE sign in row is written: person A at AMAZON. Nothing else.
     *
     * SO, BY HAND:
     *
     *   took a place              6   every place in the world
     *   signed in at the shop     3   A's three AMAZON places and no others
     *
     * A's FLIPKART place does NOT count: A is signed in at Amazon, and Flipkart
     * is a different shop that A has never been seen signed in at.
     * B's two AMAZON places do NOT count: the shop matches, the person does not.
     *
     * THE TWO WRONG ANSWERS THIS IS BUILT TO CATCH, and they are the only two a
     * mistake here can produce:
     *
     *   4   counting the person and ignoring the shop, so all four of A's places
     *       count the moment A signs in anywhere;
     *   6   ignoring both and counting every place once any sign in exists.
     */
    async function buildTheWorld(): Promise<{ a: Person; b: Person }> {
      const a = await newPerson();
      const b = await newPerson();

      const amazonOffer = await prisma.campaign.create({
        data: {
          platform: 'AMAZON',
          status: 'ACTIVE',
          title: 'Offer at Amazon',
          productName: 'Product at Amazon',
          productPricePaise: 100_000n,
          payoutPercent: 90,
        },
      });
      const flipkartOffer = await prisma.campaign.create({
        data: {
          platform: 'FLIPKART',
          status: 'ACTIVE',
          title: 'Offer at Flipkart',
          productName: 'Product at Flipkart',
          productPricePaise: 200_000n,
          payoutPercent: 85,
        },
      });

      // The shop is the one frozen on the place when it was taken, which is why
      // it is written here on every place rather than left to the offer.
      const place = async (person: Person, campaignId: string, platform: 'AMAZON' | 'FLIPKART') => {
        await prisma.task.create({
          data: {
            userId: person.id,
            campaignId,
            platform,
            state: 'CLAIMED',
          },
        });
      };

      await place(a, amazonOffer.id, 'AMAZON');
      await place(a, amazonOffer.id, 'AMAZON');
      await place(a, amazonOffer.id, 'AMAZON');
      await place(a, flipkartOffer.id, 'FLIPKART');
      await place(b, amazonOffer.id, 'AMAZON');
      await place(b, amazonOffer.id, 'AMAZON');

      expect(await prisma.task.count()).toBe(6);
      return { a, b };
    }

    it('IS A REAL COUNT NOW, AND THE COUNT IS THREE', async () => {
      const { a } = await buildTheWorld();
      await say(a, { platform: 'AMAZON' }).expect(200);
      expect(await rowCount()).toBe(1);

      const steps = await readTheRunningPage();
      const signedIn = steps.find((s) => s.step === SIGNED_IN_STEP);
      expect(signedIn).toBeDefined();

      // Not "we are not watching this yet" any more. That sentence was true until
      // this feature existed and is now the one wrong answer on the page.
      expect(signedIn!.everythingSoFar.kind).toBe('counted');
      expect(signedIn!.lastThirtyDays.kind).toBe('counted');

      // THREE. Worked out by hand above: A's three AMAZON places. Four would mean
      // the shop was ignored, six would mean the person was ignored too.
      expect(signedIn!.everythingSoFar).toEqual({ kind: 'counted', count: 3 });
      expect(signedIn!.everythingSoFar.count).not.toBe(4);
      expect(signedIn!.everythingSoFar.count).not.toBe(6);
      // Every place was taken just now, so the thirty day column is the same 3.
      expect(signedIn!.lastThirtyDays).toEqual({ kind: 'counted', count: 3 });

      // A step that is really counted has nothing to say about what it would take
      // to start counting it, and a leftover sentence there would print on the
      // page next to a real number.
      expect(signedIn!.whatItWouldTake).toBeNull();

      // And the step it sits under still counts every place in the world.
      const tookAPlace = steps[0];
      expect(tookAPlace.everythingSoFar).toEqual({ kind: 'counted', count: 6 });
    });

    it('READS THE SHOP FROZEN ON THE PLACE, NOT THE OFFER\'S SHOP TODAY', async () => {
      // FOUND BY A MUTATION, and the check that was here could not tell the
      // difference. Reading t.campaign.platform instead of t.platform passed every
      // other check in this file, because in every other world the two agree.
      //
      // THEY CAN DISAGREE, AND THAT IS THE WHOLE REASON THE COLUMN IS FROZEN. An
      // offer can be edited after somebody has taken a place on it. If the count
      // read the offer's shop as it is TODAY, editing one offer would silently
      // move a number on a page a director is reading, and move it for places
      // taken weeks earlier.
      const person = await newPerson();
      const offer = await prisma.campaign.create({
        data: {
          platform: 'FLIPKART',
          status: 'ACTIVE',
          title: 'An offer that was moved to another shop',
          productName: 'Product',
          productPricePaise: 100_000n,
          payoutPercent: 90,
        },
      });
      // The place was taken while the offer was an AMAZON offer, so AMAZON is what
      // is frozen on it. The offer says FLIPKART now.
      await prisma.task.create({
        data: { userId: person.id, campaignId: offer.id, platform: 'AMAZON', state: 'CLAIMED' },
      });

      // They signed in at AMAZON, which is the shop they were really sent to.
      await say(person, { platform: 'AMAZON' }).expect(200);

      const steps = await readTheRunningPage();
      const signedIn = steps.find((s) => s.step === SIGNED_IN_STEP);
      // ONE. Reading the offer's shop today would look for a FLIPKART sign in,
      // find none, and count nought.
      expect(signedIn!.everythingSoFar).toEqual({ kind: 'counted', count: 1 });

      // And the other way round, to prove it is not simply always one: signing in
      // at the shop the OFFER now names must count nothing, because that is not
      // the shop this place was taken at.
      const second = await newPerson();
      await prisma.task.create({
        data: { userId: second.id, campaignId: offer.id, platform: 'AMAZON', state: 'CLAIMED' },
      });
      await say(second, { platform: 'FLIPKART' }).expect(200);
      const after = await readTheRunningPage();
      const stillOne = after.find((s) => s.step === SIGNED_IN_STEP);
      expect(stillOne!.everythingSoFar).toEqual({ kind: 'counted', count: 1 });
    });

    it('leaves the step above it exactly as it was', async () => {
      // The owner said to touch no other line, and going to the shop is genuinely
      // not recorded: opening a shop happens inside the phone and our side hears
      // nothing about it. A nought there would read as "nobody went", which is a
      // lie, so it must stay as the sentence and never become a number.
      const { a } = await buildTheWorld();
      await say(a, { platform: 'AMAZON' }).expect(200);

      const steps = await readTheRunningPage();
      const went = steps.find((s) => s.step === WENT_TO_THE_SHOP_STEP);
      expect(went).toBeDefined();
      expect(went!.everythingSoFar.kind).toBe('not-watching');
      expect(went!.lastThirtyDays.kind).toBe('not-watching');
      expect(went!.everythingSoFar.count).toBeUndefined();
      expect(String(went!.whatItWouldTake).trim().length).toBeGreaterThan(20);

      // And it is still the line directly above the one this feature filled in,
      // so the journey reads in the order it happens.
      const above = steps.findIndex((s) => s.step === WENT_TO_THE_SHOP_STEP);
      const here = steps.findIndex((s) => s.step === SIGNED_IN_STEP);
      expect(here).toBe(above + 1);
    });

    it('IS A REAL NOUGHT WITH NOTHING RECORDED, NEVER NOT WATCHING', async () => {
      // The difference the whole page turns on. A nought here means we counted
      // the rows and there were none. "We are not watching this yet" means we
      // never look, and printing one where the other belongs is the exact kind of
      // wrongness a room full of directors finds.
      await buildTheWorld();
      expect(await rowCount()).toBe(0);

      const steps = await readTheRunningPage();
      const signedIn = steps.find((s) => s.step === SIGNED_IN_STEP);
      expect(signedIn!.everythingSoFar).toEqual({ kind: 'counted', count: 0 });
      expect(signedIn!.lastThirtyDays).toEqual({ kind: 'counted', count: 0 });
      expect(signedIn!.whatItWouldTake).toBeNull();
      // Six places were taken, so the nought above is a real nought and not an
      // empty database answering for it.
      expect(steps[0].everythingSoFar).toEqual({ kind: 'counted', count: 6 });
    });

    it('counts places and not people, so a second place at the same shop counts too', async () => {
      // One sign in row, three places at that shop, and the number is three. This
      // is the row's own rule said out loud: it sits between two rows that count
      // places, so it counts places as well.
      const { a } = await buildTheWorld();
      await say(a, { platform: 'AMAZON' }).expect(200);
      // Saying it four more times changes no row and therefore changes no number.
      for (let i = 0; i < 4; i += 1) await say(a, { platform: 'AMAZON' }).expect(200);
      expect(await rowCount()).toBe(1);

      const steps = await readTheRunningPage();
      const signedIn = steps.find((s) => s.step === SIGNED_IN_STEP);
      expect(signedIn!.everythingSoFar).toEqual({ kind: 'counted', count: 3 });
    });

    it('a sign in at a shop nobody took a place at moves no number', async () => {
      // A row on its own is not a place. Somebody can sign in at Flipkart without
      // ever taking a Flipkart place, and the journey counts places.
      const { a } = await buildTheWorld();
      await say(a, { platform: 'MEESHO' }).expect(200);

      const steps = await readTheRunningPage();
      const signedIn = steps.find((s) => s.step === SIGNED_IN_STEP);
      expect(signedIn!.everythingSoFar).toEqual({ kind: 'counted', count: 0 });
    });
  });
});
