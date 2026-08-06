import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestOtp, verifyOtp } from './backend/authApi';
import { setSession } from './backend/authSession';
import {
  CODE_LENGTH,
  isValidIndianMobile,
  toE164,
  describeAuthError,
} from './backend/format';

// The Fayr-account sign-in — mobile number → OTP. This is the user's identity
// WITH THE BACKEND (needed to submit evidence); it is separate from the
// marketplace logins that happen later inside the WebView.
//
// On a successful verify this writes the session via setSession(); the app's
// auth gate (App.js) is subscribed and swaps to Home on its own, so no callback
// wiring is needed. `onAuthed` is accepted only as an optional hook for tests.
export default function AuthScreen({ onAuthed }) {
  const [step, setStep] = useState('mobile'); // 'mobile' | 'code'
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [cooldown, setCooldown] = useState(0); // seconds until resend allowed
  const codeRef = useRef(null);

  // Count the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const mobileValid = isValidIndianMobile(mobile);
  const codeValid = code.trim().length === CODE_LENGTH;

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await requestOtp(mobile);
    setBusy(false);
    if (res.ok) {
      const resend = Number(res.body && res.body.resendInSeconds);
      setCooldown(resend > 0 ? resend : 30);
      setStep('code');
      setCode('');
      // The dev backend logs the code to its console (no real SMS yet).
      setNote(`Code sent to ${toE164(mobile)}.`);
      return;
    }
    const info = describeAuthError(res.status, res.body);
    // A 429 means a code was JUST sent (within the cooldown) — a code already
    // exists, so move to entry and run the timer rather than dead-ending here.
    if (res.status === 429) {
      setCooldown(info.resendInSeconds && info.resendInSeconds > 0 ? info.resendInSeconds : 30);
      setStep('code');
      setNote('A code was already sent recently — enter it below, or wait to resend.');
      return;
    }
    setError(info.message);
  }, [mobile]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await verifyOtp(mobile, code);
    if (res.ok && res.body && res.body.accessToken && res.body.refreshToken) {
      await setSession({
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        user: res.body.user || null,
      });
      // App.js is subscribed to the session and will swap to Home. Keep the
      // spinner up through that swap so there's no flash of the form.
      if (typeof onAuthed === 'function') onAuthed(res.body.user || null);
      return;
    }
    setBusy(false);
    setError(describeAuthError(res.status, res.body).message);
  }, [mobile, code, onAuthed]);

  const changeNumber = useCallback(() => {
    setStep('mobile');
    setCode('');
    setError(null);
    setNote(null);
    setCooldown(0);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.brand}>fayr</Text>

          {step === 'mobile' ? (
            <>
              <Text style={styles.title}>Enter your mobile number</Text>
              <Text style={styles.sub}>We&apos;ll text you a 6-digit code to sign in.</Text>
              <View style={styles.mobileRow}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput
                  style={styles.mobileInput}
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="98765 43210"
                  placeholderTextColor="#bbb"
                  keyboardType="phone-pad"
                  autoFocus
                  maxLength={14}
                  returnKeyType="done"
                  onSubmitEditing={() => mobileValid && !busy && send()}
                />
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity
                style={[styles.primaryBtn, (!mobileValid || busy) && styles.btnDisabled]}
                onPress={send}
                disabled={!mobileValid || busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter the code</Text>
              <Text style={styles.sub}>
                Sent to {toE164(mobile)}.{' '}
                <Text style={styles.linkInline} onPress={changeNumber}>Change number</Text>
              </Text>
              <TextInput
                ref={codeRef}
                style={styles.codeInput}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                placeholder="••••••"
                placeholderTextColor="#ccc"
                keyboardType="number-pad"
                autoFocus
                maxLength={CODE_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => codeValid && !busy && verify()}
              />
              {note ? <Text style={styles.note}>{note}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity
                style={[styles.primaryBtn, (!codeValid || busy) && styles.btnDisabled]}
                onPress={verify}
                disabled={!codeValid || busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resendBtn}
                onPress={send}
                disabled={cooldown > 0 || busy}
                activeOpacity={0.7}
              >
                <Text style={[styles.resendText, (cooldown > 0 || busy) && styles.resendDisabled]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.footnote}>
          Your Fayr account. You&apos;ll connect your shopping accounts separately, later.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 72 },
  brand: { fontSize: 40, fontWeight: '800', color: '#111', letterSpacing: -1, marginBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: '#111' },
  sub: { fontSize: 15, color: '#666', marginTop: 8, marginBottom: 24, lineHeight: 21 },
  mobileRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#ddd',
    borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 14,
  },
  prefix: { fontSize: 18, fontWeight: '700', color: '#111', marginRight: 8 },
  mobileInput: { flex: 1, fontSize: 18, color: '#111', paddingVertical: 16, letterSpacing: 1 },
  codeInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 14, backgroundColor: '#fff',
    fontSize: 30, fontWeight: '700', color: '#111', textAlign: 'center',
    letterSpacing: 12, paddingVertical: 16,
  },
  primaryBtn: {
    marginTop: 24, borderRadius: 14, backgroundColor: '#111', paddingVertical: 17, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  btnDisabled: { backgroundColor: '#c7c7c7', shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  resendBtn: { marginTop: 18, alignItems: 'center', paddingVertical: 8 },
  resendText: { fontSize: 14, fontWeight: '700', color: '#111' },
  resendDisabled: { color: '#aaa' },
  linkInline: { color: '#2874F0', fontWeight: '700' },
  note: { fontSize: 13, color: '#0C831F', marginTop: 14, lineHeight: 18 },
  error: { fontSize: 13, color: '#b3261e', marginTop: 14, lineHeight: 18 },
  footnote: { fontSize: 12, color: '#999', paddingHorizontal: 24, paddingBottom: 20, lineHeight: 18 },
});
