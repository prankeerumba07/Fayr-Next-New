// returncatch — fayr-design.browser.jsx:2573 (ReturnCatch)
//
// "Did you buy it?" — the screen somebody comes back to from the shop. Built on
// 1 September 2026, on the owner's instruction: "When they come back to FAYR, they
// should see: Have you purchased the product?"
//
// IT WAS NOT BUILT BEFORE, and the reason it was skipped was wrong. The note in the
// walk through said the journey works out where somebody is from what the shop and
// the server say, so it never has to ask — and that saying yes without buying would
// let somebody skip ahead. The first half is true from the moment the shop tells us
// anything. It is NOT true in the gap before that, which is exactly where this
// screen sits: somebody who has just come back from the shop was being shown "Before
// you go", a screen about a trip they had already made.
//
// AND SAYING YES SKIPS NOTHING. It moves them one screen on. It does not create an
// order, does not confirm one, and does not move money: every one of those still
// needs the shop's own word, read by Fayr. What the answer really does is stop
// asking a question that has been answered.
//
// WHAT SAYING YES LEADS TO, since 2 September 2026. It used to go straight to
// "show us the order". Now Fayr has a look first: the shop's own list of recent
// orders is read on the phone, the server decides whether any of it is this
// offer's product, and if one is, the next screen shows it and asks "is this your
// order?". If not, the person is asked to show us, exactly as before, and nothing
// is ever explained about why — see src/order/LookingForItScreen.js.
//
// THE DESIGN'S OWN SCREEN: the product picture, the heading, the sentence naming
// the product, the green button and the quiet second action. One departure: the
// design says "so we can move you to Step 2", which is a number from its own seven
// step tracker and not this journey's. The sentence says what happens instead.
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { SAID_THEY_BOUGHT, markVisitedShop } from '../journey/shopVisits';
import { COLOR, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen, ProductImage } from '../ui/primitives';
import { WE_CANNOT_SEE_A_PURCHASE } from '../ui/journeyWords';
import { goBackOrHome } from '../ui/nav';
import { PLATFORMS } from '../platforms';
import { enterTheShop } from '../shop/enterTheShop';
import { shopsInsideFayr } from '../shop/insideFayr';

export default function ReturnCatchScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const product = campaign ? campaign.productName || campaign.title : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : null;

  const yes = useCallback(() => {
    if (campaignId) markVisitedShop(campaignId, SAID_THEY_BOUGHT);
    // THE NOTE IS WRITTEN FIRST, so the journey knows this was answered whatever
    // happens next. Then Fayr has a look. That screen always leaves by itself,
    // and it decides between showing an order it found and asking for one.
    navigation.navigate('LookingForIt', { campaignId });
  }, [campaignId, navigation]);

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <ProductImage
          imageUrl={campaign ? campaign.imageUrl : null}
          seed={campaignId}
          radius={20}
          style={styles.art}
        />
        {/* WHAT FAYR CANNOT SEE, SAID BEFORE IT ASKS — 21 September 2026.
            The owner's case: a payment that failed at the bank. Landing on a
            bare "Did you buy it?" after Fayr has already looked reads as though
            nothing had happened; saying what Fayr could not see first is what
            makes the question a next step rather than a doubt. The sentence is
            named from journeyWords.js, never retyped, because the plain
            language walk reads that file off disk. */}
        <Text style={[hSub, styles.cannot]}>{WE_CANNOT_SEE_A_PURCHASE}</Text>
        <Text style={[hTitle, styles.title]}>Did you buy it?</Text>
        <Text style={[hSub, styles.sub]}>
          {product
            ? `Tell us once your ${product} order is placed, and we will ask you to `
              + 'show us the order.'
            : 'Tell us once your order is placed, and we will ask you to show us '
              + 'the order.'}
        </Text>
      </View>
      <View style={styles.foot}>
        <Pill onPress={yes} color={COLOR.greenDeep}>YES, I HAVE BOUGHT IT ✓</Pill>
        {/* ── NO GOES BACK TO THE OFFER, AND THE CLAIM KEEPS RUNNING ──────
            21 September 2026, the owner's choice between two designs. The case
            this card is for is A PAYMENT THAT FAILED, not somebody changing
            their mind: a bank that timed out wants to try again in the next
            minute. So No moves nothing — no tickets, no seat, no claim — and
            lands on the offer, where the button already says Continue and walks
            straight back into the shop with the marketplace session untouched.

            THE OTHER DESIGN WAS CONSIDERED AND REFUSED: releasing the claim
            would return the five tickets and free the seat, then charge five
            again to re-claim, and on a one-slot offer it opens that seat to
            everybody in the gap. That punishes a failed payment as though it
            were abandonment.

            AND IT LANDS ON THE OFFER RATHER THAN HOME. goBackOrHome put them a
            tap further away from the one thing they came back to do. */}
        {/* ── AND THE WAY BACK INTO THE SHOP — 21 SEPTEMBER 2026 ──────────
            THE DEAD END THIS CLOSES, and it was mine. Earlier today the buy
            step's fallback for a shop inside Fayr was moved from the
            screenshot screen to this card, because asking somebody whose
            payment failed to photograph an order is asking for a thing that
            does not exist. The screenshot screen carried a door back into the
            shop — added 18 September after an adversarial review found exactly
            this dead end — and moving the route left the door behind.

            The owner, within the hour: "I can't continue and complete the
            purchase from my end. When I click on 'Continue', it directly takes
            me to the page where it asks, 'Did you buy it?'" Yes re-ran a read
            that finds nothing, No went back to the offer whose Continue lands
            here again. A loop with no way into the shop.

            THE SAME DOOR, THROUGH THE SAME enterTheShop the claim itself uses,
            and only for a shop whose shopping happens inside Fayr. The four
            shops somebody leaves Fayr for keep their own path exactly as it
            was — their buy step is buyinterstitial, which opens the shop's own
            app, and nothing here changes it. */}
        {shopsInsideFayr(key) ? (
          <Ghost onPress={() => enterTheShop({ campaignId, marketplace: key, navigation })}>
            Go back to {shop} and try again
          </Ghost>
        ) : null}
        {/* popTo, NOT navigate. On @react-navigation/native 7.3.16 a NAVIGATE
            only reuses an existing route when the target name equals the CURRENT
            route's name, or when the action carries `pop` — so navigate() pushed
            a SECOND Detail on top of this screen and the arrow there came back
            here instead of leaving. See the same note in delivery.js. */}
        <TextBtn onPress={() => (campaignId
          ? navigation.popTo('Detail', { campaignId })
          : goBackOrHome(navigation))}
        >
          Not yet — take me back
        </TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  art: { width: 92, height: 92 },
  // Quieter than the question under it: it is context, not the thing being asked.
  cannot: { marginTop: 18, textAlign: 'center', maxWidth: 270, opacity: 0.85 },
  title: { marginTop: 6, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 270 },
  foot: { paddingHorizontal: 28, paddingBottom: 28, gap: SPACE.xs },
});
