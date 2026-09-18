import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReportEventDto } from './dto/report-event.dto';
import { UserEventService } from './user-event.service';
import {
  cleanAnonymousId,
  type UserEventName,
  type UserEventPayload,
} from './user-event.types';

/**
 * THE APP TELLING US IT REACHED A SCREEN.
 *
 * ── WHY THIS ONE HAS NO SIGN-IN ON IT ─────────────────────────────────────
 *
 * Every step it accepts happens BEFORE anybody has an account. Opening the app,
 * reading onboarding, arriving at the screen that asks for a number — there is
 * no session yet by definition, so requiring one would mean the first half of
 * the funnel could never be measured at all.
 *
 * That is a real trade and it is made with four guards, not with a shrug:
 *
 *   1. FIVE NAMES. The DTO accepts APP_OPENED, ONBOARDING_DONE,
 *      PHONE_ENTRY_SEEN, FEED_OPENED and SCREEN_VIEWED. Nothing that means money,
 *      an account or a claim can be written through here, so the worst somebody
 *      can forge is a dent in a chart.
 *   2. NO FREE TEXT. Still none, and `screen` did not change that. It is checked
 *      against APP_SCREENS — the app's own route names — so the only strings it
 *      can carry are ones already written down in user-event.types.ts. An
 *      allow-list, not a length check: a length check would take a mobile number.
 *      Nothing personal can arrive on this route, even by accident.
 *   3. A TIGHT THROTTLE. Twenty a minute per address. An app that opens, reads
 *      onboarding and reaches the phone screen sends three. Screen views are the
 *      first thing here that can repeat, so twenty a minute is now a real ceiling
 *      rather than a formality: a person tapping through twenty screens in a
 *      minute is measured, and the twenty-first is dropped rather than queued.
 *      Dropping one is the right trade — this is a chart, not a ledger.
 *   4. IT CANNOT FAIL. It answers 204 whatever happened underneath, so a phone
 *      never retries and never shows anybody an error about analytics.
 *
 * WHAT IT IS NOT: a general event pipe. Every future step that the SERVER can
 * see must be recorded on the server, where it cannot be forged. This route
 * exists only for the things the server genuinely cannot know.
 */
@Controller('events')
export class EventController {
  constructor(private readonly events: UserEventService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async report(@Body() dto: ReportEventDto): Promise<void> {
    // Assembled field by field rather than spread from the DTO, so the only
    // things that can ever reach the payload are the two named here. A spread
    // would silently start storing whatever field somebody adds to the DTO next.
    const payload: UserEventPayload = {};
    if (dto.platform) payload.platform = dto.platform;
    if (dto.screen) payload.screen = dto.screen;

    await this.events.record({
      type: dto.type as UserEventName,
      anonymousId: cleanAnonymousId(dto.anonymousId),
      // undefined and not {} when nothing came with it: an empty object would
      // write `{}` into a column whose null means "this step carried nothing".
      payload: Object.keys(payload).length > 0 ? payload : undefined,
    });
  }
}
