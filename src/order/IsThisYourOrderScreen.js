// "IS THIS YOUR ORDER?"
//
// THE DESIGN ALREADY HAD THIS SCREEN TOO, and this is drawn from it rather than
// invented. OcrConfirm, at fayr-design.browser.jsx:2898, is "Are these order
// details correct?": a small chip saying where the details came from, a two line
// heading, a sentence, a white card of labelled rows, then one green button and
// one quiet second action. Its shape, its card and its two actions are copied
// here, along with the words this project already wrote for that screen in
// src/screens/ocrconfirm.js.
//
// WHY IT IS A SEPARATE FILE FROM ocrconfirm.js. That screen asks about THE one
// order Fayr holds. This one asks about ONE OF SEVERAL orders that might be it,
// and lets somebody look through the rest. One file doing both would be one
// screen answering two questions, which is the habit this project has spent
// weeks undoing.
//
// FOUR FACTS AND NO MORE, which is what the owner asked for: the order number,
// the day, the amount, and the product. Anything else on this card would be
// something to read rather than something to answer.
//
// EVERY ONE OF THEM IS THE SERVER'S. The phone looked at the shop's own list and
// handed over the text; the server read it and decided. Nothing on this screen is
// worked out here, because a second opinion on the phone is how a screen comes to
// contradict the record it is drawn from.
//
// SAYING NO IS NOT A DEAD END. It goes to the screen that asks for the order
// another way, which always works: a picture, or typing it in.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { listFoundOrders, thisOrderIsMine } from '../backend/orderCandidatesApi';
import { getTaskId, refreshFromBackend } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Pill, TextBtn, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';
import { orderCardRows } from '../ui/orderCard.js';

export default function IsThisYourOrderScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const shopKey = campaign ? campaign.marketplace : null;
  const shop = shopKey && PLATFORMS[shopKey] ? PLATFORMS[shopKey].name : null;

  const [orders, setOrders] = useState([]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  /** Where "no" and "nothing to show" both lead: ask the person instead. */
  const askInstead = useCallback(() => {
    // Back to the journey, which works out for itself that the next thing is to
    // show us the order. No screen is named here.
    navigation.replace('Journey', { campaignId });
  }, [navigation, campaignId]);

  // ONLY THE ORDERS THE SERVER SAID MATCH. An order that is not this offer's
  // product is not a candidate, and offering one would invite somebody to
  // confirm a purchase nobody asked them to make.
  useEffect(() => {
    let alive = true;
    const taskId = campaignId ? getTaskId(campaignId) : null;
    if (!taskId) { askInstead(); return undefined; }
    listFoundOrders(taskId).then((res) => {
      if (!alive) return;
      const mine = res.ok
        ? res.orders.filter((o) => o && o.matches === true && !o.chosenAt)
        : [];
      setOrders(mine);
      setLoaded(true);
      if (mine.length === 0) askInstead();
    });
    return () => { alive = false; };
  }, [campaignId, askInstead]);

  const current = orders.length > 0 ? orders[at % orders.length] : null;

  const yesItIsMine = useCallback(async () => {
    const taskId = campaignId ? getTaskId(campaignId) : null;
    if (!taskId || !current || busy) return;
    setBusy(true);
    setError(null);
    const res = await thisOrderIsMine(taskId, current.id);
    await refreshFromBackend();
    setBusy(false);
    if (!res.ok) {
      // The server's own words. It knows things this screen cannot, such as an
      // order the offer cannot have caused.
      setError(res.error || 'We could not use that order. Please show us instead.');
      return;
    }
    // NO STEP NAMED. The journey reads the record and lands on the step this
    // claim is really on, which is the resume it already does.
    navigation.replace('Journey', { campaignId });
  }, [campaignId, current, busy, navigation]);

  const showAnother = useCallback(() => {
    setError(null);
    setAt((n) => n + 1);
  }, []);

  // Nothing to ask about. The screen that replaces this one is already on its
  // way, so this draws nothing rather than flashing an empty card.
  if (!loaded || !current) return <Screen bg={COLOR.homeBg} />;

  const rows = orderCardRows(current, { productFallback: campaign ? campaign.productName : null });
  const more = orders.length > 1;

  return (
    <Screen bg={COLOR.homeBg}>
      <TopBar title="Your order" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            ✓  Read from your {shop || 'shop'} order
          </Text>
        </View>

        <Text style={[hTitle, styles.title]}>
          Is this{'\n'}your order?
        </Text>
        <Text style={hSub}>
          {more
            ? `We found ${orders.length} orders that could be it. This is the `
              + 'closest one. Tell us if it is yours, or look at the next one.'
            : 'Read it and tell us it is yours. Nothing moves until you do.'}
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
              </View>
            </View>
          ))}
        </View>

        {more ? (
          <Text style={styles.which}>
            Order {(at % orders.length) + 1} of {orders.length}.
          </Text>
        ) : null}

        <Text style={styles.note}>
          These come from your own order and cannot be typed over. If this is not
          the right one, say so and we will ask you to show us the order you
          really placed.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.foot}>
        <Pill onPress={yesItIsMine} disabled={busy} color={COLOR.greenDeep}>
          {busy ? 'Working…' : 'YES, THAT IS MINE →'}
        </Pill>
        {more ? (
          <TextBtn onPress={showAnother}>Show me the next one</TextBtn>
        ) : null}
        <TextBtn onPress={askInstead}>No, that is not it</TextBtn>
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

  which: {
    fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.sub, marginTop: 14,
  },
  note: {
    fontFamily: FONT.body, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
    marginTop: SPACE.lg,
  },
  error: {
    fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.red, marginTop: SPACE.lg,
  },

  foot: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 22 },
});
