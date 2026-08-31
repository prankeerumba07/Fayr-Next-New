// "Check offer pages" — the morning job, run by a person on a real phone.
//
// WHY THIS IS ON A PHONE AND NOT ON A SERVER. It answers one question: does this
// offer's page open the way a real shopper would see it? Only a device with the
// shopper's own signed-in session can answer that, so a person starts it each
// morning. There is no scheduled version and there should not be one.
//
// HOW IT OPENS A PAGE. Through the same WebView the existing scraper uses, on the
// same origin the person is already signed in to, with the same injected-script
// and postMessage contract out of platforms.js. Nothing here touches a shop's
// protections: the request is the one the shopper's own browser makes. One attempt
// per page, no retry — see livecheck.js.
//
// WHY IT ASKS FOR A STAFF SIGN-IN. Marking offers as no longer working hides them
// from every user's feed. An ordinary app login must never be able to do that, so
// the server requires a staff token and this screen asks for one. It is held in
// memory only and written down nowhere.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';

import { goBackOrHome } from './ui/nav';
import { COLOR, FONT, RADIUS, SPACE } from './ui/theme';
import { PLATFORMS } from './platforms';
import {
  buildPageScript, readPageOutcome, splitByWhetherThereIsAPage, summariseRun,
} from './livecheck.js';
import { offersToCheck, staffSignIn, submitResults } from './backend/liveCheckApi';

export const SCREEN_TITLE = 'Check offer pages';

export default function LiveCheckScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);

  // The one page being opened right now, and the promise waiting for its answer.
  const [job, setJob] = useState(null);
  const waiting = useRef(null);

  const signIn = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await staffSignIn(email, password);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    // Kept in memory only. Nothing writes it to the device.
    setToken(res.token);
    setPassword('');
  }, [email, password]);

  /** Open one page in the WebView and wait for the answer, once. */
  const openOnePage = useCallback((platformKey, url) => {
    return new Promise((resolve) => {
      waiting.current = resolve;
      setJob({ platformKey, url });
    });
  }, []);

  const onMessage = useCallback((event) => {
    const resolve = waiting.current;
    waiting.current = null;
    let payload = null;
    try { payload = JSON.parse(event.nativeEvent.data); } catch (e) { payload = null; }
    setJob(null);
    if (resolve) resolve(payload || { ok: false, status: 0, html: '' });
  }, []);

  const run = useCallback(async () => {
    setBusy(true); setError(null); setReport(null);
    setStatus('Asking Fayr which offers are live…');

    const list = await offersToCheck(token);
    if (!list.ok) { setBusy(false); setStatus(null); setError(list.error); return; }

    const { toOpen, noPage } = splitByWhetherThereIsAPage(list.offers);
    const results = noPage.slice();

    for (let i = 0; i < toOpen.length; i += 1) {
      const offer = toOpen[i];
      setStatus(`Opening ${i + 1} of ${toOpen.length}: ${offer.title}`);
      const key = String(offer.platform || '').toLowerCase();
      const answer = await openOnePage(key, offer.productUrl);
      const outcome = readPageOutcome(answer.html, answer.status);
      results.push({
        campaignId: offer.campaignId,
        state: outcome.state,
        httpStatus: Number.isFinite(answer.status) ? answer.status : 0,
        evidence: outcome.evidence || undefined,
      });
    }

    setStatus('Sending what we found to Fayr…');
    const sent = await submitResults(token, results);
    setBusy(false); setStatus(null);
    if (!sent.ok) { setError(sent.error); return; }
    setReport({ ...summariseRun(results), server: sent.report });
  }, [token, openOnePage]);

  const platform = job ? PLATFORMS[job.platformKey] : null;

  const summary = useMemo(() => {
    if (!report) return null;
    const c = report.counts;
    return [
      [String(report.checked), 'offers looked at'],
      [String(c.opened), 'pages opened normally'],
      [String(c.expired + c['sold-out'] + c.unavailable), 'a shopper cannot buy'],
      [String(c['no-link']), 'have no shop page saved'],
      [String(c['could-not-open']), 'we could not open'],
    ];
  }, [report]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.cream]}
        style={[styles.header, { paddingTop: insets.top + SPACE.md }]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBackOrHome(navigation)}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{SCREEN_TITLE}</Text>
        <Text style={styles.sub}>For Fayr staff. Run this once each morning.</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.body}>
        {!token ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in as Fayr staff</Text>
            <Text style={styles.note}>
              This is not your app sign-in. It is the same email and password you use
              for the Fayr staff panel. It is kept only while this screen is open.
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Your Fayr staff email"
              placeholderTextColor={COLOR.sub}
              autoCapitalize="none"
              keyboardType="email-address"
              accessibilityLabel="Staff email"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={COLOR.sub}
              secureTextEntry
              accessibilityLabel="Staff password"
            />
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, busy && styles.buttonOff]}
              disabled={busy}
              onPress={signIn}
            >
              <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ready</Text>
            <Text style={styles.note}>
              Make sure you are signed in to the shops first, on the Connect screen.
              A page that will not open without a sign-in comes back as one we could
              not look at, which is honest but not useful.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, busy && styles.buttonOff]}
              disabled={busy}
              onPress={run}
            >
              <Text style={styles.buttonText}>
                {busy ? 'Working…' : 'Open every offer page now'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {status ? (
          <View style={styles.card}>
            <ActivityIndicator color={COLOR.greenDeep} />
            <Text style={styles.note}>{status}</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {summary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What we found</Text>
            {summary.map(([value, label]) => (
              <View key={label} style={styles.statRow}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
            <Text style={styles.note}>
              Offers a shopper cannot buy are now greyed out in the app, with a line
              saying they may come back. The full list is on the staff panel.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* The one WebView, reused for every page. Kept at zero height: nothing here
          is for looking at, and the person is watching the progress line above. */}
      {job && platform ? (
        <WebView
          key={job.platformKey + ':' + job.url}
          source={{ uri: platform.startUrl }}
          userAgent={platform.userAgent}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={buildPageScript(job.url)}
          onMessage={onMessage}
          onError={() => onMessage({ nativeEvent: { data: '{"ok":false,"status":0,"html":""}' } })}
          style={styles.hidden}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.homeBg },
  header: {
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg,
    borderBottomWidth: 1, borderBottomColor: COLOR.line,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, color: COLOR.ink },
  title: { fontFamily: FONT.display, fontSize: 28, color: COLOR.ink, marginTop: SPACE.xs },
  sub: { fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: 4 },

  body: { padding: SPACE.lg, paddingBottom: SPACE.xl },
  card: {
    backgroundColor: COLOR.surface, borderRadius: RADIUS.card, borderWidth: 1,
    borderColor: COLOR.line, padding: SPACE.md, marginBottom: SPACE.md,
  },
  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 16, color: COLOR.ink, marginBottom: 6 },
  note: { fontFamily: FONT.body, fontSize: 13, lineHeight: 20, color: COLOR.sub, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md, paddingVertical: 12, marginTop: SPACE.sm,
    fontFamily: FONT.body, fontSize: 15, color: COLOR.ink, backgroundColor: COLOR.homeBg,
  },
  button: {
    marginTop: SPACE.md, paddingVertical: 13, borderRadius: RADIUS.card,
    backgroundColor: COLOR.gold, alignItems: 'center',
  },
  buttonOff: { opacity: 0.5 },
  buttonText: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
  error: { fontFamily: FONT.body, fontSize: 14, color: COLOR.red, marginBottom: SPACE.md },

  statRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6, gap: 8 },
  statValue: { fontFamily: FONT.displayXBold, fontSize: 20, color: COLOR.ink, minWidth: 36 },
  statLabel: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, flex: 1 },

  hidden: { width: 0, height: 0, opacity: 0 },
});
