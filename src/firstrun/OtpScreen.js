// Otp — fayr-design.browser.jsx:700, plus OtpLocked (:766) and Blocked (:781)
// as inline states rather than separate routes.
//
// The design specifies the whole fail ladder against the REAL backend, and it is
// reproduced exactly because it is the honest behaviour, not decoration:
//   403            → the account is blocked
//   "too many" / 5 → OTP entry is paused (the backend locks the challenge)
//   otherwise      → shake, clear, and say how many attempts are left
//
// The 30s resend cooldown matches OTP_RESEND_COOLDOWN_SECONDS, and a real resend
// re-reads `resendInSeconds` from the server rather than assuming 30.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fillOtp } from '../ui/otp';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, hSub, hTitle } from '../ui/brand';
import { requestOtp, verifyOtp } from '../backend/authApi';
import * as authSession from '../backend/authSession';

const N = 6;
const MAX_FAILS = 5; // the backend locks the challenge after five wrong tries

export default function OtpScreen({
  mobile, resendIn, onBack, onVerified, onSupport, onLocked, onBlocked,
}) {
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState(Array(N).fill(''));
  const [secs, setSecs] = useState(resendIn || 30);
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // NOT STATES OF THIS SCREEN ANY MORE. The design draws OtpLocked and Blocked as
  // two separate screens, and the owner's rule is that every page stays separate
  // and works according to its purpose. They now live at src/screens/otplocked.js
  // and src/screens/blocked.js, and this screen reports rather than renders.
  const refs = useRef(Array.from({ length: N }, () => React.createRef()));
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const runShake = () => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -4, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const submit = async (full) => {
    if (busy || full.length !== N) return;
    setBusy(true); setError('');
    const res = await verifyOtp(mobile, full);
    if (res.ok && res.body && res.body.accessToken) {
      // Establish the real session; the app's auth gate is subscribed to this.
      await authSession.setSession({
        user: res.body.user,
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
      });
      onVerified && onVerified(res.body);
      return;
    }
    setBusy(false);
    if (res.status === 403) { if (onBlocked) onBlocked(); return; }

    const msg = (res.body && (res.body.message || res.body.error)) || '';
    const next = fails + 1;
    setFails(next);
    runShake();
    setDigits(Array(N).fill(''));
    if (refs.current[0].current) refs.current[0].current.focus();
    if (/too many/i.test(String(msg)) || next >= MAX_FAILS) {
      // The server knows how long the pause is; when it says nothing, the
      // locked screen says to try again shortly rather than inventing a clock.
      if (onLocked) onLocked(res.body && res.body.retryAfterSeconds);
      return;
    }
    setError(String(msg) || 'That code didn’t match.');
  };

  // One path for every way digits can arrive: a keystroke, a paste, the iOS
  // keyboard suggestion, or Android sms-otp autofill. The old version kept only
  // the LAST character of whatever it was given, so a six-digit autofill left one
  // digit in one box. See src/ui/otp.js.
  const setAt = (i, v) => {
    const r = fillOtp(digits, i, v);
    setDigits(r.digits);
    const target = refs.current[r.focus] && refs.current[r.focus].current;
    if (target) target.focus();
    if (r.complete) submit(r.digits.join(''));
  };

  const resend = async () => {
    const res = await requestOtp(mobile);
    if (res.ok) {
      setError('');
      setSecs((res.body && res.body.resendInSeconds) || 30);
    } else {
      setError((res.body && res.body.message) || 'Couldn’t resend just now.');
    }
  };

  const shown = `+91 ${String(mobile || '').replace(/(\d{5})(\d{5})/, '$1 $2')}`;

  const full = digits.every((x) => x);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.back} activeOpacity={0.8} onPress={onBack}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>Verify OTP</Text>
      </View>

      <View style={styles.body}>
        <Text style={hTitle}>Enter the 6-digit code</Text>
        <Text style={hSub}>
          Sent to <Text style={styles.strong}>{shown}</Text> ·{' '}
          <Text style={styles.edit} onPress={onBack}>Wrong number? Edit</Text>
        </Text>

        <Animated.View style={[styles.boxes, { transform: [{ translateX: shake }] }]}>
          {digits.map((v, i) => (
            <TextInput
              key={i}
              ref={refs.current[i]}
              autoFocus={i === 0}
              value={v}
              keyboardType="number-pad"
              // iOS shows the code above the keyboard for this; Android fills it
              // from the SMS for autoComplete="sms-otp". Neither needs DLT or an
              // app hash — that was only ever about Android's silent SMS
              // Retriever, which stays a later problem.
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              importantForAutofill="yes"
              autoCorrect={false}
              onChangeText={(t) => setAt(i, t)}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace' && !v && i > 0 && refs.current[i - 1].current) {
                  refs.current[i - 1].current.focus();
                }
              }}
              style={[
                styles.box,
                { borderColor: fails > 0 && !v ? COLOR.red : v ? COLOR.green : COLOR.line },
              ]}
              maxLength={N}
              textAlign="center"
            />
          ))}
        </Animated.View>

        {error ? (
          <Text style={styles.err}>
            {error}
            {fails > 0 ? ` · ${Math.max(0, MAX_FAILS - fails)} attempts left` : ''}
          </Text>
        ) : (
          <Text style={styles.hint}>Enter the 6-digit code sent to your number.</Text>
        )}

        <Text style={styles.resend}>
          {secs > 0 ? (
            <>Resend code in <Text style={styles.strong}>0:{String(secs).padStart(2, '0')}</Text></>
          ) : (
            <Text style={styles.edit} onPress={resend}>Resend code</Text>
          )}
        </Text>

        {/* A dev-only note used to sit here saying "your 6-digit code is printed
            in the backend server console". It was written when no SMS provider
            was wired. One is now (SMS_PROVIDER=twilio), and that sender logs a
            masked number and a provider reference — never the code — so the line
            was simply false in the configuration this app actually runs in, and
            it was on screen while a demo says out loud that there is no shortcut
            behind it. Removed rather than reworded: the device is not told which
            sender the server used, so it cannot say anything true about where
            the code went. Making it truthful needs one additive field on the
            request-code response, which is a shape change and not mine to make
            unasked. The boot line already tells a developer, in the terminal
            where it matters: "Active sender: DEV — the code is printed in this
            terminal, no SMS is sent". */}

        <View style={{ flex: 1 }} />
        <Pill
          onPress={() => submit(digits.join(''))}
          disabled={!full || busy}
          color={full && !busy ? COLOR.ink : '#cfcfcf'}
        >
          {busy ? 'VERIFYING…' : 'VERIFY'}
        </Pill>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  strong: { fontFamily: FONT.bodyBold, color: COLOR.ink2 },
  edit: { fontFamily: FONT.bodyBold, color: COLOR.greenDeep },
  boxes: { flexDirection: 'row', gap: 8, marginTop: 26 },
  box: {
    flex: 1, height: 58, borderRadius: 13, borderWidth: 1.5, backgroundColor: '#fff',
    fontFamily: FONT.display, fontSize: 22, color: COLOR.ink2, padding: 0,
  },
  err: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.red, marginTop: 14 },
  hint: { fontFamily: FONT.body, fontSize: 11.5, color: '#a9aa9c', marginTop: 14 },
  resend: { fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: 10 },
});
