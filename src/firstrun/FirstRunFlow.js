// The journey before a session exists: Splash → Onboarding → AuthLanding →
// PhoneEntry → Otp, in the design's order (fayr-design.browser.jsx §1–3).
//
// This lives OUTSIDE the NavigationContainer, because there is no navigator until
// the user is signed in — the same constraint that made the consent modal awkward
// earlier. So the sequence is a small explicit state machine rather than a stack,
// which also makes "no path dead-ends" (the design's Flow 2 note) checkable.
//
// Onboarding is shown once per install, not on every sign-out: a returning user
// who logs out should not have to sit through three slides again.
import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import SplashScreen from './SplashScreen';
import OnboardingScreen from './OnboardingScreen';
import AuthLandingScreen from './AuthLandingScreen';
import PhoneEntryScreen from './PhoneEntryScreen';
import OtpScreen from './OtpScreen';
// The design draws these as two screens of their own, not as states of the
// code screen. They are resolved from the one screen register, by their own
// design keys, like every other screen.
import OtpLockedScreen from '../screens/otplocked';
import BlockedScreen from '../screens/blocked';
import PolicyScreen from '../PolicyScreen';
import { hasSeenOnboarding, markOnboardingSeen } from './firstRunStore';
import { STEPS } from './steps';
import { ANIMATIONS_STEP, willSeeTheAnimations } from './opening';

export { STEPS };

export default function FirstRunFlow({ sessionRestoring }) {
  const [step, setStep] = useState('splash');
  // How long the server said the pause lasts, when it said. Null means it did
  // not, and the locked screen then says to try again shortly.
  const [lockedFor, setLockedFor] = useState(null);
  const [seen, setSeen] = useState(null); // null = still reading the flag
  const [mobile, setMobile] = useState('');
  const [resendIn, setResendIn] = useState(30);
  const [policyDoc, setPolicyDoc] = useState(null);

  useEffect(() => {
    let alive = true;
    hasSeenOnboarding().then((v) => { if (alive) setSeen(v); });
    return () => { alive = false; };
  }, []);

  // The splash doubles as the session-restore wait, so it must not hand over
  // while the keychain read is still in flight — otherwise a signed-in user sees
  // a flash of the sign-in screen before being let in.
  const leaveSplash = () => {
    if (seen === null || sessionRestoring) return;
    // Asked of opening.js, which is where the whole sequence is described and
    // where the test for it lives. Deciding it again here with its own `? :`
    // would be the second copy that drifts.
    setStep(willSeeTheAnimations(seen) ? ANIMATIONS_STEP : 'landing');
  };

  useEffect(() => {
    if (step !== 'splash') return;
    if (seen === null || sessionRestoring) return;
    // Flags resolved after the splash's own timer already fired — move on now.
    const t = setTimeout(leaveSplash, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, sessionRestoring, step]);

  const finishOnboarding = async () => {
    await markOnboardingSeen();
    setSeen(true);
    setStep('landing');
  };

  return (
    <View style={{ flex: 1 }}>
      {step === 'splash' ? <SplashScreen onDone={leaveSplash} /> : null}

      {step === 'onboarding' ? <OnboardingScreen onDone={finishOnboarding} /> : null}

      {step === 'landing' ? (
        <AuthLandingScreen
          onContinue={() => setStep('phone')}
          onOpenPolicy={(doc) => setPolicyDoc(doc)}
        />
      ) : null}

      {step === 'phone' ? (
        <PhoneEntryScreen
          initial={mobile}
          onBack={() => setStep('landing')}
          onSent={(num, body) => {
            setMobile(num);
            setResendIn((body && body.resendInSeconds) || 30);
            setStep('otp');
          }}
        />
      ) : null}

      {step === 'otp' ? (
        <OtpScreen
          mobile={mobile}
          resendIn={resendIn}
          onBack={() => setStep('phone')}
          // No navigation on success: setSession notifies the auth gate in App.js,
          // which swaps this whole flow out for the signed-in app.
          onVerified={() => {}}
          // A dead end must still offer a way out. There is no signed-in session
          // here, so Help (which needs auth) is unreachable — the honest action is
          // to go back and try another number.
          onSupport={() => setStep('phone')}
          onLocked={(seconds) => { setLockedFor(seconds); setStep('otplocked'); }}
          onBlocked={() => setStep('blocked')}
        />
      ) : null}

      {step === 'otplocked' ? (
        <OtpLockedScreen
          route={{
            params: {
              secondsLeft: lockedFor,
              // No signed-in session here, so Help is unreachable. Going back to
              // the number is the honest way out of a dead end.
              onSupport: () => setStep('phone'),
            },
          }}
        />
      ) : null}

      {step === 'blocked' ? (
        <BlockedScreen route={{ params: { onSupport: () => setStep('phone') } }} />
      ) : null}

      <Modal
        visible={policyDoc != null}
        animationType="slide"
        onRequestClose={() => setPolicyDoc(null)}
      >
        <PolicyScreen doc={policyDoc} onClose={() => setPolicyDoc(null)} />
      </Modal>
    </View>
  );
}
