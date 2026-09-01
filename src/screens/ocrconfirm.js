// ocrconfirm — fayr-design.browser.jsx:2898 (OcrConfirm)
//
// "Are these order details correct?" — the human gate on a machine's reading.
// Split out of src/journey/JourneyScreen.js on 1 September 2026, where it shared
// one page with the design's underreview screen. They are two screens now, because
// they do two different things: that one is the wait, this one is the details.
//
// UNTIL TODAY THIS SCREEN WAS UNREACHABLE, and that mattered more than it looks.
// The task engine has a gate called CONFIRM_ORDER whose whole meaning is "this is
// my order" (src/taskflow.js:998). The design drew the screen for it. The app had
// no such screen, so the tap that fired the event sat on the DELIVERY screen under
// the words "Yes, it is delivered" — one button standing for two different facts.
// Splitting the journey made that impossible to keep: two screens cannot both own
// one event. This screen owns it now, and the delivery screen no longer fires it.
//
// THE DESIGN'S OWN CONTENT: the source chip, the two-line heading, the sentence
// about where the details came from, the white card of rows, and the two actions.
//
// THREE DEPARTURES, EACH FOR A STATED REASON:
//
//  * THE ROWS ARE NOT EDITABLE, and the design's "✎ Edit details" is not copied.
//    Letting the person being checked retype the fields their proof is checked
//    against would defeat the check, and the backend deliberately exposes no edit
//    route, so the button would do nothing. The screen says this in one line
//    rather than leaving somebody wondering why the values are fixed.
//  * A FIFTH ROW, Marketplace, on the owner's instruction. The design has four.
//  * The design writes an order number and an order date into the file. Neither is
//    copied. Every row is filled from the real record through ui/orderDetails.js,
//    and a row we do not hold says so.
//
// WHAT IT SHOWS IS THE PERSON'S OWN DATA, both sides of it. Nothing here reveals
// how Fayr judges evidence: not a tolerance, not a score, not a verdict. Those are
// for staff, and showing them would hand a forger a way to test their own work.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getTask as getTaskFromServer } from '../backend/tasksApi';
import {
  clearActionError, dispatch, getActionError, getTask, getTaskId, isPending, subscribe,
} from '../taskStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Pill, TextBtn, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { howManyKnown, orderDetailRows, readFrom } from '../ui/orderDetails';
import { goBackOrHome } from '../ui/nav';

export default function OcrConfirmScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : null;

  const [, setTick] = useState(0);
  const [tapped, setTapped] = useState(false);

  // Follow the server's record: it is what decides whether this screen is still
  // the right one to be on.
  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  // Re-read on every arrival, not only the first. Coming back from the shop has to
  // pick up an order that was read while we were away.
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    const reread = () => {
      const id = campaignId ? getTaskId(campaignId) : null;
      if (id) getTaskFromServer(id).catch(() => {});
    };
    const unfocus = navigation.addListener('focus', reread);
    reread();
    return unfocus;
  }, [navigation, campaignId]);

  const task = campaignId ? getTask(campaignId) : null;
  const order = task ? task.order : null;
  const rows = orderDetailRows({
    order,
    productName: campaign ? campaign.productName || campaign.title : null,
    shopName: shop,
  });
  const known = howManyKnown(rows);
  const from = readFrom(order ? order.source : null);

  const busy = tapped || (campaignId ? isPending(campaignId) : false);
  const error = campaignId ? getActionError(campaignId) : null;

  const yesTheseAreMine = useCallback(() => {
    if (!campaignId || busy) return;
    clearActionError(campaignId);
    setTapped(true);
    const res = dispatch(campaignId, {
      type: 'CONFIRM_ORDER', key: 'confirm', at: Date.now(),
    });
    setTapped(false);
    if (res.rejected) Alert.alert('Not yet', res.reason);
  }, [campaignId, busy]);

  const notMine = useCallback(() => {
    Alert.alert(
      'That is not your order?',
      'Do not confirm it. Send us a screenshot of the order you really placed and '
      + 'a person at Fayr will look at both.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Send a screenshot',
          onPress: () => navigation.navigate('ProofUpload', {
            campaignId, kind: 'PURCHASE',
          }),
        },
      ],
    );
  }, [navigation, campaignId]);

  return (
    <Screen bg={COLOR.homeBg}>
      <TopBar title="Confirm order" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{from.icon}  {from.label}</Text>
        </View>

        <Text style={[hTitle, styles.title]}>
          Are these order{'\n'}details correct?
        </Text>
        <Text style={hSub}>
          {known === 0
            ? 'We have not been able to read your order yet, so there is nothing to '
              + 'confirm on this screen.'
            : 'Read them and tell us they are yours. Nothing moves until you do.'}
        </Text>

        <View style={styles.card}>
          {rows.map((r, i) => (
            <View
              key={r.label}
              style={[styles.row, i === rows.length - 1 && styles.rowLast]}
            >
              <Text style={styles.rowLabel}>{r.label}</Text>
              <View style={styles.rowRight}>
                <Text style={[styles.rowValue, !r.known && styles.rowUnknown]}>
                  {r.value}
                </Text>
                {r.note ? <Text style={styles.rowNote}>{r.note}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.whyFixed}>
          These come from your own order and cannot be typed over. If a value is
          wrong, do not confirm it: send a screenshot instead and a person at Fayr
          will sort it out. A screenshot is never the only thing we go on, and it is
          never accepted without a person at Fayr looking at it.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.foot}>
        <Pill
          onPress={yesTheseAreMine}
          disabled={busy || known === 0}
          color={COLOR.greenDeep}
        >
          {busy ? 'Working…' : 'YES, THESE ARE CORRECT →'}
        </Pill>
        <TextBtn onPress={notMine}>No — this is not my order</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: SPACE.xl },

  chip: {
    alignSelf: 'flex-start', backgroundColor: COLOR.greenBg,
    borderRadius: RADIUS.round, paddingHorizontal: 13, paddingVertical: 6,
    marginBottom: 12,
  },
  chipText: { fontFamily: FONT.displaySemi, fontSize: 12, color: COLOR.greenDeep },

  title: { fontSize: 26, lineHeight: 31 },

  card: {
    marginTop: 18, backgroundColor: '#fff', borderRadius: RADIUS.xl,
    paddingHorizontal: 16, ...SHADOW.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.sub },
  rowRight: { flex: 1, alignItems: 'flex-end' },
  rowValue: {
    fontFamily: FONT.displaySemi, fontSize: 13.5, lineHeight: 18, color: COLOR.ink,
    textAlign: 'right',
  },
  rowUnknown: { fontFamily: FONT.bodyMed, color: COLOR.sub },
  rowNote: {
    fontFamily: FONT.body, fontSize: 11, lineHeight: 16, color: COLOR.sub,
    textAlign: 'right', marginTop: 4,
  },

  whyFixed: {
    fontFamily: FONT.body, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
    marginTop: SPACE.lg,
  },
  error: {
    fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.red, marginTop: SPACE.lg,
  },

  foot: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 22 },
});
