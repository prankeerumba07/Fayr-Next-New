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
import { restoreSession, persistSession, logoutPlatform } from './session';
import { DEBUG_CAPTURE } from './config';
import { readEvidence } from './taskflow';
import { dispatch } from './taskStore';

// Platforms whose fetch payload feeds the task flow. Amazon reads a review's
// order (HTML scrape); Flipkart/Myntra are order-first (their JSON order API),
// so a purchase advances the task before any review exists. Others are still in
// discovery mode (no reverse-engineered order endpoint yet - see platforms.js).
const READER_PLATFORMS = { amazon: true, flipkart: true, myntra: true };

// Marketplaces whose OWN in-page logout is broken or missing in the WebView, so
// Fayr shows its own "Log out" button. The rest (Amazon/Flipkart/Myntra/Meesho/
// Blinkit) have a working logout in their account menu, so we don't add one there.
const LOGOUT_PLATFORMS = { zepto: true, instamart: true };

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
export default function ConnectScreen({ platform, campaign, navigation }) {
  const webRef = useRef(null);
  const [mode, setMode] = useState('web'); // 'web' | 'results'
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [target, setTarget] = useState(''); // the product the review task is for
  // DEV-ONLY: bypass the campaign filter for the next fetch. Starts OFF, so the
  // filtered production path is always the default. Inert unless DEV_TOOLS.
  const [devShowAll, setDevShowAll] = useState(false);
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

  // The URL the WebView is actually on. Marketplaces redirect (Zepto's
  // zepto.com -> zeptonow.com, Swiggy's subdomains), and the AUTH cookies live on
  // the redirected domain - which a start-URL-only clear never sees. Logout uses
  // this so it clears the real domain.
  const currentUrlRef = useRef(platform.startUrl);
  const onNav = useCallback((navState) => {
    if (navState && navState.url) currentUrlRef.current = navState.url;
    saveSession();
  }, [saveSession]);
  const onLoadEnd = useCallback((e) => {
    const u = e && e.nativeEvent && e.nativeEvent.url;
    if (u) currentUrlRef.current = u;
    saveSession();
  }, [saveSession]);

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
    // DEV: a session-clear probe reporting what localStorage held (e.g. Myntra
    // urt/uidx) before it was wiped. Not a fetch result - report and stop.
    if (msg && msg.__fayrClear) {
      Alert.alert(
        `localStorage @ ${msg.origin || '?'}`,
        msg.error
          ? `error: ${msg.error}`
          : `${msg.localCount || 0} key(s)${msg.localKeys && msg.localKeys.length ? `:\n${msg.localKeys.join(', ')}` : ''}`
      );
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

    // Feed the task flow. readEvidence (per platform) decides what the payload
    // actually proves - including that it proves nothing (signin redirect,
    // unreadable order, not-purchased-yet) - and transition() decides whether
    // that advances the task. Neither is this screen's business, which is why
    // nothing is interpreted here. Amazon is review-anchored (HTML scrape);
    // Flipkart/Myntra are order-first (their JSON order API), so a purchase
    // advances the task before any review exists.
    if (campaign && READER_PLATFORMS[platform.key]) {
      try {
        const evidence = readEvidence(platform.key, msg.raw, {
          asin: campaign.asin || null,
          pid: campaign.pid || null,
          styleId: campaign.styleId || null,
          product: campaign.productName || null,
          amount: campaign.amount != null ? campaign.amount : null,
          reviewId: campaign.reviewId || null,
        });
        dispatch(campaign.id, {
          type: 'EVIDENCE',
          // Keyed by what the evidence IS, so re-tapping Fetch on an unchanged
          // order is a no-op rather than another history entry.
          key: `evidence:${evidence.order ? evidence.order.id : evidence.blocker || 'none'}`,
          evidence,
          at: Date.now(),
        });
        // Return to the task once the evidence has landed. The task screen is
        // where the outcome lives - state, gaps, refund - so dropping the user
        // on a raw results list makes a successful fetch look like a dead end.
        // Navigate AFTER dispatch so the screen renders the new state, not the
        // old one.
        if (navigation && typeof navigation.navigate === 'function') {
          navigation.navigate('Task', { campaignId: campaign.id });
        }
      } catch (e) {
        /* the raw view below still works; the task simply doesn't advance */
      }
    }
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
  }, [platform, campaign, navigation]);

  const fetchReviews = useCallback(() => {
    setBusy(true);
    setError(null);
    // The campaign's ASIN and the debug flag are injected in the SAME script as
    // the fetch, not as a separate call, so the fetch can never run against a
    // stale or unset target. Both fail closed: with no campaign ASIN and no
    // debug opt-in the script returns error:"no_campaign_target" rather than
    // surfacing every order the account has (see platforms.js).
    // The unfiltered path is opened ONLY by: the committed DEBUG_CAPTURE flag,
    // or the dev toggle - and the dev toggle is itself gated on DEV_TOOLS, which
    // is a literal false in production. So in a shipped build this expression can
    // only ever be `DEBUG_CAPTURE === true` (default false); the campaign filter
    // stays the default and the production path is untouched by any of this.
    // eslint-disable-next-line no-undef
    const unfiltered = DEBUG_CAPTURE === true || (__DEV__ && devShowAll);
    // A Fayr campaign has no marketplace product id (the user searches and buys
    // the product themselves), so Flipkart/Myntra match on NAME + AMOUNT - both
    // are on the campaign page. The id pins (asin/pid/styleId) are injected too
    // but are normally null; they're used only when a prior fetch already
    // discovered the marketplace id, to pin the match exactly. All target-filter
    // fail-closed: with neither a name nor an id, no order is surfaced.
    const preamble =
      `window.__fayrTargetName = ${JSON.stringify((campaign && campaign.productName) || null)};` +
      `window.__fayrTargetAmount = ${JSON.stringify((campaign && campaign.amount != null ? campaign.amount : null))};` +
      `window.__fayrTargetAsin = ${JSON.stringify((campaign && campaign.asin) || null)};` +
      `window.__fayrTargetPid = ${JSON.stringify((campaign && campaign.pid) || null)};` +
      `window.__fayrTargetStyleId = ${JSON.stringify((campaign && campaign.styleId) || null)};` +
      `window.__fayrDebugCapture = ${JSON.stringify(unfiltered === true)};`;
    webRef.current?.injectJavaScript(`${preamble}\n${platform.fetchScript}`);
  }, [platform, campaign, devShowAll]);

  const backToLogin = useCallback(() => {
    setMode('web');
    setShowRaw(false);
  }, []);

  // DEV-ONLY: wipe this marketplace's session so a different account can log in
  // without hunting for the site's logout link. Clears: (1) localStorage /
  // sessionStorage / IndexedDB for the current origin - reporting the keys back
  // first, since some platforms (Myntra urt/uidx) keep auth there too; (2) the
  // WebKit cookies, expiring each on its OWN domain so dotted-parent auth cookies
  // (.flipkart.com / .myntra.com) are actually removed, not just the www host;
  // (3) the persisted Keychain snapshot. Then reloads the logged-out page.
  // Log out of THIS marketplace. Only shown where the marketplace's own logout
  // doesn't work in the WebView (Zepto, Instamart - see LOGOUT_PLATFORMS). Wipes
  // the live page's localStorage (Zepto's Zustand blob, Instamart's
  // swiggy_auth_headers) and expires this platform's cookies on BOTH its start
  // domain and the domain it actually redirected to (currentUrlRef) - which is
  // what the old start-URL-only clear missed. Other marketplaces are untouched.
  const logoutThisPlatform = useCallback(async () => {
    // Block auto-save so nothing re-persists the session we're about to clear.
    lastSaveRef.current = Date.now() + 8000;
    // STEP 1 — cookies. clearAll BOTH stores (awaited) so the dotted-domain auth
    // cookie (.swiggy.com) is actually gone before the page reloads. The earlier
    // targeted clear left it in NSHTTPCookieStorage, which then re-synced into the
    // WebView on reload - which is why "logged out" kept coming back logged in.
    let res = { ok: false };
    try {
      const urls = Array.from(new Set([platform.startUrl, currentUrlRef.current].filter(Boolean)));
      res = await logoutPlatform(platform.key, urls);
    } catch (e) { /* ignore */ }
    // STEP 2 — the page's OWN storage + reload, in ONE script so the wipe
    // provably completes before the reload re-reads it. Swiggy keeps its bearer
    // token in localStorage (auth_headers / user_info / swiggy_user_info) and
    // Zepto keeps a Zustand blob there; a cookie-only clear leaves the page able
    // to re-authenticate. localStorage/sessionStorage are cleared synchronously,
    // THEN we navigate to the start URL - by which point the cookies (step 1) are
    // already gone, so the fresh load has nothing to restore the session from.
    const wipeAndReload = `(function(){
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      try {
        if (window.indexedDB && indexedDB.databases) {
          indexedDB.databases().then(function(dbs){ (dbs || []).forEach(function(d){ try { indexedDB.deleteDatabase(d.name); } catch (e) {} }); });
        }
      } catch (e) {}
      try { location.replace(${JSON.stringify(platform.startUrl)}); } catch (e) { try { location.reload(); } catch (e2) {} }
      true;
    })();`;
    try { webRef.current?.injectJavaScript(wipeAndReload); } catch (e) { /* ignore */ }
    setMode('web');
    setItems([]); setRaw(null); setError(null);
    Alert.alert(
      res.ok ? `Logged out of ${platform.name}` : 'Could not log out',
      res.ok
        ? 'Signed out on this device — the page reloaded logged out. Log in with a different mobile number.'
        : 'The session could not be fully cleared. Close and reopen the app, then try again.',
    );
  }, [platform]);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      `Log out of ${platform.name}?`,
      'This signs you out on this device so you can log in with a different mobile number.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => { logoutThisPlatform(); } },
      ],
    );
  }, [platform, logoutThisPlatform]);

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
            onLoadEnd={onLoadEnd}
            onNavigationStateChange={onNav}
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
            // Explicit scroll enable — Fabric (new arch) doesn't always apply the
            // iOS default, and being explicit is harmless if it was already on.
            scrollEnabled
            nestedScrollEnabled
            // containerStyle REPLACES the library default { flex: 1, overflow:
            // 'hidden' }. Both matter: flex:1 sizes the container; overflow:
            // 'hidden' is what makes the page scroll WITHIN it instead of
            // overflowing past its bounds — without it, no platform scrolled.
            containerStyle={{ flex: 1, overflow: 'hidden', backgroundColor: '#fff' }}
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
          {/* DEV ONLY. DEV_TOOLS is a literal false in a production build, so
              this whole control is dead-code-eliminated and cannot be reached.
              It only bypasses the campaign filter for the NEXT fetch; the filter
              is still the default (devShowAll starts false). */}
          {/* eslint-disable-next-line no-undef */}
          {/* Real feature (not dev-only): a marketplace-independent logout so a
              user can switch accounts even when the marketplace's own logout is
              broken/absent in the WebView (Instamart, Zepto). */}
          {LOGOUT_PLATFORMS[platform.key] ? (
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={confirmLogout}
              activeOpacity={0.7}
            >
              <Text style={styles.logoutBtnText}>Log out of {platform.name}</Text>
            </TouchableOpacity>
          ) : null}
          {__DEV__ ? (
            <View style={styles.devRow}>
              <TouchableOpacity
                style={[styles.devToggle, devShowAll && styles.devToggleOn]}
                onPress={() => setDevShowAll((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={[styles.devToggleText, devShowAll && styles.devToggleTextOn]}>
                  {devShowAll ? '● ' : '○ '}Show all my reviews (dev){devShowAll ? ' — filter OFF' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
  devRow: { marginTop: 4 },
  devToggle: { marginTop: 4, paddingVertical: 8, alignItems: 'center' },
  devToggleOn: { backgroundColor: '#fff4f4', borderRadius: 8 },
  devToggleText: { fontSize: 12, color: '#999', fontWeight: '600' },
  devToggleTextOn: { color: '#b3261e' },
  devClear: { marginTop: 2, paddingVertical: 8, alignItems: 'center' },
  devClearText: { fontSize: 12, color: '#b3261e', fontWeight: '600', textDecorationLine: 'underline' },
  fetchBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  logoutBtn: {
    marginHorizontal: 14, marginBottom: 6, paddingVertical: 12, alignItems: 'center',
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e0b3b3', backgroundColor: '#fff6f6',
  },
  logoutBtnText: { fontSize: 13, color: '#b3261e', fontWeight: '700' },
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
