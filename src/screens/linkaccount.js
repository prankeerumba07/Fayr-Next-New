// linkaccount — fayr-design.browser.jsx:2281 (LinkAccount)
//
// The required step between claiming an offer and buying the product: connect the
// shop account you will buy from. Split out of src/journey/JourneyScreen.js on
// 1 September 2026, where it was one page of ten inside one file.
//
// EVERYTHING ON IT IS THE DESIGN'S: the heading, the "Required before you can
// buy" pill, the "What we never do" card and its three lines, the three reasons,
// the two-step footer, and the sentence under the button. Two departures, both
// because the design is a web preview and this is a phone:
//
//  1. The design opens the shop in a NEW BROWSER TAB and says so. Here the shop
//     opens inside Fayr, on the shop's own page, so the line says that instead.
//  2. The design draws the shop's real logo from an image file the app does not
//     have. ShopMark draws the same tile with the shop's own name and colour.
//
// ONE DELIBERATE IMPROVEMENT, and it closes a real hole. Until now merely OPENING
// the shop counted as connected, so somebody who tapped through and came straight
// back was moved on to "buy the product" having signed in to nothing. Opening the
// shop no longer counts. The person comes back, says they signed in, and only then
// does the journey move on — which is exactly the two steps the design draws.
//
// WHAT FAYR CAN SEE IS SAID IN PLAIN WORDS AND IS TRUE. The sign in happens on the
// shop's own page inside a web view. Fayr never sees the password and never types
// it. What it reads afterwards is the person's own orders and their own reviews,
// on this device, and nothing else.
//
// "GO TO <SHOP> NOW", which the owner asked for by name, appears on the second step
// — after the person says they have signed in, which is the moment the owner
// described. It opens the shop's own installed app by its own address, falling back
// to the website when that app is not there. See src/ui/shopApp.js for how sure we
// are about each address, and src/openShop.js for the fallback.
//
// WHAT IS NOT BUILT HERE, AND WHY, because it is the part the owner asked about most
// carefully. Two things:
//
//   RETURNING TO FAYR THE INSTANT THE SHOP'S SIGN IN SUCCEEDS. Fayr would have to
//   watch the sign in happen, and the only place that can see it is the web view in
//   src/ConnectScreen.js, which is frozen and is being rebuilt by the owner. It has
//   not been touched. What happens today: the person comes back themselves, by the
//   back arrow or the "Fayr home" button that is always in the header, and lands on
//   this screen's second step rather than anywhere on the shop.
//
//   CHECKING THAT THE ACCOUNT CONNECTED THROUGH FAYR IS THE ONE SIGNED IN TO THE
//   SHOP'S OWN APP. Fayr cannot see inside another app at all — no phone lets it —
//   so as asked this cannot be done by anybody. What CAN be done is remembering
//   which account Fayr connected and refusing to move on when a later reading shows
//   a different one, and the only thing that can read an account identity is the
//   same frozen web view. So this is waiting on the same file.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { SIGNED_IN, hasVisitedShop, markVisitedShop } from '../journey/shopVisits';
import { openShopApp } from '../openShop';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, TopBar, hSub, hTitle } from '../ui/brand';
import SignInSheet from '../connect/SignInSheet';
import { verifiedCardWords } from '../connect/sheetWords.js';
import { accountNameFor } from '../connect/accountName.js';
import { Screen, ShopMark } from '../ui/primitives';
import { appButtonLabel } from '../ui/shopApp';
import { goBackOrHome } from '../ui/nav';
import { deadlineLine } from '../ui/confirmJoin';
import { getAuthoritative } from '../taskStore';

/** The three lines in the design's blue "what we never do" card. */
function neverDo(shop) {
  return [
    `See or store your ${shop} password`,
    'Access, read, or place your orders',
    "Touch anything beyond confirming it's you",
  ];
}

/** The design's three reasons, in the design's order and words. */
function reasons(shop) {
  return [
    ['🛡️', 'Protects your refunds',
      `Makes sure only you can claim refunds against your ${shop} purchases — `
      + 'no one else can.'],
    ['🤝', 'Keeps campaigns fair',
      "Confirms one real person per claim, so bots and duplicates don't take the slots."],
    ['⚡', 'Just once',
      `Confirm once — every future ${shop} campaign skips this entirely.`],
  ];
}

export default function LinkAccountScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  // HOW LONG IS LEFT TO BUY, read from the claim's own record on the server and
  // never from a number written into this screen.
  const deadline = deadlineLine(getAuthoritative(campaignId), new Date());
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : params.marketplace || 'amazon';
  const shop = PLATFORMS[key] ? PLATFORMS[key].name : String(key);

  // THE VERIFIED CARD'S OWN WORDS. Read from the record of whether this shop was
  // connected for this claim, so coming back to the screen shows the card rather
  // than the button again.
  const [connected, setConnected] = useState(() => hasVisitedShop(campaignId, SIGNED_IN));
  const card = verifiedCardWords(shop, accountNameFor(key));

  // Two steps, as the design draws them. `sent` is true once the person has been
  // sent to the shop, so the second step is what they come back to.
  const [sent, setSent] = useState(false);
  // THE SHEET THAT COMES UP FIRST. Tapping connect no longer throws somebody
  // straight at a shop: the sheet says what the sign in is for, links to the two
  // documents, and carries one button. See src/connect/SignInSheet.js, which is
  // the design's own TruecallerSheet shape (fayr-design.browser.jsx:631).
  const [sheetUp, setSheetUp] = useState(false);

  // Re-render on the way back from the shop, so the second step is on screen.
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    return navigation.addListener('focus', () => setSent((was) => was));
  }, [navigation]);

  /** Tapping connect. The sheet comes up; nothing opens yet. */
  const askFirst = useCallback(() => setSheetUp(true), []);

  // GOING THERE TO SIGN IN, and saying so in one word. That word is what makes
  // the shop's own sign in page the one that opens instead of its shopping page.
  // See src/signin.js: a visit made to read somebody's orders keeps the page it
  // needs, and only a visit made to sign in is redirected.
  const openShop = useCallback(() => {
    setSheetUp(false);
    setSent(true);
    navigation.navigate(key, { campaignId, toSignIn: true });
  }, [navigation, key, campaignId]);

  const signedIn = useCallback(() => {
    // Only now does the journey move on. See the note at the top of this file.
    if (campaignId) markVisitedShop(campaignId, SIGNED_IN);
    setConnected(true);
    // Ask the journey to look again, exactly as returncatch does.
    if (params.onJourneyMoved) params.onJourneyMoved();
    else navigation.navigate('buyinterstitial', { campaignId });
  }, [campaignId, params, navigation]);

  const opens = PLATFORMS[key] ? PLATFORMS[key].startUrl : null;
  const openTheirApp = useCallback(async () => {
    if (campaignId) markVisitedShop(campaignId, SIGNED_IN);
    await openShopApp(key, opens);
  }, [key, opens, campaignId]);

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Connect your account" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <ShopMark marketplace={key} size={54} />
          <Text style={[hTitle, styles.title]}>Connect your{'\n'}{shop} account</Text>
        </View>

        <View style={styles.required}>
          <Text style={styles.requiredText}>🔒 Required before you can buy</Text>
        </View>

        {/* HOW LONG IS LEFT TO BUY, in one short line. The confirmation page
            carried the claim deadline in a card of its own; the owner took that
            page off the path on 2 September 2026, so the deadline says itself here
            instead, and on the before you go page, and at the slot reserved
            moment. All three use the same sentence from src/ui/confirmJoin.js so
            they cannot drift apart. Nothing is drawn when there is no deadline to
            state. */}
        {deadline ? <Text style={styles.deadline}>⏰ {deadline}</Text> : null}

        <Text style={[hSub, styles.lead]}>
          Before you shop on {shop}, connect the account you will buy from — the one
          using your Fayr number or email. This is a{' '}
          <Text style={styles.strong}>one time, required step</Text>, and you cannot
          continue to the purchase without it.
        </Text>

        <View style={styles.never}>
          <Text style={styles.neverTitle}>🔒 What we never do</Text>
          {neverDo(shop).map((line) => (
            <View key={line} style={styles.neverRow}>
              <Text style={styles.neverCross}>✕</Text>
              <Text style={styles.neverText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.reasons}>
          {reasons(shop).map(([icon, name, why]) => (
            <View key={name} style={styles.reason}>
              <Text style={styles.reasonIcon}>{icon}</Text>
              <View style={styles.flex}>
                <Text style={styles.reasonName}>{name}</Text>
                <Text style={styles.reasonWhy}>{why}</Text>
              </View>
            </View>
          ))}
        </View>

        {sent ? (
          <View style={styles.opened}>
            <Text style={styles.openedTitle}>✓ {shop} opened inside Fayr</Text>
            <Text style={styles.openedBody}>
              Sign in on {shop}&apos;s own page with the number or email you shop
              with there. Your password goes to {shop} and never to us. When you are
              signed in, come back and tap{' '}
              <Text style={styles.strong}>I have signed in</Text>.
            </Text>
          </View>
        ) : null}

        {/* THE VERIFIED CARD, once the person says they have signed in. It carries
            the name on the shop account when Fayr has been able to read it off the
            shop's own page, and when it has not it says the account is connected
            and shows no name at all. It never invents one and it never leaves an
            empty space where a name goes. See src/connect/accountName.js, which is
            also where the reason the name cannot be read yet is written down. */}
        {connected ? (
          <View style={styles.verified}>
            <View style={styles.verifiedTop}>
              <ShopMark marketplace={key} size={38} />
              <View style={styles.flex}>
                <Text style={styles.verifiedTitle}>{card.title}</Text>
                {card.showsName ? (
                  <Text style={styles.verifiedName}>{card.name}</Text>
                ) : null}
                <Text style={styles.verifiedUnder}>{card.under}</Text>
              </View>
              <TouchableOpacity
                onPress={askFirst}
                style={styles.manage}
                accessibilityRole="button"
                accessibilityLabel={`${card.manage} your ${shop} account`}
              >
                <Text style={styles.manageText}>{card.manage}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        {sent ? (
          <>
            <Pill onPress={signedIn} color={COLOR.greenDeep}>
              I HAVE SIGNED IN — CONTINUE →
            </Pill>
            {/* The owner's own wording. It opens the shop's installed app, and
                falls back to the website when that app is not there. */}
            <Ghost onPress={openTheirApp}>{appButtonLabel(key, shop)}</Ghost>
            <TextBtn onPress={openShop}>Did it not open? Open {shop} again</TextBtn>
          </>
        ) : (
          <Pill onPress={askFirst} color={COLOR.ink}>
            CONNECT MY {shop.toUpperCase()} ACCOUNT →
          </Pill>
        )}
        {/* The design has no "skip" or "not now" here and neither does this.
            Connecting is the only way forward; the back arrow cancels to the
            offer and never reaches a purchase. */}
        <Text style={styles.footNote}>
          Connecting your {shop} account is required to continue your purchase.
        </Text>
      </View>

      {/* THE SHEET THAT COMES UP FIRST, the design's own TruecallerSheet shape.
          Its one button is the only thing that opens the shop. */}
      <SignInSheet
        visible={sheetUp}
        marketplace={key}
        onContinue={openShop}
        onClose={() => setSheetUp(false)}
        onTerms={() => { setSheetUp(false); navigation.navigate('Policy', { doc: 'terms' }); }}
        onPrivacy={() => { setSheetUp(false); navigation.navigate('Policy', { doc: 'privacy' }); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 22 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  title: { flex: 1, fontSize: 22, lineHeight: 27 },

  required: {
    alignSelf: 'flex-start', marginTop: 12, backgroundColor: '#FFF3D6',
    borderWidth: 1, borderColor: '#EAD79A', borderRadius: RADIUS.round,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  deadline: {
    fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red, marginTop: 10,
  },
  requiredText: { fontFamily: FONT.displaySemi, fontSize: 11.5, color: '#8A6D10' },

  lead: { marginTop: 12 },
  strong: { fontFamily: FONT.bodyBold, color: COLOR.ink2 },

  never: {
    marginTop: SPACE.lg, backgroundColor: COLOR.blueBg, borderWidth: 1,
    borderColor: '#CBE0FF', borderRadius: RADIUS.lg, paddingHorizontal: 15,
    paddingVertical: 13,
  },
  neverTitle: {
    fontFamily: FONT.displaySemi, fontSize: 13, color: '#2F6FD0', marginBottom: 8,
  },
  neverRow: { flexDirection: 'row', gap: 8, paddingVertical: 3 },
  neverCross: { fontFamily: FONT.bodyBold, fontSize: 12, color: '#2F6FD0' },
  neverText: {
    flex: 1, fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17,
    color: '#3A5478',
  },

  reasons: { gap: 10, marginTop: 14 },
  reason: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 13, ...SHADOW.card,
  },
  reasonIcon: { fontSize: 19 },
  reasonName: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink2 },
  reasonWhy: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17, color: COLOR.sub,
    marginTop: 2,
  },

  opened: {
    marginTop: 14, backgroundColor: COLOR.greenBg, borderWidth: 1,
    borderColor: '#CDE9BE', borderRadius: RADIUS.md, paddingHorizontal: 14,
    paddingVertical: 12,
  },
  openedTitle: {
    fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.greenDeep,
    marginBottom: 4,
  },
  openedBody: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
  },

  verified: {
    marginTop: 14, backgroundColor: COLOR.greenBg, borderWidth: 1,
    borderColor: '#CDE9BE', borderRadius: RADIUS.lg, paddingHorizontal: 14,
    paddingVertical: 13,
  },
  verifiedTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  verifiedTitle: {
    fontFamily: FONT.displaySemi, fontSize: 10.5, letterSpacing: 0.4,
    color: COLOR.greenDeep,
  },
  verifiedName: {
    fontFamily: FONT.displayXBold, fontSize: 16, color: COLOR.ink2, marginTop: 1,
  },
  verifiedUnder: {
    fontFamily: FONT.bodyMed, fontSize: 11, lineHeight: 16, color: COLOR.sub,
    marginTop: 2,
  },
  manage: {
    borderWidth: 1, borderColor: '#CDE9BE', borderRadius: RADIUS.round,
    paddingHorizontal: 11, paddingVertical: 6, backgroundColor: '#fff',
  },
  manageText: { fontFamily: FONT.displaySemi, fontSize: 10.5, color: COLOR.greenDeep },

  foot: {
    paddingHorizontal: SPACE.xl, paddingTop: 10, paddingBottom: SPACE.xl, gap: 8,
  },
  footNote: {
    textAlign: 'center', marginTop: 9, fontFamily: FONT.bodySemi, fontSize: 10.5,
    lineHeight: 15, color: COLOR.sub,
  },
});
