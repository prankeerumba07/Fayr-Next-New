import { Matches } from 'class-validator';

/**
 * A per-unit price a reviewer is considering, in integer paise as a string.
 *
 * No upper bound here on purpose: the real ceiling depends on the task (the
 * campaign's price and the order's total), so it is enforced where those are
 * known. A preview that refused a figure the write path would accept — or worse,
 * allowed one it would refuse — would be a preview nobody could trust.
 */
export class AmountPreviewQuery {
  @Matches(/^\d{1,12}$/, {
    message: 'unitPricePaise must be integer paise as a string',
  })
  unitPricePaise!: string;
}
