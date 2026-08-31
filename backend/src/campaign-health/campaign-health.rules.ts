import type { CampaignStatus, Platform } from '@prisma/client';
import {
  chargedDisagreesWithCampaign,
} from '../tasks/engine/charged-amount';
import {
  DEFAULT_RETURN_POLICY,
  windowDaysFor,
} from '../tasks/engine/return-policy';

/**
 * THE DAILY CHECK ON EVERY LIVE OFFER — the rules, with no database under them.
 *
 * An offer that is wrong is wrong on a phone, in public, for as long as nobody
 * looks. Nobody looks every day, so something has to. This file is that
 * something: pure functions over facts that have already been gathered, which is
 * what makes them testable at every boundary instead of only against whatever
 * happens to be in the database today.
 *
 * TWO RULES GOVERN EVERY FINDING HERE, and both are about being read rather than
 * being thorough:
 *
 *   1. A FINDING NAMES ITS CONSEQUENCE. "Category is empty" is a remark. "The
 *      category is empty, so refunds on this offer are held for 7 days rather
 *      than the window its category would give it" is a finding. A list of true
 *      remarks is how a team learns to close the tab.
 *   2. WHAT CANNOT BE CHECKED IS SAID, NOT GUESSED. Whether the picture shows the
 *      product, and whether the price still matches the marketplace, cannot be
 *      established from anything Fayr holds — there is no product-page address on
 *      most offers and this job does not go out to the marketplaces. Those come
 *      back as `unchecked`, with the reason. Reporting them as passes would be
 *      the most damaging thing this file could do, because it would be believed.
 */

/** Worst first. The order is the display order. */
export const SEVERITY_ORDER = ['blocking', 'attention', 'unchecked'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export interface Finding {
  code: string;
  severity: Severity;
  /** One short line, in the words of whoever owns the offer. */
  title: string;
  /** What is wrong, what it does to a user, and where to look. */
  detail: string;
  /**
   * The same finding, worded for a LIST of offers rather than one.
   *
   * A finding that lands on most of the catalogue is shown once with a count
   * instead of repeated down the page — and at that point the heading is read by
   * someone looking at ten offers, so "this offer has no category" is simply
   * wrong, and one offer's own price in the heading is worse. Findings that can
   * plausibly group carry this; the rest are singular by nature.
   */
  group?: { title: string; detail: string };
}

/** What was found about the picture file, gathered before the rules run. */
export type ImageFacts =
  | { kind: 'none' }
  | { kind: 'remote' }
  | {
      kind: 'local-file';
      exists: boolean;
      looksLikeImage: boolean;
      /** Titles of OTHER live offers using the same picture. Never includes self. */
      sharedWith: string[];
    };

export interface CampaignFacts {
  id: string;
  title: string;
  productName: string;
  platform: Platform;
  status: CampaignStatus;
  category: string | null;
  productPricePaise: bigint;
  payoutPercent: number;
  payoutCapPaise: bigint | null;
  returnWindowDays: number | null;
  totalSlots: number | null;
  claimedCount: number;
  terms: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  image: ImageFacts;
  /**
   * What people actually paid on this offer, one figure per order, already
   * resolved by the same code the refund gate uses. Empty means nobody has
   * bought yet — which is a reason to stay quiet, not a reason to pass.
   */
  chargedSamples: bigint[];
}

const rupees = (paise: bigint): string => {
  const neg = paise < 0n;
  const a = neg ? -paise : paise;
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${whole}.${String(a % 100n).padStart(2, '0')}`;
};

const blank = (s: string | null | undefined): boolean =>
  s == null || s.trim() === '';

/** What the headline percentage would pay on the listed price. */
const headlinePaise = (price: bigint, percent: number): bigint =>
  (price * BigInt(Math.trunc(percent))) / 100n;

/**
 * The percentage the offer's own title advertises, or null.
 *
 * Only a number immediately followed by a per-cent sign counts. That rules out
 * the two things that would otherwise flood the report: model numbers ("1600W")
 * and prices ("₹599"). A number above 100 is not a payout percentage either — it
 * is a wattage or a quantity — so it is ignored rather than reported as out of
 * range on the strength of a title.
 */
export function headlinePercentInTitle(title: string): number | null {
  const m = /(\d{1,3})\s*%/.exec(title ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : null;
}

/** Every finding on one offer, worst first. */
export function checkCampaign(c: CampaignFacts): Finding[] {
  const out: Finding[] = [];
  const add = (
    code: string,
    severity: Severity,
    title: string,
    detail: string,
    group?: { title: string; detail: string },
  ): void => {
    out.push({ code, severity, title, detail, ...(group ? { group } : {}) });
  };

  // ── the picture ───────────────────────────────────────────────────────────
  if (blank(c.imageUrl) || c.image.kind === 'none') {
    add(
      'picture-missing',
      'blocking',
      'This offer has no picture',
      'There is no picture on this offer, so every card and product page shows a '
        + 'generated placeholder pattern instead of the product. Upload one on the '
        + 'campaign screen.',
    );
  } else if (c.image.kind === 'remote') {
    add(
      'picture-not-fetched',
      'unchecked',
      'The picture is hosted somewhere else',
      `The picture is at ${c.imageUrl}, outside Fayr, and this check does not fetch `
        + 'from other people\'s servers — so whether it still loads has not been '
        + 'established either way. Open the offer to see it.',
    );
  } else {
    const file = (c.imageUrl ?? '').split('/').pop() ?? c.imageUrl ?? '';
    if (!c.image.exists) {
      add(
        'picture-file-missing',
        'blocking',
        'The picture file is not on the server',
        `This offer points at ${file}, and that file is not there. Users see a broken `
          + 'image where the product should be. Re-upload the picture.',
      );
    } else if (!c.image.looksLikeImage) {
      add(
        'picture-not-an-image',
        'blocking',
        'The picture file is not an image',
        `${file} is on the server but its contents are not a PNG, JPEG, WebP or GIF, `
          + 'so nothing will render it. Something other than a picture was uploaded.',
      );
    }
    if (c.image.exists && c.image.sharedWith.length > 0) {
      add(
        'picture-shared',
        'attention',
        'Another live offer shows the same picture',
        `The same picture file is on ${c.image.sharedWith.length} other live `
          + `offer${c.image.sharedWith.length === 1 ? '' : 's'}: `
          + `${c.image.sharedWith.join('; ')}. Either two offers are showing the `
          + 'wrong product, or one of them is a leftover test.',
      );
    }
  }

  // ── the money ─────────────────────────────────────────────────────────────
  if (c.productPricePaise <= 0n) {
    add(
      'price-missing',
      'blocking',
      'The offer has no product price',
      'With no price there is nothing to take a percentage of, so this offer '
        + 'cannot pay a refund and the maximum shown to users is meaningless.',
    );
  }

  if (c.payoutPercent <= 0 || c.payoutPercent > 100) {
    add(
      'percent-out-of-range',
      'blocking',
      `The refund percentage is ${c.payoutPercent}`,
      `A refund percentage of ${c.payoutPercent} cannot be right — it has to be `
        + 'between 1 and 100. Anything at or below zero pays nothing; anything '
        + 'above a hundred pays more than the product cost.',
    );
  }

  if (c.payoutCapPaise != null && c.payoutCapPaise <= 0n) {
    add(
      'cap-is-zero',
      'blocking',
      'The maximum refund is set to zero',
      'This offer has a refund ceiling of zero, so every refund on it works out '
        + `to ${rupees(0n)} however much the buyer paid — and nothing on any screen `
        + 'says so. An offer with no ceiling has the field left EMPTY; a zero is '
        + 'read as a real limit of nothing.',
    );
  } else if (
    c.payoutCapPaise != null
    && c.productPricePaise > 0n
    && c.payoutPercent > 0
    && c.payoutCapPaise < headlinePaise(c.productPricePaise, c.payoutPercent)
  ) {
    const full = headlinePaise(c.productPricePaise, c.payoutPercent);
    add(
      'cap-below-headline',
      'attention',
      'The ceiling stops the advertised percentage being paid',
      `${c.payoutPercent}% of ${rupees(c.productPricePaise)} is ${rupees(full)}, but `
        + `the ceiling on this offer is ${rupees(c.payoutCapPaise)} — so the `
        + 'percentage in the headline is never actually what a buyer gets. That may '
        + 'be deliberate; it is worth being sure.',
    );
  }

  const headline = headlinePercentInTitle(c.title);
  if (headline != null && headline !== c.payoutPercent) {
    add(
      'headline-percent-mismatch',
      'blocking',
      `The title says ${headline}% and the offer pays ${c.payoutPercent}%`,
      `This offer's own title advertises ${headline}%, and the figure that actually `
        + `pays is ${c.payoutPercent}%. One of the two is wrong, and a buyer who `
        + 'reads the title has been told the wrong number.',
    );
  }

  // Real orders against the listed price, compared by the SAME rule the refund
  // gate uses — so the check can never disagree with what a payout would do.
  const samples = c.chargedSamples;
  if (samples.length === 0) {
    // ONE REASON, THE ONE THAT APPLIES. Listing both when only one is true is
    // how a report stops being trusted.
    add(
      'price-not-verified',
      'unchecked',
      'The listed price has not been checked against anything real',
      blank(c.productUrl)
        ? 'There is no product link on this offer, so there is no page to read a '
          + 'current price from, and nobody has bought on it yet either. Whether '
          + `${rupees(c.productPricePaise)} is still the right price is unknown.`
        : 'Nobody has bought on this offer yet, so there is no order to compare '
          + `the listed ${rupees(c.productPricePaise)} against.`,
      {
        title: 'These listed prices have not been checked against anything real',
        detail:
          'Nothing has been bought on these offers, and most carry no product '
          + 'link to read a current price from — so whether their prices are '
          + 'still right is unknown. The first order on an offer settles it, '
          + 'because the check then compares what was really paid.',
      },
    );
  } else {
    const off = samples.filter((paid) =>
      chargedDisagreesWithCampaign(paid, c.productPricePaise),
    );
    if (off.length * 2 > samples.length) {
      const sorted = [...off].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const example = sorted[Math.floor(sorted.length / 2)];
      add(
        'price-disagrees-with-orders',
        'attention',
        'Real orders do not match the listed price',
        `${off.length} of ${samples.length} orders on this offer paid a different `
          + `amount from the ${rupees(c.productPricePaise)} listed — around `
          + `${rupees(example)}. The refund itself uses what was actually paid, so `
          + 'nobody is underpaid; what is wrong is the price and the maximum shown '
          + 'to everyone who has not bought yet.',
      );
    }
  }

  // ── seats ─────────────────────────────────────────────────────────────────
  if (c.totalSlots != null && c.totalSlots <= 0) {
    add(
      'no-seats-at-all',
      'blocking',
      'The offer has no seats',
      `The seat limit on this offer is ${c.totalSlots}, so nobody can claim it, `
        + 'while it still appears on the feed. Either set a real limit or leave the '
        + 'field empty for no limit.',
    );
  } else if (
    c.totalSlots != null
    && c.claimedCount >= c.totalSlots
    && c.status === 'ACTIVE'
  ) {
    add(
      'full-but-still-live',
      'blocking',
      'The offer is full but still on the feed',
      `All ${c.totalSlots} seats are taken (${c.claimedCount} claimed) and the offer `
        + 'is still live, so people are opening it and being refused. Pause it or '
        + 'raise the seat count.',
    );
  }

  // ── what the offer says ───────────────────────────────────────────────────
  if (blank(c.terms)) {
    add(
      'terms-missing',
      'attention',
      'The Terms and conditions section is empty',
      'The product page has a Terms and conditions section and this offer has '
        + 'nothing in it, so the section renders blank to anyone who opens it.',
    );
  }

  // ONE FINDING, TWO CAUSES. An empty category and a category the table does not
  // recognise have the same consequence — refunds held for the default window
  // rather than the one this product should have — so they are one finding whose
  // detail says which it was. Two codes meant the same problem was reported twice
  // under different names, and neither looked widespread on its own.
  const windowDays = windowDaysFor(DEFAULT_RETURN_POLICY, c.category);
  if (c.returnWindowDays == null) {
    const known =
      !blank(c.category)
      && Object.prototype.hasOwnProperty.call(
        DEFAULT_RETURN_POLICY.byCategory,
        String(c.category).toLowerCase(),
      );
    if (!known) {
      add(
        'return-window-is-the-default',
        'attention',
        blank(c.category)
          ? 'No category, so the default return window applies'
          : `"${c.category}" matches no return-window rule`,
        (blank(c.category)
          ? 'This offer has no category, so '
          : `Nothing in the return-window table matches "${c.category}", so `)
          + `refunds on it are held for ${windowDays} days — the default — rather `
          + 'than a window chosen for this kind of product. If that is not right, '
          + 'either set the days on the offer itself or add the category to the '
          + 'table.',
        {
          title: 'These offers fall back to the default return window',
          detail:
            'None of these offers sets its own return window, and none of their '
            + 'categories appears in the return-window table — so refunds on all '
            + `of them are held for ${DEFAULT_RETURN_POLICY.defaultDays} days. `
            + 'That is a decision about the table, not a fix to make one offer at '
            + 'a time: either the categories in use should be in it, or the '
            + 'default is right and this is nothing to act on.',
        },
      );
    }
  }

  // ── and what could not be checked at all ──────────────────────────────────
  if (blank(c.productUrl)) {
    add(
      'picture-not-verified',
      'unchecked',
      'Nobody can tell whether the picture is the right product',
      'There is no product link on this offer, so there is no page to compare the '
        + 'picture against. Whether it shows this product has not been checked and '
        + 'cannot be, by this or any other automatic check, until a link is added.',
      {
        title: 'Nobody can tell whether these pictures are the right products',
        detail:
          'None of these offers has a product link, so there is no page to '
          + 'compare their pictures against. Whether each one shows the product '
          + 'it claims to has not been checked, and cannot be by any automatic '
          + 'check, until the links are added. Only a person opening the '
          + 'marketplace page can settle it today.',
      },
    );
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}
