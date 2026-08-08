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

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORMS } from './platforms';
import { STATES, describe, createPolicy, BLOCKERS, SOURCES } from './taskflow';
import {
  getTask, getAuthoritative, hasTask, subscribe, load, dispatch, reset,
} from './taskStore';
import { percentOfPaise, formatPaise } from './money';
import * as campaignStore from './backend/campaignStore';
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './ui/theme';
import { Card, RefundBadge, ProductImage } from './ui/primitives';
import { clampMonotonic } from './ui/timeline';

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

// Platform-neutral fallback text for a backend blocker when the server didn't
// attach a specific reason. The server's blockerReason ALWAYS wins over these;
// these only cover the "blocker set, reason null" edge, and are deliberately
// not Amazon-worded.
const BLOCKER_TEXT = {
  [BLOCKERS.RECONNECT]: 'Sign in to your marketplace account again so we can read your orders.',
  [BLOCKERS.ORDER_UNREADABLE]: "We couldn't read this order — connect your email so we can verify it from the confirmation.",
  [BLOCKERS.NO_DELIVERY_DATE]: 'Delivery date not available yet.',
  [BLOCKERS.REVIEW_NOT_PUBLIC]: 'Your review isn’t showing as public yet.',
  [BLOCKERS.RETURNED]: 'This order looks returned, which blocks the refund.',
};

// The "what's next" hints, derived from the AUTHORITATIVE backend snapshot (the
// source of truth) rather than the optimistic engine's generic default. Rules:
//   1. A real, current backend blocker/reason wins — that's what actually happened.
//   2. With no blocker and no matching order, show NOTHING here (the order card
//      already says "no order fetched yet") — never the misleading static
//      "Delivery date not available yet · Next: dkim" leftover.
//   3. With an order but no delivery, THAT hint is genuinely true — show it.
//   4. No authoritative snapshot yet (offline / pre-first-sync): fall back to the
//      optimistic engine's own gaps so the screen still says something useful.
function nextStepGaps(authoritative, view) {
  if (!authoritative) return view.gaps;
  if (authoritative.blocker) {
    return [{
      field: 'blocker',
      message:
        authoritative.blockerReason ||
        BLOCKER_TEXT[authoritative.blocker] ||
        `Action needed: ${authoritative.blocker}`,
      action: authoritative.blocker,
    }];
  }
  if (!authoritative.order) return [];
  if (!authoritative.delivery) {
    return [{ field: 'delivery', message: 'Delivery date not available yet', action: SOURCES.DKIM }];
  }
  return [];
}

// How the review becomes verifiable, per marketplace. This is deliberately NOT
// the web prototype's copy: the prototype tells quick-commerce/Meesho users their
// rating is "confirmed instantly" from the in-app signal, but that weak
// `is_rated` marker must never stand as proof on its own (fraud model, loophole
// 2). For those platforms a Fayr reviewer confirms the review is genuinely live,
// so the copy says exactly that.
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
  meesho: {
    title: 'Reviewer check',
    sub: 'Meesho doesn’t show review text publicly, so a Fayr reviewer confirms yours is live.',
  },
  blinkit: {
    title: 'Reviewer check',
    sub: 'Blinkit has no public review page, so a Fayr reviewer confirms your rating.',
  },
  zepto: {
    title: 'Reviewer check',
    sub: 'Zepto has no public review page, so a Fayr reviewer confirms your rating.',
  },
  instamart: {
    title: 'Reviewer check',
    sub: 'Instamart has no public review page, so a Fayr reviewer confirms your rating.',
  },
};

// ── one timeline stage ──────────────────────────────────────────────────────
function Stage({ stage, last }) {
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
              style={styles.stageAction}
            >
              <Text style={styles.stageActionText}>{action.label} →</Text>
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

  useEffect(() => {
    if (!campaignId) return undefined;
    // React to updates for THIS campaign's task (optimistic + authoritative).
    const un = subscribe((id) => {
      if (id !== campaignId) return;
      setTask(getTask(campaignId));
      setAuthoritative(getAuthoritative(campaignId));
      setClaimed(hasTask(campaignId));
    });
    if (!getTask(campaignId)) load();
    setTask(getTask(campaignId));
    setAuthoritative(getAuthoritative(campaignId));
    setClaimed(hasTask(campaignId));
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

  const act = useCallback((event) => {
    const res = dispatch(campaignId, event);
    if (res.rejected) Alert.alert('Not yet', res.reason);
  }, [campaignId]);

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
  const gaps = nextStepGaps(authoritative, view);
  const itemPaise = task.order ? task.order.itemPaise : null;
  const refundPaise = itemPaise != null ? percentOfPaise(itemPaise, campaign.percent) : null;
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
        ? `${refundLabel} reserved for your fayr Wallet`
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
      title: published ? 'Review confirmed live' : rv.title,
      sub: published ? 'Publicly visible on the product page' : rv.sub,
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
      state: refunded || payable ? 'done' : eligible ? 'active' : 'pending',
      chip: refunded || payable
        ? { label: 'Confirmed', tone: 'ok' }
        : eligible && !refundLabel
          ? { label: 'Needs staff check', tone: 'warn' }
          : null,
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
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.8}>
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

          {/* AUTHORITATIVE backend state — the source of truth behind the timeline */}
          {authoritative ? (
            <Text style={styles.serverBadge}>
              ✓ Verified state: {authoritative.state}
              {authoritative.blocker ? ` · ${authoritative.blocker}` : ''}
            </Text>
          ) : null}
        </LinearGradient>

        <View style={styles.body}>
          {/* what's blocking / what's next, from the backend */}
          {gaps.map((g) => (
            <View key={g.field} style={styles.gap}>
              <Text style={styles.gapTitle}>{g.message}</Text>
              <Text style={styles.gapAction}>Next: {g.action}</Text>
            </View>
          ))}

          <Text style={styles.sectionHead}>Refund timeline</Text>
          <Text style={styles.sectionSub}>Updates automatically as your refund progresses</Text>
          <View style={{ marginTop: SPACE.lg }}>
            {stages.map((s, i) => (
              <Stage key={s.key} stage={s} last={i === stages.length - 1} />
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
                {itemPaise != null ? (
                  <>
                    <Row label="Item price" value={`₹${formatPaise(itemPaise)}`} />
                    {task.order.orderTotalPaise != null && task.order.orderTotalPaise !== itemPaise ? (
                      // Show the contrast explicitly: the refund is a % of the ITEM,
                      // not of an order total that may bundle unrelated products.
                      <Text style={styles.contrast}>
                        Order total ₹{formatPaise(task.order.orderTotalPaise)} — includes other items; refund uses the item price only
                      </Text>
                    ) : null}
                  </>
                ) : task.order.orderTotalPaise != null ? (
                  // Quick-commerce (and Myntra): web exposes only the ORDER TOTAL,
                  // not a per-item price. Show it plainly as the order amount; the
                  // Refund section states the per-item price is still needed.
                  <Row label="Order amount" value={`₹${formatPaise(task.order.orderTotalPaise)}`} />
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
            {!payable ? (
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
            style={styles.ghostBtn}
            onPress={() => act({ type: 'CONFIRM_ORDER', key: 'confirm', at: Date.now() })}
            activeOpacity={0.8}
          >
            <Text style={styles.ghostBtnText}>Yes, this is my order</Text>
          </TouchableOpacity>

          {/* dev footer */}
          <TouchableOpacity onPress={() => reset(campaignId)} style={styles.resetBtn}>
            <Text style={styles.resetText}>Reset task (dev)</Text>
          </TouchableOpacity>
          <Text style={styles.history}>
            {task.history.length} event(s) · state {task.state}
            {task.blocker ? ` · blocked: ${task.blocker}` : ''}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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

  gap: {
    backgroundColor: '#FFF4F4', borderWidth: 1, borderColor: '#F3CACA',
    borderRadius: RADIUS.md, padding: 12, marginBottom: SPACE.lg,
  },
  gapTitle: { fontFamily: FONT.body, fontSize: 13, color: '#7a1f1a', lineHeight: 18 },
  gapAction: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#b3261e', marginTop: 6 },

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
  ghostBtnText: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },
  resetBtn: { alignItems: 'center', marginTop: SPACE.xl },
  resetText: { fontFamily: FONT.body, fontSize: 12, color: '#bbb' },
  history: { fontFamily: FONT.body, fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 8 },
});
