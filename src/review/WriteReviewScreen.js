// WRITE YOUR REVIEW — the one screen where somebody's own words are typed.
//
// ── WHY THIS SCREEN EXISTS AT ALL ───────────────────────────────────────────
//
// Zepto, Blinkit and Swiggy Instamart have no review form. All they take is a
// private star rating on the order, which nobody but the buyer can ever see. So
// for those shops the written review is written HERE and stays with Fayr; the
// shop gets the stars, and this descriptive feedback is the thing a brand is
// actually paying for.
//
// It is not one of the design's sixty one screens — the design assumed the
// review is written at the shop — so it lives here rather than in src/screens/,
// which is only for those. It follows the design's palette and the house style.
//
// ── FAYR NEVER WRITES ANYBODY'S REVIEW ──────────────────────────────────────
//
// No suggestions, no autocomplete, no templates, no example sentences, no
// generated text, nothing to tap that puts words in the box. The entire company
// rests on these being real opinions from real people who really used the thing,
// and a review Fayr helped write is the exact fraud it exists to replace.
//
// What the screen MAY do, and does, is name CATEGORIES worth thinking about —
// how it held up over time, how it compares with what they used before. Those
// come from src/review/theFayrScore.js's MISSING table, they are prompts to
// think rather than words to copy, and there is a check that refuses any of them
// that carries a quotable phrase.
//
// ── AND IT WARNS, IT NEVER BLOCKS ───────────────────────────────────────────
//
// A thin review is scored thin and said to be thin. The button is never
// disabled, nothing is hidden, nothing is refused, and a person may send exactly
// what they wrote. The owner chose this over blocking. There is a check that the
// button's `disabled` never depends on the score.
//
// ── THE SCORE ON SCREEN IS THE APP'S, AND IT IS NOT WHAT IS STORED ─────────
//
// This one updates as they type, which cannot be a network call per keystroke.
// It is never sent. The server works out its own from the text it stores, and
// what comes back is what is kept. The two are the same rules and one shared
// fixture table keeps them from drifting — see src/review/score-fixtures.json.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getReview, putReview } from '../backend/reviewsApi';
import { getAuthoritative, getTaskId } from '../taskStore';
import { WENT_TO_REVIEW, markVisitedShop } from '../journey/shopVisits';
import { goingToTheReview } from '../backend/tasksApi';
import { theWatchedOrderKey } from '../order/whichRead';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';
// THE CLIPBOARD, THROUGH THE ONE FILE THAT ALREADY OWNS IT.
//
// NOT openShop.js's copyProductName, and that is a deliberate choice rather than
// an oversight. That path runs the string through ui/shopApp.js's whatToCopy,
// which collapses every run of whitespace and trims the ends — exactly right for
// a product name going into a search box, and exactly wrong here, where the rule
// is that what lands on the clipboard is what they typed, character for
// character. ui/clipboard.js is the existing verbatim path: it hands
// Clipboard.setString the string it was given and changes nothing about it.
import { copyToClipboard } from '../ui/clipboard';
import { FAIR, STRONG, THIN, theFayrScore } from './theFayrScore';

/** What each band is called on screen, and how it is drawn. */
const BAND_WORD = {
  [THIN]: 'Thin',
  [FAIR]: 'Fair',
  [STRONG]: 'Strong',
};
const BAND_COLOUR = {
  [THIN]: COLOR.sub,
  [FAIR]: COLOR.amber,
  [STRONG]: COLOR.greenDeep,
};

export default function WriteReviewScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const taskId = campaignId ? getTaskId(campaignId) : null;
  const product = campaign
    ? campaign.productName || campaign.title || null
    : null;

  const [text, setText] = useState('');
  // ── THE STARS, AND NOTHING IS CHOSEN FOR THEM ────────────────────────────
  //
  // null means they have not said, and that is where it starts and where it can
  // always be put back. NOT 0, which would be a rating; not 5, which would be
  // Fayr asking for a number. Nothing on this screen suggests which one to pick.
  const [stars, setStars] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState(null);

  // What they wrote last time, if anything. Rewriting is allowed on purpose:
  // somebody who thinks of something else an hour later should be able to add it.
  useEffect(() => {
    let alive = true;
    if (!taskId) { setLoading(false); return undefined; }
    getReview(taskId).then((r) => {
      if (!alive) return;
      if (r.ok && r.review && typeof r.review.text === 'string') setText(r.review.text);
      // Only a real 1-5 comes back as a choice. Null stays null: "they have not
      // said" is not the same fact as "they gave it nothing".
      if (r.ok && r.review && typeof r.review.stars === 'number') setStars(r.review.stars);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [taskId]);

  // THE APP'S OWN ANSWER, as they type. Never sent anywhere.
  const scored = useMemo(() => theFayrScore(text), [text]);

  const send = useCallback(async () => {
    if (!taskId) return;
    setSaving(true);
    setRefusal(null);
    // EXACTLY WHAT THEY TYPED. No trim, no tidying — the same rule the server
    // keeps on the way in.
    const answer = await putReview(taskId, text, stars);
    setSaving(false);
    if (answer.ok) { setSaved(true); return; }
    // THE SERVER'S OWN SENTENCE, when it gave one. It knows why it refused and
    // this screen does not.
    setRefusal(answer.error || null);
  }, [taskId, text, stars]);

  /**
   * COPY IT, EXACTLY AS IT IS IN THE BOX.
   *
   * ── AND IT IS INDEPENDENT OF SAVING ────────────────────────────────────
   *
   * Copying does not require saving first and saving does not require copying.
   * There is no ordering between them and no state that one sets and the other
   * reads. Somebody who wants the words on their clipboard and nothing else may
   * have exactly that.
   *
   * `text` ITSELF, not a tidied copy of it. The clipboard gets what is in the
   * box, character for character — the same rule the server keeps on the way in
   * and the response keeps on the way out.
   */
  const copy = useCallback(() => {
    setCopied(copyToClipboard(text));
  }, [text]);

  /**
   * ── ONE TAP: THE REVIEW GOES TO THE CLIPBOARD, AND THAT ORDER'S PAGE OPENS ──
   *
   * PHASE 7, TASK 5, 18 SEPTEMBER 2026 — the one genuinely new behaviour of the
   * phase, in the owner's words: "ONE tap: the review is copied AND that same
   * tap opens that order's own page at the shop, inside Fayr -> they rate,
   * paste, submit -> coming back, Fayr verifies it by itself."
   *
   * THE COPY IS THE SAME COPY. copyToClipboard, the box's own `text`, verbatim
   * — the identical call the COPY MY REVIEW control makes, so there is one idea
   * of what lands on the clipboard and the checks that pin it pin both.
   *
   * THE PAGE IS THE ORDER'S OWN, NOT THE SHOP'S FRONT DOOR. The KEY of the
   * order Fayr watched being placed is on the record; ShopScreen turns it into
   * the page's address through the measured shape in detailLook.js, and lands
   * there. That is a different landing from a shopping session's, on purpose —
   * see src/shop/theOrderPage.js.
   *
   * THE KEY, NOT THE NUMBER — CORRECTED 19 SEPTEMBER 2026, PHASE 8A. Phase 7
   * handed over `task.order.id`, the order NUMBER the page prints. A Zepto
   * order's page is addressed by the UUID in its link, a different string, so
   * the door opened on a page that does not exist. The two identifiers are kept
   * apart on our side (tasks.orderId, tasks.watchedOrderKey) and here.
   *
   * THE LABEL IS THE OWNER'S OWN: "Copy and add review for this product".
   *
   * AND OUR SIDE IS TOLD THEY LEFT FOR THE REVIEW, with the same request the
   * old "OPEN ZEPTO →" door made, so the record carries wentToReviewAt exactly
   * as before. It does not refuse to open when that fails: nothing about the
   * money hangs off it — see goingToWriteIt in reviewguide.js for the argument.
   *
   * NOTHING HERE SAYS THE REVIEW IS POSTED. Coming back from the order page runs
   * the review read, and the read decides.
   */
  const copyAndOpenTheOrder = useCallback(async () => {
    // ── IT SAVES FIRST, AND THAT IS THE WHOLE POINT OF SAVING ───────────────
    //
    // 20 SEPTEMBER 2026, THE OWNER, AFTER RUNNING IT HIMSELF. "There should not
    // be any option for 'Save my review'. Once the user clicks on the option
    // 'Copy' and is redirected to the Zepto product page, it automatically
    // saves the review the user has given for the product."
    //
    // AND HIS REASON, WHICH IS THE REAL ONE: "at the time of refunding the
    // money to the wallet, the backend will check for the last time if the
    // review is there or not. We already have that review which the user has
    // given here in the Fayr app, and then they have pasted it there ... we can
    // check if the review has been edited, updated, removed, or deleted."
    //
    // The saved words are the ONLY copy Fayr has of what was supposed to be
    // posted. Without them the clawback check at the end of the hold has
    // nothing to compare the shop's page against — it can see THAT something is
    // there, never that it is still the same thing. So the tap that sends
    // somebody off to paste is exactly the tap that must write it down.
    //
    // HIS OWN RUN PROVED THE GAP. He wrote a review, tapped this, pasted it on
    // Zepto and submitted — and task_reviews still had 0 rows, because saving
    // lived behind a separate button he had no reason to press.
    //
    // IT DOES NOT BLOCK THE DOOR. A refused save leaves its sentence on screen
    // and the order page still opens: somebody standing in a shop with their
    // words on the clipboard must not be stranded because our side was
    // unreachable. The consequence is stated rather than hidden — with nothing
    // saved, the end-of-hold check can only confirm a review exists, and that
    // is the honest weaker answer, not a silent one.
    await send();
    setCopied(copyToClipboard(text));
    if (campaignId) markVisitedShop(campaignId, WENT_TO_REVIEW);
    if (taskId) await goingToTheReview(taskId);
    const task = campaignId ? getAuthoritative(campaignId) : null;
    const orderKey = theWatchedOrderKey(task);
    navigation.navigate('Shop', {
      campaignId,
      marketplace: campaign ? campaign.marketplace : null,
      land: 'order',
      orderKey,
    });
  }, [send, text, campaignId, taskId, campaign, navigation]);

  if (loading) {
    return (
      <Screen bg={COLOR.homeBg}>
        <TopBar title="Write your review" onBack={() => goBackOrHome(navigation)} />
        <View style={styles.middle}><ActivityIndicator size="large" color={COLOR.ink} /></View>
      </Screen>
    );
  }

  return (
    <Screen bg={COLOR.homeBg}>
      <TopBar title="Write your review" onBack={() => goBackOrHome(navigation)} />
      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text style={[hTitle, styles.title]}>Share your honest review</Text>
          {product ? <Text style={[hSub, styles.product]}>{product}</Text> : null}
          <Text style={hSub}>
            Say exactly what you think. A low rating and a high one are paid the
            same, and a review that says what was wrong is worth more to us than
            one that says everything was fine.
          </Text>

          <TextInput
            style={styles.box}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            placeholder="What was it like to use?"
            placeholderTextColor="#A9AA9C"
            autoCorrect
            autoCapitalize="sentences"
          />

          {/* ── THE SCORE, AS THEY TYPE ────────────────────────────────────
              A band and a number. It tells them how DESCRIPTIVE the review is
              and never how positive: a one-star review that says what went
              wrong scores higher than a five-star one that says nothing. */}
          <View style={styles.scoreRow}>
            <Text style={[styles.band, { color: BAND_COLOUR[scored.band] }]}>
              {BAND_WORD[scored.band]}
            </Text>
            <Text style={styles.scoreNum}>{scored.score} / 100</Text>
          </View>
          <Text style={styles.scoreNote}>
            This measures how much your review describes, not how positive it is.
          </Text>

          {/* ── CATEGORIES TO THINK ABOUT, NEVER WORDS TO COPY ─────────────
              Every line here is a KIND of thing worth mentioning, taken from
              theFayrScore.js's own table. Fayr does not suggest words, does not
              complete a sentence and does not offer anything to paste. */}
          {scored.missing.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Things you have not mentioned</Text>
              <Text style={styles.cardLead}>
                Prompts to think about, not words to use. Cover any, all, or none —
                what you write is entirely yours.
              </Text>
              {scored.missing.map((what) => (
                <Text key={what} style={styles.missing}>• {what}</Text>
              ))}
            </View>
          ) : null}

          {/* ── THE STARS, AND FAYR NEVER ASKS FOR A NUMBER ────────────────
              Five identical outlines and nothing chosen. No default, no
              highlight on any one of them, no colour that makes a number look
              like the right answer, and not a word anywhere near this control
              suggesting which to pick. The line above already says a low rating
              and a high one are paid the same, and every pixel here has to keep
              that true.

              Tapping the one already chosen puts it back to nothing, so a
              number can be un-said as easily as it was said. */}
          <View style={styles.starsBlock}>
            <Text style={styles.starsTitle}>Your star rating</Text>
            <Text style={styles.starsLead}>
              The number you gave, or will give, at the shop. We keep it so your
              record here is complete. Leave it blank if you have not decided.
            </Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setStars(stars === n ? null : n)}
                  activeOpacity={0.7}
                  style={styles.star}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${n}`}
                >
                  <Text style={stars != null && n <= stars ? styles.starOn : styles.starOff}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}
          {saved ? <Text style={styles.saved}>Saved. You can come back and add to it.</Text> : null}
        </ScrollView>

        <View style={styles.foot}>
          {/* ── "SAVE MY REVIEW" IS GONE — 20 SEPTEMBER 2026 ───────────────
              The owner, after running it: "There should not be any option for
              'Save my review'. Once the user clicks on the option 'Copy' and is
              redirected to the Zepto product page, it automatically saves the
              review." It was a button whose only job was bookkeeping, offered
              to a person who has no way of knowing the bookkeeping matters —
              and on his own run he skipped it, so his words were never stored
              and the end-of-hold comparison had nothing to compare against.
              The saving moved into the one tap that sends him off to paste.
              NEVER DISABLED ON A SCORE, and that rule moved with it: a thin
              review goes exactly as readily as a strong one. The owner chose
              warning over blocking. */}
          {/* ── AND THEN COPY IT, TO PASTE INTO THE SHOP ──────────────────
              Never disabled by the score either. It is not disabled at all:
              copying is free, it needs no network and it cannot fail in a way
              worth blocking a tap over. */}
          {/* ── THE ONE TAP, ABOVE THE PLAIN COPY ───────────────────────────
              Copies exactly what the control below copies, and then opens the
              order's own page inside Fayr. Never disabled by the score either.
              The plain copy stays for somebody who wants the words and not the
              page — the two are the same copy, so nothing can drift. */}
          <Pill onPress={copyAndOpenTheOrder} color={COLOR.greenDeep}>
            {saving ? 'SAVING…' : 'COPY AND ADD REVIEW FOR THIS PRODUCT'}
          </Pill>
          <Pill onPress={copy} color={COLOR.line}>COPY MY REVIEW</Pill>
          {copied ? (
            <Text style={styles.copied}>
              Your review is on the clipboard. Paste it into the shop’s own
              review box.
            </Text>
          ) : null}
          <Ghost onPress={() => goBackOrHome(navigation)}>I will finish it later</Ghost>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  scroll: { flex: 1 },
  body: { padding: SPACE.lg, paddingBottom: SPACE.xxl },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginBottom: 4 },
  product: { marginBottom: SPACE.sm, color: COLOR.ink2 },
  box: {
    marginTop: SPACE.md,
    minHeight: 160,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
    padding: SPACE.md,
    fontFamily: FONT.body,
    fontSize: 15,
    color: COLOR.ink,
  },
  scoreRow: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.sm,
  },
  band: { fontFamily: FONT.displaySemi, fontSize: 18 },
  scoreNum: { fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.sub },
  scoreNote: { marginTop: 2, fontFamily: FONT.body, fontSize: 12, color: COLOR.sub },
  card: {
    marginTop: SPACE.lg,
    borderRadius: RADIUS.md,
    backgroundColor: COLOR.creamDeep,
    padding: SPACE.md,
  },
  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },
  cardLead: { marginTop: 2, fontFamily: FONT.body, fontSize: 12, color: COLOR.sub },
  missing: { marginTop: 6, fontFamily: FONT.body, fontSize: 13.5, color: COLOR.ink2 },
  starsBlock: { marginTop: SPACE.lg },
  starsTitle: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink },
  starsLead: { marginTop: 2, fontFamily: FONT.body, fontSize: 12, color: COLOR.sub },
  starsRow: { flexDirection: 'row', marginTop: SPACE.sm, gap: SPACE.xs },
  star: { paddingVertical: 4, paddingHorizontal: 6 },
  // ONE COLOUR FOR EVERY CHOSEN STAR AND ONE FOR EVERY UNCHOSEN ONE. No
  // gradient, no warmer tone at five, nothing that makes one number look more
  // like the answer than another.
  starOn: { fontSize: 30, lineHeight: 34, color: COLOR.goldDeep },
  starOff: { fontSize: 30, lineHeight: 34, color: COLOR.line },
  copied: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.greenDeep, textAlign: 'center' },
  refusal: { marginTop: SPACE.md, fontFamily: FONT.body, fontSize: 13, color: COLOR.red },
  saved: { marginTop: SPACE.md, fontFamily: FONT.body, fontSize: 13, color: COLOR.greenDeep },
  foot: { padding: SPACE.lg, gap: SPACE.sm },
});
