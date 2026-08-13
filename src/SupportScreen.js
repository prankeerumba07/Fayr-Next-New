// Help — the only channel a user has when their money is stuck.
//
// Built in the design's language (fayr-design.browser.jsx): the gradient header
// with an oversized display title, white cards at radius 16, pill status chips
// with a dot, the hairline gradient divider, and the taped handwritten note used
// on My Products for an at-a-glance explanation. No design screen existed for
// support, so this borrows those parts rather than introducing a new look.
//
// One screen, three views (list → thread → ask) instead of three routes: the flow
// is a single errand, and a back tap should return to the list rather than
// unwinding a stack the user did not knowingly push.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Card, Pill } from './ui/primitives';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './ui/theme';
import {
  askQuestion, getQuestion, listQuestions, replyToQuestion,
} from './backend/supportApi';
import {
  BODY_MAX, SUBJECT_MAX, TOPICS, sortThreads, statusMeta, threadMessages,
  validateQuestion, validateReply,
} from './ui/support';

const TONE = {
  amber: { bg: COLOR.amberBg, line: COLOR.amberLine, ink: '#8A5A00' },
  blue: { bg: COLOR.blueBg, line: '#9CC3FF', ink: '#2F6FD0' },
  green: { bg: COLOR.refundBg, line: '#9FDB86', ink: COLOR.refundInk },
};

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function StatusChip({ tone, children }) {
  const t = TONE[tone] || TONE.blue;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.line }]}>
      <View style={[styles.chipDot, { backgroundColor: t.ink }]} />
      <Text style={[styles.chipText, { color: t.ink }]}>{children}</Text>
    </View>
  );
}

/** The design's taped handwritten note (MyProducts) — reused, not reinvented. */
function TapedNote({ children }) {
  return (
    <View style={styles.note}>
      <View style={[styles.tape, { left: 24, transform: [{ rotate: '-6deg' }] }]} />
      <View style={[styles.tape, { right: 24, transform: [{ rotate: '5deg' }] }]} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export default function SupportScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState('list'); // list | thread | ask
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');

  // A blocked task can hand us its own subject line, so the user does not have to
  // describe a problem the app already knows about.
  const seeded = route && route.params && route.params.subject;

  const load = useCallback(async () => {
    const res = await listQuestions();
    setThreads(sortThreads(res.questions));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (seeded) { setSubject(seeded); setView('ask'); }
  }, [load, seeded]);

  const openThread = useCallback(async (id) => {
    setBusy(true);
    setError(null);
    const res = await getQuestion(id);
    if (res.ok) { setActive(res.question); setView('thread'); } else setError(res.error);
    setBusy(false);
  }, []);

  const send = useCallback(async () => {
    const v = validateQuestion({ subject, body });
    if (!v.ok) { setError(v.reason); return; }
    setBusy(true);
    setError(null);
    const res = await askQuestion({ subject: v.subject, body: v.body });
    if (res.ok) {
      setSubject(''); setBody('');
      setActive(res.question);
      setView('thread');
      await load();
    } else setError(res.error);
    setBusy(false);
  }, [subject, body, load]);

  const sendReply = useCallback(async () => {
    const v = validateReply(reply);
    if (!v.ok) { setError(v.reason); return; }
    setBusy(true);
    setError(null);
    const res = await replyToQuestion(active.id, v.body);
    if (res.ok) { setReply(''); setActive(res.question); await load(); } else setError(res.error);
    setBusy(false);
  }, [reply, active, load]);

  const goBack = () => {
    if (view === 'list') navigation.goBack();
    else { setView('list'); setError(null); }
  };

  const title = view === 'ask' ? 'Ask Fayr' : view === 'thread' ? 'Your question' : 'Help';

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBack} style={styles.back} activeOpacity={0.8}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          contentContainerStyle={{ padding: SPACE.lg, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <TouchableOpacity style={styles.error} onPress={() => setError(null)} activeOpacity={0.85}>
              <Text style={styles.errorText}>{error}</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── list ── */}
          {view === 'list' ? (
            <>
              <TapedNote>
                Stuck on a refund, an order or a withdrawal? Ask us here and a real person answers.
              </TapedNote>

              <Pill onPress={() => setView('ask')} color={COLOR.ink}>Ask a question</Pill>

              {loading ? (
                <ActivityIndicator style={{ marginTop: SPACE.xl }} color={COLOR.ink} />
              ) : threads.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>💬</Text>
                  <Text style={styles.emptyTitle}>No questions yet</Text>
                  <Text style={styles.emptySub}>
                    When something about your money looks wrong, this is the fastest way to reach us.
                  </Text>
                </View>
              ) : (
                <View style={{ marginTop: SPACE.lg }}>
                  {threads.map((q) => {
                    const m = statusMeta(q.status, q.replies);
                    const count = (q.replies || []).length;
                    return (
                      <Card key={q.id} style={styles.row} onPress={() => openThread(q.id)}>
                        <View style={styles.rowTop}>
                          <Text numberOfLines={1} style={styles.rowSubject}>{q.subject}</Text>
                          <StatusChip tone={m.tone}>{m.label}</StatusChip>
                        </View>
                        <Text numberOfLines={2} style={styles.rowBody}>{q.body}</Text>
                        <View style={styles.divider} />
                        <View style={styles.rowFoot}>
                          <Text style={styles.rowMeta}>Asked {fmtWhen(q.createdAt)}</Text>
                          <Text style={styles.rowMeta}>
                            {count === 0 ? 'No replies yet' : `${count} ${count === 1 ? 'reply' : 'replies'} ›`}
                          </Text>
                        </View>
                      </Card>
                    );
                  })}
                </View>
              )}
            </>
          ) : null}

          {/* ── ask ── */}
          {view === 'ask' ? (
            <>
              <Text style={styles.label}>What is it about?</Text>
              <View style={styles.topics}>
                {TOPICS.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setSubject(t)}
                    style={[styles.topic, subject === t && styles.topicOn]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.topicText, subject === t && styles.topicTextOn]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Subject</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="A short summary"
                placeholderTextColor="#A5A597"
                maxLength={SUBJECT_MAX}
              />

              <Text style={styles.label}>What happened?</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={body}
                onChangeText={setBody}
                placeholder="Tell us what you were doing and what you expected. Order numbers help."
                placeholderTextColor="#A5A597"
                multiline
                textAlignVertical="top"
                maxLength={BODY_MAX}
              />
              <Text style={styles.counter}>{body.length}/{BODY_MAX}</Text>

              <Pill onPress={send} loading={busy} color={COLOR.greenDeep}>Send to Fayr</Pill>
              <Text style={styles.footnote}>
                A real person reads this. Do not share your PAN, passwords or OTPs here — we never ask for them.
              </Text>
            </>
          ) : null}

          {/* ── thread ── */}
          {view === 'thread' && active ? (
            <>
              <Text style={styles.threadSubject}>{active.subject}</Text>
              <View style={{ flexDirection: 'row', marginBottom: SPACE.lg }}>
                {(() => {
                  const m = statusMeta(active.status, active.replies);
                  return <StatusChip tone={m.tone}>{m.label}</StatusChip>;
                })()}
              </View>

              {threadMessages(active).map((msg) => (
                <View
                  key={msg.id}
                  style={[styles.msg, msg.author === 'staff' ? styles.msgStaff : styles.msgUser]}
                >
                  <Text style={styles.msgWho}>{msg.author === 'staff' ? 'Fayr' : 'You'}</Text>
                  <Text style={styles.msgBody}>{msg.body}</Text>
                  <Text style={styles.msgWhen}>{fmtWhen(msg.createdAt)}</Text>
                </View>
              ))}

              {active.status === 'CLOSED' ? (
                <Text style={styles.closedNote}>
                  This question is closed. Ask a new one if you need anything else.
                </Text>
              ) : (
                <>
                  <Text style={[styles.label, { marginTop: SPACE.xl }]}>Add a reply</Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={reply}
                    onChangeText={setReply}
                    placeholder="Anything to add?"
                    placeholderTextColor="#A5A597"
                    multiline
                    textAlignVertical="top"
                    maxLength={BODY_MAX}
                  />
                  <Pill onPress={sendReply} loading={busy} color={COLOR.ink}>Send reply</Pill>
                </>
              )}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  headerTitle: { fontFamily: FONT.display, fontSize: 22, color: COLOR.ink },

  error: { backgroundColor: COLOR.redBg, borderRadius: RADIUS.md, padding: SPACE.md, marginBottom: SPACE.md },
  errorText: { fontFamily: FONT.bodySemi, fontSize: 13.5, color: COLOR.red },

  // the design's taped note
  note: {
    alignSelf: 'center', maxWidth: 300, backgroundColor: '#F3F2E8',
    paddingVertical: 9, paddingHorizontal: 16, marginBottom: 18,
    transform: [{ rotate: '-1.5deg' }], ...SHADOW.chip,
  },
  tape: {
    position: 'absolute', top: -7, width: 42, height: 13,
    backgroundColor: 'rgba(228,222,170,0.85)',
  },
  noteText: {
    fontFamily: FONT.body, fontStyle: 'italic', fontSize: 12,
    color: '#6f7065', textAlign: 'center', lineHeight: 17,
  },

  row: { marginBottom: SPACE.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  rowSubject: { flex: 1, fontFamily: FONT.displaySemi, fontSize: 14.5, color: COLOR.ink },
  rowBody: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, marginTop: 5, lineHeight: 18 },
  divider: { height: 1, backgroundColor: COLOR.line, marginVertical: 10 },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowMeta: { fontFamily: FONT.body, fontSize: 11, color: '#8b8c80', fontStyle: 'italic' },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderRadius: RADIUS.round, paddingHorizontal: 10, paddingVertical: 4,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontFamily: FONT.bodySemi, fontSize: 11 },

  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: SPACE.xl },
  emptyIcon: { fontSize: 42 },
  emptyTitle: { fontFamily: FONT.display, fontSize: 17, color: COLOR.ink, marginTop: 10 },
  emptySub: {
    fontFamily: FONT.body, fontSize: 13, color: COLOR.sub,
    marginTop: 8, textAlign: 'center', lineHeight: 19,
  },

  label: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.sub, marginBottom: 6, marginTop: SPACE.md },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  topic: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.round,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: COLOR.surface,
  },
  topicOn: { backgroundColor: COLOR.ink, borderColor: COLOR.ink },
  topicText: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.ink },
  topicTextOn: { color: '#fff' },
  input: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md, paddingVertical: 11, backgroundColor: COLOR.surface,
    fontFamily: FONT.body, fontSize: 15, color: COLOR.ink,
  },
  textarea: { minHeight: 120, paddingTop: 11 },
  counter: {
    fontFamily: FONT.body, fontSize: 10.5, color: '#8b8c80',
    textAlign: 'right', marginTop: 4, marginBottom: SPACE.md,
  },
  footnote: {
    fontFamily: FONT.body, fontSize: 11.5, color: COLOR.sub,
    marginTop: SPACE.md, lineHeight: 17, textAlign: 'center',
  },

  threadSubject: { fontFamily: FONT.display, fontSize: 19, color: COLOR.ink, marginBottom: SPACE.sm },
  msg: { borderRadius: RADIUS.lg, padding: SPACE.md, marginBottom: SPACE.sm, maxWidth: '92%' },
  msgUser: { alignSelf: 'flex-end', backgroundColor: COLOR.surface, borderWidth: 1, borderColor: COLOR.line },
  msgStaff: { alignSelf: 'flex-start', backgroundColor: COLOR.creamDeep },
  msgWho: { fontFamily: FONT.bodySemi, fontSize: 11, color: COLOR.sub, marginBottom: 3 },
  msgBody: { fontFamily: FONT.body, fontSize: 14, color: COLOR.ink, lineHeight: 20 },
  msgWhen: { fontFamily: FONT.body, fontSize: 10, color: '#8b8c80', marginTop: 5 },
  closedNote: {
    fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub,
    textAlign: 'center', marginTop: SPACE.lg, lineHeight: 18,
  },
});
