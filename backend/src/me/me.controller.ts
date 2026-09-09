import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Platform } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContactService } from '../contact/contact.service';
import type { HowToReachUs } from '../contact/contact.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ShopSignInService } from '../shops/shop-sign-in.service';
import { AS_THE_APP_SPELLS_IT } from '../common/platform-name';

/** The signed-in user's own balances. Money is integer paise as a STRING. */
export interface MyWalletResponse {
  ticketBalance: number;
  walletBalancePaise: string;
}

/**
 * The signed-in user's own profile. `setupDone` is what the app checks to decide
 * whether to run the first-run setup sequence — deliberately not "is name set",
 * because a user may complete setup while declining to give a name.
 */
export interface MyProfileResponse {
  id: string;
  displayId: string;
  mobile: string;
  name: string | null;
  ageBand: string | null;
  gender: string | null;
  categories: string[];
  /** Which shops they SAID they use, at setup. A preference, not a fact. */
  platforms: string[];
  /**
   * WHICH SHOPS THEY ARE ACTUALLY SIGNED IN AT, from our own record of it.
   *
   * ── NOT THE SAME FIELD AS `platforms`, AND THE DIFFERENCE IS THE POINT ─────
   *
   * `platforms` is what somebody ticked during setup. This is what really
   * happened, one row per person per shop, written the moment the phone saw a
   * shop treat them as signed in.
   *
   * ── WHY THE APP NEEDS IT, MEASURED ────────────────────────────────────────
   *
   * Because asking a shop for its sign in page when they are already signed in
   * is what gets Fayr taken for a robot. From the owner's log on 9 September
   * 2026: Amazon connect succeeded at 19:06, the app asked Amazon again at 19:10
   * for a second campaign, and Amazon served a page reading only "Click the
   * button below to continue shopping", then 503, then its puzzle. The app asked
   * because it kept its own note keyed by CAMPAIGN in a file on the phone, so a
   * second campaign at the same shop looked like a shop nobody had signed in to.
   *
   * SPELLED THE WAY THE REST OF THIS RESPONSE SPELLS SHOPS. `platforms` carries
   * the app's own lower case keys, so this does too — a response with two
   * spellings of Amazon in it is a response somebody compares wrongly.
   */
  connectedShops: string[];
  setupDone: boolean;
  /** Which terms version is on record, and when it was agreed to. Null until then. */
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  /** Whether a PAN is on file — never the PAN itself. */
  hasPan: boolean;
}

/**
 * The authenticated user's own account reads and profile writes.
 *
 * `/me/wallet` gives the app the ticket count and refundable balance. `/me` is
 * the profile the first-run setup sequence fills in; PATCH is progressive, so a
 * user who abandons setup halfway keeps what they already answered.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly contact: ContactService,
    private readonly signIns: ShopSignInService,
  ) {}

  /**
   * How to reach Fayr: the number to ring, and the sentence to show.
   *
   * THE APP CARRIES NO COPY OF THE NUMBER. It asks, every time the Help screen
   * opens, and shows exactly what comes back. So changing backend/.env and
   * restarting is the whole procedure, with no build and no app update.
   *
   * `words` is always a full sentence. When there is no number, `phone` is
   * nothing and the sentence offers the app instead, so a screen that shows
   * `words` can never show a gap or half a number.
   *
   * Behind the sign-in guard like the rest of /me. Not because the number is a
   * secret, but because the only screen that asks for it is one a signed-in
   * person is already looking at, and an open route is a route to watch.
   */
  @Get('how-to-reach-us')
  howToReachUs(): HowToReachUs {
    return this.contact.howToReachUs();
  }

  @Get('wallet')
  async wallet_(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyWalletResponse> {
    const [ticketBalance, paise] = await Promise.all([
      this.tickets.getBalance(user.id),
      this.wallet.getUserBalance(user.id),
    ]);
    return { ticketBalance, walletBalancePaise: paise.toString() };
  }

  @Get()
  async profile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyProfileResponse> {
    const [row, connected] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      this.signIns.platformsConnected(user.id),
    ]);
    return toProfileResponse(row, connected);
  }

  /**
   * Save setup answers. Only the fields present are written, so each step of the
   * sequence can save as it completes without resending earlier answers.
   */
  @Patch()
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MyProfileResponse> {
    const data: {
      name?: string;
      ageBand?: string;
      gender?: string;
      categories?: string[];
      platforms?: string[];
      setupDoneAt?: Date;
      termsVersion?: string;
      termsAcceptedAt?: Date;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.ageBand !== undefined) data.ageBand = dto.ageBand;
    if (dto.gender !== undefined) data.gender = dto.gender;
    // De-duplicated: the client sends a selection, and a repeated entry would
    // otherwise be stored twice and skew any later use of these lists.
    if (dto.categories !== undefined) data.categories = [...new Set(dto.categories)];
    if (dto.platforms !== undefined) data.platforms = [...new Set(dto.platforms)];

    // CONSENT, RECORDED. Only `true` counts; `false` is ignored rather than read as
    // a withdrawal, which is a separate deliberate act. The version is mandatory
    // because an unversioned record cannot show WHAT was agreed to, and the
    // timestamp is set HERE, on the server — a client-supplied one would prove
    // nothing. A later version replaces the record, which is the correct behaviour
    // when the terms change; nothing can clear it.
    if (dto.acceptTerms === true) {
      const version = (dto.termsVersion ?? '').trim();
      if (version.length === 0) {
        throw new BadRequestException(
          'termsVersion is required when acceptTerms is true: a consent record '
          + 'without a version cannot show what was agreed to.',
        );
      }
      data.termsVersion = version;
      data.termsAcceptedAt = new Date();
    }

    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { setupDoneAt: true },
    });
    // One-way latch: completing setup can be stamped but never cleared, so a
    // later profile edit cannot reopen onboarding for someone who finished it.
    if (dto.setupDone === true && row.setupDoneAt == null) {
      data.setupDoneAt = new Date();
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    // THE CONNECTED SHOPS ARE READ HERE TOO. This response and the one from GET
    // /me are the same shape, and a field that appeared on one and not the other
    // would be a field the app could not rely on.
    const connected = await this.signIns.platformsConnected(user.id);
    return toProfileResponse(updated, connected);
  }
}

function toProfileResponse(row: {
  id: string;
  displayId: string;
  mobile: string;
  name: string | null;
  ageBand: string | null;
  gender: string | null;
  categories: string[];
  platforms: string[];
  setupDoneAt: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  pan: string | null;
}, connectedShops: readonly Platform[]): MyProfileResponse {
  return {
    id: row.id,
    displayId: row.displayId,
    mobile: row.mobile,
    name: row.name,
    ageBand: row.ageBand,
    gender: row.gender,
    categories: row.categories,
    platforms: row.platforms,
    // LOWER CASED to match `platforms` above, through the one map that already
    // knows both spellings rather than toLowerCase() here. A second place that
    // converts between our enum and the app's keys is a second place to get it
    // wrong, and the app keys off this to decide whether to open a shop.
    connectedShops: connectedShops.map((p) => AS_THE_APP_SPELLS_IT[p]),
    setupDone: row.setupDoneAt != null,
    // Returned so the app can tell whether consent is on record and for WHICH
    // version — that is how a terms change becomes visible rather than assumed.
    termsVersion: row.termsVersion,
    termsAcceptedAt: row.termsAcceptedAt ? row.termsAcceptedAt.toISOString() : null,
    // The PAN itself never leaves the server on a profile read — only whether
    // one exists, which is all any screen needs to know.
    hasPan: row.pan != null,
  };
}
