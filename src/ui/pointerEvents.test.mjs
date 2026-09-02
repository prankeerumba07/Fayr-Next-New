// A VIEW THAT REFUSES TAPS MUST NOT HAVE ANYTHING TAPPABLE INSIDE IT.
//
// WHY THIS CHECK EXISTS. On 2 September 2026 the reminder card on the home page
// stopped working completely — the cross did nothing, tapping the card did
// nothing, the dots did nothing. One word caused it. The card's wrapper had been
// given pointerEvents="none" with pointerEvents="auto" on the card inside, which
// is the way a WEB PAGE gives you two layers:
//
//   .box-none   { pointer-events: none; }
//   .box-none * { pointer-events: all;  }
//
// REACT NATIVE DOES NOT WORK THAT WAY, and the phone's own code says so. From
// this project's own React Native 0.81.5:
//
//   node_modules/react-native/React/Views/RCTView.m:172
//     self.userInteractionEnabled = (pointerEvents != RCTPointerEventsNone);
//   node_modules/react-native/React/Views/RCTView.m:179 to :182
//     BOOL canReceiveTouchEvents = ([self isUserInteractionEnabled] && ...);
//     if (!canReceiveTouchEvents) { return nil; }
//
// So "none" switches touches off for the view AND everything drawn inside it,
// and it does that BEFORE it ever looks at a child. A child asking for "auto" is
// never reached and cannot undo it. The same is true with the new architecture
// turned on:
//
//   React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:670
//     case PointerEventsMode::None: return nil;
//
// THE VALUE THAT DOES WHAT THE WEB IDIOM MEANT IS "box-none". React Native's own
// description of the four modes lives in
// Libraries/Components/View/ViewPropTypes.d.ts around :180, and RCTView.m says it
// in one line at :218 to :219:
//
//   case RCTPointerEventsBoxNone: return hitSubview;
//
// Walk the children, hand back the child that was hit, never hand back this box.
// In plain words:
//
//   none        this box takes no taps, and neither does anything inside it
//   box-none    this box takes no taps, the things inside it do
//   box-only    this box takes taps, the things inside it do not
//   auto        the ordinary behaviour, and what a view does when nothing is said
//
// SO THE RULE IS: if you want a box that lets taps through to what is behind it
// while the things drawn in it still work, the value is box-none. "none" is only
// ever right when NOTHING inside needs a finger — a background drawing, a picture,
// a layer being switched off on purpose.
//
// WHAT THIS CHECK LOOKS AT. Only the plain, always-on form, written straight into
// the file: pointerEvents="none". A value that changes with a condition, like
// src/DetailScreen.js's pointerEvents={revealed ? 'auto' : 'none'}, is somebody
// deliberately switching a whole block off and on again, which is exactly what
// "none" is for, so it is left alone.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    process.exitCode = 1;
  }
};
const ok = (cond, why) => assert.ok(cond, why);

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..');
const ROOT = join(APP, '..');

// ── READING A FILE WITHOUT ITS COMMENTS ──────────────────────────────────────
// A note that mentions pointerEvents="none" while explaining this very rule is
// not code, and must not be read as code. Every comment character is replaced
// with a space, so what is left is the same length and every position still
// lines up with the real file.
function withoutComments(source) {
  const out = source.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

// The plain always-on form, in the three ways it can be written.
const ALWAYS_NONE = /pointerEvents\s*=\s*(?:"none"|'none'|\{\s*'none'\s*\}|\{\s*"none"\s*\})/g;

// THINGS A FINGER OPERATES. If one of these is inside a box that refuses taps,
// the person cannot use it, which is the whole defect this check is here to catch.
const TAPPABLE = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Button',
  'TextInput',
  'Switch',
  'ScrollView',
  'FlatList',
  'SectionList',
  'onPress',
  'onLongPress',
];

/** The tag name that starts at this `<`. */
function tagNameAt(text, lt) {
  const m = /^<\s*([A-Za-z][A-Za-z0-9_.]*)/.exec(text.slice(lt, lt + 60));
  return m ? m[1] : null;
}

/** Where the opening tag that begins at `lt` stops, and whether it closed itself. */
function endOfOpeningTag(text, lt) {
  let depth = 0;
  for (let i = lt + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) {
      let j = i - 1;
      while (j > lt && /\s/.test(text[j])) j -= 1;
      return { at: i, selfClosing: text[j] === '/' };
    }
  }
  return null;
}

/** Everything drawn inside the tag that begins at `lt`, or '' when it has no inside. */
function insideOf(text, lt) {
  const name = tagNameAt(text, lt);
  if (!name) return '';
  const open = endOfOpeningTag(text, lt);
  if (!open || open.selfClosing) return '';
  const start = open.at + 1;
  const opener = new RegExp('<\\s*' + name.replace('.', '\\.') + '(?![A-Za-z0-9_.])', 'g');
  const closer = new RegExp('<\\s*/\\s*' + name.replace('.', '\\.') + '\\s*>', 'g');
  let depth = 1;
  let at = start;
  while (at < text.length) {
    opener.lastIndex = at;
    closer.lastIndex = at;
    const o = opener.exec(text);
    const c = closer.exec(text);
    if (!c) return text.slice(start);
    if (o && o.index < c.index) { depth += 1; at = o.index + 1; continue; }
    depth -= 1;
    if (depth === 0) return text.slice(start, c.index);
    at = c.index + 1;
  }
  return text.slice(start);
}

/**
 * EVERY BOX IN THIS SOURCE THAT REFUSES ALL TAPS, and what is drawn inside it.
 *
 * Answers a list, one entry per always-on pointerEvents="none", each saying which
 * tag it was on and which finger-operated things were found inside it.
 */
export function boxesThatRefuseTaps(source) {
  const code = withoutComments(source);
  const found = [];
  ALWAYS_NONE.lastIndex = 0;
  let m = ALWAYS_NONE.exec(code);
  while (m) {
    // Walk back to the `<` that starts this tag.
    let lt = -1;
    for (let i = m.index; i >= 0; i -= 1) {
      if (code[i] === '<' && tagNameAt(code, i)) { lt = i; break; }
      if (code[i] === '>') break; // we are past the tag; nothing to find
    }
    if (lt >= 0) {
      const inside = insideOf(code, lt);
      found.push({
        tag: tagNameAt(code, lt),
        tappable: TAPPABLE.filter((word) => (
          new RegExp('[<\\s{(]' + word + '(?![A-Za-z0-9_])').test(inside)
        )),
      });
    }
    m = ALWAYS_NONE.exec(code);
  }
  return found;
}

/** Every JavaScript file the app itself is built from. */
function appFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) appFiles(full, out);
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full);
  }
  return out;
}

console.log('\nA box that refuses taps must have nothing tappable inside it');

// ── THE RULE ITSELF, ON SMALL EXAMPLES ──────────────────────────────────────
// So the walk over the real app below is known to be looking for the right thing.

t('the exact mistake is caught: a box refusing taps with a cross inside it', () => {
  const bad = `
    <View style={styles.holder} pointerEvents="none">
      <View style={styles.card} pointerEvents="auto">
        <TouchableOpacity onPress={dismiss}><Text>x</Text></TouchableOpacity>
      </View>
    </View>`;
  const found = boxesThatRefuseTaps(bad);
  assert.equal(found.length, 1, 'the one refusing box should be found');
  ok(found[0].tappable.includes('TouchableOpacity'), 'the cross inside should be seen');
  ok(found[0].tappable.includes('onPress'), 'and so should its onPress');
});

t('a child asking for auto does not excuse it, because the phone never reads it', () => {
  const bad = '<View pointerEvents="none"><Pressable pointerEvents="auto" onPress={go} /></View>';
  const found = boxesThatRefuseTaps(bad);
  assert.equal(found.length, 1, 'only the outer box refuses taps, so only it is looked at');
  assert.deepEqual(found[0].tappable, ['Pressable', 'onPress'],
    'the outer box still has a tappable thing inside it, and the child saying auto '
    + 'changes nothing, because the phone stops at the outer box and never reads it');
});

t('a background drawing with nothing tappable in it is fine', () => {
  const fine = '<Svg pointerEvents="none">{lines}</Svg>';
  assert.deepEqual(boxesThatRefuseTaps(fine), [{ tag: 'Svg', tappable: [] }]);
});

t('a box that closes itself has no inside, so it is fine', () => {
  const fine = '<View pointerEvents="none" style={styles.veil} />';
  assert.deepEqual(boxesThatRefuseTaps(fine), [{ tag: 'View', tappable: [] }]);
});

t('a value that changes with a condition is somebody switching a block off on purpose', () => {
  const fine = "<View pointerEvents={revealed ? 'auto' : 'none'}><Pressable onPress={x} /></View>";
  assert.deepEqual(boxesThatRefuseTaps(fine), [], 'not the always-on form, so not looked at');
});

t('a note explaining this very rule is not read as code', () => {
  // The real shape this guards, copied from src/ui/WaitingBox.js: the note about
  // what went wrong sits INSIDE the opening tag, right above the value. Read as
  // code it would look like a box refusing every tap with a cross inside it, and
  // the check would shout about a card that is perfectly correct.
  const fine = `
    <View
      style={styles.holder}
      // This said pointerEvents="none" for a few hours and the cross went dead.
      pointerEvents="box-none"
    >
      <Pressable onPress={x} />
    </View>`;
  assert.deepEqual(boxesThatRefuseTaps(fine), [],
    'the note is a note; only the value the tag really carries counts');
});

t('the box being refused is the one the word was written on, not its parent', () => {
  const bad = `
    <View style={outer}>
      <Pressable onPress={outerTap} />
      <View pointerEvents="none"><Image source={art} /></View>
    </View>`;
  const found = boxesThatRefuseTaps(bad);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].tappable, [], 'the sibling Pressable is not inside it');
});

// ── THE WALK OVER THE WHOLE APP ─────────────────────────────────────────────

t('no file in the app refuses taps on a box with something tappable inside it', () => {
  const bad = [];
  for (const file of appFiles(APP)) {
    for (const box of boxesThatRefuseTaps(readFileSync(file, 'utf8'))) {
      if (box.tappable.length > 0) {
        bad.push(`${relative(ROOT, file)}: <${box.tag}> refuses every tap, `
          + `but these are drawn inside it and need a finger: ${box.tappable.join(', ')}. `
          + 'The value you want is box-none, which refuses taps on the box itself and '
          + 'lets the things inside it work. See the note at the top of this check.');
      }
    }
  }
  assert.deepEqual(bad, [], '\n  ' + bad.join('\n  '));
});

t('the app really does use this word, so the walk above is not passing on nothing', () => {
  let seen = 0;
  for (const file of appFiles(APP)) {
    seen += boxesThatRefuseTaps(readFileSync(file, 'utf8')).length;
  }
  ok(seen >= 2, `expected the app to refuse taps somewhere on purpose, found ${seen}`);
});

// ── THE CARD THAT BROKE, NAMED ──────────────────────────────────────────────

t('the reminder card’s strip lets taps through instead of killing them', () => {
  const box = readFileSync(join(APP, 'ui/WaitingBox.js'), 'utf8');
  ok(box.includes('pointerEvents="box-none"'),
    'the strip around the reminder card must be box-none: the design wants the empty '
    + 'space beside the card to reach the campaign behind it, and box-none is the only '
    + 'value that does that while leaving the card itself working');
  ok(!/pointerEvents="none"/.test(box),
    'nothing on the reminder card may refuse every tap; that is the 2 September 2026 '
    + 'defect where the cross, the card and the dots all went dead at once');
});

t('and the phone’s own code still says what this check claims it says', () => {
  const view = join(ROOT, 'node_modules/react-native/React/Views/RCTView.m');
  const src = readFileSync(view, 'utf8');
  ok(src.includes('self.userInteractionEnabled = (pointerEvents != RCTPointerEventsNone);'),
    'RCTView.m must still switch user interaction off for a view asking for none');
  ok(/case RCTPointerEventsBoxNone:\s*\n\s*return hitSubview;/.test(src),
    'RCTView.m must still answer a tap on a box-none view with the child that was hit');
  ok(/case RCTPointerEventsNone:\s*\n\s*return nil;/.test(src),
    'RCTView.m must still answer a tap on a none view with nothing at all');
});

console.log(`  ${passed} checks passed`);
