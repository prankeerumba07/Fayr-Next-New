// Task status — the post-claim journey, rebuilt in the fayr design system as the
// prototype's refund timeline (Claimed → Order verified → Refund tracked →
// Delivered → Review → Verification → Return window → Refund confirmed → Wallet).
//
// Two rules this screen exists to honour, both kept from the original:
//   1. NEVER render a blank where a fact should be. A missing field is a gap with
//      a cause and a next action, not an empty row.
//   2. The BACKEND is the source of truth. Stage states derive from the
//      authoritative task snapshot (mirrored into `task`), never from a timer or
//      a step counter that could drift from the server.
//
// Claiming lives on DetailScreen; this screen is only ever the post-claim view.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORMS } from './platforms';
import { STATES, describe, createPolicy } from './taskflow';
import {
  getTask, getAuthoritative, hasTask, subscribe, load, dispatch, reset,
  isPending, getActionError, clearActionError,
} from './taskStore';
import { formatPaise } from './money';
import { displayChargedPaise, displayRefundPaise, orderPriceLines } from './ui/refund';
import { resolveChargedPaise } from './chargedAmount';
import * as campaignStore from './backend/campaignStore';
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './ui/theme';
import { Card, RefundBadge, ProductImage } from './ui/primitives';
import { clampMonotonic, releaseStageState } from './ui/timeline';
import { closedInfo, explainBlocker, nextStepLine } from './ui/stages';
import { countdownFor, messageText } from './journey/theNotice';
import { goBackOrHome } from './ui/nav';
import { StageChip } from './ui/stagebits';

const POLICY = createPolicy();

function fmtDate(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toDateString();
}

// The refund countdown. The window is anchored to the DELIVERY date, so it is a
// fixed target rather than a clock that restarts.
function countdown(endsAt, now) {
  if (endsAt == null) return null;
  const ms = endsAt - now;
  if (ms <= 0) return 'Return window has closed';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`;
}

function Row({ label, value, missing, hint }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value != null ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : (
        // Never a blank: say what's missing and why.
        <Text style={styles.rowMissing}>{missing || 'Not available'}{hint ? ` — ${hint}` : ''}</Text>
      )}
    </View>
  );
}

const STEPS = [STATES.CLAIMED, STATES.PURCHASED, STATES.DELIVERED, STATES.REVIEWED, STATES.HOLDING, STATES.REFUNDED];

// Blocker copy now lives in src/ui/stages.js (explainBlocker), where it is
// tested and where every blocker also carries the ONE thing to do next. The old
// table here additionally told users to "connect your email" — a flow that does
// not exist on the device — so it was dead-ending people as well as duplicating.

// The "what's next" hints, derived from the AUTHORITATIVE backend snapshot (the
// source of truth) rather than the optimistic engine's generic default. Rules:
//   1. A real, current backend blocker/reason wins — that's what actually happened.
//   2. With no blocker and no matching order, show NOTHING here (the order card
//      already says "no order fetched yet") — never the misleading static
//      "Delivery date not available yet · Next: dkim" leftover.
//   3. With an order but no delivery, THAT hint is genuinely true — show it.
//   4. No authoritative snapshot yet (offline / pre-first-sync): fall back to the
//      optimistic engine's own gaps so the screen still says something useful.
function nextStepGaps(authoritative, view, platformName) {
  if (!authoritative) {
    return view.gaps.map((g) => ({
      field: g.field,
      title: g.message,
      body: null,
      cta: null,
      action: null,
    }));
  }
  if (authoritative.blocker) {
    const said = explainBlocker(authoritative.blocker, platformName);
    return [{
      field: 'blocker',
      title: said.title,
      // The server's own reason is more specific than any generic copy, so it
      // wins as the body — but it is a SENTENCE under a plain-English heading,
      // never the bare enum the screen used to print.
      body: authoritative.blockerReason || said.body,
      cta: said.cta,
      action: said.action,
    }];
  }
  if (!authoritative.order) return [];
  if (!authoritative.delivery) {
    return [{
      field: 'delivery',
      title: 'No delivery date yet',
      body: `${platformName || 'The marketplace'} has not published a delivery date for this order. Nothing is lost — we keep checking.`,
      cta: null,
      action: null,
    }];
  }
  return [];
}

// How the review becomes verifiable, per marketplace — and it is NOT the same
// answer on each, so this map says what actually happens rather than one
// reassuring sentence stretched over seven platforms.
//
// Three routes exist:
//   Amazon / Flipkart   a machine settles it. Amazon's public review permalink
//                       is fetched; Flipkart states its own moderation verdict.
//   Meesho              nothing can settle it — the words live only in Meesho's
//                       app — so a Fayr reviewer opens the product page by hand.
//   Blinkit/Zepto/      the order itself carries the rating marker, and it is
//   Instamart           read straight from the account.
//
// HONEST NOTE, because this comment used to claim otherwise: on the three
// quick-commerce platforms NO person checks anything. The copy here said "a Fayr
// reviewer confirms your rating" while the reader accepts the order's own
// `is_rated` marker and advances — so the app described a queue nobody was
// standing in. That marker is weaker than a public review (it says the account
// rated the item, not that anything is publicly readable); accepting it is a
// deliberate product decision, recorded as one, and the copy now matches it.
const REVIEW_VERIFY = {
  amazon: {
    title: 'Review under verification',
    sub: 'Amazon moderates new reviews (usually 48–72h) before they show publicly.',
  },
  flipkart: {
    title: 'Review indexing',
    sub: 'Flipkart is indexing your review — it appears on the product page shortly.',
  },
  myntra: {
    title: 'Review publishing',
    sub: 'Myntra is publishing your review to the product page.',
  },
  // The only platform where a person really does look. Meesho keeps review text
  // inside its own app, so nothing Fayr runs can check the product page — a
  // reviewer opens it by hand and records what they saw. This copy promised that
  // long before the reviewer had any way to do it; the promise is now real.
  meesho: {
    title: 'Reviewer check',
    sub: 'Meesho only shows review text in its app, so someone at Fayr opens the product page and checks yours is there.',
  },
  // NOT a reviewer check, and it used to say it was. Blinkit, Zepto and
  // Instamart mark the rating on the order itself, so it is read straight from
  // the account — no person is involved and none is waited for. Saying otherwise
  // invented a queue nobody was standing in.
  // doneTitle/doneSub override the default DONE copy, which is "Review confirmed
  // live / Publicly visible on the product page". On these three that sentence is
  // simply FALSE: Blinkit, Zepto and Instamart have no public review page at all,
  // so there is nowhere for anyone — us, the user, or a director asking to see it
  // — to go and look. Saying it anyway was the app claiming something that cannot
  // be true, on a stage the demo walks straight through.
  blinkit: {
    title: 'Rating check',
    sub: 'Blinkit shows your rating on the order, so we confirm it from your account.',
    doneTitle: 'Rating confirmed',
    doneSub: 'Your rating is on the order in your Blinkit account',
  },
  zepto: {
    title: 'Rating check',
    sub: 'Zepto shows your rating on the order, so we confirm it from your account.',
    doneTitle: 'Rating confirmed',
    doneSub: 'Your rating is on the order in your Zepto account',
  },
  instamart: {
    title: 'Rating check',
    sub: 'Instamart shows your rating on the order, so we confirm it from your account.',
    doneTitle: 'Rating confirmed',
    doneSub: 'Your rating is on the order in your Instamart account',
  },
};

// The DONE copy for a platform that does publish reviews publicly — Amazon,
// Flipkart, Meesho and Myntra all do, so this is the default and only the three
// quick-commerce entries above override it.
const REVIEW_DONE_DEFAULT = {
  title: 'Review confirmed live',
  sub: 'Publicly visible on the product page',
};

// ── one timeline stage ──────────────────────────────────────────────────────
function Stage({ stage, last, busy }) {
  const { state, icon, title, sub, chip, action, auto } = stage;
  const done = state === 'done';
  const active = state === 'active';
  return (
    <View style={styles.stageRow}>
      {/* rail + node */}
      <View style={styles.rail}>
        {!last ? <View style={[styles.railLine, done && styles.railLineDone]} /> : null}
        <View style={[styles.node, done && styles.nodeDone, active && styles.nodeActive]}>
          <Text style={[styles.nodeIcon, !done && !active && styles.nodeIconPending]}>
            {done ? '✓' : icon}
          </Text>
        </View>
      </View>

      {/* card */}
      <View style={styles.stageBody}>
        <View
          style={[
            styles.stageCard,
            active && styles.stageCardActive,
            done && styles.stageCardDone,
            !done && !active && styles.stageCardPending,
          ]}
        >
          <View style={styles.stageHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[
                  styles.stageTitle,
                  active && styles.stageTitleActive,
                  !done && !active && styles.stageTitlePending,
                ]}
              >
                {title}
              </Text>
              {sub ? (
                <Text style={[styles.stageSub, !done && !active && styles.stageSubPending]}>
                  {sub}
                </Text>
              ) : null}
            </View>
            {chip ? (
              <View style={[styles.chip, chip.tone === 'ok' ? styles.chipOk : chip.tone === 'warn' ? styles.chipWarn : styles.chipInfo]}>
                <Text
                  style={[
                    styles.chipText,
                    chip.tone === 'ok' ? styles.chipTextOk : chip.tone === 'warn' ? styles.chipTextWarn : styles.chipTextInfo,
                  ]}
                >
                  ● {chip.label}
                </Text>
              </View>
            ) : null}
          </View>

          {active && action ? (
            <TouchableOpacity
              onPress={action.onPress}
              activeOpacity={0.88}
              // Disabled while an action is in flight so a second tap can't
              // race the first (two of the four routes take no idempotency key).
              disabled={busy}
              style={[styles.stageAction, busy && styles.stageActionBusy]}
            >
              <Text style={styles.stageActionText}>
                {busy ? 'Sending…' : `${action.label} →`}
              </Text>
            </TouchableOpacity>
          ) : null}

          {active && auto ? (
            <Text style={styles.autoNote}>Processing automatically — nothing needed from you</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function TaskScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const campaignId = (route && route.params && route.params.campaignId) || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const platform = campaign ? PLATFORMS[campaign.marketplace] : null;
  const platformName = platform ? platform.name : (campaign ? campaign.marketplace : '');

  const [task, setTask] = useState(campaignId ? getTask(campaignId) : null);
  const [authoritative, setAuthoritative] = useState(campaignId ? getAuthoritative(campaignId) : null);
  const [claimed, setClaimed] = useState(campaignId ? hasTask(campaignId) : false);
  const [now, setNow] = useState(Date.now());
  // An action in flight, and the server's own reason if the last one failed.
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!campaignId) return undefined;
    // React to updates for THIS campaign's task (optimistic + authoritative).
    const sync = () => {
      setTask(getTask(campaignId));
      setAuthoritative(getAuthoritative(campaignId));
      setClaimed(hasTask(campaignId));
      setPending(isPending(campaignId));
      setActionError(getActionError(campaignId));
    };
    const un = subscribe((id) => {
      if (id !== campaignId) return;
      sync();
    });
    if (!getTask(campaignId)) load();
    sync();
    return un;
  }, [campaignId]);

  // Drives the countdown, and is where a real build would run the HOLDING
  // visibility re-check. Deliberately NOT doing that here: the check must be a
  // server-side fetch of the public permalink, because a device-side one is
  // forgeable and stops the moment the app is closed - which is most of the
  // window. See the design notes in taskflow.js.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // A local pre-flight rejection is immediate and shown as an alert; a SERVER
  // rejection arrives asynchronously and lands in actionError, rendered inline
  // below. Either way the tap says something — an action that appears to work
  // and quietly doesn't is the bug this whole path exists to remove.
  const act = useCallback((event) => {
    clearActionError(campaignId);
    const res = dispatch(campaignId, event);
    if (res.rejected) Alert.alert('Not yet', res.reason);
  }, [campaignId]);

  // THE PAYOFF — on the TRANSITION to refunded, and only then.
  //
  // The release is asynchronous: dispatch() returns immediately and the server's
  // answer arrives later, so navigating from the button would show a celebration
  // before the money had moved. This watches `authoritative` — the SERVER's task,
  // not the optimistic local one — so the screen only ever appears after a
  // confirmed payment.
  //
  // `prev != null` is the load-bearing half. Opening an already-refunded task
  // from My Products starts with authoritative null (the store has not read it
  // yet) and then sets it to REFUNDED, which looks exactly like a transition. So
  // only a move from a KNOWN earlier state counts; otherwise every visit to a
  // finished task would bounce to a celebration and the timeline would be
  // unreadable.
  const prevState = useRef(authoritative ? authoritative.state : null);
  useEffect(() => {
    const state = authoritative ? authoritative.state : null;
    const prev = prevState.current;
    prevState.current = state;
    if (state === STATES.REFUNDED && prev != null && prev !== STATES.REFUNDED) {
      navigation.navigate('reward', { campaignId });
    }
  }, [authoritative, navigation, campaignId]);

  if (!campaign) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.muted}>Loading task…</Text>
      </View>
    );
  }

  // Claiming now lives on DetailScreen (the pre-claim product reveal), so this
  // screen is only ever the POST-claim task view. An unclaimed campaign that
  // still lands here (deep link, stale nav state) is sent there rather than
  // showing a second, competing claim button.
  if (!claimed) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: SPACE.lg, paddingTop: insets.top + SPACE.lg }}>
          <Text style={styles.h1}>{campaign.productName}</Text>
          <Text style={styles.muted}>{campaign.percent}% refund · {platformName}</Text>
          <Card style={{ marginTop: SPACE.xl, padding: SPACE.lg }}>
            <Text style={styles.cardTitle}>Not claimed yet</Text>
            <Text style={styles.cardBody}>
              Claim this product first — the campaign page has the details, terms and the
              claim button.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('Detail', { campaignId })}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>View campaign</Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </View>
    );
  }

  if (!task) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  const view = describe(task, now, POLICY);
  // Next-step hints come from the authoritative backend snapshot, not the
  // optimistic engine default (see nextStepGaps). `view` still drives the
  // countdown / refund-eligibility below.
  const gaps = nextStepGaps(authoritative, view, platformName);
  const closed = closedInfo(authoritative || task);
  // THE ONE RECORD, LONG FORM, read and never rebuilt. From the authoritative
  // backend snapshot, because the optimistic local task carries no message.
  const theMessage = messageText(authoritative, 'long');
  // AND THE CLOCK, from the same task. Null when there is no recorded tap, which
  // is what stops a countdown appearing beside an offer nobody has started.
  const timeLeft = countdownFor(authoritative, now);
  // The refund is based on what was actually CHARGED, not a listed price — the
  // two are different fields on different platforms, so never read itemPaise
  // straight (see src/chargedAmount.js). When this can't be decided safely the
  // screen shows "Needs staff check" rather than a number, which is exactly what
  // the backend would do.
  const charged = resolveChargedPaise(task.order);
  // ONE ROUTE to this number. It used to be computed here with the campaign's
  // percentage and WITHOUT its payout cap, while the backend pays
  // min(percentage, cap) — so on a capped campaign the screen promised more than
  // the wallet would ever receive, and on a cap of zero it promised the full
  // percentage of an order that would pay nothing. The backend's own figure now
  // wins whenever it has arrived; the local calculation is only the moment before
  // that, and it applies the cap the same way. See src/ui/refund.js.
  const refundPaise = displayRefundPaise({
    authoritativePaise: authoritative && authoritative.refund
      ? authoritative.refund.amountPaise
      : null,
    chargedPaise: charged.paise,
    percent: campaign.percent,
    capPaise: campaign.payoutCapPaise,
  });
  const itemPaise = task.order ? task.order.itemPaise : null; // display only
  // WHICH price the refund was worked out from. Same rule as the refund figure
  // itself: the backend's answer wins, because it is the one the payout used. The
  // local resolver above is the fallback for the moment before it lands — and on a
  // staff-confirmed per-unit price it cannot answer at all, because that figure
  // exists only on the server.
  const basedOnPaise = displayChargedPaise({
    authoritativePaise: authoritative && authoritative.refund
      ? authoritative.refund.basedOnPaise
      : null,
    localPaise: charged.paise,
  });
  // The price rows, decided in one testable place rather than in four nested
  // ternaries below. See orderPriceLines in src/ui/refund.js for the two things
  // this card used to get wrong.
  const prices = orderPriceLines({
    itemPaise,
    quantity: task.order ? task.order.quantity : null,
    basisPaise: basedOnPaise,
    orderTotalPaise: task.order ? task.order.orderTotalPaise : null,
  });
  const match = task.order && task.order.match;

  // ── real facts the timeline reads ────────────────────────────────────────
  const rank = STEPS.indexOf(task.state);
  const hasOrder = !!task.order;
  const hasDelivery = !!task.delivery;
  const reviewed = rank >= STEPS.indexOf(STATES.REVIEWED);
  const published = !!(task.review && task.review.published === true);
  const refunded = task.state === STATES.REFUNDED;
  const windowClosed = view.windowEndsAt != null && now >= view.windowEndsAt;
  const inHold = rank >= STEPS.indexOf(STATES.HOLDING);
  const eligible = view.refund.eligible;
  const rv = REVIEW_VERIFY[campaign.marketplace] || REVIEW_VERIFY.amazon;
  const refundLabel = refundPaise != null ? `₹${formatPaise(refundPaise)}` : null;
  // The engine's `eligible` gate says nothing about the AMOUNT — attemptRelease
  // checks that separately and refuses with 'amount-unknown'. On Instamart the
  // item price is never readable and on Blinkit only the order total is, so a
  // task can be fully "eligible" for a refund the backend would still refuse to
  // pay. Anything claiming the refund is settled must require both.
  const payable = eligible && refundLabel != null;
  const amountNeedsStaff = hasOrder && refundLabel == null;
  const release = releaseStageState({ refunded, eligible, hasAmount: refundLabel != null });

  const goMarketplace = () => navigation.navigate(campaign.marketplace, { campaignId });

  const stages = [
    {
      key: 'claimed',
      icon: '🎯',
      title: 'Product claimed',
      sub: 'Reserved for you',
      state: 'done',
    },
    {
      key: 'order',
      icon: '📦',
      title: hasOrder ? 'Order placed & verified' : 'Order not found yet',
      sub: hasOrder
        ? `Verified from your ${platformName} account`
        : `Buy on ${platformName}, then check again`,
      state: hasOrder ? 'done' : 'active',
      action: hasOrder ? null : { label: `Check ${platformName}`, onPress: goMarketplace },
    },
    {
      key: 'tracked',
      icon: '💸',
      title: 'Refund tracked',
      sub: refundLabel
        // NOT "reserved" — nothing is set aside anywhere until RELEASE_REFUND
        // posts the ledger entry. This stage only means the amount is known.
        ? `Refund amount confirmed: ${refundLabel}`
        : amountNeedsStaff
          // Say the manual step out loud. This is the routine outcome on
          // quick-commerce, not an edge case, and the screen used to imply the
          // amount would simply appear on its own.
          ? 'A Fayr reviewer confirms the amount you paid'
          : 'Confirmed once the item price is verified',
      state: hasOrder && refundLabel ? 'done' : 'pending',
      chip: hasOrder && refundLabel && !eligible && !refunded
        ? { label: 'Pending', tone: 'warn' }
        : amountNeedsStaff
          ? { label: 'Needs staff check', tone: 'warn' }
          : null,
    },
    {
      key: 'delivered',
      icon: '🚚',
      title: hasDelivery ? 'Order delivered' : 'Awaiting delivery',
      sub: hasDelivery
        ? fmtDate(task.delivery.at) || 'Delivery confirmed'
        : 'We read the delivery date from your account',
      state: hasDelivery ? 'done' : hasOrder ? 'active' : 'pending',
      action: !hasDelivery && hasOrder
        ? { label: `Check delivery on ${platformName}`, onPress: goMarketplace }
        : null,
    },
    {
      key: 'review',
      icon: '✍️',
      title: reviewed ? 'Review submitted' : 'Write your review',
      sub: reviewed
        ? `Posted on ${platformName}`
        : 'An honest review once you’ve used the product',
      state: reviewed ? 'done' : hasDelivery ? 'active' : 'pending',
      action: !reviewed && hasDelivery
        ? {
            label: 'I’ve written my review',
            onPress: () => act({ type: 'MARK_REVIEWED', key: 'reviewed', at: Date.now() }),
          }
        : null,
    },
    {
      key: 'verifying',
      // Always the magnifier — the '✓' for this stage comes from the node itself
      // once it is done, so a tick here would be both unreachable and misleading.
      icon: '🔎',
      title: published ? (rv.doneTitle || REVIEW_DONE_DEFAULT.title) : rv.title,
      sub: published ? (rv.doneSub || REVIEW_DONE_DEFAULT.sub) : rv.sub,
      state: published ? 'done' : reviewed ? 'active' : 'pending',
      auto: !published && reviewed,
    },
    {
      key: 'window',
      icon: '⏳',
      title: 'Return window',
      sub: view.windowEndsAt != null
        ? countdown(view.windowEndsAt, now)
        : 'Starts once delivery is confirmed',
      // The window closing is the MARKETPLACE's clock, but this stage is OUR
      // hold — it is not complete until the task has actually been held through
      // it. Delivery can predate the claim by months (the Instamart razor was
      // delivered 151 days before it was claimed), so "time has passed" alone
      // must never tick this off, or the hold appears served without running.
      state: windowClosed && inHold ? 'done'
        : task.state === STATES.REVIEWED || task.state === STATES.HOLDING ? 'active'
          : 'pending',
      auto: task.state === STATES.HOLDING && !windowClosed,
      action: reviewed && task.state === STATES.REVIEWED
        ? {
            label: 'Start return-window hold',
            onPress: () => act({ type: 'START_HOLD', key: `hold:${Date.now()}`, at: Date.now() }),
          }
        : null,
    },
    {
      key: 'confirmed',
      // NOT a checkmark: the Stage node renders a real '✓' only when a stage is
      // actually done, so a tick-like emoji here would read as "complete" while
      // the stage is merely active. A finish-line reads as "the milestone we're
      // heading for" without claiming it has been reached.
      icon: '🏁',
      title: 'Refund confirmed',
      sub: refunded
        ? 'Released to your fayr Wallet'
        : eligible && !refundLabel
          ? 'Waiting on a Fayr reviewer to confirm the amount you paid'
          : eligible
            ? 'Review is live and the window has closed'
            : 'Confirms when your review is live and the window closes',
      // Releasable is NOT released. This used to read `done` the moment a
      // refund became calculable, which hid the action below it (Stage draws an
      // action only while a stage is 'active') — see releaseStageState.
      state: release.state,
      chip: release.chip,
      action: eligible && !refunded && refundLabel
        ? {
            label: `Release ${refundLabel} to wallet`,
            onPress: () => act({ type: 'RELEASE_REFUND', key: 'release', at: Date.now(), policy: POLICY }),
          }
        : null,
    },
    {
      key: 'wallet',
      icon: '👛',
      title: refunded ? 'Refund in your wallet' : 'Payout',
      // Deliberately NOT claiming "sent to your bank": a released refund sits in
      // the wallet until the user withdraws and FINANCE marks it paid. The
      // withdrawal screen is a later phase.
      sub: refunded
        ? 'Withdraw it from your wallet whenever you like'
        : 'Withdraw your refund once it is confirmed',
      state: refunded ? 'done' : 'pending',
    },
  ];

  // A later stage must never read as further along than the chain genuinely is
  // — see src/ui/timeline.js for the failure this exists to stop.
  clampMonotonic(stages);

  const doneCount = stages.filter((s) => s.state === 'done').length;
  const pct = Math.round((doneCount / stages.length) * 100);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* header — soft violet gradient, product chip, progress */}
        <LinearGradient
          colors={['#E7DCFA', '#EDE4FB', COLOR.homeBg]}
          style={[styles.header, { paddingTop: insets.top + 8 }]}
        >
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => goBackOrHome(navigation)} style={styles.back} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Task status</Text>
          </View>

          <View style={styles.productChip}>
            <ProductImage
              imageUrl={campaign.imageUrl}
              seed={campaign.id}
              radius={13}
              style={styles.chipImage}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={styles.chipName}>{campaign.productName}</Text>
              <View style={{ marginTop: 6, flexDirection: 'row' }}>
                <RefundBadge percent={campaign.percent} size="sm" />
              </View>
            </View>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>{doneCount} of {stages.length} done</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progressPct}>{pct}%</Text>
          </View>

          {/* What is happening, in words. This line used to print the raw state
              and blocker enums — "✓ Verified state: HOLDING · ORDER_UNREADABLE" —
              on the screen where someone checks whether they are getting paid. */}
          {authoritative ? (
            <Text style={styles.serverBadge}>
              {closed.closed ? closed.title : nextStepLine(authoritative)}
            </Text>
          ) : null}
        </LinearGradient>

        <View style={styles.body}>
          {/* ── THE ONE MESSAGE, LONG FORM, AND THIS IS THE THIRD PLACE ──────
              The bar above the bottom navigation and the My Products list both
              show its SHORT form; this is the same record's LONG form, which is
              that short form plus the rest of its sentences. It is built once on
              the server, in backend engine/journey-message.ts, and this screen
              writes not one word of it.

              The countdown beside it ticks on the phone, because a number that
              changes every second cannot come from a record built on a server.
              Its unit words live in src/ui/journeyWords.js, which Fayr's plain
              language rule reads off disk. It is NEVER drawn for a task with no
              recorded tap: see countdownFor. */}
          {theMessage ? (
            <View style={styles.sentMessage}>
              <Text style={styles.sentMessageText}>{theMessage}</Text>
              {timeLeft ? (
                <Text style={styles.sentMessageClock}>⏰ {timeLeft}</Text>
              ) : null}
            </View>
          ) : null}

          {/* A CLOSED claim says so first and loudly. The server writes closedAt
              + closeReason while leaving state at CLAIMED, so without this a dead
              claim still rendered a live "Buy on Amazon, then check again". */}
          {closed.closed ? (
            <View style={[styles.gap, styles.gapClosed]}>
              <StageChip label={closed.label} tone={closed.tone} />
              <Text style={[styles.gapTitle, { marginTop: 8 }]}>{closed.title}</Text>
              <Text style={styles.gapBody}>{closed.body}</Text>
            </View>
          ) : null}

          {/* What is blocking this claim, said in the user's words plus the one
              thing they can do about it. */}
          {!closed.closed && gaps.map((g) => (
            <View key={g.field} style={styles.gap}>
              <Text style={styles.gapTitle}>{g.title}</Text>
              {g.body ? <Text style={styles.gapBody}>{g.body}</Text> : null}
              {g.cta ? (
                <TouchableOpacity
                  style={styles.gapCta}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (g.action === 'reconnect') goMarketplace();
                    else if (g.action === 'upload') navigation.navigate('ProofUpload', { campaignId });
                    else navigation.navigate('Support', { taskId: authoritative && authoritative.id });
                  }}
                >
                  <Text style={styles.gapCtaText}>{g.cta} ›</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}

          {/* The server's own words when an action was refused (409) or the
              request never landed. Never swallowed. */}
          {actionError ? (
            <TouchableOpacity
              style={styles.actionError}
              onPress={() => clearActionError(campaignId)}
              activeOpacity={0.8}
            >
              <Text style={styles.actionErrorTitle}>That didn’t go through</Text>
              <Text style={styles.actionErrorBody}>{actionError}</Text>
              <Text style={styles.actionErrorDismiss}>Tap to dismiss</Text>
            </TouchableOpacity>
          ) : null}
          {pending ? <Text style={styles.pendingNote}>Sending to Fayr…</Text> : null}

          <Text style={styles.sectionHead}>Refund timeline</Text>
          <Text style={styles.sectionSub}>Updates automatically as your refund progresses</Text>
          <View style={{ marginTop: SPACE.lg }}>
            {stages.map((s, i) => (
              <Stage key={s.key} stage={s} last={i === stages.length - 1} busy={pending} />
            ))}
          </View>

          {/* ── your order — every verified fact, never a blank ── */}
          <Text style={[styles.sectionHead, { marginTop: SPACE.xxl }]}>Your order</Text>
          <Card style={styles.detailCard}>
            {task.order ? (
              <>
                {task.order.image ? (
                  <Image source={{ uri: task.order.image }} style={styles.orderImage} resizeMode="contain" />
                ) : null}
                <Row label="Product" value={task.order.product} missing="Name not read from the order" />
                <Row label="Order ID" value={task.order.id} />
                <Row label="Order date" value={fmtDate(task.order.date)} />
                {task.order.statusText ? (
                  <Row label="Order status" value={String(task.order.statusText)} />
                ) : null}
                {match && match.amountOk === false ? (
                  <Text style={styles.warn}>
                    Paid price differs from the campaign (₹{campaign.amount}) — confirm this is the right product/variant before continuing.
                  </Text>
                ) : null}
                {match && match.ambiguous ? (
                  <Text style={styles.warn}>
                    More than one order matched this product — make sure this is the one for this task.
                  </Text>
                ) : null}
                {prices.linePaise != null ? (
                  <>
                    <Row label={prices.lineLabel} value={`₹${formatPaise(prices.linePaise)}`} />
                    {prices.perUnitPaise != null ? (
                      // A line covering several units is not what gets refunded.
                      // Saying so here is the difference between the screen and the
                      // payout agreeing and only appearing to.
                      <Text style={styles.contrast}>
                        Your refund is for one unit — based on ₹{formatPaise(prices.perUnitPaise)}
                      </Text>
                    ) : null}
                    {itemPaise != null && task.order.orderTotalPaise != null && task.order.orderTotalPaise !== itemPaise ? (
                      // Say which of the two the refund actually uses, and why.
                      // Both directions happen for real: a total ABOVE the item
                      // price means other items/fees share the order, while a
                      // total BELOW it means a discount landed and the listed
                      // item price was never what the user paid.
                      charged.basis === 'order-total-lower' ? (
                        <Text style={styles.contrast}>
                          You paid ₹{formatPaise(task.order.orderTotalPaise)} — less than the listed item price, so your refund is based on ₹{formatPaise(task.order.orderTotalPaise)}
                        </Text>
                      ) : (
                        <Text style={styles.contrast}>
                          Order total ₹{formatPaise(task.order.orderTotalPaise)} — includes other items; refund uses the item price only
                        </Text>
                      )
                    ) : null}
                    {prices.orderAmountPaise != null ? (
                      <Row label="Order amount" value={`₹${formatPaise(prices.orderAmountPaise)}`} />
                    ) : null}
                  </>
                ) : prices.orderAmountPaise != null ? (
                  // Quick-commerce (and Myntra): web exposes only the ORDER TOTAL,
                  // not a per-item price. Show it plainly as the order amount; the
                  // Refund section states the per-item price is still needed.
                  <Row label="Order amount" value={`₹${formatPaise(prices.orderAmountPaise)}`} />
                ) : (
                  <Row
                    label="Item price"
                    value={null}
                    missing="Couldn't read the item price"
                    hint="refund can't be computed"
                  />
                )}
                {task.order.itemAmountAmbiguous ? (
                  <Text style={styles.warn}>Item price was ambiguous — needs manual review before refund</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.rowMissing}>
                {gaps.length ? gaps[0].message : 'No order fetched yet — buy the product, then check again.'}
              </Text>
            )}
          </Card>

          {/* ── refund ── */}
          <Text style={[styles.sectionHead, { marginTop: SPACE.xxl }]}>Refund</Text>
          <Card style={styles.detailCard}>
            {refundPaise != null ? (
              <Text style={styles.refundAmount}>₹{formatPaise(refundPaise)}</Text>
            ) : (
              <Text style={styles.rowMissing}>Available once the item price is verified</Text>
            )}
            <Row label="Delivered" value={fmtDate(task.delivery && task.delivery.at)} missing="Not verified yet" />
            <Row label="Review live" value={task.review ? (task.review.published ? 'Yes' : 'No') : null} missing="Not checked yet" />
            <Row label="Returned" value={task.returned == null ? null : task.returned ? 'Yes' : 'No'} missing="Unknown" hint="blocks refund" />
            <Row label="Window ends" value={fmtDate(view.windowEndsAt)} missing="Needs a delivery date" />
            {view.windowEndsAt != null ? (
              <Text style={styles.countdown}>{countdown(view.windowEndsAt, now)}</Text>
            ) : null}
            {/* `eligible` requires state HOLDING, so it goes FALSE the moment a
                refund is released — without this branch a paid task read
                "Refund on hold · state is REFUNDED, expected HOLDING". */}
            {refunded ? (
              <Text style={styles.eligible}>✓ Released to your wallet</Text>
            ) : !payable ? (
              <View style={styles.blockedBox}>
                <Text style={styles.blockedTitle}>Refund on hold</Text>
                {view.refund.reasons.map((r) => (
                  <Text key={r} style={styles.blockedReason}>• {r}</Text>
                ))}
                {/* The engine's reasons list omits the amount — it's enforced at
                    release time, not in the eligibility gate — so state it here
                    or an "eligible" task looks payable when it isn't. */}
                {refundPaise == null ? (
                  <Text style={styles.blockedReason}>
                    • item price unknown, so the refund amount can’t be computed — a Fayr reviewer confirms it
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.eligible}>✓ Ready to release</Text>
            )}
          </Card>

          {/* primary action — always available, mirrors the active stage */}
          <TouchableOpacity style={styles.primaryBtn} onPress={goMarketplace} activeOpacity={0.88}>
            <Text style={styles.primaryBtnText}>
              {task.order ? `Re-check on ${platformName}` : `I've completed the purchase`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ghostBtn, pending && styles.ghostBtnBusy]}
            onPress={() => act({ type: 'CONFIRM_ORDER', key: 'confirm', at: Date.now() })}
            activeOpacity={0.8}
            disabled={pending}
          >
            <Text style={styles.ghostBtnText}>
              {pending ? 'Sending…' : 'Yes, this is my order'}
            </Text>
          </TouchableOpacity>

          {/* Developer tools, gated. These used to render unconditionally: a real
              user could wipe their own task with "Reset task (dev)", and the line
              under it printed the raw state and blocker enum on the screen where
              they check whether they are getting paid. __DEV__ is false in any
              release build, so this is now invisible to users. */}
          {__DEV__ ? (
            <>
              <TouchableOpacity onPress={() => reset(campaignId)} style={styles.resetBtn}>
                <Text style={styles.resetText}>Reset task (dev)</Text>
              </TouchableOpacity>
              <Text style={styles.history}>
                {task.history.length} event(s) · state {task.state}
                {task.blocker ? ` · blocked: ${task.blocker}` : ''}
              </Text>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // THE ONE MESSAGE, LONG FORM. Its words come from the server; this screen owns
  // the box around them and nothing inside it.
  sentMessage: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12,
  },
  sentMessageText: {
    fontFamily: FONT.bodyMed, fontSize: 14, lineHeight: 21, color: COLOR.ink2,
  },
  sentMessageClock: {
    fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red, marginTop: 8,
  },
  container: { flex: 1, backgroundColor: COLOR.homeBg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },
  h1: { fontFamily: FONT.display, fontSize: 20, color: COLOR.ink },

  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: '#2B1D45' },
  headerTitle: { fontFamily: FONT.display, fontSize: 19, color: '#2B1D45' },
  productChip: {
    flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: SPACE.lg,
    backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: RADIUS.xl, padding: 12, ...SHADOW.chip,
  },
  chipImage: { width: 54, height: 54 },
  chipName: { fontFamily: FONT.displaySemi, fontSize: 14, color: '#2B1D45', lineHeight: 18 },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg },
  progressLabel: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#5B4880' },
  progressTrack: {
    flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(123,97,255,0.16)',
    marginHorizontal: SPACE.md, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#22A80E' },
  progressPct: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#22A80E' },
  serverBadge: { fontFamily: FONT.bodySemi, fontSize: 11.5, color: COLOR.greenDeep, marginTop: 10 },

  body: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg },
  sectionHead: { fontFamily: FONT.display, fontSize: 17, color: COLOR.ink },
  sectionSub: { fontFamily: FONT.body, fontSize: 11.5, color: '#9a9b8c', marginTop: 3 },

  // timeline
  stageRow: { flexDirection: 'row', gap: 13 },
  rail: { width: 38, alignItems: 'center' },
  // Absolutely positioned, so give it an explicit left (rail is 38 wide, line 3)
  // rather than relying on the parent's alignItems to centre an absolute child.
  railLine: { position: 'absolute', top: 34, bottom: -6, left: 17.5, width: 3, borderRadius: 2, backgroundColor: '#E4E4D6' },
  railLineDone: { backgroundColor: '#3FBF1E' },
  node: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#EDEDE2',
    alignItems: 'center', justifyContent: 'center',
  },
  nodeDone: { backgroundColor: '#2AA412' },
  nodeActive: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#22A80E' },
  nodeIcon: { fontSize: 14, color: '#fff' },
  nodeIconPending: { opacity: 0.55 },
  stageBody: { flex: 1, paddingBottom: 12 },
  stageCard: { borderRadius: RADIUS.lg, padding: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)' },
  stageCardActive: { backgroundColor: '#F2FBEB', borderColor: '#B6E79E', borderWidth: 1.5 },
  stageCardDone: { backgroundColor: '#fff' },
  stageCardPending: { backgroundColor: '#FAFAF3', opacity: 0.85 },
  stageHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  stageTitle: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink, lineHeight: 18 },
  stageTitleActive: { fontSize: 15 },
  stageTitlePending: { color: '#AEAFA0' },
  stageSub: { fontFamily: FONT.body, fontSize: 11.5, color: '#98998a', marginTop: 3, lineHeight: 16 },
  stageSubPending: { color: '#c2c3b5' },
  chip: { borderRadius: RADIUS.round, borderWidth: 1, paddingVertical: 4, paddingHorizontal: 10 },
  chipOk: { backgroundColor: '#E7F6E0', borderColor: '#9FD97F' },
  chipWarn: { backgroundColor: '#FFF7DE', borderColor: '#F3D97A' },
  chipInfo: { backgroundColor: '#F1EAFB', borderColor: '#D9C6F5' },
  chipText: { fontFamily: FONT.displaySemi, fontSize: 11 },
  chipTextOk: { color: '#2E8B0F' },
  chipTextWarn: { color: '#A07D12' },
  chipTextInfo: { color: COLOR.purple },
  stageAction: {
    marginTop: 11, backgroundColor: '#248C08', borderRadius: RADIUS.md,
    paddingVertical: 11, alignItems: 'center',
  },
  stageActionBusy: { backgroundColor: '#7FA96F' },
  stageActionText: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: '#fff' },
  autoNote: { fontFamily: FONT.bodySemi, fontSize: 11, color: COLOR.purple, marginTop: 9 },

  // detail cards
  detailCard: { marginTop: SPACE.md, padding: 14 },
  orderImage: { width: '100%', height: 140, borderRadius: RADIUS.md, backgroundColor: COLOR.creamDeep, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5 },
  rowLabel: { fontFamily: FONT.body, fontSize: 13, color: '#7b7565', flex: 1 },
  rowValue: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink, flex: 1.4, textAlign: 'right' },
  rowMissing: { fontFamily: FONT.body, fontSize: 12, color: '#b0772a', flex: 1.4, textAlign: 'right', fontStyle: 'italic' },
  contrast: { fontFamily: FONT.body, fontSize: 11, color: '#7b7565', marginTop: 8, lineHeight: 15 },
  warn: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#d0422e', marginTop: 8 },
  refundAmount: { fontFamily: FONT.displayXBold, fontSize: 30, color: COLOR.refundInk, marginBottom: 10 },
  countdown: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink, marginTop: 8 },
  blockedBox: { marginTop: 12, backgroundColor: '#FFF8F0', borderRadius: RADIUS.sm, padding: 10 },
  blockedTitle: { fontFamily: FONT.displaySemi, fontSize: 12, color: '#b0772a', marginBottom: 4 },
  blockedReason: { fontFamily: FONT.body, fontSize: 12, color: '#8a6a3a', lineHeight: 17 },
  eligible: { marginTop: 12, fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.refundInk },

  actionError: {
    backgroundColor: '#FFF1EE', borderWidth: 1, borderColor: '#F0BDB2',
    borderRadius: RADIUS.md, padding: 12, marginBottom: SPACE.lg,
  },
  actionErrorTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#9E2B18' },
  actionErrorBody: { fontFamily: FONT.body, fontSize: 12.5, color: '#7a1f1a', marginTop: 4, lineHeight: 17 },
  actionErrorDismiss: { fontFamily: FONT.body, fontSize: 11, color: '#b08a82', marginTop: 6 },
  pendingNote: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.purple, marginBottom: SPACE.md },

  gap: {
    backgroundColor: '#FFF4F4', borderWidth: 1, borderColor: '#F3CACA',
    borderRadius: RADIUS.md, padding: 12, marginBottom: SPACE.lg,
  },
  gapClosed: { backgroundColor: '#FBFBEF', borderColor: COLOR.line },
  gapTitle: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: '#7a1f1a', lineHeight: 20 },
  gapBody: { fontFamily: FONT.body, fontSize: 13, color: '#7a1f1a', lineHeight: 19, marginTop: 4, opacity: 0.9 },
  gapCta: {
    alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#b3261e',
    borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 9,
  },
  gapCtaText: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#fff' },

  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 16, color: COLOR.ink, marginBottom: 8 },
  cardBody: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: COLOR.ink, borderRadius: RADIUS.md, paddingVertical: 15,
    alignItems: 'center', marginTop: SPACE.lg, ...SHADOW.chip,
  },
  primaryBtnText: { fontFamily: FONT.displaySemi, fontSize: 15, color: '#fff' },
  ghostBtn: {
    backgroundColor: '#F1F1E6', borderRadius: RADIUS.md, paddingVertical: 14,
    alignItems: 'center', marginTop: SPACE.md,
  },
  ghostBtnBusy: { opacity: 0.55 },
  ghostBtnText: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },
  resetBtn: { alignItems: 'center', marginTop: SPACE.xl },
  resetText: { fontFamily: FONT.body, fontSize: 12, color: '#bbb' },
  history: { fontFamily: FONT.body, fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 8 },
});
