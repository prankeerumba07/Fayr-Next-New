// Screenshot proof — the fallback when the scraper cannot read an order.
//
// Ported from ScreenshotProof / ProofUpload (fayr-design.browser.jsx :2755,
// :2856): the dashed drop target, the status banner tinted by outcome, the
// reviewer's note surfaced verbatim, and the supporting-only footnote.
//
// DROPPED from the design: OcrConfirm (:2898), the screen where the user reviews
// and EDITS the extracted order number, amount and date. Letting the person being
// verified retype the fields their proof is checked against would defeat the
// check — and the backend deliberately never exposes an edit path. Extraction is
// staff-facing; the user sees the outcome, not the form.
//
// Also dropped: the design's fake upload progress bar and "resumable — a dropped
// connection picks up where it left off". Neither is true.
//
// ADDED 1 September 2026: on a successful upload this now opens the design's own
// imagesuploaded screen, which says what to do next rather than repeating that the
// picture arrived. It was one of the twenty design screens that had never been
// built. See src/screens/imagesuploaded.js.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KINDS, listScreenshots, uploadScreenshot } from './backend/screenshotsApi';
import * as campaignStore from './backend/campaignStore';
import { getTask } from './backend/tasksApi';
import { getTaskId } from './taskStore';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './ui/theme';
import { StageChip } from './ui/stagebits';
import { SUPPORTING_ONLY, WHAT_TO_CAPTURE, proofView } from './ui/proof';
import { goBackOrHome } from './ui/nav';

const KIND_ORDER = ['PURCHASE', 'DELIVERY', 'REVIEW'];

export default function ProofUploadScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;

  const [kind, setKind] = useState(KIND_ORDER.includes(params.kind) ? params.kind : 'PURCHASE');
  const [taskId, setTaskId] = useState(params.taskId || null);
  const [uploads, setUploads] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const campaign = campaignId ? campaignStore.getById(campaignId) : null;

  // Resolve the task id: the caller may pass it, or we look it up from the local
  // store's authoritative snapshot for this campaign.
  useEffect(() => {
    if (taskId || !campaignId) return;
    const id = getTaskId(campaignId);
    if (id) setTaskId(id);
  }, [campaignId, taskId]);

  const load = useCallback(async () => {
    if (!taskId) { setUploads([]); return; }
    const res = await listScreenshots(taskId);
    setUploads(res.ok ? res.uploads : []);
  }, [taskId]);

  useEffect(() => {
    const unfocus = navigation.addListener('focus', load);
    load();
    return unfocus;
  }, [navigation, load]);

  const view = proofView(uploads || [], kind);

  const pickAndUpload = async () => {
    if (busy || !taskId) return;
    setError(null);

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Fayr needs permission to open your photos so you can pick the screenshot. '
        + 'Only the image you choose is uploaded.',
      );
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
      exif: false, // strip camera/location metadata — we need the picture, not where they were
    });
    if (picked.canceled || !picked.assets || !picked.assets[0]) return;

    setBusy(true);
    const res = await uploadScreenshot(taskId, kind, picked.assets[0]);
    if (!res.ok) setError(res.error);
    else {
      await load();
      // Refresh the authoritative task too: an upload can change what the task
      // screen should say next.
      if (taskId) getTask(taskId).catch(() => {});
      // THE DESIGN'S OWN NEXT SCREEN, built 1 September 2026. Its job is not to say
      // the picture arrived — the card below already says that, where the picture
      // is — it is to say WHAT TO DO NEXT, which after a delivery picture is go and
      // write the review, and nothing was telling anybody that. It is given the
      // kind, so it says the right next thing for each of the three.
      navigation.navigate('imagesuploaded', { campaignId, taskId, kind });
    }
    setBusy(false);
  };

  const kindTitle = KINDS[kind] ? KINDS[kind].title : 'Order';

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBackOrHome(navigation)} style={styles.back} activeOpacity={0.8}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Send a screenshot</Text>
        </View>
        {campaign ? (
          <Text numberOfLines={1} style={styles.headerSub}>
            {campaign.productName || campaign.title}
          </Text>
        ) : null}

        <View style={styles.switch}>
          {KIND_ORDER.map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setKind(k)}
              style={[styles.switchBtn, kind === k && styles.switchBtnOn]}
              activeOpacity={0.85}
            >
              <Text style={[styles.switchText, kind === k && styles.switchTextOn]}>
                {KINDS[k].title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {!taskId ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Claim this offer first</Text>
            <Text style={styles.noticeBody}>
              A screenshot has to attach to a claim. Claim the offer, then come back here.
            </Text>
          </View>
        ) : uploads == null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={COLOR.ink} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : (
          <>
            {view.banner ? (
              <View style={styles.bannerWrap}>
                <StageChip label={view.banner.label} tone={view.banner.tone} />
                <Text style={styles.bannerNote}>
                  {view.banner.fromReviewer ? (
                    <Text style={styles.reviewerTag}>Reviewer’s note: </Text>
                  ) : null}
                  {view.banner.note}
                </Text>
              </View>
            ) : null}

            <View style={styles.guide}>
              <Text style={styles.guideTitle}>What to capture</Text>
              <Text style={styles.guideBody}>{WHAT_TO_CAPTURE[kind]}</Text>
            </View>

            {view.canUpload ? (
              <TouchableOpacity
                style={[styles.drop, busy && styles.dropBusy]}
                activeOpacity={0.85}
                onPress={pickAndUpload}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color={COLOR.greenDeep} />
                    <Text style={styles.dropLabel}>Uploading…</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.dropIcon}>📤</Text>
                    <Text style={styles.dropLabel}>{view.uploadLabel}</Text>
                    <Text style={styles.dropSub}>JPG · PNG · WebP</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.footnote}>{SUPPORTING_ONLY}</Text>

            {view.history.length ? (
              <View style={styles.history}>
                <Text style={styles.historyTitle}>EARLIER {kindTitle.toUpperCase()} UPLOADS</Text>
                {view.history.map((u) => (
                  <View key={u.id} style={styles.historyRow}>
                    <Text style={styles.historyDate}>{String(u.uploadedAt || '').slice(0, 10)}</Text>
                    <Text style={styles.historyStatus}>{u.status.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  headerTitle: { fontFamily: FONT.display, fontSize: 21, color: COLOR.ink },
  headerSub: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.sub, marginTop: 8 },
  switch: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: RADIUS.pill,
    padding: 3, marginTop: SPACE.md, ...SHADOW.chip,
  },
  switchBtn: { flex: 1, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  switchBtnOn: { backgroundColor: COLOR.ink },
  switchText: { fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.sub },
  switchTextOn: { fontFamily: FONT.display, color: '#fff' },

  bannerWrap: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14,
    marginBottom: SPACE.md, ...SHADOW.card,
  },
  bannerNote: { fontFamily: FONT.body, fontSize: 13, color: COLOR.ink2, marginTop: 8, lineHeight: 19 },
  reviewerTag: { fontFamily: FONT.bodyBold },

  guide: {
    backgroundColor: COLOR.blueBg, borderRadius: RADIUS.md,
    padding: 13, marginBottom: SPACE.md,
  },
  guideTitle: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: '#1C5BB8' },
  guideBody: { fontFamily: FONT.body, fontSize: 12.5, color: '#2F4F7A', marginTop: 4, lineHeight: 18 },

  drop: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: COLOR.line,
    borderRadius: RADIUS.xl, backgroundColor: '#fff', minHeight: 168,
    alignItems: 'center', justifyContent: 'center', gap: 8, padding: SPACE.xl,
  },
  dropBusy: { borderColor: COLOR.green },
  dropIcon: { fontSize: 40 },
  dropLabel: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink2 },
  dropSub: { fontFamily: FONT.body, fontSize: 11.5, color: COLOR.sub },

  error: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.red, marginTop: 10 },
  footnote: { fontFamily: FONT.body, fontSize: 11.5, color: '#8b8c80', marginTop: 14, lineHeight: 17 },

  history: { marginTop: SPACE.xl },
  historyTitle: { fontFamily: FONT.display, fontSize: 11, letterSpacing: 0.6, color: COLOR.sub },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: RADIUS.sm, padding: 12, marginTop: 8,
  },
  historyDate: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.ink },
  historyStatus: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub, textTransform: 'capitalize' },

  notice: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, ...SHADOW.card },
  noticeTitle: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
  noticeBody: { fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: 6, lineHeight: 19 },

  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 30 },
  loadingText: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },
});
