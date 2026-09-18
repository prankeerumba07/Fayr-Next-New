// shop — the shop inside Fayr, as a step of the journey. Figma 74:60107.
//
// ── A DOOR, NOT A PAGE ──────────────────────────────────────────────────────
//
// The journey's router draws one design screen per step, and for the three
// quick-commerce shops the step after claiming is "you are in the shop". The
// shop itself is src/shop/ShopScreen.js — a full-screen web view with Fayr's bar
// across the top — and it cannot be drawn inside the journey's strip. So this
// screen does the one thing a step here has to do: it records the consent our
// side needs and hands over to the Shop route, through the same door the claim
// uses. See src/shop/enterTheShop.js.
//
// WHAT IT DRAWS is a moment's wait, and — only if our side refused to record the
// visit — the refusal in our side's own words and a way to try again. It never
// draws the shop and never decides anything about it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { enterTheShop } from '../shop/enterTheShop';
import { COLOR, SPACE } from '../ui/theme';
import { Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';
import { TRY_AGAIN } from '../ui/journeyWords';

export default function ShopStepScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const marketplace = campaign ? campaign.marketplace : params.marketplace || null;

  const [refusal, setRefusal] = useState(null);
  const opening = useRef(false);

  const open = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    setRefusal(null);
    const went = await enterTheShop({ campaignId, marketplace, navigation });
    opening.current = false;
    if (!went.ok) setRefusal(went.refusal);
  }, [campaignId, marketplace, navigation]);

  // ONCE, WHEN THE STEP IS REACHED, AND NOT ON EVERY RE-RENDER. The router
  // redraws on every change to the record; the door must not open twice for it.
  useEffect(() => { void open(); }, [open]);

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Opening the shop" onBack={() => goBackOrHome(navigation)} />
      <View style={styles.middle}>
        {refusal ? (
          <>
            <Text style={[hTitle, styles.title]}>We could not open the shop</Text>
            <Text style={[hSub, styles.sub]}>{refusal}</Text>
            <Pill onPress={open} color={COLOR.ink}>{TRY_AGAIN.toUpperCase()}</Pill>
          </>
        ) : (
          <ActivityIndicator size="large" color={COLOR.greenDeep} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACE.xl, gap: SPACE.md,
  },
  title: { textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 300 },
});
