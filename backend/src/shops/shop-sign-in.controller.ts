import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecordShopSignInDto } from './dto/record-shop-sign-in.dto';
import { ShopSignInService } from './shop-sign-in.service';

/** What the phone is told back. Never anything it did not already know. */
export interface ShopSignInResponse {
  platform: string;
  /** True the first time only, so a log can say which calls did something. */
  recorded: boolean;
}

/**
 * THE PHONE TELLING OUR SIDE THAT SOMEBODY GOT SIGNED IN AT A SHOP.
 *
 * WHY THE PHONE HAS TO BE THE ONE TO SAY IT. Signing in happens on the shop's own
 * page, inside the web view, and the thing that says "signed in" is kept by every
 * one of the seven shops where nothing running in that page can read it. So our
 * side cannot go and look. The phone can see the shop greeting somebody by name,
 * or the shop's own sign out control on the page, and those are the two signals.
 *
 * WHICH MEANS IT IS SOMEBODY'S WORD, AND THAT IS SAID OUT LOUD RATHER THAN HIDDEN.
 * A row here is not proof of anything about an order and is never treated as
 * evidence. It moves no money and opens no gate. It is a count, so that the page
 * that measures Fayr can stop saying "we are not watching this yet" about a step
 * every person has to get through.
 *
 * BEHIND THE SIGN IN GUARD, and the person is taken from that sign in and never
 * from the request, so a phone cannot write a row against somebody else.
 */
@Controller('me/shop-sign-ins')
@UseGuards(JwtAuthGuard)
export class ShopSignInController {
  constructor(private readonly signIns: ShopSignInService) {}

  /**
   * Write it down, once.
   *
   * Rate limited, because it is a write a phone can call and there are only ever
   * seven shops: nobody has a reason to say this more than a handful of times.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordShopSignInDto,
  ): Promise<ShopSignInResponse> {
    const done = await this.signIns.record(
      user.id,
      dto.platform,
      dto.howWeKnew ?? 'the phone saw the shop treat them as signed in',
    );
    return { platform: done.platform, recorded: done.wasTheFirstTime };
  }
}
