// "Chat with us" — ask Fayr a question and get an answer back.
//
// Built in the design's language, the same parts Help uses: the gradient header
// with an oversized display title, white cards at radius 16, and the pill chip
// with a dot. No design screen existed for this, so it borrows from Help rather
// than introducing a new look next door to it.
//
// EVERY DECISION IS IN ui/chat.js. This file draws what that returns and nothing
// else — no branching of its own, no wording of its own. That is what lets the
// whole screen be checked under node, including the states nobody plans for.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { goBackOrHome } from './ui/nav';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './ui/theme';
import { openChat, readChat, sayItHelped, sendChatMessage } from './backend/assistantApi';
import {
  QUESTION_MAX,
  SCREEN_TITLE,
  chatView,
  validateQuestion,
} from './ui/chat.js';

/**
 * How often the screen looks for a reply written by a person, in milliseconds.
 *
 * Every four seconds while the screen is open, and never when it is not. A
 * connection held open would save a couple of seconds and would break on a
 * train; this reconnects by itself every time because it never connected.
 */
const LOOK_FOR_A_REPLY_EVERY = 4000;

/** One line of the conversation. */
function Message({ message }) {
  const mine = message.who === 'you';
  const waiting = message.tone === 'waiting';
  // A reply written by an actual person is drawn differently from one the answer
  // book produced. Somebody told "a person will get back to you" has to be able
  // to tell, at a glance, that the next thing they are reading IS that person.
  const fromAPerson = message.tone === 'person';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        style={[
          styles.bubble,
          mine && styles.bubbleMine,
          waiting && styles.bubbleWaiting,
          fromAPerson && styles.bubblePerson,
        ]}
      >
        {message.label ? (
          <View style={styles.labelChip}>
            <View style={styles.labelDot} />
            <Text style={styles.labelText}>{message.label}</Text>
          </View>
        ) : null}
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const scroller = useRef(null);
  const sending = useRef(false);

  const load = useCallback(async (quietly) => {
    // A look that fails while somebody is reading must not paint an error over
    // a conversation that is on screen and perfectly readable. The first load
    // says so; the ones after it stay silent and try again in four seconds.
    const res = await readChat();
    if (res.ok) setChat(res.chat);
    else if (!quietly) setError(res.error);
    setLoading(false);
  }, []);

  // ARRIVING AT THE SCREEN STARTS A NEW CONVERSATION.
  //
  // The owner's rule, 2 September 2026: nobody is ever shown their own older
  // conversations. Every time somebody taps "Chat with us" they start fresh.
  //
  // THE SERVER DECIDES IT, NOT THIS SCREEN. Nothing here hides a message. This
  // says "I have opened the chat screen" once, and the server answers with the
  // conversation this person is in, which is a new empty one. A rule this screen
  // enforced would be a rule anybody could turn off.
  //
  // ONCE, and never in the looking below: opening again every few seconds would
  // start a conversation every few seconds and lose what somebody was typing.
  useEffect(() => {
    let stillHere = true;
    (async () => {
      const started = await openChat();
      if (!stillHere) return;
      if (started.ok) {
        setChat(started.chat);
        setLoading(false);
        return;
      }
      // Could not start one. Read whatever conversation we are in rather than
      // showing an empty screen with an error on it.
      setError(started.error);
      await load(true);
    })();
    return () => { stillHere = false; };
  }, [load]);

  // Look for a reply written by a person, for as long as this screen is open.
  useEffect(() => {
    const timer = setInterval(() => {
      // Never on top of a message going out: the reply to that request is the
      // newer truth, and a look that landed first would undo it on screen.
      if (sending.current) return;
      void load(true);
    }, LOOK_FOR_A_REPLY_EVERY);
    return () => clearInterval(timer);
  }, [load]);

  const view = chatView({ chat, draft, busy, loading, error });

  const send = useCallback(async () => {
    const check = validateQuestion(draft);
    if (!check.ok || busy) return;
    setBusy(true);
    sending.current = true;
    setError(null);
    const res = await sendChatMessage(check.question);
    setBusy(false);
    sending.current = false;
    if (!res.ok) {
      // The question stays in the box. Losing what somebody typed because the
      // network blinked is the one thing this screen must never do.
      setError(res.error);
      return;
    }
    setDraft('');
    setChat(res.chat);
  }, [draft, busy]);

  const answerFeedback = useCallback(
    async (questionId, helpful) => {
      // Recorded on screen straight away: waiting for the round trip makes the
      // tap feel ignored. The next look brings back the stored truth anyway.
      setChat((before) =>
        before
          ? {
              ...before,
              messages: before.messages.map((m) =>
                m.questionId === questionId ? { ...m, helpful } : m,
              ),
            }
          : before,
      );
      const res = await sayItHelped(questionId, helpful);
      if (!res.ok) setError(res.error);
    },
    [],
  );

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.cream]}
        style={[styles.header, { paddingTop: insets.top + SPACE.md }]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBackOrHome(navigation)}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{SCREEN_TITLE}</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.body}
          onContentSizeChange={() =>
            scroller.current && scroller.current.scrollToEnd({ animated: true })
          }
        >
          {view.loading ? (
            <ActivityIndicator color={COLOR.greenDeep} style={styles.spinner} />
          ) : null}

          {view.empty ? <Text style={styles.intro}>{view.intro}</Text> : null}

          {view.status ? (
            <View style={styles.statusChip}>
              <Text style={styles.statusText}>{view.status}</Text>
            </View>
          ) : null}

          {view.messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}

          {view.input.busy ? (
            <View style={[styles.row, styles.rowTheirs]}>
              <View style={styles.bubble}>
                <ActivityIndicator color={COLOR.greenDeep} />
              </View>
            </View>
          ) : null}

          {view.feedback ? (
            <View style={styles.feedback}>
              <Text style={styles.feedbackPrompt}>{view.feedback.prompt}</Text>
              <View style={styles.feedbackButtons}>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.feedbackButton, styles.feedbackYes]}
                  onPress={() => answerFeedback(view.feedback.questionId, true)}
                >
                  <Text style={styles.feedbackYesText}>{view.feedback.yes}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.feedbackButton}
                  onPress={() => answerFeedback(view.feedback.questionId, false)}
                >
                  <Text style={styles.feedbackNoText}>{view.feedback.no}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {view.error ? <Text style={styles.error}>{view.error}</Text> : null}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, SPACE.md) }]}>
          {view.input.hint ? (
            <Text style={styles.hint}>{view.input.hint}</Text>
          ) : null}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              value={view.input.value}
              onChangeText={setDraft}
              placeholder={view.input.placeholder}
              placeholderTextColor={COLOR.sub}
              multiline
              maxLength={QUESTION_MAX}
              accessibilityLabel="Your question"
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!view.input.canSend}
              onPress={send}
              style={[styles.send, !view.input.canSend && styles.sendOff]}
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.homeBg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.line,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, color: COLOR.ink },
  title: { fontFamily: FONT.display, fontSize: 30, color: COLOR.ink, marginTop: SPACE.xs },

  body: { padding: SPACE.lg, paddingBottom: SPACE.xl },
  spinner: { marginVertical: SPACE.lg },
  intro: {
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 23,
    color: COLOR.sub,
    marginBottom: SPACE.lg,
  },

  row: { flexDirection: 'row', marginBottom: SPACE.md },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLOR.line,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.md,
    ...SHADOW.card,
  },
  bubbleMine: { backgroundColor: COLOR.creamDeep, borderColor: COLOR.line },
  bubbleWaiting: { backgroundColor: COLOR.amberBg, borderColor: COLOR.amberLine },
  // A reply written by an actual person. Green because green is what Fayr uses
  // for the thing that actually happened, and this is the reply somebody was
  // told to wait for.
  bubblePerson: { backgroundColor: COLOR.greenBg, borderColor: COLOR.green },
  bubbleText: { fontFamily: FONT.body, fontSize: 15, lineHeight: 23, color: COLOR.ink },
  bubbleTextMine: { fontFamily: FONT.bodyMed },

  // Who has this conversation, said once at the top rather than on every bubble.
  statusChip: {
    alignSelf: 'center',
    backgroundColor: COLOR.greenBg,
    borderWidth: 1,
    borderColor: COLOR.green,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
    marginBottom: SPACE.md,
  },
  statusText: { fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.refundInk },

  labelChip: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.xs },
  labelDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#8A5A00', marginRight: 6,
  },
  labelText: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#8A5A00' },

  feedback: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLOR.line,
  },
  feedbackPrompt: {
    fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink, marginBottom: SPACE.sm,
  },
  feedbackButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  feedbackButton: {
    paddingVertical: 10,
    paddingHorizontal: SPACE.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.homeBg,
  },
  feedbackYes: { backgroundColor: COLOR.refundBg, borderColor: '#9FDB86' },
  feedbackYesText: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.refundInk },
  feedbackNoText: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.sub },

  error: {
    marginTop: SPACE.md,
    fontFamily: FONT.body,
    fontSize: 14,
    color: COLOR.red,
  },

  composer: {
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: 1,
    borderTopColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  hint: {
    fontFamily: FONT.body, fontSize: 13, color: COLOR.red, marginBottom: SPACE.xs,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: COLOR.line,
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACE.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: FONT.body,
    fontSize: 15,
    color: COLOR.ink,
    backgroundColor: COLOR.homeBg,
  },
  send: {
    paddingVertical: 13,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.card,
    backgroundColor: COLOR.gold,
  },
  sendOff: { opacity: 0.45 },
  sendText: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
});
