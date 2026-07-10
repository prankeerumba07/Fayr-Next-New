import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { extractItems, timelineOf } from './extract';

function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const VERDICT = {
  eligible: { label: '✓ Eligible to verify', color: '#1a7f37', bg: '#eaf7ee' },
  in_window: { label: '⏳ In return window', color: '#9a6700', bg: '#fff4e0' },
  returned: { label: '✗ Returned / cancelled', color: '#b3261e', bg: '#fdeceb' },
  unknown: { label: '❔ Dates unavailable', color: '#666', bg: '#f0f0f0' },
};

function Timeline({ item }) {
  const t = timelineOf(item);
  const rows = [
    ['Order', fmt(t.orderDate)],
    ['Delivered', fmt(t.deliveryDate)],
    ['Reviewed', fmt(t.reviewDate)],
  ].filter((r) => r[1] !== '—');
  const v = VERDICT[t.verdict];
  return (
    <View style={styles.timeline}>
      {rows.map(([k, val]) => (
        <Text key={k} style={styles.tlRow}>
          <Text style={styles.tlKey}>{k}: </Text>{val}
        </Text>
      ))}
      <Text style={styles.tlRow}>
        <Text style={styles.tlKey}>Return window: </Text>
        {t.returnClosesAt ? `${t.returnClosed ? 'closed' : 'closes'} ${fmt(t.returnClosesAt)}` : '—'}
        <Text style={styles.tlDim}>{`  (${t.periodDays}d${item.returnPeriodDays ? '' : ', default'})`}</Text>
      </Text>
      <View style={[styles.verdict, { backgroundColor: v.bg }]}>
        <Text style={[styles.verdictText, { color: v.color }]}>{v.label}</Text>
      </View>
    </View>
  );
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

const PID_LABEL = { amazon: 'ASIN', flipkart: 'PID', myntra: 'Style ID' };

function ReviewCard({ item, color, platform }) {
  const idLabel = PID_LABEL[platform.key] || 'Product ID';
  const productId =
    item.productId != null ? String(item.productId) : item.asin || null;
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.cardRow}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="cover" />
        ) : null}
        <View style={{ flex: 1 }}>
          {item.product ? (
            <Text style={styles.product} numberOfLines={2}>{item.product}</Text>
          ) : item.title ? (
            <Text style={styles.product} numberOfLines={2}>{item.title}</Text>
          ) : null}
          {item.date ? <Text style={styles.date}>Ordered / reviewed: {item.date}</Text> : null}
          <Stars rating={item.rating} />
          {item.product && item.title ? <Text style={styles.reviewTitle}>{item.title}</Text> : null}
          {item.text ? <Text style={styles.reviewText}>{item.text}</Text> : null}
          <View style={styles.badgeRow}>
            {item.verified ? <Text style={styles.verified}>✓ Verified Purchase</Text> : null}
            {productId ? <Text style={styles.asin}>{idLabel} {productId}</Text> : null}
          </View>
          <Timeline item={item} />
        </View>
      </View>
    </View>
  );
}

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
    setMode('results');
  }, []);

  const fetchReviews = useCallback(() => {
    setBusy(true);
    setError(null);
    webRef.current?.injectJavaScript(platform.fetchScript);
  }, [platform]);

  const backToLogin = useCallback(() => {
    setMode('web');
    setShowRaw(false);
  }, []);

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
            <TouchableOpacity onPress={() => setShowRaw((s) => !s)} style={styles.linkBtn}>
              <Text style={[styles.link, { color: platform.color }]}>
                {showRaw ? 'Show cards' : 'Show raw JSON'}
              </Text>
            </TouchableOpacity>
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
  cardRow: { flexDirection: 'row' },
  thumb: { width: 56, height: 56, borderRadius: 8, marginRight: 12, backgroundColor: '#f0f0f0' },
  product: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  date: { fontSize: 12, color: '#777', marginTop: 2 },
  stars: { fontSize: 15, color: '#f5a623', marginTop: 4 },
  ratingNum: { fontSize: 12, color: '#777' },
  reviewTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 6 },
  reviewText: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  verified: { fontSize: 12, fontWeight: '700', color: '#1a7f37', marginRight: 10 },
  asin: { fontSize: 11, color: '#888', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  timeline: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  tlRow: { fontSize: 12, color: '#444', marginBottom: 2 },
  tlKey: { color: '#888' },
  tlDim: { color: '#bbb', fontSize: 11 },
  verdict: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 6 },
  verdictText: { fontSize: 12, fontWeight: '700' },
  errorBox: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#fff4f4', borderWidth: 1, borderColor: '#f3caca' },
  errorTitle: { fontSize: 15, fontWeight: '700', color: '#b3261e', marginBottom: 6 },
  errorText: { fontSize: 13, color: '#7a1f1a', lineHeight: 18 },
  errorHint: { fontSize: 12, color: '#999', marginTop: 8 },
  rawBox: { flex: 1, backgroundColor: '#0d1117', padding: 12 },
  rawText: { color: '#c9d1d9', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
