// THE CLAIM JOURNEY — one page at a time.
//
// What was here before was one long screen with every stage on it at once. It was
// honest and complete and it read as a list. This is the same journey drawn the
// way the design draws it: one thing to do, where you are, and what happens next.
//
// EVERY DECISION IS IN ui/journey.js. This file draws what that returns and
// nothing else — no branching of its own about which page to show, no wording of
// its own. That is what lets the whole journey be checked under node, including
// the states nobody plans for.
//
// THE DESIGN'S OWN PARTS, NOT NEW ONES. The gradient header, the tone chip and
// the segment tracker are ui/stagebits.js, already ported from the design. The
// tracker is drawn with ten segments instead of seven because this journey has
// ten pages; everything else about it is unchanged.
//
// COMING BACK FROM THE SHOP CANNOT LAND AT THE BEGINNING. The page is worked out
// from the server's record of the task, every time the screen is looked at, so
// there is no pointer on the device to lose. Leaving for Amazon and coming back
// re-derives the same page from the same record.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as campaignStore from './../backend/campaignStore';
import { listScreenshots, uploadScreenshot } from './../backend/screenshotsApi';
import { getTask } from './../backend/tasksApi';
import {
  clearActionError, dispatch, getActionError, getAuthoritative,
  getTaskId, isPending, subscribe,
} from './../taskStore';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './../ui/theme';
import { StageChip, StepTracker } from './../ui/stagebits';
import { checkLine, journeyStepFor, journeyView, page } from './../ui/journey';
import { goBackOrHome } from './../ui/nav';
import { hasVisitedShop, markVisitedShop } from './shopVisits';

/** Which kind of screenshot each page is about. */
const SHOT_KIND = { 'purchase-shot': 'PURCHASE', 'review-shot': 'REVIEW' };

/** The tone each page is drawn in, from the design's own palette. */
const TONE = {
  join: 'amber', connect: 'amber', buy: 'amber', delivered: 'blue',
  'purchase-shot': 'blue', checking: 'blue', review: 'purple',
  'review-shot': 'purple', window: 'green', refund: 'green',
};

export default function JourneyScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;

  const [, setTick] = useState(0);
  const [uploads, setUploads] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const authoritative = campaignId ? getAuthoritative(campaignId) : null;
  const taskId = campaignId ? getTaskId(campaignId) : null;

  // Redraw whenever the server's record changes: that record is what decides
  // which page this is, so the screen has to follow it rather than its own state.
  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  const loadShots = useCallback(async () => {
    if (!taskId) { setUploads([]); return; }
    const res = await listScreenshots(taskId);
    setUploads(res.ok ? res.uploads : []);
  }, [taskId]);

  // On every return to this screen, not only the first time. Coming back from the
  // shop, or from the marketplace sign-in, has to re-read the record — that is
  // the whole mechanism behind landing on the right page.
  useEffect(() => {
    const unfocus = navigation.addListener('focus', () => {
      void loadShots();
      if (taskId) getTask(taskId).catch(() => {});
    });
    void loadShots();
    return unfocus;
  }, [navigation, loadShots, taskId]);

  const shotsOf = (kind) => (uploads || []).filter((u) => u.kind === kind);
  const newestOf = (kind) => {
    const list = shotsOf(kind);
    return list.length > 0 ? list[0] : null;
  };

  // Everything the page depends on, gathered once. The step is worked out first
  // so the right screenshot can be shown with it — asking for the newest of ALL
  // of them would show the review picture on the order page.
  const facts = {
    task: authoritative,
    // Only the first two pages use this, and only before there is any record to
    // read. See journey/shopVisits.js for why it is a note and not a check.
    connected:
      !!(authoritative && authoritative.order) ||
      shotsOf('PURCHASE').length > 0 ||
      hasVisitedShop(campaignId),
    // Whether a screenshot is needed at all is the SERVER'S business, read off
    // the task's own blocker by journey.js. Not passed at all here, so there is
    // one place that decides it and no chance of this screen disagreeing.
    purchaseShotSent: shotsOf('PURCHASE').length > 0,
    productName: campaign ? campaign.productName || campaign.title : null,
    shopName: campaign ? campaign.marketplaceName || campaign.marketplace : null,
    busy: busy || (campaignId ? isPending(campaignId) : false),
    error: error || (campaignId ? getActionError(campaignId) : null),
  };
  // `showPage` exists for the walk through, and for nothing else in the app.
  // Which page this is, is normally the SERVER'S decision, worked out from the
  // claim's own record — which is what makes coming back from the shop land on
  // the right page. That also means eight of the ten pages cannot be looked at
  // unless a claim happens to be at that exact point, so the walk through asks
  // for one by name. Unset, nothing changes: the record decides, as it must.
  const asked = (route && route.params && route.params.showPage) || null;
  const key = asked && page(asked) ? asked : journeyStepFor(facts);
  const view = journeyView({
    ...facts,
    check: checkFor(newestOf(SHOT_KIND[key] || 'PURCHASE'), key),
  });

  const act = useCallback((event) => {
    if (!campaignId) return;
    clearActionError(campaignId);
    const res = dispatch(campaignId, event);
    if (res.rejected) Alert.alert('Not yet', res.reason);
  }, [campaignId]);

  const pickAndSend = useCallback(async (kind) => {
    if (busy || !taskId) return;
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Fayr needs permission to open your photos so you can pick the '
        + 'screenshot. Only the image you choose is sent.',
      );
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
      exif: false, // the picture, not where they were when they took it
    });
    if (picked.canceled || !picked.assets || !picked.assets[0]) return;

    setBusy(true);
    const res = await uploadScreenshot(taskId, kind, picked.assets[0]);
    if (!res.ok) setError(res.error);
    else {
      await loadShots();
      if (taskId) getTask(taskId).catch(() => {});
    }
    setBusy(false);
  }, [busy, taskId, loadShots]);

  const press = useCallback(() => {
    switch (view.key) {
      case 'join':
        // The design's own confirmation screen, which already carries the
        // ticket cost, the refund, the deadline and the honesty acknowledgement.
        // Claiming from here instead would be a second way to spend somebody's
        // tickets, with fewer words in front of it.
        navigation.navigate('ConfirmJoin', { campaignId });
        return;
      case 'connect':
        // The same shop, opened to sign in rather than to buy. There is one way
        // in to a shop and there should be: a second one would be a second thing
        // to keep working.
        if (campaign) {
          markVisitedShop(campaignId);
          navigation.navigate(campaign.marketplace, { campaignId });
        }
        return;
      case 'buy':
      case 'review':
        if (campaign) {
          markVisitedShop(campaignId);
          navigation.navigate(campaign.marketplace, { campaignId });
        }
        return;
      case 'delivered':
        act({ type: 'CONFIRM_ORDER', key: 'confirm', at: Date.now() });
        return;
      case 'purchase-shot':
        void pickAndSend('PURCHASE');
        return;
      case 'review-shot':
        void pickAndSend('REVIEW');
        return;
      case 'refund':
        navigation.navigate('Earnings');
        return;
      default:
    }
  }, [view.key, campaignId, campaign, navigation, act, pickAndSend]);

  if (!campaign) {
    return (
      <View style={styles.root}>
        <Text style={styles.missing}>That offer is not here any more.</Text>
        <TouchableOpacity onPress={() => goBackOrHome(navigation)} style={styles.action}>
          <Text style={styles.actionText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tone = TONE[view.key] || 'blue';

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.cream]}
        style={[styles.header, { paddingTop: insets.top + SPACE.sm }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => goBackOrHome(navigation)}
            style={styles.back}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          {view.product ? (
            <Text numberOfLines={1} style={styles.headerTitle}>{view.product}</Text>
          ) : null}
        </View>

        {/* Where you are: said out loud, and drawn. Both, because the bar alone
            is a decoration and the words alone are hard to place at a glance. */}
        <StageChip label={view.where} tone={tone} style={styles.chip} />
        <StepTracker step={view.stepNumber} total={view.of} tone={tone} style={styles.track} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>{view.title}</Text>
        <Text style={styles.p}>{view.body}</Text>

        {view.check ? (
          <View style={styles.checkCard}>
            <View style={styles.checkHead}>
              {view.check.running ? (
                <ActivityIndicator color={COLOR.greenDeep} />
              ) : (
                <Text style={styles.checkMark}>{view.check.decided ? '✓' : '•'}</Text>
              )}
              <Text style={styles.checkTitle}>
                {view.check.running ? 'Reading your screenshot' : 'What we found'}
              </Text>
            </View>
            <Text style={styles.checkLine}>{view.check.line}</Text>
            {view.check.note ? (
              <Text style={styles.checkNote}>{view.check.note}</Text>
            ) : null}
            <Text style={styles.checkFoot}>
              A screenshot is never the only thing we go on, and it is never
              accepted without a person at Fayr looking at it.
            </Text>
          </View>
        ) : null}

        {view.waiting ? (
          <View style={styles.waitCard}>
            <Text style={styles.waitText}>
              Nothing needed from you. We will move this on by ourselves.
            </Text>
          </View>
        ) : null}

        {/* What happens next, on every page. The one thing somebody standing in a
            shop with their phone out actually wants to know. */}
        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>What happens next</Text>
          <Text style={styles.nextText}>{view.next}</Text>
        </View>

        {view.error ? <Text style={styles.error}>{view.error}</Text> : null}
      </ScrollView>

      {view.action ? (
        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, SPACE.lg) }]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={press}
            disabled={!view.action.enabled}
            activeOpacity={0.88}
            style={[styles.action, !view.action.enabled && styles.actionBusy]}
          >
            <Text style={styles.actionText}>
              {view.action.busy ? 'Working…' : `${view.action.label} →`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

/**
 * What to show about the reading of a screenshot.
 *
 * The words come from ui/journey.js, so this screen and the older screenshot
 * screen cannot end up disagreeing about what a status means.
 *
 * Only on the two pages that are about a screenshot. On the others there is
 * nothing to say about one, and saying it anyway would put an order's reading on
 * the page about writing a review.
 */
function checkFor(upload, key) {
  if (!upload) return null;
  if (key !== 'purchase-shot' && key !== 'checking' && key !== 'review-shot') {
    return null;
  }
  const status = typeof upload.status === 'string' ? upload.status : '';
  return {
    running: status === 'UPLOADED' || status === 'EXTRACTING',
    decided: status === 'APPROVED',
    line: checkLine(status),
    note: typeof upload.reviewNote === 'string' && upload.reviewNote
      ? upload.reviewNote
      : null,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },

  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: FONT.bodySemi, fontSize: 20, color: COLOR.ink },
  headerTitle: {
    flex: 1, fontFamily: FONT.display, fontSize: 15, color: COLOR.ink,
  },
  chip: { alignSelf: 'flex-start', marginTop: SPACE.md },
  track: { marginTop: SPACE.sm },

  body: { padding: SPACE.xl, paddingBottom: SPACE.xxl },
  h1: { fontFamily: FONT.display, fontSize: 24, lineHeight: 31, color: COLOR.ink },
  p: {
    fontFamily: FONT.body, fontSize: 14.5, lineHeight: 23, color: COLOR.sub,
    marginTop: SPACE.md,
  },

  checkCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: SPACE.lg,
    marginTop: SPACE.xl, ...SHADOW.card,
  },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  checkMark: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.greenDeep },
  checkTitle: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink },
  checkLine: {
    fontFamily: FONT.body, fontSize: 14, lineHeight: 22, color: COLOR.ink,
    marginTop: SPACE.sm,
  },
  checkNote: {
    fontFamily: FONT.bodyMed, fontSize: 13.5, lineHeight: 21, color: COLOR.sub,
    marginTop: SPACE.sm, backgroundColor: COLOR.creamDeep,
    borderRadius: RADIUS.md, padding: SPACE.md,
  },
  checkFoot: {
    fontFamily: FONT.body, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
    marginTop: SPACE.md,
  },

  waitCard: {
    backgroundColor: COLOR.greenBg, borderRadius: RADIUS.lg, padding: SPACE.lg,
    marginTop: SPACE.xl,
  },
  waitText: {
    fontFamily: FONT.bodyMed, fontSize: 13.5, lineHeight: 21,
    color: COLOR.refundInk,
  },

  nextCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: SPACE.lg,
    marginTop: SPACE.xl, ...SHADOW.card,
  },
  nextLabel: {
    fontFamily: FONT.bodySemi, fontSize: 10.5, letterSpacing: 1.4,
    color: COLOR.sub, textTransform: 'uppercase',
  },
  nextText: {
    fontFamily: FONT.body, fontSize: 14, lineHeight: 22, color: COLOR.ink,
    marginTop: SPACE.xs,
  },

  error: {
    fontFamily: FONT.bodyMed, fontSize: 13.5, color: COLOR.red,
    marginTop: SPACE.lg,
  },
  missing: {
    fontFamily: FONT.body, fontSize: 15, color: COLOR.sub,
    textAlign: 'center', marginTop: SPACE.xxl, marginHorizontal: SPACE.xl,
  },

  foot: { paddingHorizontal: SPACE.xl, paddingTop: SPACE.md },
  action: {
    backgroundColor: COLOR.greenDeep, borderRadius: RADIUS.md,
    paddingVertical: SPACE.lg, alignItems: 'center', marginHorizontal: SPACE.xl,
    ...SHADOW.chip,
  },
  actionBusy: { opacity: 0.6 },
  actionText: { fontFamily: FONT.display, fontSize: 15, color: '#fff' },
});
