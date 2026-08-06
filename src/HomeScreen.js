import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { PLATFORM_LIST, PLATFORMS } from './platforms';
import { clearSession, currentUser } from './backend/authSession';
import * as campaignStore from './backend/campaignStore';
import { hasTask } from './taskStore';

export default function HomeScreen({ navigation }) {
  const user = currentUser();
  const [campaigns, setCampaigns] = useState(campaignStore.getAll());
  const [loaded, setLoaded] = useState(campaignStore.isLoaded());

  useEffect(() => {
    const un = campaignStore.subscribe((list) => {
      setCampaigns(list);
      setLoaded(campaignStore.isLoaded());
    });
    // App.js kicks off the initial load on sign-in; refresh on focus too.
    const unfocus = navigation.addListener('focus', () => {
      setCampaigns(campaignStore.getAll());
      setLoaded(campaignStore.isLoaded());
    });
    return () => { un(); unfocus(); };
  }, [navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Text style={styles.brand}>fayr</Text>
        <TouchableOpacity onPress={() => clearSession()} activeOpacity={0.7} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.tagline}>
        {user && user.mobile ? `Signed in as ${user.mobile}` : 'Connect an account to verify your reviews'}
      </Text>

      <Text style={styles.sectionLabel}>Available tasks</Text>
      {!loaded ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#111" />
          <Text style={styles.loadingText}>Loading campaigns…</Text>
        </View>
      ) : campaigns.length === 0 ? (
        <Text style={styles.empty}>
          No campaigns yet. Create one in the admin tool, then pull to refresh.
        </Text>
      ) : (
        campaigns.map((c) => {
          const mp = PLATFORMS[c.marketplace];
          return (
            <TouchableOpacity
              key={c.id}
              style={styles.taskTile}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Task', { campaignId: c.id })}
            >
              <Text style={styles.taskTitle}>
                {c.percent}% refund · {mp ? mp.name : c.marketplace}
              </Text>
              <Text style={styles.taskSub} numberOfLines={1}>
                {c.productName} {hasTask(c.id) ? '· claimed ›' : '›'}
              </Text>
            </TouchableOpacity>
          );
        })
      )}

      <Text style={styles.sectionLabel}>Connect an account</Text>
      {PLATFORM_LIST.map((p) => {
        const c = campaignStore.forMarketplace(p.key);
        return (
          <TouchableOpacity
            key={p.key}
            style={[styles.tile, { backgroundColor: p.color }]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate(p.key, { campaignId: c ? c.id : null })}
          >
            <Text style={styles.tileTitle}>{p.name}</Text>
            <Text style={styles.tileSub}>Connect & fetch reviews ›</Text>
          </TouchableOpacity>
        );
      })}

      <Text style={styles.footnote}>
        POC — sign-in happens inside the platform’s own web page. Your session
        stays on this device; requests run in the logged-in browser context.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  taskTile: {
    borderRadius: 18, padding: 20, marginBottom: 12, backgroundColor: '#111',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  taskTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  taskSub: { fontSize: 13, color: '#bbb', marginTop: 6 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 12 },
  content: { padding: 20, paddingTop: 60 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 40, fontWeight: '800', color: '#111', letterSpacing: -1 },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  logoutText: { fontSize: 14, fontWeight: '700', color: '#b3261e' },
  tagline: { fontSize: 15, color: '#666', marginTop: 4, marginBottom: 28 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  loadingText: { fontSize: 14, color: '#666', marginLeft: 10 },
  empty: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 8 },
  tile: {
    borderRadius: 18, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  tileTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  tileSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4, fontWeight: '600' },
  footnote: { fontSize: 12, color: '#999', marginTop: 20, lineHeight: 18 },
});
