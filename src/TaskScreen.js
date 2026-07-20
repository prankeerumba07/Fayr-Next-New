// The task screen: current state, the fetched order for confirmation, the gaps
// where a field is missing, and the refund countdown.
//
// The rule this screen exists to honour: NEVER render a blank where a fact
// should be. If the order couldn't be read, it says so and offers the next
// action. A missing field is a gap with a cause, not an empty row.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CAMPAIGNS, campaignById } from './campaign';
import { PLATFORMS } from './platforms';
import { STATES, BLOCKERS, describe, createPolicy, shouldRecheckVisibility } from './taskflow';
import { getTask, subscribe, load, dispatch, reset } from './taskStore';
import { percentOfPaise, formatPaise } from './money';

const POLICY = createPolicy();
const FALLBACK_COLOR = '#FF9900';

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

export default function TaskScreen({ navigation, route }) {
  const campaignId = (route && route.params && route.params.campaignId) || CAMPAIGNS[0].id;
  const campaign = campaignById(campaignId) || CAMPAIGNS[0];
  const platform = PLATFORMS[campaign.marketplace];
  const color = (platform && platform.color) || FALLBACK_COLOR;
  const platformName = platform ? platform.name : campaign.marketplace;

  const [task, setTask] = useState(getTask(campaignId));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Only react to updates for THIS campaign's task.
    const un = subscribe((id, t) => { if (id === campaignId) setTask(t); });
    if (!getTask(campaignId)) load();
    setTask(getTask(campaignId));
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

  if (!task) {
    return <SafeAreaView style={styles.container}><Text style={styles.muted}>Loading…</Text></SafeAreaView>;
  }

  const view = describe(task, now, POLICY);
  const itemPaise = task.order ? task.order.itemPaise : null;
  const refundPaise = itemPaise != null ? percentOfPaise(itemPaise, campaign.percent) : null;
  const stepIndex = STEPS.indexOf(task.state);
  const idLabel = campaign.asin || campaign.pid || campaign.styleId || null;
  const match = task.order && task.order.match;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.h1}>{campaign.productName}</Text>
        <Text style={styles.muted}>
          {campaign.percent}% refund · {platformName}{idLabel ? ` · ${idLabel}` : ` · ₹${campaign.amount}`}
        </Text>

        <View style={styles.pipeline}>
          {STEPS.map((s, i) => (
            <View key={s} style={styles.pipeStep}>
              <View style={[styles.dot, i <= stepIndex && { backgroundColor: color }]} />
              <Text style={[styles.pipeLabel, i === stepIndex && styles.pipeLabelActive]}>{s}</Text>
            </View>
          ))}
        </View>

        {view.gaps.map((g) => (
          <View key={g.field} style={styles.gap}>
            <Text style={styles.gapTitle}>{g.message}</Text>
            <Text style={styles.gapAction}>Next: {g.action}</Text>
          </View>
        ))}

        <Text style={styles.h2}>Your order</Text>
        <View style={styles.card}>
          {task.order ? (
            <>
              {task.order.image ? (
                <Image
                  source={{ uri: task.order.image }}
                  style={styles.orderImage}
                  resizeMode="contain"
                />
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
              {view.gaps.length ? view.gaps[0].message : 'No order fetched yet. Tap "I\'ve completed the purchase".'}
            </Text>
          )}
        </View>

        <Text style={styles.h2}>Refund</Text>
        <View style={styles.card}>
          {refundPaise != null ? (
            <Text style={styles.refund}>₹{formatPaise(refundPaise)}</Text>
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
          {!view.refund.eligible ? (
            <View style={styles.blockedBox}>
              <Text style={styles.blockedTitle}>Refund on hold</Text>
              {view.refund.reasons.map((r) => (
                <Text key={r} style={styles.blockedReason}>• {r}</Text>
              ))}
            </View>
          ) : (
            <Text style={styles.eligible}>✓ Ready to release</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: color }]}
          onPress={() => navigation.navigate(campaign.marketplace, { campaignId })}
        >
          <Text style={styles.btnText}>
            {task.order ? `Re-check on ${platformName}` : "I've completed the purchase"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => act({ type: 'CONFIRM_ORDER', key: 'confirm', at: Date.now() })}
        >
          <Text style={styles.btnGhostText}>Yes, this is my order</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => act({ type: 'MARK_REVIEWED', key: 'reviewed', at: Date.now() })}
        >
          <Text style={styles.btnGhostText}>Yes, I have reviewed it</Text>
        </TouchableOpacity>

        {task.state === STATES.REVIEWED ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => act({ type: 'START_HOLD', key: `hold:${Date.now()}`, at: Date.now() })}
          >
            <Text style={styles.btnGhostText}>Start return-window hold</Text>
          </TouchableOpacity>
        ) : null}

        {view.refund.eligible ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#0C831F' }]}
            onPress={() => act({ type: 'RELEASE_REFUND', key: 'release', at: Date.now(), policy: POLICY })}
          >
            <Text style={styles.btnText}>Release ₹{formatPaise(refundPaise)} to wallet</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity onPress={() => reset(campaignId)} style={styles.resetBtn}>
          <Text style={styles.resetText}>Reset task (dev)</Text>
        </TouchableOpacity>

        <Text style={styles.history}>
          {task.history.length} event(s) · state {task.state}
          {task.blocker ? ` · blocked: ${task.blocker}` : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  h1: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  h2: { fontSize: 13, fontWeight: '700', color: '#999', textTransform: 'uppercase', marginTop: 22, marginBottom: 8, letterSpacing: 0.5 },
  muted: { fontSize: 13, color: '#777', marginTop: 4 },
  pipeline: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 },
  pipeStep: { alignItems: 'center', flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ddd', marginBottom: 4 },
  pipeLabel: { fontSize: 8, color: '#bbb', textAlign: 'center' },
  pipeLabelActive: { color: '#1a1a1a', fontWeight: '700' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e2e2', borderRadius: 12, padding: 14 },
  orderImage: { width: '100%', height: 140, borderRadius: 10, backgroundColor: '#f6f6f6', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5 },
  rowLabel: { fontSize: 13, color: '#777', flex: 1 },
  rowValue: { fontSize: 13, color: '#1a1a1a', fontWeight: '600', flex: 1.4, textAlign: 'right' },
  rowMissing: { fontSize: 12, color: '#b0772a', flex: 1.4, textAlign: 'right', fontStyle: 'italic' },
  contrast: { fontSize: 11, color: '#777', marginTop: 8, lineHeight: 15 },
  warn: { fontSize: 12, color: '#b3261e', marginTop: 8, fontWeight: '600' },
  refund: { fontSize: 30, fontWeight: '800', color: '#0C831F', marginBottom: 10 },
  countdown: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', marginTop: 8 },
  blockedBox: { marginTop: 12, backgroundColor: '#fff8f0', borderRadius: 8, padding: 10 },
  blockedTitle: { fontSize: 12, fontWeight: '700', color: '#b0772a', marginBottom: 4 },
  blockedReason: { fontSize: 12, color: '#8a6a3a', lineHeight: 17 },
  eligible: { marginTop: 12, fontSize: 14, fontWeight: '700', color: '#0C831F' },
  gap: { backgroundColor: '#fff4f4', borderWidth: 1, borderColor: '#f3caca', borderRadius: 10, padding: 12, marginTop: 14 },
  gapTitle: { fontSize: 13, color: '#7a1f1a', lineHeight: 18 },
  gapAction: { fontSize: 12, color: '#b3261e', fontWeight: '700', marginTop: 6 },
  btn: { backgroundColor: FALLBACK_COLOR, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnGhost: { backgroundColor: '#f2f2f2' },
  btnGhostText: { color: '#1a1a1a', fontSize: 14, fontWeight: '600' },
  resetBtn: { alignItems: 'center', marginTop: 18 },
  resetText: { fontSize: 12, color: '#bbb' },
  history: { fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 10 },
});
