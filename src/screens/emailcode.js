// emailcode — fayr-design.browser.jsx:2704 (EmailCode)
//
// The second half of connecting an inbox: the code that proves the inbox is really
// theirs. Built on 1 September 2026, exactly as the design draws it.
//
// THE DESIGN'S OWN SCREEN: the bar, the heading, the line naming the address with
// "Edit" beside it, the six boxes, the button that opens the mail app, and the
// resend line with the "check spam or promotions" hint.
//
// NOTHING HAS SENT A CODE, AND THE SCREEN SAYS SO. There is no route that sends one
// and nothing that could check one, so the boxes accept digits and go nowhere. That
// is stated at the top of the screen rather than left for somebody to discover by
// typing six digits and waiting.
//
// WHY BUILD IT AT ALL. Because the owner asked for every page in the design to
// exist and to work to its purpose, and because half a flow is not testable: with
// this screen missing, nobody could see what connecting an inbox will look like, or
// notice that the address needs to be editable from here, or that the mail app
// button matters on a phone where switching apps loses the code.
//
// TWO DEPARTURES:
//
//  * The design writes a resend countdown starting at 41 seconds into the file. How
//    long a code lasts is the server's business and nothing has told us, so the
//    countdown is handed in and the line says plainly when there is nothing to
//    count.
//  * The design's boxes each hold one digit in their own state. Here there is ONE
//    value and the boxes are drawn from it, so pasting a whole code works, which is
//    what people actually do with a code they were sent.
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { codeDigits, codeIsComplete, maskAddress } from '../ui/emailAddress';
import { countdown } from './otplocked';
import { goBackOrHome } from '../ui/nav';

const HOW_MANY = 6;

export default function EmailCodeScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const address = typeof params.email === 'string' ? params.email : null;
  const masked = address ? maskAddress(address) : null;
  // The design writes 41 seconds into the file. This is handed in, and when nothing
  // hands one in the line below says so instead of counting down from a guess.
  const left = countdown(
    typeof params.secondsLeft === 'number' ? params.secondsLeft : null,
  );

  const [typed, setTyped] = useState('');
  const boxes = useMemo(() => codeDigits(typed, HOW_MANY), [typed]);
  const complete = codeIsComplete(typed, HOW_MANY);

  const openMail = useCallback(() => {
    // The mail app, by the address scheme every phone understands. If nothing can
    // open it, nothing happens and the code is still typeable here.
    Linking.openURL('message://').catch(() => {
      Linking.openURL('mailto:').catch(() => {});
    });
  }, []);

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Check your inbox" onBack={() => goBackOrHome(navigation)} />
      <View style={styles.body}>
        <View style={styles.notSent}>
          <Text style={styles.notSentText}>
            No code has been sent. Connecting an inbox is not built yet, so this
            screen shows what it will look like and the boxes go nowhere.
          </Text>
        </View>

        <Text style={[hTitle, styles.title]}>Enter the six digit code</Text>
        <Text style={hSub}>
          {masked ? `Sent to ${masked}` : 'Sent to your inbox'}
          {'  '}
          <Text
            style={styles.edit}
            onPress={() => navigation.navigate('emailconnect', { campaignId })}
          >
            Edit
          </Text>
        </Text>

        {/* ONE value, six boxes drawn from it. A single hidden field means pasting
            a whole code works, which is what people do with a code they were sent;
            six separate fields each holding one digit cannot take a paste. */}
        <TouchableOpacity
          style={styles.boxes}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Enter the six digit code"
        >
          {boxes.map((digit, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <View key={i} style={[styles.box, digit !== '' && styles.boxFull]}>
              <Text style={styles.boxText}>{digit}</Text>
            </View>
          ))}
          <TextInput
            value={typed}
            onChangeText={setTyped}
            keyboardType="number-pad"
            maxLength={HOW_MANY}
            style={styles.hidden}
            accessibilityLabel="The six digit code"
          />
        </TouchableOpacity>

        <View style={styles.mailWrap}>
          <Ghost onPress={openMail}>Open my mail app</Ghost>
        </View>

        <Text style={styles.resend}>
          {left ? `You can ask for another in ${left}` : 'Ask for another code'}
          {'  ·  '}
          Cannot find it? Look in spam or promotions.
        </Text>

        {complete ? (
          <Text style={styles.wouldCheck}>
            That is six digits. When this is built, Fayr would check it here and
            your inbox would be connected.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24 },

  notSent: {
    backgroundColor: COLOR.amberBg, borderWidth: 1, borderColor: COLOR.amberLine,
    borderRadius: RADIUS.md, paddingHorizontal: 13, paddingVertical: 11,
    marginBottom: SPACE.lg,
  },
  notSentText: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: '#7A5A10',
  },

  title: { fontSize: 24, lineHeight: 29 },
  edit: { fontFamily: FONT.bodyBold, color: COLOR.greenDeep },

  boxes: {
    flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 26,
  },
  box: {
    width: 42, height: 54, borderRadius: 13, borderWidth: 1.5,
    borderColor: COLOR.line, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  boxFull: { borderColor: COLOR.green },
  boxText: { fontFamily: FONT.display, fontSize: 21, color: COLOR.ink2 },
  hidden: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0, fontSize: 1, color: 'transparent',
  },

  mailWrap: { marginTop: 18, alignSelf: 'center', minWidth: 200 },

  resend: {
    fontFamily: FONT.bodyMed, fontSize: 11, lineHeight: 17, color: '#A9AA9C',
    textAlign: 'center', marginTop: 12,
  },
  wouldCheck: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: COLOR.sub,
    textAlign: 'center', marginTop: 14,
  },
});
