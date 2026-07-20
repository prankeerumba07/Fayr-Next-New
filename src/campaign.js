// The campaigns. Stands in for the campaign model until the backend exists.
//
// A real Fayr campaign carries NO marketplace product id: the user reads the
// campaign, is dropped on the marketplace HOME page, searches the product
// themselves and buys it. So the only keys we have to find the order in their
// history are the two things printed on the campaign page: the product NAME and
// the expected AMOUNT (see src/verify.js matchOrderByNameAmount). Amazon is the
// exception - its order list is walled, so that one still matches on ASIN.
//
// ── TO TEST FLIPKART / MYNTRA ON-DEVICE ──────────────────────────────────────
// Set FLIPKART_TEST and MYNTRA_TEST below to a product you have ACTUALLY BOUGHT
// on that account. Use the product's name as it reads in your order history and
// the price you paid (whole rupees). Then reload the app, open that marketplace,
// log in, and tap "Fetch". The tool should find that order by name (+amount) and
// show it on the task screen for you to confirm - no screenshot.
// ─────────────────────────────────────────────────────────────────────────────

// EDIT THESE to match a real past order on each account:
const FLIPKART_TEST = {
  productName: 'boAt Airdopes 141', // ← the product name as in your Flipkart orders
  amount: 1299,                      // ← the price you paid (₹, whole rupees)
};
const MYNTRA_TEST = {
  productName: 'Roadster Men Shirt', // ← the product name as in your Myntra orders
  amount: 799,                       // ← paid price (Myntra amount isn't checked yet; name is)
};
// Quick-commerce (Zepto/Blinkit/Instamart). The amount here is matched against
// the ORDER TOTAL (these platforms don't expose a per-item price on web), so use
// the total you paid for that order. Name is the primary key.
const ZEPTO_TEST = {
  productName: 'Amul Gold Milk',  // ← a product name as it reads in your Zepto orders
  amount: null,                    // ← the order total (₹) if you want the amount check; else null
};
const BLINKIT_TEST = {
  productName: 'Amul Butter',      // ← a product name as it reads in your Blinkit orders
  amount: null,
};
const INSTAMART_TEST = {
  productName: 'Maggi Noodles',    // ← a product name as it reads in your Instamart orders
  amount: null,                    // ← Instamart web doesn't expose the amount; name only
};

export const CAMPAIGNS = Object.freeze([
  {
    id: 'camp_amazon_1',
    marketplace: 'amazon',
    // Item from a MERGED order (item line 388.00 of a 1326.00 order total), so
    // the refund maths - a % of the ITEM, not the order total - stays visible.
    asin: 'B0FTYW51JV',
    productName: 'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Shelf',
    amount: 388,
    percent: 90,
    category: 'furniture',
  },
  {
    id: 'camp_flipkart_1',
    marketplace: 'flipkart',
    productName: FLIPKART_TEST.productName,
    amount: FLIPKART_TEST.amount,
    percent: 80,
    category: 'electronics',
  },
  {
    id: 'camp_myntra_1',
    marketplace: 'myntra',
    productName: MYNTRA_TEST.productName,
    amount: MYNTRA_TEST.amount,
    percent: 70,
    category: 'apparel',
  },
  {
    id: 'camp_zepto_1',
    marketplace: 'zepto',
    productName: ZEPTO_TEST.productName,
    amount: ZEPTO_TEST.amount,
    percent: 50,
    category: 'grocery',
  },
  {
    id: 'camp_blinkit_1',
    marketplace: 'blinkit',
    productName: BLINKIT_TEST.productName,
    amount: BLINKIT_TEST.amount,
    percent: 50,
    category: 'grocery',
  },
  {
    id: 'camp_instamart_1',
    marketplace: 'instamart',
    productName: INSTAMART_TEST.productName,
    amount: INSTAMART_TEST.amount,
    percent: 50,
    category: 'grocery',
  },
]);

export function campaignById(id) {
  return CAMPAIGNS.find((c) => c.id === id) || null;
}

export function campaignForMarketplace(key) {
  return CAMPAIGNS.find((c) => c.marketplace === key) || null;
}

// Back-compat alias: some older single-task code paths still import CAMPAIGN.
export const CAMPAIGN = CAMPAIGNS[0];
