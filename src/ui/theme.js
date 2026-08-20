// Fayr design tokens — the single source of colour, type and spacing for the
// redesigned RN screens. Ported from the `C` palette + font system in the
// backend-wired prototype (fayr-design.browser.jsx): a warm CREAM ground, GOLD
// as the primary accent, GREEN reserved for money/refund, near-black ink text,
// with pastel tints for category/marketplace colour. Poppins (display),
// Alexandria (the `fayr.` wordmark), Inter (body). Pure module — no RN imports —
// so it can be consumed anywhere and stays trivial to reason about.

export const COLOR = {
  // grounds
  cream: '#F9FAE9',
  creamDeep: '#F1F2D9',
  homeBg: '#FBFBEF',
  surface: '#FFFFFF',
  line: '#ECEDDC',

  // ink
  ink: '#191919',
  ink2: '#262626',
  sub: '#5C5C5C',

  // gold accent (headers, highlights)
  gold: '#FFE000',
  goldDeep: '#F5C400',
  headYellow: '#F6E14B',
  headYellow2: '#FBF3C0',

  // money / refund green
  green: '#68B642',
  greenDeep: '#30A90F',
  greenBg: '#F1F5DB',
  refundBg: '#E4F5C0',
  refundInk: '#3E8E00',

  // supporting
  blue: '#6CAAFC',
  blueBg: '#EAF2FF',
  purple: '#7926D9',
  purpleBg: '#EFE7FF',
  red: '#E5392B',
  redBg: '#FFDCDC',
  amber: '#F5A623',
  amberBg: '#FFF8E1',
  amberLine: '#FECA3A',
};

// Font families = the keys registered in src/ui/fonts.js (loaded via expo-font).
// Fall back to the platform sans if a family somehow isn't loaded yet.
export const FONT = {
  logo: 'Alexandria_800ExtraBold',      // the `fayr.` wordmark
  logoBold: 'Alexandria_700Bold',
  display: 'Poppins_700Bold',           // section titles, headers
  displaySemi: 'Poppins_600SemiBold',   // buttons, card names
  displayXBold: 'Poppins_800ExtraBold', // hero numbers
  body: 'Inter_400Regular',
  bodyMed: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 18, pill: 22, round: 999 };
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export const SHADOW = {
  card: {
    shadowColor: '#141414',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  chip: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
};

// ── money display ───────────────────────────────────────────────────────────
// Indian digit grouping (1,23,456) without relying on Intl, which Hermes only
// partially ships. Input is an integer rupee amount.
export function groupIndian(intValue) {
  const s = String(Math.max(0, Math.floor(intValue)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

// paise (number|string) → "1,23,456" rupee string (whole rupees, floored).
export function rupeesFromPaise(paise) {
  const n = paise == null ? 0 : Number(paise);
  if (Number.isNaN(n)) return '0';
  return groupIndian(Math.floor(n / 100));
}

// The "up to ₹X" estimate shown BEFORE purchase: percent of the campaign's
// expected item price, capped by payoutCapPaise if set. Returns whole rupees.
export function estMaxRefundRupees(campaign) {
  if (!campaign || campaign.productPricePaise == null) return null;
  const pct = campaign.percent != null ? campaign.percent : 100;
  // FLOOR, matching computeRefundPaise's integer division backend-side. Rounding
  // up here would make an "up to" figure that is one paise above anything payable.
  let paise = Math.floor((campaign.productPricePaise * pct) / 100);
  if (campaign.payoutCapPaise != null) paise = Math.min(paise, campaign.payoutCapPaise);
  return groupIndian(Math.floor(paise / 100));
}
