import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, Platform, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { extractItems } from './extract';

function fmt(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
      <Stars rating={item.rating} />
      {item.product && item.title ? <Text style={styles.reviewTitle}>{item.title}</Text> : null}
      {item.text ? <Text style={styles.reviewText}>{item.text}</Text> : null}
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

export default function ConnectScreen({ platform }) {
  const webRef = useRef(null);
  const [mode, setMode] = useState('web'); // 'web' | 'results'
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

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
    setRaw(msg.raw);
    try {
      setItems(extractItems(msg.raw));
    } catch (e) {
      setItems([]);
    }
    setShowRaw(DISCOVERY_PLATFORMS.includes(platform.key));
    setMode('results');
  }, [platform]);

  const fetchReviews = useCallback(() => {
    setBusy(true);
    setError(null);
    webRef.current?.injectJavaScript(platform.fetchScript);
  }, [platform]);

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
      {mode === 'web' ? (
        <>
          <View style={[styles.hintBar, { backgroundColor: platform.color }]}>
            <Text style={styles.hintText}>{platform.hint}</Text>
          </View>
          <WebView
            ref={webRef}
            source={{ uri: platform.startUrl }}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={platform.beforeLoadScript}
            originWhitelist={['*']}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            // A desktop-ish UA tends to expose the same endpoints as captured.
            userAgent={
              Platform.OS === 'android'
                ? 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
                : undefined
            }
            style={{ flex: 1 }}
          />
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
        </>
      ) : (
        <View style={{ flex: 1 }}>
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
                {JSON.stringify(raw, null, 2)}
              </Text>
            </ScrollView>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <ReviewCard item={item} color={platform.color} platform={platform} />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
              ListHeaderComponent={
                <Text style={styles.count}>
                  {items.length} item{items.length === 1 ? '' : 's'} parsed
                </Text>
              }
              ListEmptyComponent={
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Nothing parsed</Text>
                  <Text style={styles.errorText}>
                    The response came back but no review/order-shaped data was found.
                    Tap “Show raw JSON” to inspect what was returned.
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
  reviewTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 6 },
  reviewText: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 18 },
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
