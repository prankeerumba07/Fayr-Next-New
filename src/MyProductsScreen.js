// "My Products" — every claim the user has, and what each one is waiting on.
//
// Ported from MyProducts / ProgressRow / RefundedRow in fayr-design.browser.jsx
// (:3785, :3844, :3893): the gradient header with the oversized display title,
// the ink-filled segmented control, the taped handwritten note, the 7-segment
// step tracker and the tone-coded stage chip.
//
// WHAT THE DESIGN HAS THAT THIS DOES NOT, and why:
//  - The per-row countdown. The design counts down a hardcoded 25m/23h; the real
//    claim deadline is `claimExpiresAt`, so the row shows the real remaining time
//    and simply omits it when the backend has not set one. An invented timer on a
//    screen about money is worse than no timer.
//  - "Upload order proof" / "Upload delivery proof" as separate steps. The
//    scraper reads order AND delivery in one fetch (see src/ui/stages.js), so
//    those steps describe waiting, not homework.
//
// Data is the real GET /tasks. Campaigns are resolved through campaignStore's
// any-status lookup, so a claim on a paused campaign still renders its product.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listTasks } from './backend/tasksApi';
import * as campaignStore from './backend/campaignStore';
import { normalizeCampaign } from './backend/campaignsApi';
import { COLOR, FONT, RADIUS, SHADOW, SPACE, rupeesFromPaise } from './ui/theme';
import { MarketplaceTag, ProductImage } from './ui/primitives';
import { emptyState, myProductsView } from './ui/tasklist';
import { StageChip, StepTracker, TapedNote } from './ui/stagebits';

/** Remaining time to a deadline, in the design's compact form. Null when unknown. */
function remainingLabel(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms) || ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h : ${String(m).padStart(2, '0')}m` : `${m}m : ${String(s).padStart(2, '0')}s`;
}

function ProgressRow({ row, campaign, now, onOpen }) {
  const { stage, closed, task } = row;
  const timeLeft = closed.closed ? null : remainingLabel(task.claimExpiresAt, now);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.rowTop} activeOpacity={0.85} onPress={onOpen}>
        <ProductImage
          imageUrl={campaign && campaign.imageUrl}
          seed={(campaign && campaign.id) || row.id}
          radius={RADIUS.md}
          style={styles.thumb}
        />
        <View style={styles.rowInfo}>
          {campaign && campaign.percent != null ? (
            <Text style={styles.pct}>{campaign.percent}% Refund 💵</Text>
          ) : null}
          <Text numberOfLines={2} style={styles.product}>
            {(campaign && (campaign.productName || campaign.title)) || 'Your claim'}
          </Text>
          {campaign ? <MarketplaceTag marketplace={campaign.marketplace} style={{ marginTop: 6 }} /> : null}
          <StageChip
            label={closed.closed ? closed.label : stage.label}
            tone={closed.closed ? closed.tone : stage.tone}
            style={{ marginTop: 9 }}
          />
          {/* The tracker is meaningless for a claim that ended early — it would
              draw progress towards a refund that is not coming. */}
          {closed.closed ? null : <StepTracker step={stage.step} tone={stage.tone} style={{ marginTop: 9 }} />}
        </View>
      </TouchableOpacity>

      <View style={styles.divider} />

      <View style={styles.rowBottom}>
        {timeLeft ? (
          <View style={styles.timer}>
            <Text style={styles.timerText}>{timeLeft}</Text>
            <Text style={styles.timerSub}>Remaining</Text>
          </View>
        ) : (
          <Text style={styles.stepText}>
            {closed.closed ? closed.title : `Step ${stage.step} of 7`}
          </Text>
        )}
        {row.cta ? (
          <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onOpen}>
            <Text style={styles.ctaText}>{row.cta} ›</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.noAction}>
            {closed.closed ? 'Nothing to do' : 'No action needed'}
          </Text>
        )}
      </View>
    </View>
  );
}

function RefundedRow({ row, campaign, onOpen }) {
  // `refund.amountPaise` is computed from the item amount actually charged, so it
  // is the figure that was really paid — not the campaign's listed price.
  const paise = row.task.refund ? row.task.refund.amountPaise : null;
  const settled = row.task.closedAt ? String(row.task.closedAt).slice(0, 10) : null;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onOpen}>
      <View style={styles.rowTop}>
        <ProductImage
          imageUrl={campaign && campaign.imageUrl}
          seed={(campaign && campaign.id) || row.id}
          radius={RADIUS.md}
          style={styles.thumb}
        />
        <View style={styles.rowInfo}>
          {campaign && campaign.percent != null ? (
            <Text style={styles.pct}>{campaign.percent}% Refund 💵</Text>
          ) : null}
          <Text numberOfLines={2} style={styles.product}>
            {(campaign && (campaign.productName || campaign.title)) || 'Your claim'}
          </Text>
          <StageChip label="Refunded" tone="green" check style={{ marginTop: 9 }} />
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.rowBottom}>
        <Text style={styles.settled}>{settled ? `Claim settled on ${settled}` : 'Claim settled'}</Text>
        {paise != null ? (
          <Text style={styles.amountLabel}>
            Amount: <Text style={styles.amount}>₹{rupeesFromPaise(paise)}</Text>
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function MyProductsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('progress');
  const [tasks, setTasks] = useState(null); // null = first load
  const [refreshing, setRefreshing] = useState(false);
  const [campaigns, setCampaigns] = useState(campaignStore.getAll());
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const res = await listTasks();
    if (res.ok) {
      setTasks(res.tasks);
      // Resolve every campaign this user has a claim on, whatever its status —
      // otherwise a paused campaign renders as a blank row.
      const ids = [...new Set(res.tasks.map((t) => t.campaign && t.campaign.id).filter(Boolean))];
      await Promise.all(ids.map((id) => campaignStore.ensureById(id)));
      setCampaigns(campaignStore.getAll());
    } else if (tasks == null) {
      setTasks([]);
    }
  }, [tasks]);

  useEffect(() => {
    const unsub = campaignStore.subscribe(() => setCampaigns(campaignStore.getAll()));
    const unfocus = navigation.addListener('focus', load);
    load();
    return () => { unsub(); unfocus(); };
  }, [navigation, load]);

  // One shared tick drives every row's countdown, so N rows do not run N timers.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const view = myProductsView(tasks || []);
  const rows = tab === 'progress' ? view.inProgress : view.refunded;
  const empty = emptyState(tab);
  // Prefer the store's copy (it carries price/cap/asin), but fall back to the
  // campaign embedded in the task — normalized, so both branches expose the same
  // field names (`percent`, `marketplace`) rather than one silently rendering blank.
  const campaignFor = (row) => {
    const cid = row.campaign && row.campaign.id;
    return (cid && campaignStore.getById(cid))
      || (row.campaign ? normalizeCampaign(row.campaign) : null);
  };
  const open = (row) => {
    const cid = row.campaign && row.campaign.id;
    if (cid) navigation.navigate('Task', { campaignId: cid });
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <Text style={styles.title}>My Products</Text>
        <View style={styles.segment}>
          {[['progress', 'In Progress', view.counts.inProgress],
            ['refunded', 'Refund Claimed', view.counts.refunded]].map(([k, label, count]) => (
              <TouchableOpacity
                key={k}
                onPress={() => setTab(k)}
                activeOpacity={0.85}
                style={[styles.segBtn, tab === k && styles.segBtnOn]}
              >
                <Text style={[styles.segText, tab === k && styles.segTextOn]}>
                  {label}{count ? ` (${count})` : ''}
                </Text>
              </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={COLOR.ink}
          />
        )}
      >
        <TapedNote>
          {tab === 'progress'
            ? 'Claimed products still working their way to a refund appear here.'
            : 'Claimed products with settled refunds appear here.'}
        </TapedNote>

        {tasks == null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={COLOR.ink} />
            <Text style={styles.loadingText}>Loading your claims…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{empty.icon}</Text>
            <Text style={styles.emptyTitle}>{empty.title}</Text>
            <Text style={styles.emptyBody}>{empty.body}</Text>
          </View>
        ) : (
          rows.map((row) => (tab === 'progress' ? (
            <ProgressRow
              key={row.id}
              row={row}
              campaign={campaignFor(row)}
              now={now}
              onOpen={() => open(row)}
            />
          ) : (
            <RefundedRow key={row.id} row={row} campaign={campaignFor(row)} onOpen={() => open(row)} />
          )))
        )}

        {rows.length > 0 ? <Text style={styles.footer}>SECURE FAYR TRACKING</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: 14 },
  title: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.ink, marginTop: 6, marginBottom: 14 },
  segment: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: RADIUS.pill,
    padding: 3, ...SHADOW.chip,
  },
  segBtn: { flex: 1, borderRadius: 20, paddingVertical: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: COLOR.ink },
  segText: { fontFamily: FONT.bodyMed, fontSize: 13.5, color: COLOR.sub },
  segTextOn: { fontFamily: FONT.display, color: '#fff' },

  card: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 12,
    marginBottom: 12, ...SHADOW.card,
  },
  rowTop: { flexDirection: 'row', gap: 12 },
  thumb: { width: 88, height: 102 },
  rowInfo: { flex: 1, minWidth: 0 },
  pct: {
    alignSelf: 'flex-start', backgroundColor: COLOR.refundBg, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
    fontFamily: FONT.display, fontSize: 11.5, color: COLOR.refundInk,
  },
  product: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink, marginTop: 6, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLOR.line, marginVertical: 11 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  timer: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFEAEA',
    borderRadius: 5, paddingHorizontal: 10, paddingVertical: 4,
  },
  timerText: { fontFamily: FONT.displayXBold, fontSize: 11.5, color: COLOR.red },
  timerSub: { fontFamily: FONT.body, fontSize: 10, color: '#726d73' },
  stepText: { fontFamily: FONT.body, fontSize: 11, color: '#8b8c80', flex: 1 },
  cta: {
    backgroundColor: '#1D7400', borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9,
  },
  ctaText: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#fff' },
  noAction: { fontFamily: FONT.displaySemi, fontSize: 11.5, color: COLOR.sub },
  settled: { fontFamily: FONT.body, fontSize: 10.5, color: COLOR.sub, flex: 1 },
  amountLabel: { fontFamily: FONT.body, fontSize: 10.5, color: COLOR.sub },
  amount: { fontFamily: FONT.displaySemi, fontSize: 16, color: COLOR.ink },

  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 10 },
  loadingText: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },
  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: SPACE.xl },
  emptyIcon: { fontSize: 46 },
  emptyTitle: { fontFamily: FONT.display, fontSize: 17, color: COLOR.ink, marginTop: 10 },
  emptyBody: { fontFamily: FONT.body, fontSize: 13.5, color: COLOR.sub, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  footer: {
    textAlign: 'center', fontFamily: FONT.bodySemi, fontSize: 9.5,
    letterSpacing: 1.8, color: '#b0b1a2', marginTop: 22,
  },
});
