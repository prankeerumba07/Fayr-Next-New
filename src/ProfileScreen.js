// "My Profile" — the fourth tab, and the only door to Help and the policies.
//
// Merged from TWO screens in fayr-design.browser.jsx, as agreed: Insights (:3922)
// supplies the layout — profile card, two real stat tiles, a grouped link list,
// log out at the bottom of the scroll — and Profile (:4189) supplies the privacy
// control panel and the "Help & support" row. Merging is deliberate: the design
// reaches its settings screen through a row on Insights, which would have put
// Help two taps deep behind a screen that otherwise has nothing real in it.
//
// DROPPED from the design, because the backend cannot do them and a settings row
// that does nothing is worse than an absent one:
//   - "Connected inbox" / Gmail — there is no email-connect flow on the device.
//   - "Edit preferences", "Account & security" (phone change, device list),
//     "Notifications" — no endpoints exist for any of them.
//   - "Delete account" — no deletion endpoint. The privacy policy promises this
//     via Help, so the Help row is the honest route for now.
// The stats and both privacy lines below are real: they read the same sources as
// the wallet, and describe what the app actually does.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from './backend/authApi';
import { currentUser } from './backend/authSession';
import { getWallet } from './backend/meApi';
import { getWithdrawals } from './backend/withdrawalsApi';
import { listTasks } from './backend/tasksApi';
import { COLOR, FONT, RADIUS, SHADOW, SPACE, groupIndian } from './ui/theme';
// ONE definition of which withdrawals have left the balance, and one of the
// all-time total — shared with the Earnings screen rather than restated here.
import { ON_THE_WAY, allTimeEarningsPaise } from './ui/wallet';
import { POLICY_VERSION } from './ui/policy';

const REVIEWED_STATES = ['REVIEWED', 'HOLDING', 'REFUNDED'];

function Row({ icon, title, sub, onPress, danger, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowLine]}
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, danger && { color: COLOR.red }]}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {onPress ? <Text style={styles.chev}>›</Text> : null}
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [signingOut, setSigningOut] = useState(false);
  const user = currentUser();

  const load = useCallback(async () => {
    const [w, wd, t] = await Promise.all([getWallet(), getWithdrawals(), listTasks()]);
    if (w.ok) setWallet(w);
    if (wd.ok) setWithdrawals(wd.withdrawals || []);
    if (t.ok) setTasks(t.tasks || []);
  }, []);

  useEffect(() => {
    const unfocus = navigation.addListener('focus', load);
    load();
    return unfocus;
  }, [navigation, load]);

  // The SAME FUNCTION as the Earnings screen, not the same arithmetic written
  // twice — "same arithmetic" in two files is precisely how two screens come to
  // disagree about one number.
  const sum = (arr) => arr.reduce((s, x) => s + Number(x.amountPaise || 0), 0);
  const paidPaise = sum(withdrawals.filter((w) => w.status === 'PAID'));
  const movingPaise = sum(withdrawals.filter((w) => ON_THE_WAY.includes(w.status)));
  const balancePaise = wallet ? Number(wallet.walletBalancePaise || 0) : 0;
  const totalPaise = allTimeEarningsPaise({ wallet, withdrawals });
  const reviewed = tasks.filter((t) => REVIEWED_STATES.includes(t.state)).length;

  const doLogout = () => {
    Alert.alert('Log out?', 'You will need your mobile number and a code we send you to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          if (signingOut) return;
          setSigningOut(true);
          try { await signOut(); } finally { setSigningOut(false); }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>My Profile</Text>

        <View style={styles.idCard}>
          <View style={styles.avatar}><Text style={styles.avatarIcon}>👤</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* The user's own number, from the session that logged them in — no
                new endpoint, and nothing here that is not already theirs. */}
            <Text style={styles.name}>{formatMobile(user && user.mobile)}</Text>
            <Text style={styles.nameSub}>Mobile verified</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>₹{groupIndian(Math.floor(totalPaise / 100))}</Text>
            <Text style={styles.statLabel}>Total earned</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{reviewed}</Text>
            <Text style={styles.statLabel}>Products reviewed</Text>
          </View>
        </View>

        <View style={styles.group}>
          <Row icon="💰" title="Earnings & withdrawals" sub="Balance, withdrawals and payout details"
            onPress={() => navigation.navigate('Earnings')} />
          <Row icon="🛍️" title="My Products" sub="Every claim and its refund"
            onPress={() => navigation.navigate('MyProducts')} />
          <Row icon="🎟️" title="Tickets" sub={wallet ? `${wallet.ticketBalance} available` : 'Loading…'} last />
        </View>

        {/* The privacy panel from the design's settings screen, cut down to the
            two things that are actually true of this app today. */}
        <View style={styles.privacy}>
          <Text style={styles.privacyTitle}>🛡️ Your privacy, your control</Text>
          <Text style={styles.privacyIntro}>What Fayr can and cannot see.</Text>
          <View style={styles.privacyRow}>
            <Text style={styles.rowIcon}>🛍️</Text>
            <View style={styles.rowBody}>
              <Text style={styles.privacyName}>Marketplace account</Text>
              <Text style={styles.rowSub}>Reads only your own order and review pages, on this device</Text>
            </View>
            <View style={styles.dotOn} />
          </View>
          <View style={styles.privacyRow}>
            <Text style={styles.rowIcon}>🔑</Text>
            <View style={styles.rowBody}>
              <Text style={styles.privacyName}>Your marketplace password</Text>
              <Text style={styles.rowSub}>Never seen, never stored — you sign in on their own page</Text>
            </View>
            <View style={styles.dotOn} />
          </View>
        </View>

        <View style={styles.group}>
          {/* "Chat with us" first: it answers in seconds, and Help is where a
              question goes when it needs a person. Putting the slower door first
              would send everybody down it. */}
          <Row icon="💬" title="Chat with us" sub="Ask a question and get an answer straight away"
            onPress={() => navigation.navigate('Chat')} />
          <Row icon="🆘" title="Help & support" sub="Ask a question about a claim or a payment"
            onPress={() => navigation.navigate('Support')} />
          <Row icon="📄" title="Terms & Conditions" sub={`Last updated ${POLICY_VERSION}`}
            onPress={() => navigation.navigate('Policy', { doc: 'terms' })} />
          <Row icon="🔒" title="Privacy Policy" sub="What we read, store and share"
            onPress={() => navigation.navigate('Policy', { doc: 'privacy' })} />
          {/* Shown to everybody, and useless to everybody but staff: the screen
              itself asks for a staff sign-in, and the server refuses an app login.
              Hiding it would mean guessing who is staff from the app side, which
              the app has no way to know. */}
          <Row icon="🔍" title="Check offer pages" sub="For Fayr staff. Opens every offer page to see if it still works"
            onPress={() => navigation.navigate('LiveCheck')} last />
        </View>

        <TouchableOpacity
          style={styles.logout}
          activeOpacity={0.85}
          onPress={doLogout}
          disabled={signingOut}
        >
          <Text style={styles.logoutText}>{signingOut ? 'Logging out…' : 'Log out'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/** "+91 98765 43210" from whatever E.164 shape the session holds. */
function formatMobile(m) {
  if (!m) return 'Your account';
  const digits = String(m).replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return 'Your account';
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  title: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.ink, marginTop: 6, marginBottom: 12 },

  idCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#fff',
    borderRadius: RADIUS.lg, paddingHorizontal: 15, paddingVertical: 14, ...SHADOW.card,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: COLOR.purpleBg,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarIcon: { fontSize: 24 },
  name: { fontFamily: FONT.displayXBold, fontSize: 18, color: COLOR.ink2 },
  nameSub: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.sub, marginTop: 2 },

  stats: { flexDirection: 'row', gap: 12, marginTop: 12 },
  stat: {
    flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.lg,
    padding: 16, alignItems: 'center', ...SHADOW.card,
  },
  statValue: { fontFamily: FONT.displayXBold, fontSize: 22, color: COLOR.ink },
  statLabel: { fontFamily: FONT.bodyMed, fontSize: 11.5, color: COLOR.sub, marginTop: 3 },

  group: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, marginTop: 12,
    overflow: 'hidden', ...SHADOW.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 15, paddingVertical: 14 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line },
  rowIcon: { fontSize: 19, width: 24, textAlign: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },
  rowSub: { fontFamily: FONT.bodyMed, fontSize: 11, color: COLOR.sub, marginTop: 1, lineHeight: 15 },
  chev: { color: '#b7b8aa', fontSize: 18 },

  privacy: {
    backgroundColor: '#F4FBF0', borderWidth: 1, borderColor: '#CBEBB8',
    borderRadius: RADIUS.lg, padding: 15, marginTop: 12,
  },
  privacyTitle: { fontFamily: FONT.display, fontSize: 14, color: COLOR.ink },
  privacyIntro: { fontFamily: FONT.bodyMed, fontSize: 11.5, color: COLOR.sub, marginTop: 4, marginBottom: 8 },
  privacyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.06)',
  },
  privacyName: { fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.ink2 },
  dotOn: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR.green },

  logout: {
    marginTop: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLOR.red,
    borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center',
  },
  logoutText: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.red },
});
