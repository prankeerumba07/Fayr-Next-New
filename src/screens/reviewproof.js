// reviewproof — fayr-design.browser.jsx:3056 (ReviewProof)
//
// "Posted? Show us." The picture of a live review. Split out of
// src/journey/JourneyScreen.js on 1 September 2026, where it was one page of ten
// inside one file.
//
// THE DESIGN'S OWN CONTENT: the bar, the heading, the two ways of proving it, the
// blue note, and the one button.
//
// THE TWO WAYS ARE THE OTHER WAY ROUND HERE, AND THAT IS DELIBERATE. The design
// prefers a link to the review and accepts a screenshot. Fayr has no route that
// takes a review link — nothing anywhere in the backend accepts one — so an address
// box on this screen would be a box that swallows what somebody typed. The
// screenshot is real, so the screenshot leads, and the screen says in one plain line
// that sending a link is not ready yet. Neither option is removed and nothing is
// pretended.
//
// THE UPLOAD IS REAL. The design's "Upload a screenshot instead" button has nothing
// behind it. This one asks for permission, opens the phone's photos, strips where
// the picture was taken, and sends it to the same place every other proof goes.
//
// NOT COPIED: "your deadline freezes — the frozen clock is visible on your campaign
// card". Fayr freezes no deadlines and draws no such clock, so it would be a promise
// about behaviour that does not exist.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import * as campaignStore from '../backend/campaignStore';
import { listScreenshots, uploadScreenshot } from '../backend/screenshotsApi';
import { getTask as getTaskFromServer } from '../backend/tasksApi';
import { getTaskId } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { checkLine } from '../ui/journey';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

export default function ReviewProofScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';

  const [taskId, setTaskId] = useState(params.taskId || null);
  const [sent, setSent] = useState(null); // null = not read yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (taskId || !campaignId) return;
    const id = getTaskId(campaignId);
    if (id) setTaskId(id);
  }, [campaignId, taskId]);

  const load = useCallback(async () => {
    if (!taskId) { setSent([]); return; }
    const res = await listScreenshots(taskId);
    setSent(res.ok ? res.uploads.filter((u) => u.kind === 'REVIEW') : []);
  }, [taskId]);

  // On every arrival, not only the first: coming back from writing the review has
  // to pick up anything that changed while we were away.
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    const unfocus = navigation.addListener('focus', () => {
      void load();
      if (taskId) getTaskFromServer(taskId).catch(() => {});
    });
    void load();
    return unfocus;
  }, [navigation, load, taskId]);

  const pickAndSend = useCallback(async () => {
    if (busy || !taskId) return;
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Fayr needs permission to open your photos so you can pick the screenshot. '
        + 'Only the image you choose is sent.',
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
    const res = await uploadScreenshot(taskId, 'REVIEW', picked.assets[0]);
    if (!res.ok) setError(res.error);
    else {
      await load();
      if (taskId) getTaskFromServer(taskId).catch(() => {});
    }
    setBusy(false);
  }, [busy, taskId, load]);

  const newest = Array.isArray(sent) && sent.length > 0 ? sent[0] : null;

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Review proof" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={[hTitle, styles.title]}>Posted? Show us</Text>
        <Text style={hSub}>
          Take a screenshot of your review on the {shop} product page and choose it
          here.
        </Text>

        {newest ? (
          <View style={styles.status}>
            <View style={styles.statusHead}>
              {newest.status === 'pending_review' ? (
                <ActivityIndicator color={COLOR.greenDeep} />
              ) : (
                <Text style={styles.statusMark}>
                  {newest.status === 'approved' ? '✓' : '•'}
                </Text>
              )}
              <Text style={styles.statusTitle}>What we found</Text>
            </View>
            <Text style={styles.statusLine}>{lineFor(newest)}</Text>
            {newest.reviewReason ? (
              <Text style={styles.statusNote}>{newest.reviewReason}</Text>
            ) : null}
            <Text style={styles.statusFoot}>
              A screenshot is never the only thing we go on, and it is never accepted
              without a person at Fayr looking at it.
            </Text>
          </View>
        ) : null}

        <View style={styles.linkCard}>
          <Text style={styles.linkTitle}>Sending a link instead</Text>
          <Text style={styles.linkBody}>
            Not ready yet. Fayr has nowhere to put the address of your review, so we
            are not going to ask for one and drop it. A screenshot is what we take
            today.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.foot}>
        <Pill onPress={pickAndSend} disabled={busy || !taskId} color={COLOR.ink}>
          {busy ? 'Sending…' : 'CHOOSE A PICTURE'}
        </Pill>
        <Ghost onPress={() => navigation.navigate('Support')}>
          Something went wrong — get help
        </Ghost>
      </View>
    </Screen>
  );
}

/**
 * What to say about the newest picture.
 *
 * The words come from ui/journey.js, the one place that decides what a status
 * means, so this screen and the screenshot screen cannot end up disagreeing. The
 * user-facing status is coarse on purpose — the backend never tells the person
 * being checked which field it thought was wrong.
 */
function lineFor(upload) {
  switch (upload && upload.status) {
    case 'approved': return checkLine('APPROVED');
    case 'rejected': return checkLine('REJECTED');
    case 'needs_more': return checkLine('NEEDS_MORE');
    default: return checkLine('EXTRACTED');
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingHorizontal: SPACE.xl, paddingTop: 4, paddingBottom: SPACE.xl },

  title: { fontSize: 23, lineHeight: 28 },

  status: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: SPACE.lg,
    marginTop: SPACE.lg, ...SHADOW.card,
  },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  statusMark: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.greenDeep },
  statusTitle: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink },
  statusLine: {
    fontFamily: FONT.body, fontSize: 14, lineHeight: 22, color: COLOR.ink,
    marginTop: SPACE.sm,
  },
  statusNote: {
    fontFamily: FONT.bodyMed, fontSize: 13.5, lineHeight: 21, color: COLOR.sub,
    marginTop: SPACE.sm, backgroundColor: COLOR.creamDeep,
    borderRadius: RADIUS.md, padding: SPACE.md,
  },
  statusFoot: {
    fontFamily: FONT.body, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
    marginTop: SPACE.md,
  },

  linkCard: {
    marginTop: 14, backgroundColor: COLOR.blueBg, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  linkTitle: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#2F6FD0' },
  linkBody: {
    fontFamily: FONT.bodySemi, fontSize: 11.5, lineHeight: 18, color: '#2F6FD0',
    marginTop: 3,
  },

  error: {
    fontFamily: FONT.bodyMed, fontSize: 13.5, color: COLOR.red, marginTop: SPACE.lg,
  },

  foot: { paddingHorizontal: SPACE.xl, paddingTop: 10, paddingBottom: SPACE.xl, gap: 8 },
});
