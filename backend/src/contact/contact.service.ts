import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { CALL_BUTTON, callUsWords, howToReachUsTitle, writeToUsWords } from './contact.words';

/** A full international number: a plus sign, a country code, then digits. */
const FULL_NUMBER = /^\+[1-9]\d{7,14}$/;

/** What the app is told, and what the chat answer is built from. */
export interface HowToReachUs {
  /** The number to ring, ready to dial. Null when Fayr has no number. */
  phone: string | null;
  /** The heading. */
  title: string;
  /** The whole sentence. Never has a gap in it. */
  words: string;
  /**
   * What the button that starts the call says. Null when there is nothing to ring.
   *
   * Sent rather than written into the app for the same reason the page that
   * measures Fayr sends its own phrases: a word written in the app is a word the
   * plain-language check never reads.
   */
  button: string | null;
}

/**
 * THE ONE PLACE THAT KNOWS THE SUPPORT NUMBER.
 *
 * It reads backend/.env and nothing else reads it. Nothing here logs the number,
 * because a log is a file, and the rule is that the number lives in one file.
 *
 * TWO GATES, THE SAME ARRANGEMENT AS THE SENDER (see sms.provider.ts). The env
 * schema refuses a half-written number at boot. This refuses one again, because a
 * ConfigService can be built by a script or a test with a half-filled config, and
 * a phone that cannot dial the thing on the screen is worse than no number shown.
 * A refusal here is not a crash: it is treated exactly as "we have no number",
 * which has a safe answer already.
 */
@Injectable()
export class ContactService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * The number, or null.
   *
   * Read on every call rather than kept, so changing backend/.env and restarting
   * is the whole procedure and no second place remembers the old one.
   */
  phoneNumber(): string | null {
    const raw = String(this.config.get('FAYR_SUPPORT_PHONE', { infer: true }) ?? '').trim();
    if (raw === '') return null;
    if (!FULL_NUMBER.test(raw)) return null;
    return raw;
  }

  /** What to show, in one piece, in the language asked for. */
  howToReachUs(language = 'en'): HowToReachUs {
    const phone = this.phoneNumber();
    return {
      phone,
      title: howToReachUsTitle(language),
      words: phone == null ? writeToUsWords(language) : callUsWords(phone, language),
      button: phone == null ? null : CALL_BUTTON,
    };
  }
}
