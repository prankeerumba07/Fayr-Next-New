// The product page's claim block only wakes up when somebody has scrolled to it.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { BOTTOM_SLACK, reachedBottom } from './detailReveal.js';

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

console.log('reachedBottom');

t('clearly above the bottom is not the bottom', () => {
  assert.equal(
    reachedBottom({ offsetY: 0, viewportHeight: 800, contentHeight: 3000 }),
    false,
  );
  assert.equal(
    reachedBottom({ offsetY: 1000, viewportHeight: 800, contentHeight: 3000 }),
    false,
  );
  // One point short of the slack is still not the bottom.
  assert.equal(
    reachedBottom({ offsetY: 3000 - 800 - BOTTOM_SLACK - 1, viewportHeight: 800, contentHeight: 3000 }),
    false,
  );
});

t('exactly at the line is the bottom', () => {
  // offsetY + viewportHeight === contentHeight - 24
  assert.equal(
    reachedBottom({ offsetY: 3000 - 800 - BOTTOM_SLACK, viewportHeight: 800, contentHeight: 3000 }),
    true,
  );
});

t('the very end of the page is the bottom', () => {
  assert.equal(
    reachedBottom({ offsetY: 2200, viewportHeight: 800, contentHeight: 3000 }),
    true,
  );
});

t('pulling past the end is still the bottom', () => {
  // A rubber-band bounce reports a position past the end, and on some phones a
  // negative one at the top. Neither may turn the button off again.
  assert.equal(
    reachedBottom({ offsetY: 2600, viewportHeight: 800, contentHeight: 3000 }),
    true,
  );
});

t('a page shorter than the window is already at the bottom', () => {
  // NOTHING TO SCROLL. Answering false here would leave the claim button dead
  // with no way on earth to reach it.
  assert.equal(
    reachedBottom({ offsetY: 0, viewportHeight: 900, contentHeight: 400 }),
    true,
  );
  assert.equal(
    reachedBottom({ offsetY: 0, viewportHeight: 900, contentHeight: 900 }),
    true,
  );
});

t('a measurement we cannot use counts as the bottom', () => {
  // The safe direction is a button somebody can press, not a page nobody can
  // claim from.
  for (const bad of [undefined, null, NaN, Infinity, '600', {}]) {
    assert.equal(
      reachedBottom({ offsetY: bad, viewportHeight: 800, contentHeight: 3000 }),
      true,
      `offsetY ${String(bad)} did not fall safe`,
    );
    assert.equal(
      reachedBottom({ offsetY: 0, viewportHeight: bad, contentHeight: 3000 }),
      true,
      `viewportHeight ${String(bad)} did not fall safe`,
    );
    assert.equal(
      reachedBottom({ offsetY: 0, viewportHeight: 800, contentHeight: bad }),
      true,
      `contentHeight ${String(bad)} did not fall safe`,
    );
  }
  assert.equal(reachedBottom(null), true);
  assert.equal(reachedBottom(undefined), true);
  assert.equal(reachedBottom({}), true);
});

t('it is pure, so this test can read it at all', () => {
  const src = readFileSync(new URL('./detailReveal.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('import '), 'detailReveal.js imports something');
});

console.log('\nthe product page uses it, and nothing floats any more');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // TWO COPIES, AND THE REASON MATTERS. `detail` has the comments taken out, so a
  // rule cannot be satisfied by a comment that merely describes it. `raw` keeps
  // them, because the claim block is marked with a comment and a check that strips
  // comments can never find its own marker. The first version of these checks used
  // the stripped copy for both and failed on exactly that.
  const raw = readFileSync(new URL('../DetailScreen.js', import.meta.url), 'utf8');
  const detail = strip(raw);
  const flat = detail.replace(/\s+/g, ' ');

  /** The JSX between the ScrollView's own tags. */
  const insideScroll = (() => {
    const open = detail.indexOf('<ScrollView');
    const close = detail.lastIndexOf('</ScrollView>');
    return open >= 0 && close > open ? detail.slice(open, close) : '';
  })();

  t('the page asks this file, at the throttle the owner asked for', () => {
    assert.ok(/reachedBottom/.test(detail), 'the page does not use reachedBottom');
    // includes, not a regular expression: {16} in a pattern is a quantifier, so
    // /scrollEventThrottle={16}/ asks for sixteen equals signs. The first version
    // of this check did exactly that and failed on correct code.
    assert.ok(
      flat.includes('scrollEventThrottle={16}'),
      'the scroll is not throttled at 16',
    );
    assert.ok(/onScroll=/.test(detail), 'the page never listens to the scroll');
  });

  t('the tick box and the claim button are INSIDE the scrolling page', () => {
    assert.ok(
      insideScroll.includes('TERMS_SENTENCE'),
      'the tick box is not inside the ScrollView',
    );
    assert.ok(
      /Claim this campaign/.test(insideScroll),
      'the claim button is not inside the ScrollView',
    );
  });

  t('NOTHING FLOATS. The claim block sits in no absolutely placed box', () => {
    // The owner's complaint was paint-over. This walks the style names used on the
    // claim block and checks each one's own definition, rather than trusting that
    // the pinned bar was removed.
    const block = (raw.match(/THE CLAIM BLOCK[\s\S]*?END OF THE CLAIM BLOCK/) || [''])[0];
    assert.ok(block.length > 100, 'the claim block is not marked in the file');
    const names = [...block.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    assert.ok(names.length > 2, 'no styles found on the claim block');
    for (const name of new Set(names)) {
      const def = (raw.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`)) || [''])[0];
      assert.ok(
        !/position: 'absolute'/.test(def),
        `styles.${name} on the claim block is absolutely placed`,
      );
    }
  });

  t('and the pinned bar that used to hold it is gone', () => {
    assert.ok(
      !/<LinearGradient[\s\S]{0,400}styles\.footer/.test(detail),
      'the pinned footer bar is still there',
    );
  });

  t('the space is reserved before it shows, so revealing it cannot jump', () => {
    // Kept mounted and turned see-through, rather than added to the page when the
    // scroll arrives. Adding it would grow the page under the reader's thumb.
    assert.ok(
      flat.includes('opacity: revealed ? 1 : 0'),
      'the block is not reserved',
    );
    assert.ok(
      flat.includes("pointerEvents={revealed ? 'auto' : 'none'}"),
      'an invisible block can still be tapped',
    );
  });
}

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
