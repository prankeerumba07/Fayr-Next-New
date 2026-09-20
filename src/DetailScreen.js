// Campaign detail — the pre-claim product reveal, split out of TaskScreen so
// "should I take this?" and "how is my task going?" are two distinct screens
// (matching the prototype's detail → claim → task-status flow).
//
// Everything on this screen is REAL campaign data from the backend
// (campaignStore) plus the authoritative task snapshot (taskStore). The
// prototype's cosmetic metadata — slots remaining, days left, ribbon, rating,
// variant — is deliberately NOT shown: the backend has no such fields and we
// chose not to invent them.
//
// The prototype's 3D <model-viewer> hero is a web-only technology; here the hero
// is the campaign's real product photo on a soft gradient stage.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import {
  claim as claimTask, getAuthoritative, hasTask, subscribe,
} from './taskStore';
import { getWallet } from './backend/meApi';
import { refundLines, ticketPlan } from './ui/confirmJoin';
import { formatPaise } from './money';
import { COLOR, FONT, RADIUS, SPACE, SHADOW, estMaxRefundRupees } from './ui/theme';
import { seatsLine, joinedLine, isFullCampaign, lockedReason } from './ui/seats';
import { Card, RefundBadge, MarketplaceTag, ProductImage } from './ui/primitives';
import { copyToClipboard } from './ui/clipboard';
import { TERMS_SENTENCE, acceptedTerms, claimBlockedLine } from './ui/terms';
import { enterTheShop } from './shop/enterTheShop';
// WHERE A CLAIM GOES, decided in one pure place so the sign in cannot be
// dropped again by a screen. See src/journey/afterClaim.js.
import { whereAClaimGoes, signInParams } from './journey/afterClaim.js';
import { isConnected } from './backend/connectedShops';
import { reachedBottom } from './ui/detailReveal';
import { goBackOrHome } from './ui/nav';

// Soft per-campaign hero tint (deterministic from the id) — the fayr palette's
// pastels, standing in for the prototype's per-product theme colours.
const HERO_TINTS = [
  ['#F3E9FF', '#FBF3D9'],
  ['#E7F1FF', '#F1F5DB'],
  ['#FFE9F0', '#FBF3D9'],
  ['#E9F7E4', '#EAF2FF'],
  ['#FFF3E0', '#F9FAE9'],
];
function heroTint(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return HERO_TINTS[h % HERO_TINTS.length];
}

// "2d 5h remaining" / "4h remaining" / null once past. Minute-level precision is
// enough for a multi-day reservation, so this needs no 1-second ticker.
function remaining(untilMs, now) {
  if (untilMs == null) return null;
  const ms = untilMs - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function Section({ title, children, style }) {
  return (
    <View style={[{ marginTop: SPACE.xxl }, style]}>
      <Text style={styles.sectionHead}>{title}</Text>
      {children}
    </View>
  );
}

function Step({ icon, title, sub, tint, last }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepIcon, { backgroundColor: tint }]}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1, paddingTop: 3, paddingBottom: last ? 0 : 16 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function Bullet({ children }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function Faq({ q, a, open, onToggle }) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onToggle} style={styles.faq}>
      <View style={styles.faqHead}>
        <Text style={styles.faqQ}>{q}</Text>
        <Text style={styles.faqChevron}>{open ? '⌃' : '⌄'}</Text>
      </View>
      {open ? <Text style={styles.faqA}>{a}</Text> : null}
    </TouchableOpacity>
  );
}

export default function DetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const campaignId = (route && route.params && route.params.campaignId) || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;

  const [claimed, setClaimed] = useState(campaignId ? hasTask(campaignId) : false);
  const [authoritative, setAuthoritative] = useState(
    campaignId ? getAuthoritative(campaignId) : null,
  );
  const [faqOpen, setFaqOpen] = useState(-1);
  const [copied, setCopied] = useState(false);
  // THE TERMS TICK BOX. Not remembered between visits on purpose: accepting the
  // terms is something a person does when they are about to claim, and a tick that
  // survived from a week ago is not an acceptance made now.
  const [accepted, setAccepted] = useState(false);
  // HAS THE READER GOT TO THE END OF THE PAGE? The claim block is see-through and
  // untappable until they have. It never goes back: scrolling up again does not
  // unread the page, and a claim button that came and went would be worse than one
  // that waited.
  const [revealed, setRevealed] = useState(false);
  const [viewport, setViewport] = useState(0);
  // THE TICKET NUMBERS THE CONFIRMATION PAGE USED TO CARRY. That page is off the
  // path, so the balance is read here instead. An unknown balance stays unknown:
  // ticketPlan answers "we do not know" rather than guessing, and the row shows a
  // dash. This is the screen where 5 tickets are actually spent, so a guessed
  // number here would be a guess about somebody's money.
  const [wallet, setWallet] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!campaignId) return undefined;
    const un = subscribe((id) => {
      if (id !== campaignId) return;
      setClaimed(hasTask(campaignId));
      setAuthoritative(getAuthoritative(campaignId));
    });
    setClaimed(hasTask(campaignId));
    setAuthoritative(getAuthoritative(campaignId));
    return un;
  }, [campaignId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    getWallet().then((w) => { if (live && w.ok) setWallet(w); });
    return () => { live = false; };
  }, []);

  // The claim no longer happens here. 5 tickets commit on the next screen, where
  // the design puts the cost, the refund, the deadline and the honesty
  // acknowledgement in front of the user first — this button used to spend them
  // on one tap, with the terms only visible further up the page.
  //
  // It opens the JOURNEY now, at its first page, rather than jumping straight to
  // the confirmation. The journey is the spine: everything from here to the
  // refund is one sequence, and starting inside it means the step counter is
  // right from the very first screen instead of appearing halfway through.
  const onScrolled = useCallback((e) => {
    const n = e.nativeEvent;
    if (reachedBottom({
      offsetY: n.contentOffset.y,
      viewportHeight: n.layoutMeasurement.height,
      contentHeight: n.contentSize.height,
    })) {
      setRevealed(true);
    }
  }, []);

  // THE CLAIM HAPPENS HERE NOW.
  //
  // It used to open the confirmation page and claim from there. The owner took that
  // page off the path on 2 September 2026: the tick box is on this page, so a page
  // asking somebody to confirm what they had just confirmed was one tap that added
  // nothing.
  //
  // IT SENDS THE VALUE THAT WAS TICKED, not a literal yes. Writing `true` here
  // would keep working if the guard above it were ever removed, and would then put
  // an acceptance nobody gave on the record. The server refuses a claim that does
  // not carry it, and stamps when it was accepted and what was accepted.
  //
  // The three answers the server can give each go to the screen the design drew
  // for them, exactly as the confirmation page used to route them.
  const doClaim = useCallback(async () => {
    if (!acceptedTerms(accepted) || !campaignId || claiming) return;
    setClaiming(true);
    const res = await claimTask(campaignId, accepted);
    setClaiming(false);
    if (!res.ok) {
      const msg = String(res.error || '');
      if (/not enough tickets/i.test(msg)) {
        navigation.navigate('NotEnoughTickets', { campaignId });
        return;
      }
      navigation.navigate('JoinFailed', { campaignId, error: msg });
      return;
    }
    // ── STRAIGHT TO THE SHOP'S OWN LOGIN PAGE, NOTHING BETWEEN ─────────────
    //
    // 18 SEPTEMBER 2026, THE OWNER'S FLOW IN HIS OWN WORDS: "accept terms ->
    // CLAIM -> STRAIGHT to the shop's own LOGIN page, inside Fayr. No screen
    // between." The slot-reserved moment, the connect step, "before you go" and
    // its pop-up all existed because the person was about to LEAVE the app.
    // For Zepto, Blinkit and Instamart they do not leave, so none of it is
    // shown.
    //
    // WHAT WAS BEING REMOVED WAS ONE SCREEN, NOT THE SIGN IN — 20 September
    // 2026. "Connect your {shop} account" was the page he wanted gone. The
    // build took the landing with it, so a claim made signed-out went to the
    // shop's FRONT PAGE, which has no sign in on it. Measured on a Zepto claim
    // the same day. whereAClaimGoes is the half that was missing; the word
    // `toSignIn` is what opens the sign in rather than the shopping page.
    //
    // THE FOUR OTHER SHOPS GET THIS TOO, and that is the point: he asked for it
    // "for other marketplaces as well". Every shop has a screen under its own
    // key in App.js, so there is one answer and not two.
    const goes = whereAClaimGoes({
      marketplace: campaign ? campaign.marketplace : null,
      connected: isConnected(campaign ? campaign.marketplace : null),
    });
    if (goes.kind === 'signin') {
      navigation.navigate(goes.route, signInParams(campaignId));
      return;
    }
    // THE CONSENT IS STILL RECORDED, by enterTheShop, with the same server call
    // the pop-up used to make, and the shop does not open if it fails: a
    // purchase our side has no consent for cannot be paid. When it fails the
    // claim has still happened, so they land on the slot-reserved moment as
    // before and the journey offers the door again.
    if (goes.kind === 'shop') {
      const went = await enterTheShop({
        campaignId, marketplace: campaign.marketplace, navigation,
      });
      if (went.ok) return;
    }
    navigation.navigate('Claimed', { campaignId });
  }, [navigation, campaignId, accepted, claiming, campaign]);

  if (!campaign) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.muted}>Loading campaign…</Text>
      </View>
    );
  }

  const platform = PLATFORMS[campaign.marketplace];
  const mktName = platform ? platform.name : campaign.marketplace;
  const [tintA, tintB] = heroTint(campaign.id);
  const maxRefund = estMaxRefundRupees(campaign);
  const priceLabel =
    campaign.productPricePaise != null ? `₹${formatPaise(campaign.productPricePaise)}` : null;

  // Copy the EXACT campaign product name — the same string the order matcher
  // scores against, so what the user pastes into search is what we later try to
  // match. Confirmation reverts after a moment so the button reads as an action
  // again rather than a permanent state, and it only confirms on a real success.
  const onCopyName = useCallback(() => {
    if (!copyToClipboard(campaign.productName)) return;
    setCopied(true);
  }, [campaign.productName]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // The real reservation deadline from the backend task (CLAIM_TTL_DAYS server
  // side — never a hardcoded "48 hours" here).
  const expiresAt = authoritative && authoritative.claimExpiresAt
    ? Date.parse(authoritative.claimExpiresAt)
    : null;
  const reserveLeft = remaining(Number.isNaN(expiresAt) ? null : expiresAt, now);

  // THE THREE NUMBERS THE CONFIRMATION PAGE CARRIED. Same two helpers it used, so
  // there is one definition of each figure rather than a second copy here.
  const tickets = ticketPlan({
    balance: wallet ? wallet.ticketBalance : null,
    cost: campaign.ticketCost,
  });
  const refund = refundLines(campaign);

  const terms = campaign.terms
    ? campaign.terms.split('\n').map((l) => l.trim()).filter(Boolean)
    : [
        `Buy this exact product on ${mktName}, from your own account.`,
        'Your review must be publicly visible on the product page to be verified.',
        'Your refund releases after the marketplace return window closes.',
        'Your rating never affects your refund — only that the review is genuine and public.',
        `Claiming spends ${campaign.ticketCost} tickets; they return if the claim expires before you buy.`,
        // Refund basis, set 2026-08-11. Any marketplace can show a per-item price
        // above what was actually charged once a discount, bank offer or coupon
        // lands, so the payout figure is the amount charged — see
        // src/chargedAmount.js and backend charged-amount.ts, which enforce it.
        'Refund is based on the FINAL amount you actually paid for this exact product - not the listed price, and not any higher price shown before a discount.',
        'You may pay using any card, UPI, or bank offer available at checkout. These are allowed and do not affect your refund.',
        'You may NOT use gift cards, wallet balance, or promotional credit issued by the marketplace to pay for this product. Orders paid this way are not eligible for a refund under this offer.',
        'If your final order amount is lower than the listed price due to a marketplace discount, bank offer, or coupon, your refund is calculated on the lower amount you actually paid.',
        'This is your responsibility to follow. Fayr checks the amount actually charged on your order, and pays out based on that number alone.',
      ];

  const FAQS = [
    ['When do I get my refund?',
      'Once your review is publicly live on the product page and the marketplace return window has closed. The refund is credited to your fayr Wallet.'],
    ['Does my rating affect my refund?',
      'No. Any rating pays the same — we only verify that the review is genuine and publicly visible.'],
    ['What if I don’t end up buying it?',
      `If the claim expires before you purchase, your ${campaign.ticketCost} tickets are returned to you.`],
  ];

  // Null whenever the server stated no figure — see src/ui/seats.js.
  const seats = seatsLine(campaign);
  const joined = joinedLine(campaign);
  const full = isFullCampaign(campaign);

  return (
    <View style={styles.root}>
      <ScrollView
        // The design's sheet ends with 150 points of empty space to keep its
        // pinned button off the content (fayr-design.browser.jsx:2064). Nothing is
        // pinned here any more, so this is only the ordinary room at the end of a
        // page plus whatever the phone's own bottom edge needs.
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.xl }}
        showsVerticalScrollIndicator={false}
        // 16 is one frame at sixty a second, which is what the owner asked for:
        // often enough that the block wakes the moment the end comes into view,
        // and not so often that work happens between frames nobody sees.
        scrollEventThrottle={16}
        onScroll={onScrolled}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(w, h) => {
          // A PAGE THAT DOES NOT SCROLL STILL HAS TO BE CLAIMABLE. A campaign with
          // very little text never fires a scroll event at all, so without this the
          // block would stay see-through with nothing left to scroll and no way on
          // earth to claim it.
          setRevealed((was) => was || reachedBottom({
            offsetY: 0, viewportHeight: viewport, contentHeight: h,
          }));
        }}
      >
        {/* hero — real product photo on a soft gradient stage */}
        <LinearGradient
          colors={[tintA, tintB, COLOR.homeBg]}
          style={[styles.hero, { paddingTop: insets.top + 8 }]}
        >
          <TouchableOpacity
            onPress={() => goBackOrHome(navigation)}
            style={styles.back}
            activeOpacity={0.8}
            // The same slop every other back control on this app gets. A 40pt
            // circle is the drawn size, not the size of a thumb.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <ProductImage
            imageUrl={campaign.imageUrl}
            seed={campaign.id}
            radius={RADIUS.lg}
            style={styles.heroImage}
          />
        </LinearGradient>

        <View style={styles.body}>
          <RefundBadge percent={campaign.percent} maxRupees={maxRefund} />
          <Text style={styles.title}>{campaign.productName || campaign.title}</Text>
          <View style={styles.metaRow}>
            <MarketplaceTag marketplace={campaign.marketplace} />
            {priceLabel ? <Text style={styles.price}>≈ {priceLabel}</Text> : null}
          </View>

          {/* How full the offer is. Both lines are null unless the server stated
              a figure, so an unlimited campaign — or an app talking to a server
              that does not send these — shows nothing at all rather than a zero.
              The claim control below is deliberately NOT disabled when full: the
              server owns that refusal and answers with its own words, and a dead
              button explains nothing. */}
          {seats || joined ? (
            <View style={styles.seatsRow}>
              {seats ? (
                <Text style={[styles.seats, full && styles.seatsFull]}>👥 {seats}</Text>
              ) : null}
              {joined ? <Text style={styles.joined}>{joined}</Text> : null}
            </View>
          ) : null}

          {/* ── A FULL OFFER IS LOCKED, NOT GONE ──────────────────────────────
              The owner's words, 18 September 2026: "I don't want the campaign to
              go away or vanish from the app once the slot is full ... it was
              active, now the slots are full, so it has been locked, and it will
              come back soon."

              THE WHOLE PAGE STILL READS. Somebody who wants to know what the
              offer was may look, which is why this is a note on the page rather
              than a wall in front of it. The words are src/ui/seats.js's and the
              reasoning for each of the three things they say is there. */}
          {lockedReason(campaign) ? (
            <View style={styles.lockedBox}>
              <Text style={styles.lockedTitle}>🔒 Locked for now</Text>
              {lockedReason(campaign).map((line) => (
                <Text key={line} style={styles.lockedText}>{line}</Text>
              ))}
            </View>
          ) : null}

          <Section title="Campaign overview">
            <Text style={styles.para}>
              Buy the {campaign.productName || campaign.title} on {mktName} as you normally
              would, and get {campaign.percent}% back
              {maxRefund != null ? ` — up to ₹${maxRefund}` : ''} credited to your fayr
              Wallet once your review is live and the return window closes.
            </Text>
          </Section>

          <Section title="How it works">
            <Step
              icon="🛍️" tint="#FDEBF0"
              title="Claim this product"
              sub={`Reserves it for you and spends ${campaign.ticketCost} tickets.`}
            />
            <Step
              icon="📦" tint="#EAF2FF"
              title={`Buy on ${mktName}`}
              sub="From your own account, exactly as you normally would."
            />
            <Step
              icon="🧾" tint="#EAE7FD"
              title="We verify your order"
              sub={`Fayr reads the order from your ${mktName} account — no screenshots needed.`}
            />
            <Step
              icon="⭐" tint="#F2E9FD"
              title="Write your honest review"
              sub="Once you've actually used it. Any rating pays the same."
            />
            <Step
              icon="💸" tint="#E9F7E4"
              title="Get your refund"
              sub="After the return window closes — straight to your fayr Wallet."
              last
            />
            <View style={styles.walletNote}>
              <Text style={styles.walletNoteText}>
                Your refund is credited to your <Text style={styles.bold}>fayr Wallet</Text>.
              </Text>
            </View>
          </Section>

          <Section title="What to buy">
            <Card style={styles.specCard}>
              {[
                ['Product', campaign.productName || campaign.title],
                ['Marketplace', mktName],
                priceLabel ? ['Expected price', priceLabel] : null,
                campaign.category ? ['Category', campaign.category] : null,
                campaign.asin ? ['ASIN', campaign.asin] : null,
              ]
                .filter(Boolean)
                .map(([k, v], i, arr) => (
                  <View
                    key={k}
                    style={[styles.specRow, i < arr.length - 1 && styles.specDivider]}
                  >
                    <Text style={styles.specKey}>{k}</Text>
                    <Text style={styles.specVal}>{v}</Text>
                  </View>
                ))}
            </Card>
            <View style={styles.warnRow}>
              <Text style={styles.warnIcon}>⚠️</Text>
              <Text style={styles.warnText}>
                Buy only this exact product. A different product, variant or seller can’t be
                matched to this campaign.
              </Text>
            </View>
          </Section>

          <Section title="Terms & conditions">
            {/* Keyed by INDEX, not by the text. Terms are operator-authored free
                text, so two identical lines are entirely possible — and keying by
                the string made a duplicated sentence collide two React keys and
                break this render. Position is the stable identity here. */}
            {terms.map((t, i) => <Bullet key={i}>{t}</Bullet>)}
          </Section>

          <Section title="Frequently asked">
            {FAQS.map(([q, a], i) => (
              <Faq
                key={q}
                q={q}
                a={a}
                open={faqOpen === i}
                onToggle={() => setFaqOpen(faqOpen === i ? -1 : i)}
              />
            ))}
          </Section>

          <View style={styles.trustRow}>
            {[['🔒', 'Password never seen'], ['🧾', 'Order verified for you'], ['⭐', 'Any rating pays same']].map(
              ([ic, label]) => (
                <View key={label} style={styles.trustChip}>
                  <Text style={{ fontSize: 17 }}>{ic}</Text>
                  <Text style={styles.trustText}>{label}</Text>
                </View>
              ),
            )}
          </View>
        </View>
        {/* THE CLAIM BLOCK — the last thing on the page, and it SCROLLS.
            It used to sit in a bar pinned to the bottom of the screen, painting
            over the campaign text behind it, which is what the owner reported on
            2 September 2026. Nothing here is pinned any more.

            IT WAKES UP ONLY WHEN SOMEBODY HAS SCROLLED TO IT, decided by position
            and never by a timer. See src/ui/detailReveal.js. That is the whole
            point of the tick box: it says "I have read everything above", and a
            box you can tick without scrolling says nothing.

            IT STAYS MOUNTED while it is hidden and only turns see-through. Adding
            it to the page when the scroll arrives would grow the page under the
            reader's own thumb.

            WHAT THE DESIGN DOES INSTEAD, written down because this differs from
            it. The design pins this button to the bottom of the screen
            (fayr-design.browser.jsx:2168, "z8 — sticky claim") and stops it
            covering anything by reserving 150 points of empty space at the end of
            the scrolling sheet. The design has no tick box at all. The owner asked
            for this arrangement instead, and a tick box has to sit with the button
            it controls, so this follows the owner. */}
        <View
          style={[styles.claimBlock, { opacity: revealed ? 1 : 0 }]}
          pointerEvents={revealed ? 'auto' : 'none'}
        >
        {claimed ? (
          <View style={styles.reservedRow}>
            <View style={styles.reservedTag}>
              <Text style={styles.reservedTagText}>Slot reserved</Text>
            </View>
            {reserveLeft ? <Text style={styles.reservedTime}>{reserveLeft}</Text> : null}
          </View>
        ) : null}

        {/* Sits immediately above "Buy on <marketplace>" because that button
            lands the user on the marketplace HOMEPAGE, where their first act is
            typing this product name into the search bar. Copying it removes the
            typing and the typos — and a typo matters more here than it looks:
            the campaign name is what the order matcher scores against, so a
            mistyped search leads to buying a near-miss variant that then fails
            to match. Only shown once claimed; before that there is nothing to
            go and buy. */}
        {claimed ? (
          <TouchableOpacity
            onPress={onCopyName}
            style={styles.copyName}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Copy product name: ${campaign.productName}`}
          >
            <Text style={styles.copyNameText} numberOfLines={1}>
              {copied ? '✓ Copied — paste it into search' : '⧉ Copy product name'}
            </Text>
          </TouchableOpacity>
        ) : null}

          {/* WHAT THIS CLAIM COSTS AND PAYS, directly above the tick box.
              These three numbers lived on the confirmation page until the owner
              took it off the path on 2 September 2026, and losing them would have
              been the real cost of removing that screen: this is the moment 5
              tickets are actually spent.

              DRAWN THE WAY THE DESIGN DRAWS NUMBERS ON THIS SCREEN — the pair of
              white stat cards it uses at the top of the sheet for "Slots
              Remaining" and "Time Remaining" (fayr-design.browser.jsx:2068). The
              design has no ticket figures on this page at all, because in the
              design they are on the confirmation page.

              THE REFUND IS ALWAYS "UP TO". The exact figure depends on what is
              actually charged and is not known until the order is read, so no
              screen states an exact refund for one purchase. */}
          {!claimed ? (
            <View style={styles.numbers}>
              <View style={styles.numberCard}>
                <Text style={styles.numberLabel}>This claim{'\n'}uses</Text>
                <View style={[styles.numberPill, styles.numberPillTickets]}>
                  <Text style={styles.numberPillTicketsText}>
                    🎟 {tickets.cost} tickets
                  </Text>
                </View>
                <Text style={styles.numberFoot}>
                  {tickets.after == null
                    ? 'They come back if the claim runs out before you buy.'
                    : `${tickets.after} left after this. They come back if the claim runs out before you buy.`}
                </Text>
              </View>
              <View style={styles.numberCard}>
                <Text style={styles.numberLabel}>You get{'\n'}back</Text>
                <View style={[styles.numberPill, styles.numberPillRefund]}>
                  <Text style={styles.numberPillRefundText}>
                    {refund.maxLine ? `up to ${refund.maxLine}` : refund.percentLine}
                  </Text>
                </View>
                <Text style={styles.numberFoot}>
                  {refund.percentLine} of what you actually pay.
                </Text>
              </View>
            </View>
          ) : null}

        {/* THE TERMS TICK BOX, above the claim button, on the owner's
            instruction of 1 September 2026. Only before the claim: once the
            campaign is claimed the acceptance is already on the record and asking
            again would suggest it had not been taken.

            The sentence comes from src/ui/terms.js and is not typed out here, so
            there is one copy of the words a person agrees to. */}
        {!claimed ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setAccepted((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel={TERMS_SENTENCE}
          >
            <View style={[styles.termsBox, accepted && styles.termsBoxOn]}>
              {accepted ? <Text style={styles.termsTick}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>{TERMS_SENTENCE}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.88}
          onPress={
            claimed
              ? () => navigation.navigate('Journey', { campaignId: campaign.id })
              : doClaim
          }
          // DEAD, NOT JUST GREY. A button that looks disabled and still works is
          // the worst of both, so the press itself is refused as well.
          disabled={!claimed && !acceptedTerms(accepted)}
          style={[
            styles.cta,
            claimed && styles.ctaClaimed,
            !claimed && !acceptedTerms(accepted) && styles.ctaOff,
          ]}
        >
          <Text style={styles.ctaText}>
            {/* ── AND IT MUST NOT LOOK CLAIMABLE ────────────────────────────
                "Locked" is not "Claim". WHAT IS ALLOWED IS UNTOUCHED: the press
                still goes to the same place and the server still owns the
                refusal, answering in its own words — which is the existing
                decision recorded beside the seats row above, and a dead button
                explains nothing. Nothing here spends a ticket; the claim gate
                does, and it refuses. This is the drawing and only the drawing. */}
            {claimed
              ? 'Carry on →'
              : full
                ? 'Locked · every slot is taken'
                : `Claim this campaign · ${campaign.ticketCost} tickets →`}
          </Text>
        </TouchableOpacity>

        {claimed ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Task', { campaignId: campaign.id })}
            style={styles.secondary}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryText}>See every detail ›</Text>
          </TouchableOpacity>
        ) : (
          // SAYS WHY IT IS DEAD. A dead button with no explanation reads as a
          // broken screen, and this one is dead on purpose.
          <Text style={styles.ctaHint}>
            {claimBlockedLine(accepted) || 'Claiming reserves this product for you'}
          </Text>
        )}
        </View>
        {/* END OF THE CLAIM BLOCK */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },

  hero: { paddingBottom: SPACE.xl, alignItems: 'center' },
  back: {
    // ── A TOP, AND IT IS NOT A TIDY-UP ──────────────────────────────────────
    //
    // This was `position:'absolute'` with a `left` and NO `top`. An absolute box
    // with neither top nor bottom is placed at whatever its static position
    // works out to, which depends on the children around it rather than on
    // anything written here — so the arrow DRAWS where you expect and its touch
    // target does not have to be in the same place. That is the shape of "the
    // button is right there and tapping it does nothing".
    //
    // The parent already holds the notch (hero's paddingTop is insets.top + 8),
    // so 0 here is the top of the content box, under the notch and inside the
    // parent's bounds — which matters, because iOS does not deliver touches to a
    // child drawn outside its parent.
    position: 'absolute', top: 0, left: SPACE.lg, zIndex: 3, elevation: 3,
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 18, color: COLOR.ink },
  heroImage: { width: 210, height: 210, marginTop: 44 },

  body: { paddingHorizontal: SPACE.lg, marginTop: -SPACE.sm },
  title: { fontFamily: FONT.display, fontSize: 22, color: COLOR.ink, marginTop: 10, lineHeight: 29 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: 10 },
  price: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.sm },
  seats: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.refundInk },
  // Full is stated in the warning colour, not hidden: it is the one seat fact
  // that changes what the reader should do next.
  seatsFull: { color: COLOR.red },
  joined: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub },

  sectionHead: { fontFamily: FONT.display, fontSize: 18, color: COLOR.ink, marginBottom: 10 },
  para: { fontFamily: FONT.body, fontSize: 13.5, lineHeight: 21, color: '#6b6555' },

  stepRow: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  stepIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: COLOR.ink },
  stepSub: { fontFamily: FONT.body, fontSize: 12.5, color: '#7b7565', marginTop: 2, lineHeight: 18 },
  walletNote: {
    marginTop: 6, backgroundColor: '#FFF7DF', borderWidth: 1, borderColor: '#F2E6BD',
    borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 14,
  },
  walletNoteText: { fontFamily: FONT.bodyMed, fontSize: 13, color: '#4a463c' },
  bold: { fontFamily: FONT.bodyBold, color: COLOR.ink },

  specCard: { paddingHorizontal: 14 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 12 },
  specDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line },
  specKey: { fontFamily: FONT.bodyMed, fontSize: 13, color: '#7b7565' },
  specVal: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink, textAlign: 'right', flex: 1 },
  warnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  warnIcon: { fontSize: 14 },
  warnText: { fontFamily: FONT.bodySemi, fontSize: 12.5, lineHeight: 18, color: '#d0422e', flex: 1 },

  bulletRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', marginBottom: 10 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#c7bfa9', marginTop: 8 },
  bulletText: { fontFamily: FONT.body, fontSize: 13.5, lineHeight: 20, color: '#6b6555', flex: 1 },

  faq: {
    backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)', padding: 14, marginBottom: 9,
  },
  faqHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  faqQ: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink, flex: 1 },
  faqChevron: { fontSize: 14, color: '#a8a08e' },
  faqA: { fontFamily: FONT.body, fontSize: 13, color: '#6b6555', marginTop: 10, lineHeight: 20 },

  trustRow: { flexDirection: 'row', gap: 10, marginTop: SPACE.xxl },
  trustChip: {
    flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)', paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center',
  },
  trustText: { fontFamily: FONT.bodySemi, fontSize: 11.5, color: '#6b6555', marginTop: 6, textAlign: 'center', lineHeight: 15 },

  claimBlock: {
    // IN THE PAGE, NOT OVER IT. No position, no bottom, nothing that lifts this out
    // of the flow. That is the whole fix. The rule and the space above it make it
    // read as the last block of the page rather than a bar that happens to be there.
    marginTop: SPACE.xl,
    paddingTop: SPACE.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLOR.line,
  },
  // The design's own pair of white stat cards, the shape it uses for numbers on
  // this screen (fayr-design.browser.jsx:2068): two equal cards, a small grey
  // two-line label, then a rounded tinted pill holding the figure.
  numbers: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  numberCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.05)',
  },
  numberLabel: {
    fontFamily: FONT.displaySemi, fontSize: 12, color: '#8a8574', lineHeight: 15,
  },
  numberPill: {
    marginTop: 9, alignSelf: 'flex-start', borderRadius: 20,
    paddingVertical: 4, paddingHorizontal: 10,
  },
  numberPillTickets: { backgroundColor: '#FFF3D6' },
  numberPillTicketsText: { fontFamily: FONT.bodyBold, fontSize: 12, color: '#8a6d10' },
  numberPillRefund: { backgroundColor: COLOR.greenBg },
  numberPillRefundText: { fontFamily: FONT.bodyBold, fontSize: 12, color: COLOR.greenDeep },
  numberFoot: {
    fontFamily: FONT.body, fontSize: 10.5, lineHeight: 14, color: COLOR.sub, marginTop: 8,
  },

  reservedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  reservedTag: { backgroundColor: COLOR.ink, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 8 },
  reservedTagText: { fontFamily: FONT.displaySemi, fontSize: 12, color: '#fff' },
  reservedTime: { fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red },
  cta: {
    backgroundColor: COLOR.ink, borderRadius: RADIUS.pill, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.card,
  },
  ctaClaimed: { backgroundColor: '#2E9E00' },
  // BLUE, the same tone the Home tile's locked banner uses, and deliberately not
  // the amber this app keeps for a warning: a full offer is not a fault.
  lockedBox: {
    marginTop: SPACE.md, backgroundColor: COLOR.blueBg, borderWidth: 1,
    borderColor: '#CBE0FF', borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, gap: 6,
  },
  lockedTitle: { fontFamily: FONT.bodySemi, fontSize: 14, color: '#2F6FD0' },
  lockedText: { fontFamily: FONT.body, fontSize: 13, lineHeight: 19, color: COLOR.ink },
  ctaText: { fontFamily: FONT.displaySemi, fontSize: 15.5, color: '#fff' },
  ctaHint: { fontFamily: FONT.bodySemi, fontSize: 11, color: '#a8a08e', textAlign: 'center', marginTop: 9 },
  ctaOff: { backgroundColor: '#cfcfcf', shadowOpacity: 0 },

  termsRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
    paddingHorizontal: 2,
  },
  termsBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#B9BAA9',
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  termsBoxOn: { backgroundColor: COLOR.green, borderColor: COLOR.green },
  termsTick: { color: '#fff', fontSize: 13, fontFamily: FONT.bodySemi, lineHeight: 16 },
  termsText: {
    flex: 1, fontFamily: FONT.body, fontSize: 12.5, lineHeight: 18, color: COLOR.ink2,
  },
  // Quieter than the primary CTA on purpose — it is a helper for the button
  // below it, not a competing action. Dashed border reads as "utility".
  copyName: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    marginBottom: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  copyNameText: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.ink },
  secondary: { alignItems: 'center', marginTop: 10 },
  secondaryText: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.ink },
});
