import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { PLATFORM_LIST } from './platforms';

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>fayr</Text>
      <Text style={styles.tagline}>Connect an account to verify your reviews</Text>

      {PLATFORM_LIST.map((p) => (
        <TouchableOpacity
          key={p.key}
          style={[styles.tile, { backgroundColor: p.color }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate(p.key, { platformKey: p.key })}
        >
          <Text style={styles.tileTitle}>{p.name}</Text>
          <Text style={styles.tileSub}>Connect & fetch reviews ›</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.footnote}>
        POC — sign-in happens inside the platform’s own web page. Your session
        stays on this device; requests run in the logged-in browser context.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  content: { padding: 20, paddingTop: 60 },
  brand: { fontSize: 40, fontWeight: '800', color: '#111', letterSpacing: -1 },
  tagline: { fontSize: 15, color: '#666', marginTop: 4, marginBottom: 28 },
  tile: {
    borderRadius: 18, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  tileTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  tileSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4, fontWeight: '600' },
  footnote: { fontSize: 12, color: '#999', marginTop: 20, lineHeight: 18 },
});
