// The three small pieces the design uses to describe a task's progress, shared
// by My Products and the Task screen so both speak with one voice.
//
// Ported from fayr-design.browser.jsx: STAGE_TONE (:3843), the 7-segment mini
// tracker inside ProgressRow (:3867), and the taped handwritten note (:3806).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLOR, FONT } from './theme';

/** The design's tone palette, plus a red the design implies but never defines. */
export const STAGE_TONE = {
  amber: { bg: '#FFF8E1', line: '#FECA3A', dot: '#F5A623', fg: 'rgba(0,0,0,0.8)' },
  blue: { bg: '#EAF2FF', line: '#9CC3FF', dot: '#2F6FD0', fg: '#2F6FD0' },
  purple: { bg: '#F2E9FD', line: '#CDB4F0', dot: '#7926D9', fg: '#7926D9' },
  green: { bg: '#EAF7E4', line: '#9FDB86', dot: '#30A90F', fg: '#30A90F' },
  red: { bg: '#FFECEC', line: '#F5A9A2', dot: COLOR.red, fg: '#B4271B' },
};

export function toneOf(tone) {
  return STAGE_TONE[tone] || STAGE_TONE.blue;
}

/** The pill that names what a task is doing right now. */
export function StageChip({ label, tone = 'blue', check = false, style }) {
  const t = toneOf(tone);
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.line }, style]}>
      {check
        ? <Text style={[styles.check, { color: COLOR.greenDeep }]}>✓</Text>
        : <View style={[styles.dot, { backgroundColor: t.dot }]} />}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** 1 buy → 2 delivery → 3 review → 4 verify → 5 window → 6 ready → 7 paid. */
export function StepTracker({ step, tone = 'blue', total = 7, style }) {
  const t = toneOf(tone);
  return (
    <View style={[styles.tracker, style]}>
      {Array.from({ length: total }, (_, i) => i + 1).map((k) => (
        <View
          key={k}
          style={[
            styles.seg,
            { backgroundColor: k < step ? COLOR.green : k === step ? t.dot : '#E7E8D6' },
          ]}
        />
      ))}
    </View>
  );
}

/** The taped, slightly-rotated handwritten note. */
export function TapedNote({ children, style }) {
  return (
    <View style={[styles.noteWrap, style]}>
      <View style={[styles.tape, styles.tapeLeft]} />
      <View style={[styles.tape, styles.tapeRight]} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  check: { fontFamily: FONT.bodyBold, fontSize: 12 },
  chipText: { fontFamily: FONT.bodyMed, fontSize: 12 },

  tracker: { flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 3, borderRadius: 3 },

  noteWrap: {
    alignSelf: 'center', maxWidth: 300, backgroundColor: '#F3F2E8',
    paddingHorizontal: 16, paddingVertical: 9, marginBottom: 18, marginTop: 2,
    transform: [{ rotate: '-1.5deg' }],
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  tape: {
    position: 'absolute', top: -7, width: 42, height: 13,
    backgroundColor: 'rgba(228,222,170,0.85)',
  },
  tapeLeft: { left: 24, transform: [{ rotate: '-6deg' }] },
  tapeRight: { right: 24, transform: [{ rotate: '5deg' }] },
  noteText: {
    fontFamily: FONT.body, fontStyle: 'italic', fontSize: 12,
    color: '#6f7065', textAlign: 'center', lineHeight: 17,
  },
});
