// The wallet: what you have, where it is going, and how to ask for it.
//
// Every rule lives on the backend already (minimum, balance re-check under a row
// lock, PAN anchoring, cross-user dedup). This screen reads, renders and posts —
// it does not decide. What to SHOW is decided in one tested place,
// src/ui/wallet.js, because a screen can't be imported under node.
//
// The first version deliberately withdraws the FULL balance: no amount field, so
// there is no min/max/format/more-than-balance validation to get wrong, and the
// request can never exceed what is actually available.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Card, Pill, SectionTitle } from './ui/primitives';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './ui/theme';
import { formatPaise } from './money';
import { getWallet } from './backend/meApi';
import {
  addPayoutMethod, getPayoutMethods, getWithdrawals, requestWithdrawal,
} from './backend/withdrawalsApi';
import { walletView } from './ui/wallet';

const money = (paise) => `₹${formatPaise(paise) || '0.00'}`;

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const TONE_STYLE = {
  ok: { bg: COLOR.refundBg, ink: COLOR.refundInk },
  warn: { bg: COLOR.amberBg, ink: '#8A5A00' },
  bad: { bg: COLOR.redBg, ink: COLOR.red },
  info: { bg: COLOR.blueBg, ink: '#1F5FBF' },
};

function StatusChip({ tone, children }) {
  const t = TONE_STYLE[tone] || TONE_STYLE.info;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.ink }]}>● {children}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, maxLength }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A5A597"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize || 'none'}
        autoCorrect={false}
        maxLength={maxLength}
      />
    </View>
  );
}

export default function WalletScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [type, setType] = useState('UPI');
  const [pan, setPan] = useState('');
  const [upiId, setUpiId] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountName, setAccountName] = useState('');

  // Three reads, always together: a balance without its in-flight withdrawals is
  // the vanishing-money bug, so they are never fetched or rendered apart.
  const load = useCallback(async () => {
    const [w, l, m] = await Promise.all([getWallet(), getWithdrawals(), getPayoutMethods()]);
    if (w.ok) setWallet(w);
    setWithdrawals(l.withdrawals);
    setMethods(m.methods);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const view = walletView({ wallet, withdrawals, payoutMethods: methods });

  const onWithdraw = useCallback(async () => {
    if (!view.canWithdraw || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await requestWithdrawal({
      amountPaise: view.withdrawAmountPaise,
      payoutMethodId: view.methods[0].id,
    });
    if (res.ok) {
      setNotice(`${money(view.withdrawAmountPaise)} requested. A Fayr reviewer approves it, then it is paid out.`);
    } else {
      setError(res.error);
    }
    await load(); // re-read BOTH numbers, so the reserve shows up as "on its way"
    setBusy(false);
  }, [view, busy, load]);

  const onAddMethod = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await addPayoutMethod({
      type,
      pan: pan.trim().toUpperCase(),
      upiId: upiId.trim(),
      bankAccount: bankAccount.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      accountName: accountName.trim(),
    });
    if (res.ok) {
      setAddOpen(false);
      setPan(''); setUpiId(''); setBankAccount(''); setIfsc(''); setAccountName('');
      setNotice('Payout details saved.');
    } else {
      setError(res.error); // verbatim: "PAN is already linked to another account"
    }
    await load();
    setBusy(false);
  }, [busy, type, pan, upiId, bankAccount, ifsc, accountName, load]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
          style={[styles.header, { paddingTop: insets.top + 8 }]}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Your wallet</Text>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: SPACE.xl }} color={COLOR.ink} />
          ) : (
            <View style={styles.balanceBlock}>
              <Text style={styles.balanceLabel}>Available to withdraw</Text>
              <Text style={styles.balanceBig}>{money(view.availablePaise)}</Text>
              {/* Rendered whenever money is in flight — the reserve is why the
                  number above can read ₹0.00 while nothing has been lost. */}
              {view.onTheWayPaise > 0 ? (
                <Text style={styles.onTheWay}>
                  + {money(view.onTheWayPaise)} on its way to you · {money(view.totalPaise)} in total
                </Text>
              ) : null}
            </View>
          )}
        </LinearGradient>

        <View style={styles.body}>
          {error ? (
            <TouchableOpacity style={styles.error} onPress={() => setError(null)} activeOpacity={0.85}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorDismiss}>Tap to dismiss</Text>
            </TouchableOpacity>
          ) : null}
          {notice ? (
            <TouchableOpacity style={styles.notice} onPress={() => setNotice(null)} activeOpacity={0.85}>
              <Text style={styles.noticeText}>{notice}</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── withdraw ── */}
          {view.canWithdraw ? (
            <Pill onPress={onWithdraw} loading={busy} color={COLOR.greenDeep}>
              {`Withdraw ${money(view.withdrawAmountPaise)}`}
            </Pill>
          ) : (
            <Card style={styles.blockedCard}>
              <Text style={styles.blockedText}>{view.blockedReason}</Text>
            </Card>
          )}

          {/* ── payout destination ── */}
          <SectionTitle style={{ marginTop: SPACE.xxl }}>Where we pay you</SectionTitle>
          {view.methods.map((m) => (
            <Card key={m.id} style={styles.methodCard}>
              <Text style={styles.methodType}>{m.type === 'UPI' ? 'UPI' : 'Bank account'}</Text>
              <Text style={styles.methodLabel}>{m.label}</Text>
            </Card>
          ))}

          {!addOpen ? (
            <TouchableOpacity style={styles.ghost} onPress={() => setAddOpen(true)} activeOpacity={0.85}>
              <Text style={styles.ghostText}>
                {view.hasPayoutMethod ? 'Add another destination' : 'Add UPI or bank details'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Card style={styles.form}>
              <View style={styles.toggleRow}>
                {['UPI', 'BANK'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setType(t)}
                    style={[styles.toggle, type === t && styles.toggleOn]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.toggleText, type === t && styles.toggleTextOn]}>
                      {t === 'UPI' ? 'UPI' : 'Bank'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {type === 'UPI' ? (
                <Field label="UPI ID" value={upiId} onChangeText={setUpiId} placeholder="name@bank" />
              ) : (
                <>
                  <Field label="Account holder name" value={accountName} onChangeText={setAccountName}
                    placeholder="As printed on your passbook" autoCapitalize="words" maxLength={120} />
                  <Field label="Account number" value={bankAccount} onChangeText={setBankAccount}
                    placeholder="Account number" keyboardType="number-pad" maxLength={20} />
                  <Field label="IFSC" value={ifsc} onChangeText={setIfsc}
                    placeholder="e.g. HDFC0001234" autoCapitalize="characters" maxLength={11} />
                </>
              )}

              <Field label="PAN" value={pan} onChangeText={setPan}
                placeholder="ABCDE1234F" autoCapitalize="characters" maxLength={10} />
              {/* Say why, and say it is permanent. PAN anchors one person to one
                  account (fraud loophole 1) — it is checked against every other
                  account, and it is not editable from the app afterwards. */}
              <Text style={styles.panNote}>
                Your PAN confirms this wallet belongs to one person. Check it before saving — it stays
                linked to your account.
              </Text>

              <Pill onPress={onAddMethod} loading={busy} color={COLOR.ink}>Save payout details</Pill>
              <TouchableOpacity onPress={() => setAddOpen(false)} style={styles.cancel} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </Card>
          )}

          {/* ── withdrawal history ── */}
          <SectionTitle style={{ marginTop: SPACE.xxl }}>Withdrawals</SectionTitle>
          {view.history.length === 0 ? (
            <Text style={styles.empty}>Nothing yet. Your refunds arrive in this wallet first.</Text>
          ) : (
            view.history.map((h) => (
              <Card key={h.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowAmount}>{money(h.amountPaise)}</Text>
                  <StatusChip tone={h.tone}>{h.label}</StatusChip>
                </View>
                {fmtDate(h.requestedAt) ? (
                  <Text style={styles.rowMeta}>Requested {fmtDate(h.requestedAt)}</Text>
                ) : null}
                {h.utr ? <Text style={styles.rowMeta}>Reference {h.utr}</Text> : null}
                {h.failureReason ? <Text style={styles.rowFail}>{h.failureReason}</Text> : null}
              </Card>
            ))
          )}

          {/* Deliberately explicit: a refund lands here, it is not sent to a bank
              on its own. The old screen implied money moved by itself. */}
          <Text style={styles.footnote}>
            Refunds land in this wallet. Ask for a withdrawal and a Fayr reviewer sends it to the
            details above. Minimum withdrawal {money(10000)}.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  headerTitle: { fontFamily: FONT.display, fontSize: 19, color: COLOR.ink },

  balanceBlock: { marginTop: SPACE.xl, alignItems: 'center' },
  balanceLabel: { fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.sub },
  balanceBig: { fontFamily: FONT.displayXBold, fontSize: 40, color: COLOR.ink, marginTop: 2 },
  onTheWay: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.refundInk, marginTop: 6, textAlign: 'center' },

  body: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg },

  error: { backgroundColor: COLOR.redBg, borderRadius: RADIUS.md, padding: SPACE.md, marginBottom: SPACE.md },
  errorText: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.red },
  errorDismiss: { fontFamily: FONT.body, fontSize: 11, color: COLOR.red, marginTop: 4, opacity: 0.8 },
  notice: { backgroundColor: COLOR.greenBg, borderRadius: RADIUS.md, padding: SPACE.md, marginBottom: SPACE.md },
  noticeText: { fontFamily: FONT.bodyMed, fontSize: 14, color: COLOR.refundInk },

  blockedCard: { backgroundColor: COLOR.surface },
  blockedText: { fontFamily: FONT.bodyMed, fontSize: 14, color: COLOR.sub },

  methodCard: { marginBottom: SPACE.sm },
  methodType: { fontFamily: FONT.bodySemi, fontSize: 11, color: COLOR.sub, letterSpacing: 0.6 },
  methodLabel: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink, marginTop: 3 },

  ghost: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.pill,
    paddingVertical: 13, alignItems: 'center', backgroundColor: COLOR.surface,
  },
  ghostText: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },

  form: { backgroundColor: COLOR.surface },
  toggleRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  toggle: {
    flex: 1, paddingVertical: 10, borderRadius: RADIUS.pill, alignItems: 'center',
    borderWidth: 1, borderColor: COLOR.line, backgroundColor: COLOR.cream,
  },
  toggleOn: { backgroundColor: COLOR.ink, borderColor: COLOR.ink },
  toggleText: { fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.ink },
  toggleTextOn: { color: '#fff' },

  field: { marginBottom: SPACE.md },
  fieldLabel: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.sub, marginBottom: 5 },
  input: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md, paddingVertical: 11,
    fontFamily: FONT.body, fontSize: 15, color: COLOR.ink, backgroundColor: COLOR.cream,
  },
  panNote: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub, marginBottom: SPACE.md, lineHeight: 17 },
  cancel: { alignItems: 'center', paddingVertical: SPACE.md },
  cancelText: { fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.sub },

  row: { marginBottom: SPACE.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  rowAmount: { fontFamily: FONT.displaySemi, fontSize: 17, color: COLOR.ink },
  rowMeta: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub, marginTop: 4 },
  rowFail: { fontFamily: FONT.bodyMed, fontSize: 12, color: COLOR.red, marginTop: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  chipText: { fontFamily: FONT.bodySemi, fontSize: 11 },

  empty: { fontFamily: FONT.body, fontSize: 13, color: COLOR.sub },
  footnote: {
    fontFamily: FONT.body, fontSize: 12, color: COLOR.sub,
    marginTop: SPACE.xxl, lineHeight: 18,
  },
});
