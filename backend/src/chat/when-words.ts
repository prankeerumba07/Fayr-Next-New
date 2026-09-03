import { IST_OFFSET_MINUTES } from '../assistant/journey';
import { timeOfDayInIndia, type TimeOfDay } from './chat-words';

/**
 * WHEN SOMETHING WAS SAID, AND WHEN FAYR IS OPEN, IN PLAIN WORDS.
 *
 * NOBODY READS A BARE TIMESTAMP. "2026-09-05T09:50:00.000Z" is not a time of day
 * to a person waiting on their money, and neither is "09:50".
 *
 * IT IS ALWAYS INDIA'S TIME, AND ALWAYS FROM THE RECORD. The moment is the one
 * stored against the message; the phone's own clock is never consulted, so a
 * phone set to the wrong day cannot make Fayr appear to have answered tomorrow.
 * India and not wherever the server is, for the same reason the greeting is:
 * somebody in Kolkata told their message arrived at four in the morning, when
 * they sent it at half past nine, has been told a machine wrote it.
 *
 * THE PARTS OF THE DAY ARE THE GREETING'S OWN. This calls timeOfDayInIndia rather
 * than drawing its own line at noon, so "good afternoon" and "in the afternoon"
 * can never disagree about when the afternoon starts. The cost, written down: at
 * two in the morning it says "in the morning", because the greeting has three
 * parts and not four. That is the greeting's rule, and one rule is worth more
 * than a fourth part of the day.
 *
 * ALL OF IT IS PURE, and the clock is always handed in, so every sentence can be
 * checked without running anything. Every one is walked through the real plain
 * language check by when-words.spec.ts, in its own language.
 */

const IST = IST_OFFSET_MINUTES;

/** The three parts of the day, named. The greeting decides which one it is. */
const PART_OF_DAY: Record<string, Record<TimeOfDay, string>> = {
  en: { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening' },
  hi: { morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम' },
  'hi-en': { morning: 'subah', afternoon: 'dopahar', evening: 'shaam' },
};

const MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई',
    'अगस्त', 'सितंबर', 'अक्तूबर', 'नवंबर', 'दिसंबर'],
  'hi-en': ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'],
};

/** Hours as words, so no sentence about our hours contains a bare number. */
const HOUR_NAMES: Record<string, string[]> = {
  en: ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven'],
  hi: ['बारह', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात',
    'आठ', 'नौ', 'दस', 'ग्यारह'],
  'hi-en': ['barah', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chhah', 'saat',
    'aath', 'nau', 'das', 'gyarah'],
};

function pick<T>(table: Record<string, T>, language: string): T {
  return table[language] ?? table.en;
}

/** The day and the minute of the day in India, for one moment. */
function inIndia(at: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(at.getTime() + IST * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** "3:20", from a twenty-four hour clock. Midnight and noon are both twelve. */
function clockFace(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')}`;
}

/** How many days apart two moments are, counted by India's calendar days. */
function daysApart(then: Date, now: Date): number {
  const a = inIndia(then);
  const b = inIndia(now);
  const dayOf = (d: { year: number; month: number; day: number }): number =>
    Date.UTC(d.year, d.month, d.day) / (24 * 60 * 60 * 1000);
  return dayOf(b) - dayOf(a);
}

/**
 * When a message was sent, in words.
 *
 * Today and yesterday are named, because that is how somebody reading a
 * conversation thinks about it. Anything older gets the day and the month, which
 * is what people actually say. The year is never shown: a conversation older than
 * a year is not one somebody is scrolling through, and a year on every line is
 * noise on all the ones they are.
 */
export function whenItWasSent(sentAt: Date, now: Date, language = 'en'): string {
  const when = inIndia(sentAt);
  const part = pick(PART_OF_DAY, language)[timeOfDayInIndia(sentAt)];
  const face = clockFace(when.hour, when.minute);
  const apart = daysApart(sentAt, now);

  if (language === 'hi') {
    if (apart === 0) return `आज ${part} ${face} बजे`;
    if (apart === 1) return `कल ${part} ${face} बजे`;
    return `${when.day} ${pick(MONTHS, language)[when.month]} को ${part} ${face} बजे`;
  }
  if (language === 'hi-en') {
    if (apart === 0) return `Aaj ${part} ${face} baje`;
    if (apart === 1) return `Kal ${part} ${face} baje`;
    return `${when.day} ${pick(MONTHS, language)[when.month]} ko ${part} ${face} baje`;
  }
  if (apart === 0) return `Today at ${face} ${part}`;
  if (apart === 1) return `Yesterday at ${face} ${part}`;
  return `${when.day} ${pick(MONTHS, language)[when.month]} at ${face} ${part}`;
}

// ── Fayr's hours ─────────────────────────────────────────────────────────────

/** When Fayr is open, on a twenty-four hour clock, India's time. */
export interface OpeningHours {
  fromHour: number;
  toHour: number;
}

/**
 * The hours if the setting says nothing. Nine in the morning to six in the
 * evening, written here ONCE and nowhere else.
 */
export const OPEN_HOURS_BY_DEFAULT: OpeningHours = { fromHour: 9, toHour: 18 };

/** The shape the setting has to have. Two hours, the smaller one first. */
const HOURS_SETTING = /^([01]?\d|2[0-3])-([01]?\d|2[0-3])$/;

/**
 * Read the hours out of the setting.
 *
 * ANYTHING UNUSABLE FALLS BACK TO THE DEFAULT rather than stopping the chat.
 * The setting decides a sentence, not a payment: a chat that refuses to answer
 * because somebody mistyped our opening time is a worse outcome than a chat that
 * answers using the hours we have always had. The env schema refuses a bad value
 * at boot, so this is the second gate and it is the forgiving one.
 */
export function openHoursFrom(setting: string | null | undefined): OpeningHours {
  const raw = String(setting ?? '').trim();
  const match = HOURS_SETTING.exec(raw);
  if (match == null) return OPEN_HOURS_BY_DEFAULT;
  const fromHour = Number(match[1]);
  const toHour = Number(match[2]);
  // Open until before we are open is not a shorter day, it is a typo.
  if (toHour <= fromHour) return OPEN_HOURS_BY_DEFAULT;
  return { fromHour, toHour };
}

/**
 * Is Fayr open at this moment?
 *
 * Counted in whole minutes in India, so a message at one minute to six is inside
 * the day and one at six exactly is not. Every day is the same: we have not
 * agreed which days we are closed, so nothing here invents a weekend.
 */
export function isOpenInIndia(now: Date, hours: OpeningHours): boolean {
  const { hour } = inIndia(now);
  return hour >= hours.fromHour && hour < hours.toHour;
}

/** "nine in the morning", out of an hour on a twenty-four hour clock. */
export function hourInWords(hour: number, language = 'en'): string {
  const safe = ((Math.trunc(hour) % 24) + 24) % 24;
  const name = pick(HOUR_NAMES, language)[safe % 12];
  const part = pick(PART_OF_DAY, language)[
    safe < 12 ? 'morning' : safe < 17 ? 'afternoon' : 'evening'
  ];
  if (language === 'hi' || language === 'hi-en') return `${part} ${name}`;
  return `${name} ${part}`;
}

/**
 * What the chat says when somebody writes outside our hours.
 *
 * IT PROMISES NOTHING WE HAVE NOT AGREED. It does not say how long, it does not
 * say tomorrow, and it does not name an hour a person will reply. It says when we
 * are open and that somebody will read this when we open, which is the whole of
 * what is true.
 */
export function outsideHoursWords(hours: OpeningHours, language = 'en'): string {
  const from = hourInWords(hours.fromHour, language);
  const to = hourInWords(hours.toHour, language);
  if (language === 'hi') {
    return `फेयर ${from} बजे से ${to} बजे तक खुला रहता है। `
      + 'अभी वह समय नहीं है, इसलिए हम खुलने पर कोई व्यक्ति इसे पढ़ेगा।';
  }
  if (language === 'hi-en') {
    return `Fayr ${from} baje se ${to} baje tak khula rehta hai. `
      + 'Abhi wo samay nahi hai, isliye hum khulne par koi vyakti ise padhega.';
  }
  return `Fayr is open from ${from} to ${to}. `
    + 'It is outside those hours now, so a person will read this when we open.';
}
