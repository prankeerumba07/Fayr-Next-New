/**
 * OCR policy constants: the vision extraction prompt + JSON schema, the per-model
 * token pricing (for cost accounting + the daily cap), and the DI token for the
 * Anthropic client. Model IDs and prices confirmed via the claude-api reference.
 */

/** DI token for the (nullable) Anthropic client — null when no API key is set. */
export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

/** Private-storage sub-folder for verification screenshots. */
export const SCREENSHOT_SUBDIR = 'screenshots';

/**
 * Cap on live (non-deleted) screenshots per task. A task realistically needs a
 * handful (purchase + delivery + review, plus the odd re-upload after a
 * NEEDS_MORE); this stops a single task from being used to dump storage. The
 * app-wide throttler already caps request rate; this caps accumulation.
 */
export const MAX_SCREENSHOTS_PER_TASK = 12;

/**
 * Per-model token rates in MICRO-USD per token ($1 / 1M tokens = 1 µUSD/token).
 * Used for cost accounting + the daily spend cap. Standard (non-intro) rates, so
 * cost is never under-counted. Unknown models fall back to the Sonnet rate.
 *   Haiku 4.5: $1 / $5 per MTok. Sonnet 5: $3 / $15 per MTok.
 */
export const MODEL_RATES: Readonly<
  Record<string, { input: number; output: number }>
> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
};
export const DEFAULT_RATE = { input: 3, output: 15 };

/** Image content types the vision API accepts (matches our upload allowlist). */
export type ImageMediaType =
  'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/**
 * Matching thresholds — MIRRORED from the scraper's order matcher
 * (src/verify.js `matchOrderByNameAmount`), NOT invented here. Keep them in step
 * with that file if it ever changes; this is the backend/paise copy.
 *
 *   - Amount tolerance is a band, never exact equality: `max(absolute floor,
 *     percentage of expected)`. COD fees, rounding, and coupon stacking shift the
 *     paid figure off the campaign price, so exact equality would false-MISMATCH
 *     genuine screenshots. The scraper uses ₹2 / 5%; ₹2 = 200 paise here.
 *   - Product name is token-overlap (see productScore); ≥ 0.6 counts as a match.
 */
export const AMOUNT_ABS_TOLERANCE_PAISE = 200n; // ₹2  — src/verify.js absTol
export const AMOUNT_PCT_TOLERANCE = 0.05; //        5%  — src/verify.js pctTol
export const NAME_MATCH_THRESHOLD = 0.6; //             — src/verify.js nameThreshold

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a screenshot of an Indian e-commerce order, delivery, or product review (Amazon, Flipkart, Meesho, Myntra, Blinkit, Zepto, Instamart).

Rules:
- Report ONLY what is clearly visible in the image. If a field is not present or not legible, return null for it. Never guess or infer values that aren't shown.
- amount = the price the buyer paid, as a plain number in the screenshot's currency (e.g. 1299.00), with currency (e.g. "INR"). Do not add or subtract shipping/discounts — report the figure shown.
- orderDate = the order/purchase date if shown, as an ISO date (YYYY-MM-DD) when you can determine it, else null.
- deliveryStatus = the delivery state text if shown (e.g. "Delivered", "Out for delivery"), else null.
- rating = the star rating (1-5) if this is a review screenshot, else null.
- confidence = 0-100, your confidence that the extracted fields are correct and complete, based on legibility and how much is visible.
- You are extracting content only; you are NOT deciding whether the proof is valid — a human reviews that.`;

export const EXTRACTION_USER_INSTRUCTION =
  'Extract the order / delivery / review details from this screenshot as JSON.';

/**
 * JSON schema for `output_config.format` — every field required, nullable via a
 * ["type","null"] union (structured outputs forbids min/max/length constraints,
 * so ranges like rating 1-5 are enforced in the matching layer, not here).
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    orderNumber: { type: ['string', 'null'] },
    productName: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    orderDate: { type: ['string', 'null'] },
    deliveryStatus: { type: ['string', 'null'] },
    rating: { type: ['integer', 'null'] },
    marketplace: { type: ['string', 'null'] },
    confidence: { type: 'integer' },
    notes: { type: ['string', 'null'] },
  },
  required: [
    'orderNumber',
    'productName',
    'amount',
    'currency',
    'orderDate',
    'deliveryStatus',
    'rating',
    'marketplace',
    'confidence',
    'notes',
  ],
} as const;
