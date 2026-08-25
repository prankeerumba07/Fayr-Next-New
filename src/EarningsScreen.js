// "Earnings" — the money tab, ported from Earnings in fayr-design.browser.jsx:3994.
//
// The design's layout kept as-is: the gold header with the giant all-time figure,
// the 2×2 stat block (Pending and Paid stacked on the left, Withdrawable and the
// Withdraw button on the right), and the link list below.
//
// This screen is a SUMMARY. The existing WalletScreen already does the real work
// — payout methods, the PAN capture, requesting a withdrawal, the request history
// — so "Withdraw" opens it rather than duplicating a money flow in two places.
//
// DROPPED from the design: the notification bell (no notifications exist) and
// "Frequently Asked Questions" (no FAQ content — Help is the real route, and it
// reaches a person).
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getWallet } from './backend/meApi';
import { getWithdrawals } from './backend/withdrawalsApi';
import { COLOR, FONT, RADIUS, SHADOW, SPACE, groupIndian } from './ui/theme';
// ONE definition of which withdrawals have left the balance, and one of the
// all-time total. Both used to be re-declared here and again in ProfileScreen,
// which is three copies of a fact that feeds a money figure — the same shape of
// defect as a price shown by one route and paid by another.
import { ON_THE_WAY, allTimeEarningsPaise } from './ui/wallet';
const rupees = (paise) => groupIndian(Math.floor(Number(paise || 0) / 100));

function StatCard({ icon, tint, label, value, style }) {
  return (
    <View style={[styles.stat, style]}>
      <View style={[styles.statIcon, { backgroundColor: tint }]}><Text style={styles.statIconText}>{icon}</Text></View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>₹{value}</Text>
    </View>
  );
}

export default function EarningsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [w, wd] = await Promise.all([getWallet(), getWithdrawals()]);
    if (w.ok) setWallet(w);
    if (wd.ok) setWithdrawals(wd.withdrawals || []);
  }, []);

  useEffect(() => {
    const unfocus = navigation.addListener('focus', load);
    load();
    return unfocus;
  }, [navigation, load]);

  const sum = (arr) => arr.reduce((s, x) => s + Number(x.amountPaise || 0), 0);
  const paid = sum(withdrawals.filter((w) => w.status === 'PAID'));
  const pending = sum(withdrawals.filter((w) => ON_THE_WAY.includes(w.status)));
  const balance = wallet ? Number(wallet.walletBalancePaise || 0) : 0;
  // The headline figure. Derived, not fetched — no endpoint reports it — and
  // correct only while a withdrawal request removes the money from the balance at
  // REQUEST time. src/ui/wallet.js explains why that can drift and
  // src/ui/earnings.test.mjs fails if it does, rather than leaving a user to read
  // a number that is too big and believe it.
  const allTime = allTimeEarningsPaise({ wallet, withdrawals });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 10 }]}
      >
        <Text style={styles.heroNote}>💵</Text>
        <Text style={styles.hero}>₹{rupees(allTime)}</Text>
        <Text style={styles.heroSub}>Your All Time Earnings ✨</Text>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={COLOR.ink}
          />
        )}
      >
        <View style={styles.grid}>
          <View style={styles.gridLeft}>
            <StatCard icon="🪙" tint="#FDECEC" label="On its way" value={rupees(pending)} />
            <StatCard icon="👛" tint="#FDF3E0" label="Paid out" value={rupees(paid)} />
          </View>
          <View style={styles.gridRight}>
            <View style={[styles.statIcon, styles.bigIcon]}><Text style={styles.bigIconText}>🏧</Text></View>
            <Text style={styles.statLabel}>Withdrawable</Text>
            <Text style={styles.bigValue}>₹{rupees(balance)}</Text>
            <TouchableOpacity
              style={styles.withdrawBtn}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Wallet')}
            >
              <Text style={styles.withdrawText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.group}>
          {[
            ['🛍️', 'My Products', () => navigation.navigate('MyProducts')],
            ['🧾', 'Withdrawal history', () => navigation.navigate('Wallet')],
            ['❓', 'Get help', () => navigation.navigate('Support')],
          ].map(([icon, label, onPress], i, arr) => (
            <TouchableOpacity
              key={label}
              style={[styles.row, i < arr.length - 1 && styles.rowLine]}
              activeOpacity={0.7}
              onPress={onPress}
            >
              <Text style={styles.rowIcon}>{icon}</Text>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Say where money sits, because "Pending" alone reads as "lost". */}
        <Text style={styles.note}>
          Refunds land in your withdrawable balance. Once you request a withdrawal it moves to
          “On its way” until a Fayr reviewer sends it to your account.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md, alignItems: 'center' },
  heroNote: { fontSize: 26 },
  hero: { fontFamily: FONT.displayXBold, fontSize: 50, color: COLOR.ink, letterSpacing: -1.5, marginTop: 2 },
  heroSub: { fontFamily: FONT.displayXBold, fontSize: 18, color: COLOR.ink, marginTop: 4 },

  grid: { flexDirection: 'row', gap: 12 },
  gridLeft: { flex: 1, gap: 12 },
  gridRight: {
    flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.xl, padding: 15,
    alignItems: 'center', ...SHADOW.card,
  },
  stat: { backgroundColor: '#fff', borderRadius: RADIUS.xl, padding: 15, ...SHADOW.card },
  statIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statIconText: { fontSize: 18 },
  bigIcon: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#FDF3E0' },
  bigIconText: { fontSize: 24 },
  statLabel: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink, marginTop: 8 },
  statValue: { fontFamily: FONT.displayXBold, fontSize: 21, color: COLOR.ink, marginTop: 3 },
  bigValue: { fontFamily: FONT.displayXBold, fontSize: 23, color: COLOR.ink, marginTop: 2 },
  withdrawBtn: {
    width: '100%', marginTop: 12, backgroundColor: COLOR.green, borderRadius: RADIUS.md,
    paddingVertical: 12, alignItems: 'center',
  },
  withdrawText: { fontFamily: FONT.display, fontSize: 15, color: '#fff' },

  group: { backgroundColor: '#fff', borderRadius: RADIUS.xl, marginTop: 14, overflow: 'hidden', ...SHADOW.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 17 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line },
  rowIcon: { fontSize: 19, width: 24, textAlign: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
  chev: { color: '#b7b8aa', fontSize: 18 },
  note: {
    fontFamily: FONT.body, fontSize: 12, color: COLOR.sub,
    lineHeight: 18, marginTop: 16, textAlign: 'center',
  },
});
