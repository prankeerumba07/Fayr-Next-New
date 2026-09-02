// THE SHEET THAT RISES FROM THE BOTTOM WHEN SOMEBODY TAPS CONNECT.
//
// DRAWN FROM TruecallerSheet, fayr-design.browser.jsx:631 to :649. Every number
// comes from src/connect/sheetWords.js, where each one has its own design line
// written beside it. Nothing here is invented.
//
// WHAT IT IS NOT, and this is the whole point. It is not a sign in. It is not an
// imitation of a shop's sign in, or of a shop's consent page, or of the phone's
// own boxes. It is Fayr saying, in Fayr's own design, what is about to happen and
// what it is for — and then the person taps once and lands on the shop's own real
// page at the shop's own real address, where the shop asks for the number and the
// code and Fayr never sees either.
import React, { useEffect, useRef } from 'react';
import {
  Animated, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';

import { COLOR, FONT, SHADOW } from '../ui/theme';
import { Pill, TextBtn } from '../ui/brand';
import { ShopMark } from '../ui/primitives';
import { PLATFORMS } from '../platforms';
import { SHEET, sheetWords } from './sheetWords.js';

export default function SignInSheet({
  visible, marketplace, onContinue, onClose, onTerms, onPrivacy,
}) {
  const shop = PLATFORMS[marketplace];
  const words = sheetWords(shop ? shop.name : marketplace);
  const rise = useRef(new Animated.Value(1)).current;

  // The design's own rise, :636: a third of a second, easing out of the bottom.
  useEffect(() => {
    if (!visible) { rise.setValue(1); return; }
    Animated.timing(rise, {
      toValue: 0,
      duration: SHEET.riseMs,
      useNativeDriver: true,
    }).start();
  }, [visible, rise]);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fill}>
        {/* THE DESIGN'S OWN TWO PARTS, :634 and :635: the dark layer over the page
            behind, and the empty room above the sheet, which closes it when
            tapped. The design blurs what is behind as well; that needs a native
            piece this app does not carry, so the dark layer is a little more
            solid instead. */}
        <Pressable
          style={styles.above}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{
                translateY: rise.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, SHEET.riseFrom],
                }),
              }],
              opacity: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            },
          ]}
        >
          {/* :637 — the little bar at the top. */}
          <View style={styles.grabber} />

          <Text style={styles.title}>{words.title}</Text>

          {/* :639 — the design puts a round tile here with a face in it. The shop's
              own mark goes in the same place, at the same size, because this sheet
              is about one shop. */}
          <ShopMark marketplace={marketplace} size={SHEET.markSize} style={styles.mark} />

          <Text style={styles.shopName}>{words.shopName}</Text>
          <Text style={styles.used}>{words.used}</Text>
          <Text style={styles.never}>{words.never}</Text>

          <View style={styles.buttonRow}>
            <Pill onPress={onContinue} color={COLOR.ink}>{words.button}</Pill>
          </View>
          <TextBtn onPress={onClose}>{words.away}</TextBtn>

          {/* :646 — the small print, and the design's own sentence from :626, with
              the two documents tappable. */}
          <Text style={styles.agree}>
            By continuing you agree to our{' '}
            <Text
              style={styles.link}
              onPress={onTerms}
              accessibilityRole="link"
            >
              Terms
            </Text>
            {' & '}
            <Text
              style={styles.link}
              onPress={onPrivacy}
              accessibilityRole="link"
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: SHEET.backdrop },
  above: { flex: 1 },

  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: SHEET.topRadius,
    borderTopRightRadius: SHEET.topRadius,
    paddingTop: SHEET.padTop,
    paddingHorizontal: SHEET.padSide,
    paddingBottom: SHEET.padBottom,
    alignItems: 'center',
    ...SHADOW.card,
  },
  grabber: {
    width: SHEET.grabberWidth,
    height: SHEET.grabberHeight,
    backgroundColor: SHEET.grabberColor,
    borderRadius: SHEET.grabberRadius,
    marginBottom: SHEET.grabberGapBelow,
  },
  title: {
    fontFamily: FONT.bodyBold, fontSize: SHEET.titleSize, color: COLOR.sub,
    textAlign: 'center',
  },
  mark: { marginTop: SHEET.markGapAbove, marginBottom: SHEET.markGapBelow },
  shopName: {
    fontFamily: FONT.displayXBold, fontSize: SHEET.nameSize, color: COLOR.ink2,
    textAlign: 'center',
  },
  // The design's own line under the name, :641: 13 across, 2 points below it.
  used: {
    fontFamily: FONT.bodyMed, fontSize: SHEET.underSize, lineHeight: 19,
    color: COLOR.sub, textAlign: 'center', marginTop: SHEET.underGapAbove,
  },
  // The second sentence, which the design has no room for. See SHEET.betweenLines.
  never: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17, color: COLOR.sub,
    textAlign: 'center', marginTop: SHEET.betweenLines,
  },
  buttonRow: { alignSelf: 'stretch', marginTop: SHEET.buttonGapAbove },
  agree: {
    fontFamily: FONT.body, fontSize: SHEET.noteSize, lineHeight: 16,
    color: SHEET.noteColor, textAlign: 'center', marginTop: SHEET.noteGapAbove,
  },
  link: { fontFamily: FONT.bodyBold, textDecorationLine: 'underline' },
});
