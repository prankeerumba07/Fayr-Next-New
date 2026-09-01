// THE TERMS TICK BOX, CHECKED ON THE REAL SCREENS.
//
// The owner asked for a tick box on the product page, the claim button dead until
// it is ticked, and the acceptance recorded rather than thrown away. Half of that
// is a decision (this file's first half) and half is wiring (its second half), so
// this reads the real screen files rather than trusting a comment.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TERMS_SENTENCE, acceptedTerms, claimBlockedLine, needsTermsLine,
} from './terms.js';

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

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('the sentence');

t('is exactly the sentence the owner gave, to the full stop', () => {
  assert.equal(
    TERMS_SENTENCE,
    'I accept the terms and conditions and I have read everything above.',
  );
});

t('says nothing about honesty, which is a different promise on a later screen', () => {
  // The honesty promise moved to the review guide. Putting it back here would be
  // two promises in one tick box, and a person cannot accept half a sentence.
  assert.doesNotMatch(TERMS_SENTENCE, /honest|rating|review/i);
});

console.log('\nwhat counts as accepted');

t('only a literal yes', () => {
  assert.equal(acceptedTerms(true), true);
});

t('nothing else, however much it looks like one', () => {
  for (const v of ['true', 1, 'yes', {}, [], 'on', ' true ']) {
    assert.equal(acceptedTerms(v), false, `${JSON.stringify(v)} counted as accepted`);
  }
});

t('and absent is not accepted', () => {
  assert.equal(acceptedTerms(undefined), false);
  assert.equal(acceptedTerms(null), false);
  assert.equal(acceptedTerms(false), false);
});

console.log('\nwhat the screens say when it is not ticked');

t('the product page says why its button is dead', () => {
  const line = claimBlockedLine(false);
  assert.equal(line, 'Tick the box above to accept the terms and conditions.');
  assert.equal(claimBlockedLine(true), null);
});

t('the confirmation page says where to go, and does not read as a fault', () => {
  const line = needsTermsLine(false);
  assert.equal(line, 'Please read and accept the terms on the product page first.');
  assert.doesNotMatch(line, /error|failed|invalid|sorry/i);
  assert.equal(needsTermsLine(true), null);
});

t('neither line uses a word a person would have to look up', () => {
  for (const line of [claimBlockedLine(false), needsTermsLine(false)]) {
    assert.doesNotMatch(line, /--/, 'a double dash');
    assert.doesNotMatch(line, /\bT&C|T & C|ToS\b/i, 'a short code');
  }
});

console.log('\nthe product page really carries it');
{
  const detail = read('../DetailScreen.js');
  const prose = strip(detail);

  t('the sentence is on the screen, taken from the one place it is written', () => {
    assert.match(prose, /TERMS_SENTENCE/, 'the screen does not use the shared sentence');
    // And it is NOT typed out a second time. A second copy is a second sentence
    // to keep in step with the one people agreed to.
    assert.doesNotMatch(
      prose, /I accept the terms and conditions/,
      'the sentence is typed out in the screen as well as imported',
    );
  });

  t('the claim button is disabled until it is ticked', () => {
    assert.match(prose, /accepted/, 'the screen tracks nothing about acceptance');
    // The button's own onPress must refuse, not merely look grey. A greyed button
    // that still works is the worst of both.
    assert.match(
      prose, /acceptedTerms\(/,
      'the screen never asks whether the terms were accepted',
    );
  });

  t('and says why it is dead rather than just being dead', () => {
    assert.match(prose, /claimBlockedLine/, 'the screen shows no reason');
  });

  t('the acceptance is handed forward to the claim, not dropped here', () => {
    // The tick is on this screen; the claim happens two screens later. If it were
    // not passed on, the tick would light up a button and change nothing else,
    // which is exactly what the owner said not to do.
    assert.match(
      prose, /acceptedTerms:\s*true/,
      'the product page does not pass the acceptance on to the journey',
    );
  });
}

console.log('\nthe confirmation page sends it to the server');
{
  const confirm = strip(read('../screens/confirm.js'));

  t('it reads the acceptance it was handed', () => {
    assert.match(confirm, /acceptedTerms/, 'the confirmation page ignores it');
  });

  t('it refuses to claim without it, and says where to go', () => {
    assert.match(confirm, /needsTermsLine/, 'it does not say what is missing');
  });

  t('and the claim call carries the value that arrived, not a literal yes', () => {
    // `claimTask(campaignId, true)` would keep working if the guard above it were
    // ever removed, and would then send an acceptance nobody gave. What is sent
    // has to be the thing that came in.
    assert.match(
      confirm, /claimTask\(campaignId, cameWithTerms\)/,
      'the claim is sent without the acceptance, or with a hardcoded yes',
    );
    assert.doesNotMatch(
      confirm, /claimTask\([^)]*,\s*true\s*\)/,
      'the claim sends a hardcoded yes',
    );
  });
}

console.log('\nthe claim call carries it all the way to the server');
{
  const api = strip(read('../backend/tasksApi.js'));
  const store = strip(read('../taskStore.js'));

  t('the request body includes it', () => {
    assert.match(api, /acceptedTerms/, 'POST /tasks does not send the acceptance');
  });

  t('and the store passes it through rather than deciding for itself', () => {
    assert.match(store, /acceptedTerms/, 'the task store drops the acceptance');
    // No default. A default here would claim somebody accepted terms they never
    // saw, which is the whole thing this guards against.
    assert.doesNotMatch(
      store, /acceptedTerms\s*=\s*true|acceptedTerms\s*\|\|\s*true|acceptedTerms\s*\?\?\s*true/,
      'the store defaults the acceptance to true, which invents a promise',
    );
  });
}

console.log('\nthe honesty promise moved, and did not disappear');
{
  // The owner decided the honesty promise does not belong at the claim. It is what
  // makes Fayr honest rather than a bribe, so it has to be SOMEWHERE, and it is on
  // the review guide, which is the screen where somebody is about to write.
  //
  // Both halves are checked. Removing it from the claim and forgetting to check the
  // other screen would have quietly deleted the promise from the whole product.
  const confirm = strip(read('../screens/confirm.js'));
  // FLATTENED. Screen text is wrapped across lines by the code formatter, so
  // "a low rating and a\n high one are paid the same" is one sentence to a reader
  // and two lines to a regular expression. The first version of these checks failed
  // on exactly that and would have read as a missing promise.
  const guide = strip(read('../screens/reviewguide.js')).replace(/\s+/g, ' ');

  t('the claim screen no longer asks anybody to promise an honest review', () => {
    assert.doesNotMatch(confirm, /honest/i, 'the claim screen still mentions honesty');
    assert.doesNotMatch(
      confirm, /rating never affects/i,
      'the claim screen still carries the rating promise',
    );
  });

  t('and it has no tick box left at all', () => {
    // The terms tick box is on the PRODUCT page. Two tick boxes two screens apart,
    // both needed before one claim, is a gate a person walks into twice.
    assert.doesNotMatch(confirm, /setAck|styles\.ackRow|ackText/, 'a tick box remains');
  });

  t('the review guide carries the promise, and carries it twice over', () => {
    // Once in the words under the heading, once in the locked note. Neither is
    // behind a tap, so it cannot be missed.
    assert.match(
      guide, /a low rating and a high one are paid the same/i,
      'the review guide no longer says a low rating pays the same',
    );
    assert.match(
      guide, /never asks for positive reviews/i,
      'the review guide no longer carries the locked promise',
    );
    assert.match(
      guide, /good or bad, earns the same refund/i,
      'the review guide no longer says both earn the same refund',
    );
  });

  t('and the promise is not hidden behind a tap on that screen', () => {
    // A promise inside a collapsed card is a promise nobody reads. The locked note
    // is drawn straight into the page: no open state, no toggle around it.
    const noteBlock = (guide.match(/styles\.promise[\s\S]{0,400}/) || [''])[0];
    assert.doesNotMatch(noteBlock, /open|Toggle|expand/i, 'the promise can be collapsed');
  });
}

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
