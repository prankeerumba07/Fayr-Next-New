import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, Platform, Linking, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { extractItems } from './extract';
import { restoreSession, persistSession } from './session';
import { DEBUG_CAPTURE } from './config';

function fmt(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Given a target product (what the review task is for), decide whether a
// fetched item is that product. In the real app this string comes from the
// task; here it's typed in. Quick-commerce has no order-confirmation email to
// key off, so we match on the product name: substring first, then a
// majority-of-tokens overlap so minor wording differences still match.
function productMatches(item, target) {
  const t = (target || '').trim().toLowerCase();
  if (!t) return true;
  const hay = `${item.product || ''} ${item.title || ''}`.toLowerCase();
  if (hay.includes(t)) return true;
  const toks = t.split(/\s+/).filter((w) => w.length > 2);
  if (!toks.length) return false;
  const hits = toks.filter((w) => hay.includes(w)).length;
  return hits / toks.length >= 0.6;
}

function Stars({ rating }) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return (
    <Text style={styles.stars}>
      {'★'.repeat(Math.max(0, Math.min(5, full)))}
      {'☆'.repeat(Math.max(0, 5 - full))} <Text style={styles.ratingNum}>{rating}</Text>
    </Text>
  );
}

// Exactly the fields requested: Product Name, Rating, Review Title, Review Text,
// Review Date, Order ID, Product URL, Marketplace Name. Delivery/return timeline
// and approval/publish-status data are still computed (see extract.js) and
// visible via "Show raw JSON" - just not on this card, to keep it to what was
// asked for.
function ReviewCard({ item, color, platform }) {
  const reviewDate = fmt(item.reviewDate) || item.date || null;
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={styles.marketplace}>{platform.name}</Text>
      {(item.product || item.title) ? (
        <Text style={styles.product} numberOfLines={2}>{item.product || item.title}</Text>
      ) : null}
      {item.rating != null ? (
        <Stars rating={item.rating} />
      ) : item.approved === true ? (
        // Rated, but this marketplace's web doesn't expose the star count.
        <Text style={styles.ratedBadge}>✓ Rated{' '}<Text style={styles.ratedBadgeSub}>(star not shown on web)</Text></Text>
      ) : /not_rated|rating_not_found/i.test(item.reviewStatus || '') ? (
        <Text style={styles.notRatedBadge}>Not rated yet</Text>
      ) : null}
      {item.product && item.title ? <Text style={styles.reviewTitle}>{item.title}</Text> : null}
      {item.text ? <Text style={styles.reviewText}>{item.text}</Text> : null}
      {item.mediaCount ? (
        <Text style={styles.mediaNote}>📷 {item.mediaCount} photo/video in review (public on product page)</Text>
      ) : item.approved === true && item.text ? (
        <Text style={styles.mediaNoteMuted}>No photos/videos — review may not show publicly</Text>
      ) : null}
      <View style={styles.metaRow}>
        {reviewDate ? <Text style={styles.metaText}>Reviewed: {reviewDate}</Text> : null}
        {item.orderId ? <Text style={styles.metaText}>Order ID: {item.orderId}</Text> : null}
      </View>
      {item.productUrl ? (
        <TouchableOpacity onPress={() => Linking.openURL(item.productUrl)}>
          <Text style={styles.productUrl} numberOfLines={1}>{item.productUrl}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Meesho has no confirmed API schema yet (see platforms.js) - card-parsing
// generic embedded state produces false positives (public catalog ratings,
// unrelated app state), so default to the raw view instead of pretending the
// cards are reliable. (Zepto/Blinkit/Instamart now have real parsers.)
const DISCOVERY_PLATFORMS = ['meesho'];

// `campaign` carries the task's product: { asin }. Without it a fetch cannot
// know which product it is allowed to surface, so it fails closed rather than
// returning every order on the account (see platforms.js). Nothing passes a
// campaign yet - that arrives with the campaign model.
export default function ConnectScreen({ platform, campaign }) {
  const webRef = useRef(null);
  const [mode, setMode] = useState('web'); // 'web' | 'results'
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [target, setTarget] = useState(''); // the product the review task is for
  // Restore any saved login cookies BEFORE the WebView creates its store, so a
  // returning user is already signed in. Persist again when leaving.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    let alive = true;
    restoreSession(platform.key, platform.startUrl).finally(() => {
      if (alive) setSessionReady(true);
    });
    return () => {
      alive = false;
      persistSession(platform.key, platform.startUrl);
    };
  }, [platform]);

  // onLoadEnd alone is not enough: an SPA login (Flipkart) authenticates
  // without a full page load, so the only snapshot ever written was the
  // PRE-login one. Also save on navigation changes, which SPA routing does
  // emit. Debounced because a single navigation can fire this several times
  // and each call writes to the Keychain.
  const lastSaveRef = useRef(0);
  const saveSession = useCallback(() => {
    const now = Date.now();
    if (now - lastSaveRef.current < 1500) return;
    lastSaveRef.current = now;
    persistSession(platform.key, platform.startUrl);
  }, [platform]);

  // When a target product is set, show only its review(s) - this is the
  // "fetch only the correct product" behaviour the background flow needs.
  const visibleItems = useMemo(
    () => items.filter((it) => productMatches(it, target)),
    [items, target]
  );

  // Cap the raw dump: React Native can fail to paint (blank/black) a single
  // <Text> holding megabytes. Show the first slice and point at "Download JSON"
  // for the rest.
  const rawText = useMemo(() => {
    if (raw == null) return '';
    const s = JSON.stringify(raw, null, 2) || '';
    const LIMIT = 200000;
    return s.length > LIMIT
      ? `${s.slice(0, LIMIT)}\n\n…(truncated ${s.length - LIMIT} more chars — use “Download JSON” for the full file)`
      : s;
  }, [raw]);

  const onMessage = useCallback((event) => {
    setBusy(false);
    let msg;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch (e) {
      setError('Could not parse response from page.');
      setMode('results');
      return;
    }
    if (!msg.ok) {
      setError(msg.error || 'Fetch failed.');
      setRaw(null);
      setItems([]);
      setMode('results');
      return;
    }
    setError(null);
    // A successful fetch proves the WebView was authenticated, making this the
    // most reliable moment to capture the logged-in cookies. Bypass the
    // debounce - this snapshot matters more than any navigation one.
    persistSession(platform.key, platform.startUrl);
    setRaw(msg.raw);
    try {
      setItems(extractItems(msg.raw));
    } catch (e) {
      setItems([]);
    }
    // Never auto-open the dark raw viewer: a multi-MB Meesho payload in a single
    // <Text> node paints as a blank near-black screen. Default to the (light)
    // cards view; the user can still toggle "Show raw JSON" on demand.
    setShowRaw(false);
    setMode('results');
  }, [platform]);

  const fetchReviews = useCallback(() => {
    setBusy(true);
    setError(null);
    // The campaign's ASIN and the debug flag are injected in the SAME script as
    // the fetch, not as a separate call, so the fetch can never run against a
    // stale or unset target. Both fail closed: with no campaign ASIN and no
    // debug opt-in the script returns error:"no_campaign_target" rather than
    // surfacing every order the account has (see platforms.js).
    const preamble =
      `window.__fayrTargetAsin = ${JSON.stringify((campaign && campaign.asin) || null)};` +
      `window.__fayrDebugCapture = ${JSON.stringify(DEBUG_CAPTURE === true)};`;
    webRef.current?.injectJavaScript(`${preamble}\n${platform.fetchScript}`);
  }, [platform, campaign]);

  const backToLogin = useCallback(() => {
    setMode('web');
    setShowRaw(false);
  }, []);

  const downloadRawJson = useCallback(async () => {
    if (!raw) return;
    try {
      const file = new File(Paths.cache, `fayr-${platform.key}-${Date.now()}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(raw, null, 2));
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: `${platform.name} raw JSON`,
        });
      } else {
        Alert.alert('Saved', `File written to ${file.uri}`);
      }
    } catch (e) {
      Alert.alert('Could not export JSON', String((e && e.message) || e));
    }
  }, [raw, platform]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* The WebView stays MOUNTED even while results show, so returning from
          results doesn't reload the page and drop the logged-in session. It's
          only hidden via display:none. */}
      <View style={[styles.flexOne, mode === 'web' ? null : styles.hidden]}>
          <View style={[styles.hintBar, { backgroundColor: platform.color }]}>
            <Text style={styles.hintText}>{platform.hint}</Text>
          </View>
          {!sessionReady ? (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color={platform.color} />
            </View>
          ) : (
          <WebView
            ref={webRef}
            source={{ uri: platform.startUrl }}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={platform.beforeLoadScript}
            originWhitelist={['*']}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            // Persist cache/cookies across launches (iOS WKWebView shared store).
            cacheEnabled
            // Save cookies to the Keychain after each load AND on every
            // navigation change, so an SPA login that never triggers a full
            // page load is still captured (no-op unless the native cookie
            // module is present).
            onLoadEnd={saveSession}
            onNavigationStateChange={saveSession}
            javaScriptEnabled
            // Per-platform override first (only Amazon sets one - it needs a
            // desktop UA or amazon.in serves a mobile orders page whose DOM the
            // parser can't read). Everything else keeps the previous behaviour:
            // an Android UA on Android, and WKWebView's default on iOS.
            userAgent={
              platform.userAgent ||
              (Platform.OS === 'android'
                ? 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
                : undefined)
            }
            // Opaque white so the WebView never shows through as a black/blank
            // flash while a heavy SPA (Zepto/Blinkit/Swiggy) is still loading.
            style={{ flex: 1, backgroundColor: '#fff' }}
            containerStyle={{ backgroundColor: '#fff' }}
            renderLoading={() => (
              <View style={styles.webLoading}>
                <ActivityIndicator size="large" color={platform.color} />
              </View>
            )}
            startInLoadingState
          />
          )}
          <TouchableOpacity
            style={[styles.fetchBtn, { backgroundColor: platform.color }]}
            onPress={fetchReviews}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.fetchBtnText}>Fetch my reviews</Text>
            )}
          </TouchableOpacity>
      </View>
      {mode === 'results' ? (
        <View style={styles.resultsWrap}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity onPress={backToLogin} style={styles.linkBtn}>
              <Text style={[styles.link, { color: platform.color }]}>‹ Back to {platform.name}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={() => setShowRaw((s) => !s)} style={styles.linkBtn}>
                <Text style={[styles.link, { color: platform.color }]}>
                  {showRaw ? 'Show cards' : 'Show raw JSON'}
                </Text>
              </TouchableOpacity>
              {raw ? (
                <TouchableOpacity onPress={downloadRawJson} style={[styles.linkBtn, { marginLeft: 14 }]}>
                  <Text style={[styles.link, { color: platform.color }]}>Download JSON</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Fetch failed</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorHint}>
                Make sure you are logged in on the previous screen, then try again.
              </Text>
            </View>
          ) : showRaw ? (
            <ScrollView style={styles.rawBox}>
              <Text style={styles.rawText} selectable>
                {rawText}
              </Text>
            </ScrollView>
          ) : (
            <FlatList
              data={visibleItems}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <ReviewCard item={item} color={platform.color} platform={platform} />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
              ListHeaderComponent={
                <View>
                  <TextInput
                    style={styles.targetInput}
                    value={target}
                    onChangeText={setTarget}
                    placeholder="Target product (leave blank to show all)"
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.count}>
                    {target.trim()
                      ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'} for “${target.trim()}” (of ${items.length} fetched)`
                      : `${items.length} item${items.length === 1 ? '' : 's'} fetched`}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>
                    {target.trim() ? 'No matching product' : 'Nothing parsed'}
                  </Text>
                  <Text style={styles.errorText}>
                    {target.trim()
                      ? `None of the ${items.length} fetched item(s) matched “${target.trim()}”. Clear the box to see them all.`
                      : 'The response came back but no review/order-shaped data was found. Tap “Show raw JSON” to inspect what was returned.'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flexOne: { flex: 1 },
  hidden: { display: 'none' },
  resultsWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  webLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  hintBar: { paddingHorizontal: 14, paddingVertical: 10 },
  hintText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  fetchBtn: {
    margin: 14, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fetchBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  resultsHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
  },
  linkBtn: { paddingVertical: 4 },
  link: { fontSize: 15, fontWeight: '600' },
  count: { fontSize: 13, color: '#666', marginBottom: 8, marginLeft: 4 },
  targetInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, color: '#1a1a1a', backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 12, borderLeftWidth: 4, padding: 12, marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e6e6',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  marketplace: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  product: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginTop: 4 },
  stars: { fontSize: 15, color: '#f5a623', marginTop: 4 },
  ratingNum: { fontSize: 12, color: '#777' },
  ratedBadge: { fontSize: 14, fontWeight: '700', color: '#0C831F', marginTop: 4 },
  ratedBadgeSub: { fontSize: 11, fontWeight: '400', color: '#999' },
  notRatedBadge: { fontSize: 13, fontWeight: '600', color: '#b0772a', marginTop: 4 },
  reviewTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 6 },
  reviewText: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 18 },
  mediaNote: { fontSize: 12, color: '#0C831F', fontWeight: '600', marginTop: 6 },
  mediaNoteMuted: { fontSize: 12, color: '#999', marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: '#777', marginRight: 14 },
  productUrl: { fontSize: 12, color: '#2874F0', marginTop: 6, textDecorationLine: 'underline' },
  errorBox: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#fff4f4', borderWidth: 1, borderColor: '#f3caca' },
  errorTitle: { fontSize: 15, fontWeight: '700', color: '#b3261e', marginBottom: 6 },
  errorText: { fontSize: 13, color: '#7a1f1a', lineHeight: 18 },
  errorHint: { fontSize: 12, color: '#999', marginTop: 8 },
  rawBox: { flex: 1, backgroundColor: '#0d1117', padding: 12 },
  rawText: { color: '#c9d1d9', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
