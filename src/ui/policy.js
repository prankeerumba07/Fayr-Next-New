// The terms a user agrees to, and what we do with their data. Data, not markup,
// so it is testable and so the same text can be shown at signup and re-read later
// from Profile.
//
// This is not decoration. CLAUDE.md makes clawback rights the countermeasure to
// loophole 3 (a review deleted after payout) — and a clawback right the user was
// never shown does not exist. The consent step at signup is what makes the rest
// of the fraud model enforceable, which is why CLAWBACK_CLAUSE_ID is asserted by
// a test rather than trusted to survive future edits.

export const POLICY_VERSION = '2026-08-13';

/** The clause the fraud model depends on. Named so a test can prove it is present. */
export const CLAWBACK_CLAUSE_ID = 'clawback';

export const TERMS = [
  {
    id: 'what-fayr-is',
    heading: 'What Fayr is',
    body:
      'Fayr pays you back for a product you buy on a marketplace, review honestly, '
      + 'and keep. You claim an offer, buy the product yourself, write your own '
      + 'review, and once that review is publicly visible and the return window has '
      + 'closed, we refund the amount shown on the offer.',
  },
  {
    id: 'refund-basis',
    heading: 'What we refund',
    body:
      'The refund is a percentage of the amount you were ACTUALLY CHARGED for the '
      + 'product — never a listed, struck-through or sticker price. If the amount you '
      + 'paid is lower than the price on the offer, the lower amount is used. '
      + 'Shipping, fees and other items in the same order are not included.',
  },
  {
    id: 'payment-methods',
    heading: 'How you must pay',
    body:
      'Pay with a method that leaves a verifiable charge: a card, UPI, net banking '
      + 'or cash on delivery. Marketplace gift cards, wallet balances and promotional '
      + 'credit are not eligible, because there is no charge for us to verify.',
  },
  {
    id: 'honest-reviews',
    heading: 'Your review is yours',
    body:
      'Write what you actually think. We never ask for a star rating, never ask you '
      + 'to change a review, and a negative review is paid exactly like a positive '
      + 'one. Do not mention Fayr, a refund or an incentive in the review itself.',
  },
  {
    id: 'one-purchase',
    heading: 'One purchase, one refund',
    body:
      'A single order can be refunded on one offer only. If the same order number '
      + 'appears against a second offer, that claim is held until a Fayr reviewer '
      + 'checks it — a genuine basket with several products can qualify more than '
      + 'once, but it needs a person to confirm it.',
  },
  {
    id: 'holding-period',
    heading: 'The waiting period',
    body:
      'We hold every claim until the marketplace return window has closed, and we '
      + 're-check that your review is still publicly visible during that time. If '
      + 'the review disappears before the window closes, the refund is not released.',
  },
  {
    id: CLAWBACK_CLAUSE_ID,
    heading: 'If a review is removed after payout',
    body:
      'If you delete, hide or materially rewrite your review after we have paid you, '
      + 'or you return the product, Fayr may reclaim the refund — by deducting it '
      + 'from your wallet balance, withholding future refunds, or recovering it as a '
      + 'debt. We will tell you why before we do.',
  },
  {
    id: 'one-account',
    heading: 'One person, one account',
    body:
      'One account per person, verified by your PAN and your payout details. Multiple '
      + 'accounts, shared payout details, or claims for someone else’s purchase end '
      + 'the account and forfeit unpaid refunds.',
  },
  {
    id: 'tickets',
    heading: 'Tickets',
    body:
      'Claiming an offer spends tickets. They come back if the claim expires before '
      + 'you buy, and you earn tickets back once a completed refund has been paid out '
      + 'to you. Tickets have no cash value and cannot be transferred.',
  },
  {
    id: 'wallet',
    heading: 'Your wallet and withdrawals',
    body:
      'Refunds land in your Fayr wallet. You can request a withdrawal to your own UPI '
      + 'or bank account above the minimum shown on the wallet screen. A Fayr reviewer '
      + 'approves each withdrawal before it is sent.',
  },
];

export const PRIVACY = [
  {
    id: 'what-we-read',
    heading: 'What we read from a marketplace',
    body:
      'When you connect a shopping account, the app reads only your own order and '
      + 'review pages, on your device, to confirm the purchase, the delivery date and '
      + 'that your review is live. We do not read your messages, your payment '
      + 'instruments, or anything you did not claim an offer for.',
  },
  {
    id: 'credentials',
    heading: 'We never see your marketplace password',
    body:
      'You sign in to the marketplace on its own page. Fayr never receives, stores or '
      + 'transmits that password, and we will never ask you for it, for an OTP, or for '
      + 'your PAN outside the payout screen.',
  },
  {
    id: 'what-we-store',
    heading: 'What we store',
    body:
      'Your mobile number, the offers you claim, the order and review details we '
      + 'verified, your wallet and ticket history, and your payout details. Payout '
      + 'details and your PAN are stored to pay you and to stop one person holding '
      + 'several accounts.',
  },
  {
    id: 'screenshots',
    heading: 'Screenshots you send us',
    body:
      'A screenshot you upload as proof is private. It is not published anywhere, it '
      + 'is only opened by Fayr staff reviewing your claim, and every time a staff '
      + 'member views one it is recorded.',
  },
  {
    id: 'sharing',
    heading: 'Who else sees it',
    body:
      'We do not sell your data and we do not share it with marketplaces. We share '
      + 'only what a payment provider needs to send your money, or what the law '
      + 'requires.',
  },
  {
    id: 'your-rights',
    heading: 'Your choices',
    body:
      'You can ask us for a copy of your data or ask us to delete your account from '
      + 'the Help screen. Some records — paid refunds and their ledger entries — are '
      + 'kept as long as the law requires, even after an account closes.',
  },
];

/** The one-line consent shown at signup, with the two things it links to. */
export const CONSENT_LINE = 'I agree to the Terms & Conditions and Privacy Policy';

export function policyDoc(kind) {
  return kind === 'privacy'
    ? { title: 'Privacy Policy', sections: PRIVACY }
    : { title: 'Terms & Conditions', sections: TERMS };
}
