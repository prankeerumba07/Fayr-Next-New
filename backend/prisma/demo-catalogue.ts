import type { Prisma } from '@prisma/client';

/**
 * THE DEMO CATALOGUE, CAPTURED FROM THE DATABASE IT WAS BUILT IN.
 *
 * These fifteen offers were created one at a time through the admin panel over
 * three weeks and existed ONLY in the local fayr_dev database — in no file, in no
 * commit, and therefore recoverable from nothing. The demo run-sheet quotes their
 * exact titles, prices and positions, so losing that database meant losing the
 * demo with it.
 *
 * So they are captured here verbatim, and two properties are load-bearing:
 *
 *   1. THE IDS ARE THE REAL ONES. Seeding the database these came from is
 *      therefore a no-op for campaigns — nothing is duplicated, nothing is
 *      renumbered, and the feed order the run-sheet was checked against does not
 *      move.
 *   2. createdAt IS PRESERVED. It is not decoration: the order-window rule floors
 *      a qualifying purchase at the later of the claim and the CAMPAIGN's
 *      creation, so a campaign re-created "now" would refuse the very orders the
 *      demo journeys depend on.
 *
 * Captured 26 August 2026. Regenerate rather than hand-edit if the panel is used
 * to change an offer, and keep the ids.
 *
 * NOT captured: the images. imageUrl points at backend/uploads/campaigns/*.png,
 * which is gitignored and untracked, so a fresh clone shows a broken image where
 * a product photo should be. The files survive a Docker restart because they sit
 * on the host filesystem, not in the container.
 */
/**
 * A seeded offer. Prisma makes `id`, `title` and the money optional on a create
 * input because the database can default them; nothing here may leave them out.
 * Stating that in the type is what lets the journeys below read `c.id` without a
 * non-null assertion on every line — an assertion is a claim, and a claim that is
 * repeated twenty times is one nobody checks.
 */
export type SeededCampaign = Prisma.CampaignCreateInput & {
  id: string;
  title: string;
  productName: string;
  productPricePaise: bigint;
};

export const DEMO_CAMPAIGNS: SeededCampaign[] = [
  {
    id: 'b23034ca-4fdd-44b1-88dc-fb96bf75f1b6',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Carry Your Laptop with Confidence, Comfort, and Style',
    productName: 'tomtoc 13-14 Inch Laptop Carrying Case for MacBook Air, MacBook Pro, Microsoft Surface Laptop Studio/Book, Water-Resistant Multi-Functional Laptop Handbag Briefcase for Daily Business, Study, Yellow',
    category: 'Accessories',
    productPricePaise: 499900n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: 'B09F94RLHX',
    productUrl: null,
    imageUrl: '/uploads/campaigns/0a61d7c3-1aab-4b84-a39b-02adcf4b2c5c.png',
    terms: 'Your Amazon account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer - no other bag, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Amazon account, your order emails, or a screenshot you upload.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-04T07:43:56.015'),
  },
  {
    id: 'c31a8fae-b148-477e-a0a1-489a61c6717a',
    platform: 'FLIPKART',
    status: 'ACTIVE',
    title: 'A Prestige 1600W induction cooktop with push-button controls — an electric stovetop that doesn\'t need a gas cylinder.',
    productName: 'Prestige 1600 W Induction Cooktop, Push Button',
    category: 'Electronics',
    productPricePaise: 219900n,
    payoutPercent: 85,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: 50,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/7426dbf5-628d-44a5-b18b-5f7431f8cd6f.png',
    terms: 'Your Flipkart account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer - no other cooktop, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Flipkart account, your order emails, or a screenshot you upload.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is 85% of the price you actually paid, sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-04T07:49:07.101'),
  },
  {
    id: '1adcdf9a-074e-4774-8e8a-d8c94f41bbd1',
    platform: 'ZEPTO',
    status: 'ACTIVE',
    title: 'A black metal bedside lamp with a pleated off-white fabric shade — a small table lamp for a nightstand.',
    productName: 'Homesake Matt Black Twister Metal Bedside Lamp, Pleated Off-White Shade',
    category: 'Home',
    productPricePaise: 67600n,
    payoutPercent: 95,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: 25,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/cf08251f-33db-4aa8-ae2d-029852161e9e.png',
    terms: 'Your Zepto account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer - no other lamp, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Zepto account, your order details, or a screenshot you upload.\nThis offer only needs a star rating inside the Zepto app - a written review is not required.\nRefund is 95% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-04T07:55:13.538'),
  },
  {
    id: 'ca4bffd0-7be4-4689-b9dc-53664d11dd4c',
    platform: 'FLIPKART',
    status: 'ACTIVE',
    title: 'Dollar Bigboss Men Vest',
    productName: 'Dollar Bigboss Men Vest',
    category: 'Apparel',
    productPricePaise: 14300n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/70918960-8d63-44ce-a665-bbfa76922cc9.png',
    terms: 'Your Flipkart account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer — no other vest, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Flipkart account, your order emails, or a screenshot you upload.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-04T09:32:24.958'),
  },
  {
    id: 'd5aa2c72-164c-4bed-9e96-d3f5d3cfd7ae',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Spin Your Storage -  5-Layer Vegetable Rack, 90% Back',
    productName: 'Amazon Brand - Solimo 5-Layer Revolving Vegetable Kitchen Rack, Multipurpose Storage Trolley with Wheels, White',
    category: 'Home & Kitchen',
    productPricePaise: 222200n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: 'B0CB5NXGFT',
    productUrl: null,
    imageUrl: '/uploads/campaigns/49e8750b-68a8-4d0d-aa9a-29e6842c83fe.png',
    terms: 'Your Amazon account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer — no other rack, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Amazon account, your order emails, or a screenshot you upload.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-07T07:32:05.322'),
  },
  {
    id: '17fd8d8e-f9af-400f-921c-9fba011fd96f',
    platform: 'BLINKIT',
    status: 'ENDED',
    title: 'Wash Away the Price - Soulflower Soap, 90% Back',
    productName: 'Soulflower Handmade Soap (Pack of 4)',
    category: null,
    productPricePaise: 160000n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/a2a1b7a7-39a8-4f1d-b881-a48ac033dabd.png',
    terms: 'Your Blinkit account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer — no other soap pack, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Blinkit account or your order details.\nThis offer only needs a star rating inside the Blinkit app - a written review is not required.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-08T09:19:28.296'),
  },
  {
    id: 'a64ee2ca-0fa9-4967-be8c-11cdd3d4e538',
    platform: 'INSTAMART',
    status: 'ENDED',
    title: 'Set the Table, Get 90% Back - Cello Dinner Set',
    productName: 'Cello Dazzle Series Tropical Lagoon Dinner Set',
    category: null,
    productPricePaise: 99900n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/f69ab2f7-b733-4029-a2c5-7a71df85c8fe.png',
    terms: 'Your Instamart account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer — no other dinner set, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Instamart account or your order details.\nThis offer only needs a star rating inside the Instamart app — a written review is not required.\nThe refund is 90% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-08T09:23:03.083'),
  },
  {
    id: 'ef46315a-be5a-4087-98a2-75d66a30e9bf',
    platform: 'INSTAMART',
    status: 'ACTIVE',
    title: 'Shave Smart, Get 90% Back - Gillette Fusion 5',
    productName: 'Gillette Fusion 5, Shaving Razor for Men, With Back Blade for Beard Shaping',
    category: null,
    productPricePaise: 33600n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/6d026bd8-76ee-4af1-8ffa-22c50de3df36.png',
    terms: 'Your Instamart account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer - no other razor, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Instamart account or your order details.\nThis offer only needs a star rating inside the Instamart app - a written review is not required.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-08T09:55:34.348'),
  },
  {
    id: '72fd5c5f-4605-4346-b69a-d89f0fa27dd8',
    platform: 'BLINKIT',
    status: 'ACTIVE',
    title: 'Bloom Big, Get 90% Back - Chrysanthemum Flower Pot',
    productName: 'Nostrae By Ekhasa Chrysanthemum Artificial Flower Pot',
    category: 'Home/Decor',
    productPricePaise: 59900n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: 30,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/db2bdac1-fc70-467b-b604-4b947a5869a8.png',
    terms: 'Your Blinkit account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer. No other flower pot, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Blinkit account or your order details.\nThis offer only needs a star rating inside the Blinkit app. A written review is not required.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-08T09:59:19.097'),
  },
  {
    id: '6ecc3200-4894-48b3-8d9f-862958c6a2ed',
    platform: 'INSTAMART',
    status: 'ENDED',
    title: 'Smooth Shave, 90% Back - Gillette Fusion 5',
    productName: 'Gillette Fusion 5, Shaving Razor for Men, With Back Blade for Beard Shaping',
    category: 'Personal Care',
    productPricePaise: 33600n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: null,
    terms: null,
    createdAt: new Date('2026-08-08T10:09:47.088'),
  },
  {
    id: '8d92f0d7-4561-460b-a560-75655ed44f9e',
    platform: 'ZEPTO',
    status: 'ACTIVE',
    title: 'Strap In, Get 90% Back - Boldfit Headband',
    productName: 'Boldfit Strapless Sports Headband',
    category: null,
    productPricePaise: 14900n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/717a4e70-26aa-452a-8b26-cef78d0c3430.png',
    terms: 'Your Zepto account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer. No other headband, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Zepto account or your order details.\nThis offer only needs a star rating inside the Zepto app. A written review is not required.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your rating is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-10T08:49:17.377'),
  },
  {
    id: 'b6ade1a9-7601-460c-b119-d36d7c819a08',
    platform: 'FLIPKART',
    status: 'ACTIVE',
    title: 'Step Up in Style - Modrix Heels, 90% Back',
    productName: 'Modrix Fashion Women Heels',
    category: null,
    productPricePaise: 32800n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/a453d2c6-6b09-4c8b-948d-c0cee1563b86.png',
    terms: 'Your Flipkart account must use the same mobile number or email that is registered on Fayr.\nBuy the exact product and listing shown in this offer. No other heels, no other listing.\nOne entry per person. Slots are given on a first-come, first-served basis.\nYour order and delivery are checked using your Flipkart account or your order details.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is 90% of the price you actually paid, sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-11T09:00:52.282'),
  },
  {
    id: 'c7e2f68d-8c1c-4136-a453-68adb53ff399',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Train in Comfort, Get 90% Back.',
    // ── THE NAME THE TWO PAGES AGREE ON, AND NOT THE ONE ON THE LISTING ───
    //
    // MEASURED ON THE OWNER'S OWN ACCOUNT, 16 September 2026. Amazon calls this
    // one product two different things, and Fayr has to match BOTH:
    //
    //   his ORDER page   Nike M PROMINA Extra Wide Black/White
    //   his REVIEW page  Nike Mens Promina Extra Wide Training Shoes
    //
    // The old value here — "Nike PROMINA Extra Wide Training Shoes, Black/White"
    // — is the LISTING title, and it matches neither. sameProductName asks
    // whether either name contains the other once punctuation is dropped, and
    // the listing title has "Black/White" the review page lacks and lacks the
    // "Mens" the review page has. So the order read answered
    // product_name_not_found on a page with the shoes printed on it.
    //
    // "PROMINA Extra Wide" is inside both, checked both ways against the real
    // strings. It is deliberately the SHORTEST thing that is: every extra word
    // is one more chance for one of the shop's two spellings to differ.
    productName: 'PROMINA Extra Wide',
    category: null,
    productPricePaise: 499500n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: 'B0F16FQFZY',
    productUrl: null,
    imageUrl: '/uploads/campaigns/ee09a091-1374-48ff-b872-fb8b19723a1a.png',
    terms: 'Your Amazon account must use the same mobile number or email address registered with Fayr.\nBuy the exact product, size, and listing shown in this offer. No other shoe, no other listing.\nYour order and delivery are checked using your Amazon account or your order details.\nYou must write a genuine, honest review after you receive and use the product.\nThe refund is 90% of the price you actually paid and is sent to your Fayr wallet after your review is checked and the return window has closed.\nReturning the product, or cancelling the order, cancels this offer and no refund will be given.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
    createdAt: new Date('2026-08-11T09:06:02.892'),
  },
  {
    id: '6a0b2e06-59ec-442e-935e-d73eee01e6c3',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Hang It Up, Get 85% Back - Lukzer Garment Rack',
    productName: 'Lukzer Heavy-Duty Metal Garment Rack with Bottom Storage Shelf & 4 Side Hooks',
    category: null,
    productPricePaise: 93800n,
    payoutPercent: 85,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: 'B0FBK246D1',
    productUrl: null,
    imageUrl: '/uploads/campaigns/7771442c-da79-4412-b7bc-3479ccb9e423.png',
    terms: 'Your Amazon account must use the same mobile number or email address registered with Fayr.\nBuy the exact product and listing shown in this offer. No other rack, no other listing.\nYour order and delivery are checked using your Amazon account or your order details.\nYou must write a genuine, honest review after you receive and use the product.\nRefund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.\nYou may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.\nYou may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.\nIf your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.\nThis is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.\nReturning the product or cancelling the order cancels this offer, and no refund will be given.',
    createdAt: new Date('2026-08-11T10:52:12.307'),
  },
  {
    id: '07e4a646-bed5-4594-962e-d6c6d61cf69c',
    platform: 'FLIPKART',
    status: 'ACTIVE',
    title: 'Modrix heels — price-guard test',
    productName: 'Modrix Fashion Women Heels',
    category: null,
    productPricePaise: 32800n,
    payoutPercent: 90,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: null,
    totalSlots: null,
    asin: null,
    productUrl: null,
    imageUrl: '/uploads/campaigns/a453d2c6-6b09-4c8b-948d-c0cee1563b86.png',
    terms: null,
    createdAt: new Date('2026-08-13T07:44:30.042'),
  },
];
