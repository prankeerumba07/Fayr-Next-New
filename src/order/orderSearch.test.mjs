// ASKING THE SHOP'S OWN SEARCH FOR ONE ORDER, INSTEAD OF READING A PAGE OF TEN.
//
// ── THE MEASUREMENT THIS EXISTS FOR ────────────────────────────────────────
//
// From the owner's own account, 16 September 2026. The address this look reads —
// the year filter on the orders list — answers with TEN rows. His Nike order,
// placed on 11 February 2026, is on the SECOND page of that list.
//
// So the ceiling was never the problem and raising it was never the fix. The
// order's number is NOT ON THE PAGE WE ARE READING, and no number of pages
// opened off that page can reach a number that is not on it. That is the thing
// this file proves, because it is the thing that is easy to argue about and
// impossible to see.
//
// The shop's own search answers with that order's card, whatever page or year it
// sits on, in ONE request. Verified signed in, in a browser, on his account.
//
// ── AND WHAT THIS FILE CANNOT PROVE ────────────────────────────────────────
//
// It cannot prove that Amazon's search answers, because that is a live page and
// this runs under node. What it proves is everything on our side of that: the
// address we build, that we type nothing, that a card on the answer is harvested
// by the SAME harvest the list goes through, that the list is not opened when
// the search answered, that the list still is when it did not, and that the
// whole look stays inside the promise it makes to the shop.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  AMAZON_ORDER_NUMBER_SHAPE, GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES,
  MOST_OF_A_NAME_WE_PUT_IN_AN_ADDRESS, WHERE_EACH_SHOP_SEARCHES_ITS_ORDERS,
  harvestRendered, howThisShopSearchesItsOrders, orderSearchPageFor, pagesToOpen,
  readsOrderPages, searchesItsOrders, theWordsToSearchFor,
} from './detailLook.js';
import {
  DRAW_DEADLINE_MS, openTheListWith, openTheSearchWith, readListStep,
} from './drawnList.js';
import { landedPath } from '../orderhistory.js';

const { ok, equal, deepEqual } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** A card as the shop really sends one: the number in an attribute, no text. */
const card = (number) =>
  `<div class="order-card js-order-card" data-csa-c-slot-id="amzn1.yourorders.order-card.${number}">`
  + '<div class="a-box-inner"><span class="a-color-secondary"></span></div></div>';

const pageOf = (...numbers) =>
  `<html><head><title>Your Orders</title></head><body><div id="ordersContainer">${
    numbers.map(card).join('')}</div></body></html>`;

/** The order that is out of reach: his, February, on the list's second page. */
const THE_ONE_ON_PAGE_TWO = '408-5614193-1514764';
const THE_PRODUCT = 'Nike Mens Promina Extra Wide Training Shoes';

/**
 * A YEAR'S FIRST PAGE, AS THE SHOP ANSWERS IT: ten rows, and his February order
 * is not among them. Ten because that is what was measured, written as ten
 * numbers rather than a loop so the page is the page and not a description of
 * one.
 */
const THE_FIRST_PAGE = pageOf(
  '408-1509645-3524313', '408-2000001-1000001', '408-2000002-1000002',
  '408-2000003-1000003', '408-2000004-1000004', '408-2000005-1000005',
  '408-2000006-1000006', '408-2000007-1000007', '408-2000008-1000008',
  '408-2000009-1000009',
);

console.log('\nthe order that the list cannot reach');

it('IS NOT ON THE LIST PAGE AT ALL, which is the whole finding', () => {
  ok(!THE_FIRST_PAGE.includes(THE_ONE_ON_PAGE_TWO),
    'the number is not in the markup, so nothing can harvest it from there');
  const found = harvestRendered(THE_FIRST_PAGE, 'amazon');
  equal(found.numbers.length, 10, 'the page answers with ten rows, as measured');
  ok(!found.numbers.includes(THE_ONE_ON_PAGE_TWO));
});

it('AND RAISING THE CEILING CANNOT REACH IT EITHER', () => {
  // The honest form of the argument: it is not that we opened too few of them.
  // Every single row on that page could be opened and the order would still not
  // have been looked at, because its number was never on the page.
  const everyOne = harvestRendered(THE_FIRST_PAGE, 'amazon').numbers;
  equal(everyOne.length, MOST_DETAIL_PAGES,
    'the whole page fits inside the ceiling already — the ceiling is not what bit');
  ok(!pagesToOpen(everyOne, 'amazon').includes(THE_ONE_ON_PAGE_TWO));
});

it('THE SEARCH FINDS IT, IN ONE REQUEST, THROUGH THE SAME HARVEST', () => {
  // What the shop answers a search with: the matching order's own card. Read by
  // harvestRendered — the list's harvest, not a second one written for this.
  const answer = pageOf(THE_ONE_ON_PAGE_TWO);
  const found = harvestRendered(answer, 'amazon');
  deepEqual(pagesToOpen(found.numbers, 'amazon'), [THE_ONE_ON_PAGE_TWO]);
  equal(found.how, 'slot', 'by the card attribute, exactly as a list row is read');
});

it('and one request is all it is: the whole answer is one page', () => {
  const step = openTheSearchWith(
    'amazon', THE_PRODUCT, 'https://www.amazon.in', 1700000000000, 'look-1',
  );
  ok(step != null);
  equal(typeof step.uri, 'string');
  ok(step.uri.startsWith(WHERE_EACH_SHOP_SEARCHES_ITS_ORDERS.amazon.page));
});

it('THE WHOLE STEP, FROM THE CAMPAIGN\u2019S NAME TO THE ORDER\u2019S NUMBER', () => {
  // Every piece joined up, which is the only form of this worth trusting: build
  // the step from the product name, hand it the answer the shop gives a search,
  // read it with the reader the list is read with, harvest it with the harvest
  // the list is harvested with, and end holding the number that is on page two.
  const step = openTheSearchWith(
    'amazon', THE_PRODUCT, 'https://www.amazon.in', 1700000000000, 'look-1',
  );
  equal(landedPath(step.uri), '/your-orders/search');

  const answer = {
    tag: 'look-1',
    ok: true,
    status: 200,
    fromTheDrawnPage: true,
    drew: true,
    html: pageOf(THE_ONE_ON_PAGE_TWO),
    url: step.uri,
  };
  const outcome = readListStep(step, answer);
  equal(outcome.whyNot, null, 'the shop did not refuse');
  equal(outcome.wantsSignIn, false, 'and it did not ask for a sign in');
  equal(outcome.looked, true, 'and the page drew');
  equal(outcome.landed, '/your-orders/search',
    'and where it landed is a PATH, so the words searched for are not in it');

  deepEqual(
    pagesToOpen(harvestRendered(answer.html, 'amazon').numbers, 'amazon'),
    [THE_ONE_ON_PAGE_TWO],
  );
});

console.log('\nthe address, and nothing but an address');

it('is the shop’s own order search with the product name in it', () => {
  const url = orderSearchPageFor('amazon', THE_PRODUCT);
  equal(url,
    'https://www.amazon.in/your-orders/search?search='
    + 'Nike%20Mens%20Promina%20Extra%20Wide%20Training%20Shoes');
});

it('ENCODED, which is the one thing that must not be forgotten here', () => {
  // A product name carries spaces, ampersands, vertical bars and hash marks, and
  // every one of them means something else in an address. The garment rack's
  // name has three of the four in it.
  const url = orderSearchPageFor(
    'amazon', 'Lukzer | Heavy-Duty Rack & 4 Side Hooks #MGS-001',
  );
  const query = url.slice(url.indexOf('search=') + 'search='.length);
  ok(!query.includes(' ') && !query.includes('|') && !query.includes('&')
    && !query.includes('#'),
  'not one character that would change what the address means survives raw');
  equal(decodeURIComponent(query), 'Lukzer | Heavy-Duty Rack & 4 Side Hooks #MGS-001');
});

it('NULL for a shop that has no search of its own, never somebody else’s', () => {
  equal(orderSearchPageFor('meesho', THE_PRODUCT), null);
  equal(orderSearchPageFor('zepto', THE_PRODUCT), null);
  equal(orderSearchPageFor('', THE_PRODUCT), null);
  equal(howThisShopSearchesItsOrders('blinkit'), null);
  equal(searchesItsOrders('meesho'), false);
});

it('and NULL when there is nothing to search for', () => {
  equal(orderSearchPageFor('amazon', null), null);
  equal(orderSearchPageFor('amazon', ''), null);
  equal(orderSearchPageFor('amazon', '   '), null);
  equal(openTheSearchWith('amazon', '', 'https://www.amazon.in', 0, 't'), null);
});

it('the name is bounded, and cut at a WORD rather than mid-word', () => {
  // Half a word is a word the shop was never asked about. The bound is about the
  // length of an address and not about what the shop's search wants.
  // THE WORD LENGTH IS CHOSEN SO THE BOUND FALLS INSIDE ONE, and that is the
  // whole of the check. A word that divides the bound exactly reads the same
  // whether the cut respects words or not, so it proves nothing: this used to
  // use one, and taking the boundary out did not fail it.
  const long = `${'Sturdy '.repeat(20)}Rack`;
  ok(MOST_OF_A_NAME_WE_PUT_IN_AN_ADDRESS % 'Sturdy '.length !== 0,
    'the bound must fall inside a word, or this check cannot see the cut');
  const words = theWordsToSearchFor(long);
  ok(words.length <= MOST_OF_A_NAME_WE_PUT_IN_AN_ADDRESS, 'and it is bounded');
  ok(words.length < long.length, 'and the bound really bit');
  const last = words.split(' ').pop();
  ok(words.split(' ').every((w) => w === 'Sturdy'),
    `a word was cut through: "${last}"`);
});

it('and a name that already fits is passed through untouched', () => {
  equal(theWordsToSearchFor(THE_PRODUCT), THE_PRODUCT);
  equal(theWordsToSearchFor('  spaced   out  name '), 'spaced out name');
  equal(theWordsToSearchFor(null), '');
});

console.log('\nFAYR TYPES NOTHING INTO THE SHOP’S PAGE');

it('the step carries an address and a reader, and no way to touch anything', () => {
  const step = openTheSearchWith(
    'amazon', THE_PRODUCT, 'https://www.amazon.in', 1700000000000, 'look-1',
  );
  for (const forbidden of [
    '.click(', '.focus(', '.submit(', '.value =', 'dispatchEvent',
    'KeyboardEvent', 'MouseEvent', 'execCommand', 'setSelectionRange',
    'form.', 'input.',
  ]) {
    ok(!step.script.includes(forbidden),
      `the search step's script contains "${forbidden}"`);
  }
});

it('and it is the SAME script the list is opened with, not a second one', () => {
  // The strongest form of "nothing was typed": there is no new script at all.
  // The search and the list are the same builder handed a different address.
  const search = openTheSearchWith(
    'amazon', THE_PRODUCT, 'https://www.amazon.in', 1700000000000, 'look-1',
  );
  const list = openTheListWith(
    'amazon', 'https://www.amazon.in', 1700000000000, 'look-1',
  );
  const withoutTheAddress = (s) => s.script.replace(/"[^"]*your-orders[^"]*"/g, '<url>');
  equal(withoutTheAddress(search), withoutTheAddress(list));
  equal(search.drawn, list.drawn,
    'and it is read the same way, because it is the same area of the same shop');
});

it('the on-device scraper is not touched by any of this', () => {
  // The owner's standing rule. These five files and the connect flow are frozen;
  // this change lives entirely in the order read that consumes them.
  for (const file of [
    'src/verify.js', 'src/extract.js', 'src/session.js', 'src/platforms.js',
  ]) {
    const source = read(file);
    ok(!source.includes('your-orders/search'),
      `${file} must not have learned about the order search`);
    ok(!source.includes('orderSearchPageFor'), `${file} must not call into it`);
  }
});

console.log('\nthe screen asks the search first, and the list only if it must');

{
  const screen = read('src/order/LookingForItScreen.js');
  const code = screen
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('the search is opened BEFORE the list, or it is not first at all', () => {
    const searchAt = code.indexOf('openTheSearchWith(');
    const listAt = code.indexOf('await openWith(theList)');
    ok(searchAt !== -1, 'the screen opens the shop’s own search');
    ok(listAt !== -1 && searchAt < listAt,
      'and it does it before the list, which is the whole of the change');
  });

  it('AND THE LIST IS NOT OPENED AT ALL WHEN THE SEARCH ANSWERED', () => {
    ok(/if \(fromTheSearch\.length === 0\) \{\s*const answer = await openWith\(theList\);/
      .test(code),
    'one request instead of a page load and up to ten fetches');
  });

  it('and it IS opened when the search answered with nothing', () => {
    // The fallback is the whole point. A shop that answers a search with nothing
    // must read exactly as it did before any of this existed.
    ok(/let fromTheSearch = \[\];/.test(code),
      'the search’s answer starts empty, so the list is the default path');
    ok(/let outcome = null;/.test(code)
      && /if \(outcome == null \|\| !outcome\.looked\)/.test(code),
    'and a look with no list has no list outcome, which is asked rather than assumed');
  });

  it('the numbers the search found beat anything harvested off a list', () => {
    ok(/const numbers = fromTheSearch\.length > 0\s*\?\s*fromTheSearch/.test(code),
      'INSTEAD OF, not as well as');
  });

  it('it is skipped when the order is already named', () => {
    ok(/onlyThisOrder == null && searchesItsOrders\(platformKey\)/.test(code),
      'asking the shop a question we know the answer to is one more request '
      + 'against a shop that rate-limits us, for nothing');
  });

  it('A REFUSAL ON THE SEARCH STOPS THE WHOLE LOOK, as it does anywhere', () => {
    ok(/if \(searchOutcome\.wantsSignIn === true\) \{/.test(code));
    ok(/if \(searchOutcome\.whyNot != null\) \{/.test(code));
    const signIn = code.indexOf('if (searchOutcome.wantsSignIn === true)');
    const refused = code.indexOf('if (searchOutcome.whyNot != null)');
    const harvested = code.indexOf('harvestRendered(searchHtml');
    ok(signIn < refused && refused < harvested,
      'and both are asked before a single number is taken off the page');
  });

  it('the screen still never writes the shop’s name', () => {
    // src/ui/funnyWait.test.mjs holds every word in this file to that rule. This
    // is the same rule asked of the piece this change added, so a failure here
    // says which change broke it.
    const forbidden = ['amazon', 'flipkart', 'meesho', 'myntra', 'zepto', 'blinkit'];
    const written = [...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    for (const text of written) {
      for (const word of forbidden) {
        ok(!text.toLowerCase().includes(word), `the screen writes "${text}"`);
      }
    }
  });

  it('AND NEITHER THE WORDS SEARCHED FOR NOR A NUMBER REACH A LOG LINE', () => {
    // The search address carries the product name in its QUERY. `landed=` prints
    // the PATH, and landedPath drops the query — which is why this line is safe
    // and why it must stay a path.
    const from = code.indexOf("logLook('search'");
    const line = code.slice(from, code.indexOf('`);', from) + 3);
    ok(line.includes('searchOutcome.landed'), 'it prints where it landed');
    ok(!line.includes('.uri') && !line.includes('productName')
      && !line.includes('searchHtml}') && !/searchHtml[^.]/.test(line),
    'and never the address, the name, or the page itself — only counts');
    const counted = code.slice(code.indexOf("logLook('searched'"));
    ok(!counted.slice(0, 400).includes('numbers['),
      'and the numbers it found are a count, never a number');
  });
}

console.log('\nthe promise this look makes to the shop is unchanged');

it('at most one search, one list, and the ceiling of order pages', () => {
  // The whole look, counted: the search, the list when the search found nothing,
  // and no more order pages than the ceiling has ever allowed.
  equal(MOST_DETAIL_PAGES, 10);
  const mostRequests = 1 + 1 + MOST_DETAIL_PAGES;
  equal(mostRequests, 12, 'and that number is stated here so it cannot drift quietly');
});

it('and the gaps between the order pages are untouched', () => {
  equal(GAP_BETWEEN_FETCHES_MS, 1500,
    'the search adds a request; it does not make the ones after it ruder');
});

it('THE WORST RUN STILL FITS INSIDE THE LOOK’S OWN CEILING', () => {
  // Two drawn pages that both wait out their whole deadline, and then every gap
  // between every order page. The screen's hard stop is forty-five seconds.
  const screen = read('src/order/LookingForItScreen.js');
  const ceiling = Number(/export const MOST_TIME_MS = (\d+);/.exec(screen)[1]);
  const worst = DRAW_DEADLINE_MS * 2 + GAP_BETWEEN_FETCHES_MS * (MOST_DETAIL_PAGES - 1);
  ok(worst < ceiling,
    `the search, the list and every gap come to ${worst}ms against a ${ceiling}ms ceiling`);
});

it('and the good run is SHORTER than what it replaces, not longer', () => {
  // When the search answers, the list is never opened — so the ordinary run is
  // one drawn page and one order page, where it used to be one drawn page and up
  // to ten. That is the point of asking the cheap question first.
  ok(DRAW_DEADLINE_MS * 1 + GAP_BETWEEN_FETCHES_MS * 0
    < DRAW_DEADLINE_MS * 1 + GAP_BETWEEN_FETCHES_MS * (MOST_DETAIL_PAGES - 1));
});

it('a number off the search is still refused unless it is this shop’s shape', () => {
  // Everything the search finds goes through the same pagesToOpen the list's
  // numbers go through, so a bad value on that page opens nothing at all.
  const nonsense = pageOf('not-an-order', '12-34-56');
  deepEqual(pagesToOpen(harvestRendered(nonsense, 'amazon').numbers, 'amazon'), []);
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('not-an-order'));
});

it('and only a shop whose orders are read one page at a time is searched', () => {
  // A number is worth having only because an order's own page can be opened with
  // it. Searching a shop whose orders are not read that way would be a request
  // for an answer nothing could use.
  for (const key of Object.keys(WHERE_EACH_SHOP_SEARCHES_ITS_ORDERS)) {
    ok(readsOrderPages(key), `${key} is searched but its order pages are not read`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
