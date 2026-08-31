// The setup sequence, built from fayr-design.browser.jsx:
//   SetupIntro :813 · Setup :835 · NameLast :967 · BuildFeed :996 · HowFayr :1015
//
// Copy and layout are the design's, verbatim. Two things are NOT in the design and
// are here deliberately:
//
//  1. PROGRESSIVE SAVING. Each screen PATCHes /me as it is answered, so a user who
//     drops out resumes where they left off rather than starting again. The step is
//     derived from the server's saved answers (src/ui/setup.js), never from local
//     state that a reinstall or a second device would lose.
//
//  2. A "Do this later" escape on every screen. The design has no such control, but
//     a screen whose only exit is the back button is a dead end — the exact class of
//     bug that forced a force-quit in Connect Marketplaces. Leaving is safe because
//     everything answered so far is already saved, and setupDone is not latched, so
//     setup resumes on the next launch.
import React from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GridFloor, Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { MIN_CATEGORIES, STEPS, patchFor, resumeCopy, setupStep } from '../ui/setup';
import { POLICY_VERSION } from '../ui/policy';
import { patchProfile } from '../backend/meApi';
import { PLATFORMS } from '../platforms';

/** The design's CAT_CARDS (:828), verbatim. */
const CAT_CARDS = [
  { label: 'Fashion & Apparel', emoji: '👗' },
  { label: 'Beauty & Personal Care', emoji: '🧴' },
  { label: 'Electronics & Mobile', emoji: '📱' },
  { label: 'Footwear', emoji: '👟' },
  { label: 'Home & Kitchen', emoji: '🍳' },
  { label: 'Grocery & Daily Needs', emoji: '🧺' },
  { label: 'Sports & Fitness', emoji: '🏋️' },
  { label: 'Toys, Babies & Kids', emoji: '🧸' },
];

/** The design's PLAT_ROWS (:834). Myntra is absent there and stays absent. */
const PLAT_ROWS = ['amazon', 'flipkart', 'meesho', 'blinkit', 'zepto', 'instamart'];

const AGES = ['18 - 24', '25 - 34', '35 - 44', '45 and above'];
const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'];

/** The escape hatch. Not in the design — see the note at the top of this file. */
function LaterLink({ onLater }) {
  if (!onLater) return null;
  return (
    <View style={styles.laterRow}>
      <TextBtn onPress={onLater}>Do this later</TextBtn>
    </View>
  );
}

function RadioRow({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.radioRow, on && styles.radioRowOn]}>
      <Text style={styles.radioLabel}>{label}</Text>
      <View style={[styles.radioDot, on && styles.radioDotOn]}>
        {on ? <View style={styles.radioDotInner} /> : null}
      </View>
    </Pressable>
  );
}

function CheckCircle({ on }) {
  return (
    <View style={[styles.check, on && styles.checkOn]}>
      {on ? <Text style={styles.checkTick}>✓</Text> : null}
    </View>
  );
}

// ── 1. SetupIntro (design :813) ─────────────────────────────────────────────
function SetupIntro({ profile, onNext, onLater }) {
  const copy = resumeCopy(profile);
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.introBody}>
        <GridFloor style={styles.introFloor} />
        <Text style={styles.wave}>👋</Text>
        <Text style={[hTitle, { marginTop: 18, textAlign: 'center' }]}>{copy.title}</Text>
        <Text style={[hSub, styles.introSub]}>{copy.body}</Text>
      </View>
      <View style={styles.introFoot}>
        <Pill onPress={onNext}>{copy.cta}</Pill>
        <LaterLink onLater={onLater} />
      </View>
    </SafeAreaView>
  );
}

// ── 2. Setup — age+gender · categories · platforms (design :835) ────────────
function Setup({ profile, startStep, onSaved, onDone, onLater }) {
  const [step, setStep] = React.useState(startStep || 0);
  const [age, setAge] = React.useState(profile.ageBand || '');
  const [gender, setGender] = React.useState(profile.gender || '');
  const [cats, setCats] = React.useState(profile.categories || []);
  const [plats, setPlats] = React.useState(profile.platforms || []);
  const [othersOn, setOthersOn] = React.useState((profile.platforms || []).includes('others'));
  const [hint, setHint] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const canNext = step === 0 ? !!(age && gender) : step === 1 ? cats.length >= MIN_CATEGORIES : true;

  const next = async () => {
    setHint('');
    if (step === 1 && cats.length < MIN_CATEGORIES) {
      // The design's own wording (:891).
      setHint(`Pick at least ${MIN_CATEGORIES} categories to continue.`);
      return;
    }
    if (!canNext) return;
    setBusy(true);
    const chosen = othersOn ? [...new Set([...plats, 'others'])] : plats.filter((p) => p !== 'others');
    const patch = patchFor.question(step, { age, gender, cats, plats: chosen });
    const res = await patchProfile(patch);
    setBusy(false);
    // A failed save must not advance: the next screen would be built on an answer
    // the server never received, and the resume would then be wrong.
    if (!res.ok) {
      setHint('Could not save that just now. Check your connection and try again.');
      return;
    }
    onSaved(res.profile);
    if (step < 2) setStep(step + 1);
    else onDone();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.progressWrap}>
        <View style={styles.segRow}>
          {[0, 1, 2].map((k) => (
            <View key={k} style={[styles.seg, k <= step && styles.segOn]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>STEP {step + 1}/3</Text>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.qBody}>
        {step === 0 ? (
          <View>
            <Text style={[hTitle, styles.qTitle]}>How Young{'\n'}Are you?</Text>
            <View style={{ marginTop: 24 }}>
              {AGES.map((a) => (
                <RadioRow key={a} label={a} on={age === a} onPress={() => setAge(a)} />
              ))}
            </View>
            <Text style={styles.genderLabel}>Gender</Text>
            <View style={styles.chipWrap}>
              {GENDERS.map((g) => (
                <Pressable
                  key={g}
                  onPress={() => setGender(g)}
                  style={[styles.chip, gender === g && styles.chipOn]}
                >
                  <Text style={[styles.chipText, gender === g && styles.chipTextOn]}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View>
            <Text style={[hTitle, styles.qTitle]}>What do you love shopping?</Text>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            <View style={styles.catGrid}>
              {CAT_CARDS.map((cat) => {
                const on = cats.includes(cat.label);
                return (
                  <Pressable
                    key={cat.label}
                    onPress={() => {
                      setCats((x) => (x.includes(cat.label)
                        ? x.filter((y) => y !== cat.label)
                        : [...x, cat.label]));
                      setHint('');
                    }}
                    style={[styles.catCard, on && styles.catCardOn]}
                  >
                    <View style={styles.catTop}>
                      <Text style={styles.catLabel}>{cat.label}</Text>
                      <CheckCircle on={on} />
                    </View>
                    <View style={styles.catArt}>
                      <Text style={styles.catEmoji}>{cat.emoji}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 2 ? (
          <View>
            <Text style={[hTitle, styles.qTitle]}>Where do you shop the most?</Text>
            <View style={{ marginTop: 22 }}>
              {PLAT_ROWS.map((mid) => {
                const on = plats.includes(mid);
                const meta = PLATFORMS[mid] || { name: mid, color: COLOR.ink };
                return (
                  <Pressable
                    key={mid}
                    onPress={() => setPlats((x) => (x.includes(mid)
                      ? x.filter((y) => y !== mid)
                      : [...x, mid]))}
                    style={[styles.platRow, on && styles.platRowOn]}
                  >
                    <View style={[styles.platMark, { backgroundColor: meta.color }]}>
                      <Text style={styles.platMarkText}>
                        {String(meta.name || mid).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.platName}>{meta.name}</Text>
                    <CheckCircle on={on} />
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setOthersOn(!othersOn)}
                style={[styles.platRow, styles.othersRow, othersOn && styles.platRowOn]}
              >
                <Text style={styles.platName}>Others</Text>
                <CheckCircle on={othersOn} />
              </Pressable>
            </View>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.qFoot}>
        {step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={styles.backCircle}>
            <Text style={styles.backCircleText}>←</Text>
          </Pressable>
        ) : null}
        <View style={styles.flex}>
          <Pill onPress={next} disabled={busy} color={canNext ? COLOR.ink : '#cfcfcf'}>
            {busy ? 'Saving…' : 'Next'}
          </Pill>
        </View>
      </View>
      <LaterLink onLater={onLater} />
    </SafeAreaView>
  );
}

// ── 3. NameLast (design :967) ───────────────────────────────────────────────
function NameLast({ profile, onSaved, onNext, onLater }) {
  const [nm, setNm] = React.useState(profile.name || '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const ok = nm.trim().length >= 2;

  const start = async () => {
    if (!ok) return;
    setBusy(true);
    const res = await patchProfile(patchFor.name(nm));
    setBusy(false);
    if (!res.ok) {
      setErr('Could not save your name just now. Check your connection and try again.');
      return;
    }
    onSaved(res.profile);
    onNext();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.nameBody}>
        <GridFloor style={styles.nameFloor} opacity={0.5} />
        <View style={styles.flex} />
        <View>
          <Text style={styles.lastly}>Lastly</Text>
          <Text style={[hTitle, styles.nameTitle]}>
            What shall we <Text style={styles.nameAccent}>Call You?</Text>
          </Text>
          <TextInput
            autoFocus
            placeholder="Your name"
            placeholderTextColor="#9a9b8c"
            value={nm}
            onChangeText={setNm}
            onSubmitEditing={start}
            returnKeyType="done"
            autoCapitalize="words"
            style={[styles.nameInput, ok && styles.nameInputOk]}
          />
          {err ? <Text style={styles.hint}>{err}</Text> : null}
        </View>
        <View style={{ flex: 1.4 }} />
      </View>
      <View style={styles.nameFoot}>
        <Pill onPress={start} disabled={!ok || busy} color={ok ? COLOR.ink : '#cfcfcf'}>
          {busy ? 'Saving…' : 'Start'}
        </Pill>
        <LaterLink onLater={onLater} />
      </View>
    </SafeAreaView>
  );
}

// ── 4. BuildFeed (design :996) ──────────────────────────────────────────────
function BuildFeed({ profile, onNext }) {
  const picks = (profile.categories || []).slice(0, 2);
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true,
      }),
    );
    loop.start();
    // The design auto-advances after 2400ms — "≤5s hard timeout per Flow 3".
    const t = setTimeout(onNext, 2400);
    return () => { clearTimeout(t); loop.stop(); };
  }, [onNext, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.buildBody}>
        <View style={styles.ring}>
          <View style={styles.ringTrack} />
          <Animated.View style={[styles.ringSpin, { transform: [{ rotate }] }]} />
          <Text style={styles.ringEmoji}>✨</Text>
        </View>
        <Text style={styles.buildLine}>
          Finding {picks.length ? picks.join(' & ') : 'the best'} campaigns for you…
        </Text>
        <Text style={styles.buildSub}>Auto-advances — no tap needed.</Text>
      </View>
    </SafeAreaView>
  );
}

// ── 5. HowFayr (design :1015) — and where consent is RECORDED ───────────────
const HOW_ITEMS = [
  {
    n: '1',
    t: 'Claims & slots',
    s: 'Every product has limited slots. Claiming reserves one for you for a short window — buy within it to keep your spot.',
  },
  {
    n: '2',
    t: 'Honest reviews only',
    s: 'Write what you really think. 1★ or 5★ — your refund is exactly the same.',
  },
  {
    n: '3',
    t: 'Know the risk',
    s: "Marketplaces may act on rewarded reviews. In rare cases your marketplace account could be affected. Join only if you're okay with this.",
  },
];

function HowFayr({ onFinish, onLater }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  const accept = async () => {
    setBusy(true);
    // This one call records WHAT was agreed to and WHICH version, and latches setup
    // as finished. They belong together: a user must never be counted as onboarded
    // with no consent on record.
    const res = await patchProfile(patchFor.consent(POLICY_VERSION));
    setBusy(false);
    if (!res.ok) {
      setErr('Could not save that just now. Check your connection and try again.');
      return;
    }
    onFinish(res.profile);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.howBody}>
        <Text style={hTitle}>Before your first campaign</Text>
        <View style={{ marginTop: 20 }}>
          {HOW_ITEMS.map((x) => (
            <View key={x.n} style={styles.howCard}>
              <View style={[styles.howNum, x.n === '3' && styles.howNumWarn]}>
                <Text style={[styles.howNumText, x.n === '3' && styles.howNumTextWarn]}>{x.n}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.howTitle}>{x.t}</Text>
                <Text style={styles.howSub}>{x.s}</Text>
              </View>
            </View>
          ))}
        </View>
        {err ? <Text style={styles.hint}>{err}</Text> : null}
        <View style={{ height: 16 }} />
        <Pill onPress={accept} disabled={busy}>
          {busy ? 'Saving…' : 'I UNDERSTAND — CONTINUE'}
        </Pill>
        <LaterLink onLater={onLater} />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The sequence. `profile` comes from GET /me, so the entry point is decided by what
 * the server already has — that is what makes a resume land on the right screen.
 */
export default function SetupFlow({ profile: initial, onFinished, onLater, startAt }) {
  const [profile, setProfile] = React.useState(initial || {});
  // `startAt` exists for the walk through, and for nothing else in the app.
  // setupStep never returns BUILD — building the feed is only ever arrived at by
  // finishing the name step — so that screen could not be looked at on a real
  // handset at all. Unset, this behaves exactly as it always has: the server's
  // saved answers decide, which is what makes a resume land in the right place.
  const [screen, setScreen] = React.useState(() => startAt || setupStep(initial));

  const merge = (next) => {
    if (next && typeof next === 'object') setProfile((p) => ({ ...p, ...next }));
  };

  if (screen === STEPS.INTRO) {
    return (
      <SetupIntro
        profile={profile}
        onNext={() => setScreen(STEPS.SETUP)}
        onLater={onLater}
      />
    );
  }
  if (screen === STEPS.SETUP) {
    return (
      <Setup
        profile={profile}
        startStep={setupStep.question(profile)}
        onSaved={merge}
        onDone={() => setScreen(STEPS.NAME)}
        onLater={onLater}
      />
    );
  }
  if (screen === STEPS.NAME) {
    return (
      <NameLast
        profile={profile}
        onSaved={merge}
        onNext={() => setScreen(STEPS.BUILD)}
        onLater={onLater}
      />
    );
  }
  if (screen === STEPS.BUILD) {
    return <BuildFeed profile={profile} onNext={() => setScreen(STEPS.HOW)} />;
  }
  return (
    <HowFayr
      onFinish={(saved) => { merge(saved); onFinished(saved); }}
      onLater={onLater}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.homeBg },
  flex: { flex: 1 },

  // intro
  introBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  introFloor: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 160 },
  wave: { fontSize: 58 },
  introSub: { maxWidth: 280, textAlign: 'center' },
  introFoot: { paddingHorizontal: 28, paddingBottom: 28 },

  // question chrome
  progressWrap: { paddingHorizontal: 24, paddingTop: 10 },
  segRow: { flexDirection: 'row', gap: 10 },
  seg: { flex: 1, height: 6, borderRadius: 6, backgroundColor: '#E3E4D3' },
  segOn: { backgroundColor: COLOR.ink },
  stepLabel: {
    fontFamily: FONT.bodySemi, fontSize: 11, letterSpacing: 2, color: '#8a8b7c', marginTop: 12,
  },
  qBody: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8 },
  qTitle: { fontSize: 30, lineHeight: 34 },
  qFoot: {
    flexDirection: 'row', gap: 14, alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 12,
  },
  backCircle: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backCircleText: { fontSize: 22, color: COLOR.ink },
  hint: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.red, marginTop: 10 },

  // age + gender
  radioRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,.04)',
    borderRadius: 16, paddingVertical: 17, paddingHorizontal: 18, marginBottom: 12,
    ...SHADOW.chip,
  },
  radioRowOn: { backgroundColor: '#F4FBEF', borderColor: COLOR.green },
  radioLabel: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
  radioDot: {
    width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: '#D9DACB',
    alignItems: 'center', justifyContent: 'center',
  },
  radioDotOn: { borderColor: COLOR.green },
  radioDotInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLOR.green },
  genderLabel: {
    fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink, marginTop: 10, marginBottom: 8,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,.06)', borderRadius: 999,
    paddingVertical: 9, paddingHorizontal: 16, backgroundColor: '#fff', ...SHADOW.chip,
  },
  chipOn: { backgroundColor: COLOR.ink, borderColor: COLOR.ink },
  chipText: { fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.sub },
  chipTextOn: { color: '#fff' },

  // categories
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 22 },
  catCard: {
    width: '47%', backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,.04)',
    borderRadius: 18, paddingHorizontal: 13, paddingTop: 13, paddingBottom: 8,
    minHeight: 140, ...SHADOW.chip,
  },
  catCardOn: { backgroundColor: '#F4FBEF', borderColor: COLOR.green },
  catTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  catLabel: {
    flex: 1, fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink, lineHeight: 18,
  },
  catArt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 6 },
  catEmoji: { fontSize: 46 },
  check: {
    width: 22, height: 22, borderRadius: 7, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#D9DACB', alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLOR.green, borderColor: COLOR.green },
  checkTick: { color: '#fff', fontSize: 13, fontFamily: FONT.bodyBold },

  // platforms
  platRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,.04)', borderRadius: 18,
    paddingVertical: 12, paddingHorizontal: 15, marginBottom: 11, ...SHADOW.chip,
  },
  platRowOn: { backgroundColor: '#F4FBEF', borderColor: COLOR.green },
  othersRow: { paddingVertical: 17 },
  platMark: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  platMarkText: { color: '#fff', fontFamily: FONT.displaySemi, fontSize: 18 },
  platName: { flex: 1, fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },

  // name
  nameBody: { flex: 1, paddingHorizontal: 26, paddingTop: 26 },
  nameFloor: { position: 'absolute', top: 0, left: 0, right: 0, height: 190 },
  lastly: { fontFamily: FONT.displaySemi, fontSize: 17, color: COLOR.ink },
  nameTitle: { fontSize: 29, marginTop: 4 },
  nameAccent: { color: '#E8604C' },
  nameInput: {
    marginTop: 22, backgroundColor: '#fff', borderWidth: 2, borderColor: '#CBBFF7',
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18,
    fontFamily: FONT.displaySemi, fontSize: 17, color: COLOR.ink,
  },
  nameInputOk: { borderColor: '#7B61FF' },
  nameFoot: { paddingHorizontal: 26, paddingBottom: 28 },

  // build feed
  buildBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  ring: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center' },
  ringTrack: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 4, borderColor: '#E7E8D6',
  },
  ringSpin: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55, borderWidth: 4,
    borderTopColor: COLOR.green, borderRightColor: 'transparent',
    borderBottomColor: 'transparent', borderLeftColor: 'transparent',
  },
  ringEmoji: { fontSize: 40 },
  buildLine: {
    fontFamily: FONT.bodyBold, fontSize: 15, color: COLOR.ink2, marginTop: 24, textAlign: 'center',
  },
  buildSub: { fontFamily: FONT.body, fontSize: 12, color: '#a9aa9c', marginTop: 8 },

  // how fayr
  howBody: { paddingHorizontal: 26, paddingTop: 4, paddingBottom: 26 },
  howCard: {
    flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: COLOR.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLOR.line,
    padding: SPACE.md, marginBottom: 12, ...SHADOW.chip,
  },
  howNum: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#EAF7E4',
    alignItems: 'center', justifyContent: 'center',
  },
  howNumWarn: { backgroundColor: '#FCF3E2' },
  howNumText: { fontFamily: FONT.displayXBold, fontSize: 15, color: COLOR.refundInk },
  howNumTextWarn: { color: '#A66A12' },
  howTitle: { fontFamily: FONT.bodyBold, fontSize: 14.5, color: COLOR.ink2 },
  howSub: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.sub, marginTop: 3, lineHeight: 19 },

  laterRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
});
