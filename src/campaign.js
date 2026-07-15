// ONE hardcoded campaign. Stands in for the campaign model until the backend
// exists - it is the minimum needed to make a fetch legal, because platforms.js
// fails closed without a campaign ASIN (see config.js DEBUG_CAPTURE).
//
// The ASIN below is deliberately an item from a MERGED order: Amazon put it in
// a single order totalling 1326.00 alongside another product. That makes the
// refund maths visible in the running app - a percentage of the ITEM (388.00)
// rather than of the order total. Swap `asin` for any product the connected
// account has actually reviewed.

export const CAMPAIGN = Object.freeze({
  id: 'camp_demo_1',
  marketplace: 'amazon',
  // Item from the merged order: item line 388.00 of a 1326.00 order total.
  asin: 'B0FTYW51JV',
  productName: 'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Shelf',
  // Percent of the ITEM price refunded. Integer - percentOfPaise rejects floats.
  percent: 90,
  // Drives the return-window hold via the policy table in taskflow.js. Not a
  // fetched fact: no marketplace exposes a return window, so this is ours.
  category: 'furniture',
});
