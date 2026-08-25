// PhoneEntry — fayr-design.browser.jsx:651.
//
// The design already specifies the real backend call (POST /auth/otp/request) and
// the exact validation: 10 digits starting 6-9, the border turning green on valid
// and red only AFTER a failed attempt, the "9•••• •••••" grouping, and the ✓.
// All kept.
import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLOR, FONT, RADIUS, SHADOW } from '../ui/theme';
import { Pill, hSub, hTitle } from '../ui/brand';
import { requestOtp } from '../backend/authApi';
import { groupMobile, isValidMobile } from './mobile';

export default function PhoneEntryScreen({ initial, onBack, onSent }) {
  const insets = useSafeAreaInsets();
  const [num, setNum] = useState(initial || '');
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const valid = isValidMobile(num);

  const send = async () => {
    if (!valid) { setTouchedInvalid(true); return; }
    setError(''); setSending(true);
    const res = await requestOtp(num);
    setSending(false);
    if (res.ok) onSent && onSent(num, res.body);
    else {
      setError(
        (res.body && (res.body.message || res.body.error))
        || 'Couldn’t send the code. Please try again.',
      );
    }
  };

  const borderColor = touchedInvalid && !valid ? COLOR.red : valid ? COLOR.green : COLOR.line;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.back} activeOpacity={0.8} onPress={onBack}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>Enter your number</Text>
      </View>

      <View style={styles.body}>
        <Text style={hTitle}>What’s your mobile number?</Text>
        <Text style={hSub}>We’ll send a one-time code to verify.</Text>

        <View style={{ marginTop: 24 }}>
          <Text style={styles.label}>Mobile number</Text>
          <View style={[styles.field, { borderColor }]}>
            <Text style={styles.cc}>🇮🇳 +91</Text>
            <View style={styles.sep} />
            <TextInput
              autoFocus
              keyboardType="number-pad"
              placeholder="10-digit number"
              placeholderTextColor="#b9baa9"
              value={groupMobile(num)}
              onChangeText={(t) => { setNum(t.replace(/\D/g, '').slice(0, 10)); setTouchedInvalid(false); }}
              onSubmitEditing={send}
              maxLength={11} // 10 digits + the inserted space
              style={styles.input}
            />
            {valid ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          {touchedInvalid && !valid ? (
            <Text style={styles.err}>Please enter a valid 10-digit mobile number.</Text>
          ) : null}
        </View>

        {error ? <Text style={[styles.err, { marginTop: 12 }]}>{error}</Text> : null}

        <View style={{ flex: 1 }} />

        <Pill onPress={send} disabled={!valid || sending} color={valid && !sending ? COLOR.ink : '#cfcfcf'}>
          {sending ? 'SENDING…' : 'SEND OTP'}
        </Pill>
        {sending ? <ActivityIndicator style={{ marginTop: 10 }} color={COLOR.ink} /> : (
          <Text style={styles.note}>We’ll text a 6-digit code to this number.</Text>
        )}
        <View style={{ height: Math.max(insets.bottom, 20) }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 8 },
  back: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  barTitle: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.ink2 },
  body: { flex: 1, paddingHorizontal: 26, paddingTop: 6 },
  label: { fontFamily: FONT.bodyBold, fontSize: 12, color: COLOR.sub, marginBottom: 6 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff',
    borderWidth: 1.5, borderRadius: RADIUS.lg, paddingHorizontal: 16, paddingVertical: 14,
  },
  cc: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.ink2 },
  sep: { width: 1, height: 22, backgroundColor: COLOR.line },
  input: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 17, color: COLOR.ink2,
    letterSpacing: 0.7, padding: 0,
  },
  tick: { color: COLOR.green, fontFamily: FONT.bodyBold, fontSize: 15 },
  err: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.red, marginTop: 8 },
  note: { fontFamily: FONT.body, fontSize: 11, color: '#a9aa9c', textAlign: 'center', marginTop: 10 },
});
