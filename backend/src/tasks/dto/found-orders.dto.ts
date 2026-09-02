import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import {
  LONGEST_ORDER_TEXT,
  MOST_RECENT_ORDERS_ACCEPTED,
} from '../order-candidates';

/**
 * WHAT THE PHONE IS ALLOWED TO SEND, AND NOTHING ELSE.
 *
 * One piece of TEXT per order it found in the shop's own list, newest first.
 *
 * THERE IS NO `matches` FIELD HERE, AND THAT IS THE POINT. The phone looks; the
 * server judges. Whether an order is the campaign's product at the campaign's
 * price is decided on this side, by matchOrderToCampaign, from the text below.
 * The app-wide validation refuses any field that is not on this class, so a
 * phone that tried to send its own verdict is turned away at the door rather than
 * quietly ignored — which is the difference between a rule and a hope.
 *
 * NOR ARE THE FIELDS THEMSELVES ACCEPTED. Not an order number, not a date, not a
 * price. If they were, a phone could hand over a tidy order that never existed.
 * Text is the one thing worth taking, because reading it is the part that can be
 * checked.
 */
export class FoundOrdersDto {
  @IsArray()
  @ArrayMaxSize(MOST_RECENT_ORDERS_ACCEPTED)
  @IsString({ each: true })
  @MaxLength(LONGEST_ORDER_TEXT, { each: true })
  pages!: string[];
}
