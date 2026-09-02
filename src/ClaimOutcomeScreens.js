// What the design shows the moment a claim resolves — the three outcomes of
// CONFIRM & JOIN, each drawn as the design draws it:
//
//   ClaimedSheet       (fayr-design.browser.jsx:2191)  it worked
//   InsufficientSheet  (:2424)                         not enough tickets
//   EnrollFailed       (:2462)                         it did not go through
//
// They live in one file because they are one decision with three answers, and
// because two of them are three lines of copy each.
//
// Two deliberate differences from the design, both because it states a number the
// backend does not:
//
//  * The claimed sheet's timer. The design counts down from 25m 35s and says the
//    product is yours "for the next 2 hours". Neither number exists in the system.
//    The real deadline is the task's own claimExpiresAt, which comes from the
//    operator's claim window — thirty minutes by default since 1 September 2026.
//
//    SO THE CLOCK REALLY TICKS NOW. While the window was seven days a per-second
//    countdown would have been theatre, and this sheet read in days and hours and
//    refreshed when it came back into view. At thirty minutes it is the opposite:
//    the owner asked for a countdown of the slot, so it redraws every second, in
//    the design's own "29m : 45s" shape. Above an hour, which an operator can
//    still set, it goes back to hours and stops ticking — src/ui/confirmJoin.js
//    decides which, and says so with `ticking`.
//
//    AND IT SAYS WHEN IT RUNS OUT. Thirty minutes will run out while somebody is
//    looking at this screen. Sitting at "0m : 00s" would look broken, so the sheet
//    changes what it says and offers the way back.
//  * "Held in active claims" on the insufficient sheet. There is no held bucket in
//    the ledger — claiming DEDUCTS and an expiry RETURNS — so the figure is
//    derived from the user's own open claims, which are exactly the tickets that
//    would come back. A PURCHASED claim has spent them for good and is excluded.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import { getWallet } from './backend/meApi';
import { getAuthoritative, getTasks } from './taskStore';
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './ui/theme';
import { Screen, Pill } from './ui/primitives';
import { SLOT_RESERVED_MS, countdown, deadlineLine, heldTicketCount } from './ui/confirmJoin';
import { goHome } from './ui/nav';
import { useMotion } from './ui/celebration';

/** The design's TextBtn: a quiet centred secondary action. */
function TextBtn({ children, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.textBtn}>
      <Text style={styles.textBtnLabel}>{children}</Text>
    </TouchableOpacity>
  );
}

/**
 * What the claimed sheet says under its heading, in the state it is in.
 *
 * Out here rather than inline so each sentence is one whole string that a person
 * and a test can both read.
 */
function subLine({ over, left, mktName, cost, task }) {
  if (over) {
    return `This slot was held until ${left.when}. Your ${cost} tickets are on their way back, and you can take the offer again.`;
  }
  // THE DEADLINE, in the same one line the connect page and the before you go page
  // use, from src/ui/confirmJoin.js. The confirmation page carried it in a card of
  // its own until the owner took that page off the path.
  const line = deadlineLine(task, new Date());
  if (line) return `${line} Buy it on ${mktName}.`;
  return `Buy it on ${mktName} to start your refund.`;
}

function Row({ a, b, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowA}>{a}</Text>
      <Text style={styles.rowB}>{b}</Text>
    </View>
  );
}

// ── Claimed ─────────────────────────────────────────────────────────────────

export function ClaimedScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const [left, setLeft] = useState(() => countdown(getAuthoritative(campaignId)));

  // Re-read when the screen comes back into view: the record is the truth, and it
  // may have changed while somebody was away.
  useEffect(() => {
    const un = navigation.addListener('focus', () => {
      setLeft(countdown(getAuthoritative(campaignId)));
    });
    return un;
  }, [navigation, campaignId]);

  // AND ONCE A SECOND WHILE IT IS TICKING. Thirty minutes is a clock somebody
  // watches, so it has to move. It reads the RECORD every time rather than
  // counting down a number it is holding, so a clock left running while the phone
  // slept cannot drift away from the real deadline.
  //
  // The timer stops itself the moment the countdown says it is no longer ticking —
  // when the time runs out, and on a long window an operator has set — so nothing
  // is redrawing a picture that is not changing.
  const ticking = left ? left.ticking : false;
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => {
      setLeft(countdown(getAuthoritative(campaignId)));
    }, 1000);
    return () => clearInterval(id);
  }, [ticking, campaignId]);

  const mkt = PLATFORMS[campaign?.marketplace] || {};
  const mktName = mkt.name || 'the marketplace';
  const cost = campaign?.ticketCost ?? 5;
  const task = getAuthoritative(campaignId);
  const motion = useMotion();

  // THE DESIGN'S OWN ANIMATION FOR THIS MOMENT, and it really has one. The sheet
  // uses fayr-rise (opacity 0 to 1, fourteen points up to nothing) and the tick
  // uses fayr-pop (opacity 0 to 1, scale .82 to 1.04 and back to 1), both on
  // cubic-bezier(.22,.61,.36,1) — fayr-design.browser.jsx:276 and :278, applied at
  // :2199 and :2201. Reduced motion shows the same words for the same time with
  // nothing moving, which is what src/ui/celebration.js already asks the phone.
  const rise = useRef(new Animated.Value(motion ? 0 : 1)).current;
  const pop = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
    if (!motion) { rise.setValue(1); pop.setValue(1); return undefined; }
    const easing = Easing.bezier(0.22, 0.61, 0.36, 1);
    const run = Animated.parallel([
      Animated.timing(rise, { toValue: 1, duration: 350, easing, useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 500, easing, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [motion, rise, pop]);
  // OVER IS NOT THE SAME AS UNKNOWN. A task with no readable deadline gives null,
  // and this sheet then simply draws no clock; only a deadline that has really
  // passed puts the screen into its ran-out state.
  const over = left ? left.over === true : false;

  // IT LEAVES BY ITSELF, AND IT CANNOT BE GOT STUCK ON.
  //
  // The owner asked for about three seconds with no button at all. So there is
  // nothing to tap, and the only way off is this timer — which makes "what if
  // something goes wrong" the important question. Three answers to it:
  //
  //  * The timer does not wait for the animation, the record, the network or
  //    anything else. It is set on arrival and it fires.
  //  * It replaces this screen in the history rather than pushing on top of it,
  //    so the back gesture cannot bring somebody back to a screen with no way out.
  //  * It is cleared when the screen goes away, so nothing navigates afterwards.
  //
  // A LAPSED SLOT DOES NOT AUTO-ADVANCE. That is not the success this moment is
  // for, and the owner asked for only the success screen to become automatic, so
  // that state keeps its words and its way back.
  useEffect(() => {
    if (over || !campaignId) return undefined;
    const id = setTimeout(() => {
      // Into the journey, which works out its own step from the claim's record and
      // lands on connecting the shop, the first step. Naming a step here would be
      // a second opinion about where somebody is.
      navigation.replace('Journey', { campaignId });
    }, SLOT_RESERVED_MS);
    return () => clearTimeout(id);
  }, [navigation, campaignId, over]);


  return (
    <Screen bg={COLOR.homeBg}>
      <View style={styles.sheetWrap}>
        <Animated.View
          style={[styles.sheet, {
            opacity: rise,
            transform: [{
              translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
            }],
          }]}
        >
          <View style={styles.grabber} />
          <Animated.Text
            style={[styles.bigTick, {
              opacity: pop,
              transform: [{
                // .82 to 1.04 and back to 1, the design's own overshoot.
                scale: pop.interpolate({
                  inputRange: [0, 0.6, 1], outputRange: [0.82, 1.04, 1],
                }),
              }],
            }]}
          >
            {over ? '⏳' : '✔️'}
          </Animated.Text>
          {/* THE OWNER'S WORDS. The design's own sticky bar calls this state
              "Slot Reserved", and he asked for that here rather than "Product
              Claimed!", because reserving a slot for thirty minutes is what has
              actually happened. */}
          <Text style={styles.claimedTitle}>
            {over ? 'Your time ran out' : 'Slot Reserved!'}
          </Text>
          {/* ONE SENTENCE PER STATE, each written as ONE string. Splitting a
              sentence across a join to fit the line width makes it impossible to
              search for, and a sentence nothing can search for is a sentence
              nothing can check. */}
          <Text style={styles.claimedSub}>{subLine({ over, left, mktName, cost, task })}</Text>
          {!over ? (
            <View style={styles.ticketChip}>
              <Text style={styles.ticketChipText}>
                🎟 {cost} tickets held · returned if the claim expires
              </Text>
            </View>
          ) : null}
          {left && !over ? (
            <View style={styles.timerBox}>
              <Text style={styles.timerValue}>{left.clock}</Text>
              <Text style={styles.timerLabel}>Remaining</Text>
            </View>
          ) : null}
          {/* THE WAY BACK, when the thirty minutes have gone. Leaving the buy
              button live would send somebody to the shop for a purchase the
              order-window rule is going to refuse, and leaving the sheet at
              "0m : 00s" with a live button would be worse still. */}
          {/* NO BUTTON ON THE SUCCESS SIDE. The owner asked for this moment to
              pass by itself, so there is nothing to tap and nothing to decide.
              A lapsed slot keeps its two ways out, because that is not a success
              and it does not move on by itself. */}
          {over ? (
            <>
              <View style={{ marginTop: 18 }}>
                <Pill
                  onPress={() => navigation.replace('Detail', { campaignId })}
                  color={COLOR.ink}
                >
                  See the offer again →
                </Pill>
              </View>
              {/* Through goHome, not navigate('Home'): Home is a TAB, not a
                  screen on this stack, and navigating straight at it is the
                  silent no-op src/ui/nav.js exists to prevent. */}
              <TextBtn onPress={() => goHome(navigation)}>
                Back to offers
              </TextBtn>
            </>
          ) : null}
        </Animated.View>
      </View>
    </Screen>
  );
}

// ── Not enough tickets ──────────────────────────────────────────────────────

export function NotEnoughTicketsScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const cost = campaign?.ticketCost ?? 5;
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    let live = true;
    getWallet().then((w) => { if (live && w.ok) setBalance(w.ticketBalance); });
    return () => { live = false; };
  }, []);

  const held = heldTicketCount(authoritativeTasks());
  const need = balance == null ? null : Math.max(0, cost - balance);

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.centre}>
        <Text style={styles.emoji}>🎟</Text>
        <Text style={styles.title}>
          {need == null
            ? 'You need more tickets'
            : `You need ${need} more ticket${need === 1 ? '' : 's'}`}
        </Text>
        <Text style={styles.sub}>
          {balance == null
            ? `This claim needs ${cost} tickets.`
            : `This claim needs ${cost} tickets. You have ${balance} available.`}
        </Text>
        <View style={styles.card}>
          <Row a="Available" b={balance == null ? '—' : `${balance} tickets`} />
          <Row a="Held in active claims" b={`${held} tickets`} last />
        </View>
        <Text style={styles.note}>
          Held tickets return automatically if a claim expires before you buy.
        </Text>
        <View style={styles.greenBanner}>
          <Text style={styles.greenBannerText}>
            Complete a campaign to earn tickets back →
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Pill onPress={() => navigation.navigate('Tabs', { screen: 'MyProducts' })}>
          GO TO MY PRODUCTS
        </Pill>
        <TextBtn onPress={() => navigation.goBack()}>Not now</TextBtn>
      </View>
    </Screen>
  );
}

// ── It did not go through ───────────────────────────────────────────────────

export function JoinFailedScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const error = route?.params?.error || '';
  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.centre}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>
          Your claim didn't go through.{' '}
          <Text style={styles.subStrong}>No tickets were used.</Text>
        </Text>
        {/* The server's own words, when it gave any. Inventing a friendlier
            sentence would hide the one fact that explains the failure — e.g.
            "Campaign is full", which no retry will fix. */}
        {error ? <Text style={styles.reason}>{error}</Text> : null}
      </View>
      {/* TRY AGAIN GOES BACK TO THE PRODUCT PAGE, because that is where a claim
          is made now. It used to reopen the confirmation page, which the owner took
          out of the path on 2 September 2026 — and reopening it would have shown a
          page with a dead button, since the terms tick box lives on the product
          page and the acceptance travels from there. */}
      <View style={styles.footer}>
        <Pill onPress={() => navigation.replace('Detail', { campaignId })}>
          TRY AGAIN
        </Pill>
        <TextBtn onPress={() => goHome(navigation)}>
          Back to offers
        </TextBtn>
      </View>
    </Screen>
  );
}

/** Every task the server has told us about, as authoritative rows. */
function authoritativeTasks() {
  return Object.keys(getTasks())
    .map((cid) => getAuthoritative(cid))
    .filter(Boolean);
}

const styles = StyleSheet.create({
  // claimed sheet
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    marginHorizontal: 14, marginBottom: 26, backgroundColor: '#FFFDF2',
    borderRadius: 22, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24,
    alignItems: 'center', ...SHADOW.card,
  },
  grabber: { width: 44, height: 4, backgroundColor: '#E5DCA6', borderRadius: 4, marginBottom: 16 },
  bigTick: { fontSize: 52 },
  claimedTitle: { fontFamily: FONT.displayXBold, fontSize: 24, color: COLOR.ink, marginTop: 10 },
  claimedSub: {
    fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: 8,
    textAlign: 'center', maxWidth: 280, lineHeight: 20,
  },
  ticketChip: {
    marginTop: 12, backgroundColor: '#FFF3D6', borderWidth: 1, borderColor: '#EAD79A',
    borderRadius: 100, paddingVertical: 5, paddingHorizontal: 13,
  },
  ticketChipText: { fontFamily: FONT.displaySemi, fontSize: 12, color: '#8a6d10' },
  timerBox: {
    marginTop: 16, backgroundColor: '#FFE9E6', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', minWidth: 200,
  },
  timerValue: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.red },
  timerLabel: { fontFamily: FONT.bodySemi, fontSize: 11, color: '#8f6a63', marginTop: 2 },

  // the two message screens
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emoji: { fontSize: 56 },
  title: {
    fontFamily: FONT.displayXBold, fontSize: 24, color: COLOR.ink, marginTop: 16,
    textAlign: 'center',
  },
  sub: {
    fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, marginTop: 8,
    textAlign: 'center', maxWidth: 280, lineHeight: 21,
  },
  subStrong: { fontFamily: FONT.bodySemi, color: COLOR.ink2 },
  reason: {
    fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, marginTop: 14,
    textAlign: 'center', maxWidth: 290, lineHeight: 18,
  },
  card: {
    alignSelf: 'stretch', marginTop: 14, backgroundColor: COLOR.surface,
    borderRadius: RADIUS.lg, padding: 16, ...SHADOW.card,
  },
  note: {
    fontFamily: FONT.body, fontSize: 11.5, color: COLOR.sub, marginTop: 10,
    alignSelf: 'stretch',
  },
  greenBanner: {
    alignSelf: 'stretch', marginTop: 8, backgroundColor: COLOR.greenBg,
    borderWidth: 1, borderColor: '#1FD75D', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  greenBannerText: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.greenDeep },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowA: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub },
  rowB: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.ink2 },

  footer: { paddingHorizontal: 28, paddingBottom: 28 },
  textBtn: { paddingVertical: 12, alignItems: 'center' },
  textBtnLabel: { fontFamily: FONT.bodySemi, fontSize: 13.5, color: COLOR.sub },
});
