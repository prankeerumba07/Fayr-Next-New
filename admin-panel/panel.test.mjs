// Guards on the staff console.
//
// The panel is a single static file with no build step, so a typo ships silently
// and only shows up as a blank screen in front of whoever is demoing. These are
// the checks that would have caught each way this file has been broken or could
// be:
//
//   - a syntax error anywhere in a 100KB script tag;
//   - a tab wired into the sidebar but not into the router, the title map or the
//     role map — which renders an empty pane for one role and not another;
//   - the panel growing its OWN money arithmetic. Three defects so far have come
//     from a number reached by a second route, and a staff console that
//     multiplies an amount by a percentage itself would be the fourth.

import fs from 'node:fs';
import path from 'node:path';

const file = path.join(import.meta.dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. the whole script parses ===');
{
  ok(script.length > 1000, 'the script block was found');
  let parsed = true, err = null;
  try { new Function(script); } catch (e) { parsed = false; err = e.message; }
  ok(parsed, 'index.html parses as JavaScript' + (err ? ` (${err})` : ''));
}

console.log('\n=== 2. every section is wired all the way through ===');
{
  // Section ids, read out of the TEAMS structure the sidebar is built from.
  const teamsBlock = (script.match(/var TEAMS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const ids = [...teamsBlock.matchAll(/\["([a-z]+)",\s*"[^"]+",\s*"[^"]*"\]/g)].map((m) => m[1]);
  ok(ids.length >= 9, `found ${ids.length} sections across the teams`);
  for (const id of ids) {
    ok(new RegExp(`\\b${id}:\\s*\\[`).test(script), `${id} has a role list (TAB_ROLES)`);
    ok(new RegExp(`\\b${id}:\\s*\\[\\s*"`).test(script), `${id} has a screen title`);
    ok(
      new RegExp(`state\\.screen === "${id}"`).test(script),
      `${id} is dispatched by the router — not a tab that opens an empty pane`,
    );
  }
  ok(ids.includes('amounts'), 'the unit-count queue is reachable, not hidden in a menu');
  ok(ids.includes('reviews'), 'the review-check queue is reachable too — a power with no queue is a dead end');
}

console.log('\n=== 2b. the four teams, and nothing lost on the way to them ===');
{
  // THE RISK THIS SECTION EXISTS FOR. Nine sections were regrouped into four
  // teams by hand. The way that goes wrong is silently: a section left out of the
  // new structure is still routed, still permitted, still loads — and simply
  // cannot be reached by anybody. Nothing errors.
  const teamsBlock = (script.match(/var TEAMS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const teams = [...teamsBlock.matchAll(/\n      \["([a-z]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
  ok(teams.length === 4, `four teams, found ${teams.length}: ${teams.map((t) => t[1]).join(', ')}`);

  // Who owns what, as decided. Not a guess — the ownership was named, and if it
  // moves, it moves here first.
  const OWNERSHIP = {
    finance: ['withdrawals', 'reports'],
    support: ['queue', 'chat', 'answers', 'verifications', 'reviews'],
    operations: ['amounts', 'staff', 'search'],
    fops: ['offers', 'livepages', 'campaigns'],
  };
  for (const [key, expected] of Object.entries(OWNERSHIP)) {
    // Each team's own block, from its key to the start of the next team.
    const at = teamsBlock.indexOf(`["${key}",`);
    ok(at >= 0, `the ${key} team exists`);
    if (at < 0) continue;
    const nextAt = teams
      .map((t) => teamsBlock.indexOf(`["${t[0]}",`))
      .filter((i) => i > at)
      .sort((a, b) => a - b)[0];
    const block = teamsBlock.slice(at, nextAt === undefined ? undefined : nextAt);
    const sections = [...block.matchAll(/\["([a-z]+)",\s*"[^"]+",\s*"[^"]*"\]/g)].map((m) => m[1]);
    ok(
      JSON.stringify(sections) === JSON.stringify(expected),
      `${key} owns exactly [${expected.join(', ')}] — found [${sections.join(', ')}]`,
    );
  }

  // Every section that existed before the regrouping is still reachable, in
  // exactly one team. This is the assertion that catches a dropped tab.
  const BEFORE = ['withdrawals', 'queue', 'verifications', 'amounts', 'reviews', 'campaigns', 'reports', 'search', 'staff'];
  const all = [...teamsBlock.matchAll(/\["([a-z]+)",\s*"[^"]+",\s*"[^"]*"\]/g)].map((m) => m[1]);
  for (const id of BEFORE) {
    ok(
      all.filter((x) => x === id).length === 1,
      `${id} appears in exactly one team (${all.filter((x) => x === id).length})`,
    );
  }
  ok(all.includes('offers'), 'the offer check has a home, in the team that owns the offers');

  // Every ROUTED screen belongs to a team, or it is unreachable. 'user' is the one
  // exception and it is reached from a search result, never from the sidebar.
  const routed = [...script.matchAll(/state\.screen === "([a-z]+)"/g)].map((m) => m[1]);
  for (const id of new Set(routed)) {
    ok(
      id === 'user' || all.includes(id),
      `${id} is routed AND reachable from the sidebar`,
    );
  }
}

console.log('\n=== 2c. the offer check reads the server, and never grades a picture itself ===');
{
  // The check is a backend job. The panel's job is to show what it found — so the
  // panel must not start deciding what counts as a problem, or there would be two
  // definitions of a broken offer and the tab would disagree with the nightly run.
  ok(/admin\/campaign-health/.test(script), 'the tab reads /admin/campaign-health');
  // Scoped to the screen itself: the campaign EDITOR legitimately handles a cap,
  // because that is where a cap is set. What must not happen is this tab deciding
  // what counts as a problem, which would give a broken offer two definitions.
  const screen = (script.match(/function OffersScreen\(\)[\s\S]*?\n    function GroupBlock/) || [''])[0];
  ok(screen.length > 500, 'found the offer-check screen');
  ok(
    !/looksLikeImage|payoutCapPaise|productPricePaise|payoutPercent/.test(screen),
    'and it judges nothing itself — every word and severity comes from the server',
  );
  ok(!/relTime|Math\.floor\(.*60/.test(screen), 'and it does not invent its own clock arithmetic');
  ok(/newSinceLastRun/.test(script), 'it shows what is new since the last nightly run');
  ok(/lastRun/.test(script), 'and when that run was, so silence can be told from staleness');
}

console.log('\n=== 2d. the offer-check screen actually renders ===');
{
  // WHY A RENDER TEST AND NOT ANOTHER GREP. The parse check above catches a
  // syntax error; it does not catch calling a helper that does not exist. The
  // first version of this screen called relTime(), which was never written — the
  // file parsed, every grep passed, and the tab would have thrown on open in
  // front of whoever was demoing.
  //
  // So the screen's own functions are lifted out and called with a stub h() and a
  // realistic report. No DOM, no browser: the point is that every name it reaches
  // for resolves.
  // One contiguous span: the screen and the three helpers only it uses, from its
  // own definition up to the next screen's.
  const from = script.indexOf('function OffersScreen()');
  const to = script.indexOf('function CampaignsScreen()');
  const src = from >= 0 && to > from ? script.slice(from, to) : '';
  ok(src.includes('OffersScreen') && src.includes('sevPill'), 'the screen\'s functions were found');

  const REPORT = {
    report: {
      ranAt: '2026-08-26T06:15:00.000Z',
      checked: 13,
      counts: { blocking: 1, attention: 3, unchecked: 21 },
      offers: [{
        campaignId: 'c1', title: 'Rate a Cotton Kurta Set', platform: 'MEESHO',
        findings: [{ code: 'picture-missing', severity: 'blocking', title: 'This offer has no picture', detail: 'A placeholder shows instead.' }],
      }],
      patterns: [{
        code: 'return-window-is-the-default', severity: 'attention',
        title: 'These offers fall back to the default return window',
        detail: 'Ten of them.', offers: [{ campaignId: 'c2', title: 'Another offer' }],
      }],
      limits: [{
        code: 'picture-not-verified', severity: 'unchecked',
        title: 'Nobody can tell whether these pictures are the right products',
        detail: 'No product links.', offers: [{ campaignId: 'c3', title: 'A third offer' }],
      }],
    },
    lastRun: { ranAt: '2026-08-26T06:15:00.000Z', trigger: 'SCHEDULED', checked: 13, blocking: 1, attention: 3, unchecked: 21 },
    newSinceLastRun: [{ campaignId: 'c1', title: 'Rate a Cotton Kurta Set', code: 'picture-missing', severity: 'blocking' }],
  };

  // A stub h() that records the tree as plain objects, and the two helpers the
  // screen borrows from the rest of the panel.
  const harness = `
    var seen = [];
    function h(tag, attrs) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var node = { tag: tag, attrs: attrs || {}, kids: kids };
      seen.push(node);
      return node;
    }
    function fmtDate(iso) { return new Date(iso).toISOString(); }
    var state = { offers: { loading: false, error: null, data: DATA, busy: false } };
    function loadOffers() {}
    ${src}
    return { tree: OffersScreen(), seen: seen };
  `;

  for (const [label, data] of [
    ['a full report', REPORT],
    ['a clean catalogue', { ...REPORT, report: { ...REPORT.report, offers: [], counts: { blocking: 0, attention: 0, unchecked: 4 } } }],
    ['no nightly run yet', { ...REPORT, lastRun: null, newSinceLastRun: [] }],
    ['no patterns or limits', { ...REPORT, report: { ...REPORT.report, patterns: [], limits: [] } }],
  ]) {
    let threw = null, out = null;
    try {
      out = new Function('DATA', harness)(data);
    } catch (e) { threw = e.message; }
    ok(!threw, `renders ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (out) {
      const text = JSON.stringify(out.seen);
      ok(!/undefined/.test(text), `${label}: nothing renders as "undefined"`);
      ok(!/NaN/.test(text), `${label}: no NaN reaches the screen`);
    }
  }

  // And the words a reader actually needs are in the output, not just the shape.
  const out = new Function('DATA', harness)(REPORT);
  const text = JSON.stringify(out.seen);
  ok(/Last automatic check/.test(text), 'it says when the nightly check last ran');
  ok(/This offer has no picture/.test(text), 'the finding\'s own words are shown');
  ok(/new/.test(text), 'and what is new since that run is marked');

  const clean = new Function('DATA', harness)({ ...REPORT, report: { ...REPORT.report, offers: [] } });
  ok(
    /Nothing\./.test(JSON.stringify(clean.seen)),
    'a clean catalogue says so in words rather than showing an empty box',
  );
}

console.log('\n=== 3. the panel never computes money itself ===');
{
  // It may DISPLAY payoutPercent and it may pass a quantity to the server. It may
  // not do arithmetic that reproduces the payout.
  const arithmetic = /payoutPercent\s*[*/]|[*/]\s*payoutPercent|itemPaise\s*\*|\*\s*itemPaise/;
  ok(!arithmetic.test(script), 'no percentage arithmetic on an amount anywhere in the panel');
  ok(script.includes('quantity-preview'),
    'what a count will pay comes from the server preview, the same resolver the payout uses');
}

console.log('\n=== 4. the reason for a payout decision cannot be empty ===');
{
  // An audit row that says nothing is worse than none: it looks like diligence.
  const card = (script.match(/function AmountCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the unit-count card was found');
  ok(/reasonIn\.value\.trim\(\)\.length\s*<\s*3/.test(card),
    'submitting is refused when the reason is blank');
  ok(!/placeholder[^)]*"confirmed"/i.test(card) && !/value:\s*"confirmed"/i.test(card),
    'and there is no invented default like "confirmed"');
  ok(/required/i.test(card), 'the field is labelled as required to the person typing');
}

console.log('\n=== 5. a correction reads as a correction ===');
{
  ok(script.includes('is already on file'),
    'an existing count is stated back before it can be overwritten');
  ok(script.includes('Save correction'), 'and the button says so');
}

console.log('\n=== 4b. the AMOUNT control, which is the dangerous one ===');
{
  const card = (script.match(/function AmountFigureCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the amount card was found');

  // Rupees in the field, integer paise on the wire. A float conversion
  // (Math.round(x * 100)) is the classic way money loses a paise.
  ok(/BigInt/.test(card), 'rupees are converted to paise in exact integer arithmetic');
  ok(!/\*\s*100\b(?![n])/.test(card), 'no float multiplication by 100 anywhere in the conversion');

  // All four gates the server enforces have to be visible to the person typing,
  // or they find out by being refused.
  ok(/Where you read it/.test(card), 'WHERE the figure came from is asked for');
  ok(/sourceSel\.value !== ""/.test(card), 'and submitting is refused without it');
  ok(/What you saw/.test(card), 'and what they saw is asked for separately');
  ok(/reasonIn\.value\.trim\(\)\.length >= 3/.test(card), 'which cannot be blank either');
  ok(/The offer says/.test(card), "the campaign's own price is shown beside the field");
  ok(/Most this can be/.test(card), 'the ceiling is shown, with which real figure produced it');
  ok(/needsAck/.test(card) && /ackBox\.checked/.test(card),
    'a disagreement has to be acknowledged before it can be saved');
  ok(/amount-preview/.test(card), 'what it pays comes from the server, not from local arithmetic');
  ok(/Save correction/.test(card), 'and a mistyped figure can still be corrected afterwards');
}

console.log('\n=== 4c. the panel\'s source list matches the server\'s ===');
{
  // A value the server does not accept would 400 at the last moment, after the
  // reviewer has done the work of reading the document.
  const types = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'backend', 'src', 'tasks', 'engine', 'evidence.types.ts'),
    'utf8',
  );
  const block = (types.match(/AMOUNT_EVIDENCE_SOURCES = \[([\s\S]*?)\] as const/) || [])[1] || '';
  const server = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  ok(server.length === 5, `the server offers ${server.length} sources`);
  for (const value of server) {
    ok(script.includes(`"${value}"`), `the panel offers "${value}" too`);
  }
}

console.log('\n=== 4d. the eyes-on-page review check ===');
{
  const card = (script.match(/function ReviewCheckCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the review-check card was found');

  // This action settles `published`, which is what starts the holding period. So
  // it is held to the same standard as the amount: WHERE, and WHAT you saw.
  ok(/The page you opened/.test(card), 'the page the reviewer opened is asked for');
  ok(/https\?:/.test(card), 'and it has to look like a real http(s) address');
  ok(/What you saw/.test(card), 'what they saw is asked for separately');
  ok(/reasonIn\.value\.trim\(\)\.length >= 3/.test(card), 'and it cannot be blank');
  ok(!/placeholder[^)]*"confirmed"/i.test(card) && !/value:\s*"confirmed"/i.test(card),
    'with no invented default like "confirmed"');
  ok(/required/i.test(card), 'both fields are labelled as required to the person typing');

  // A confirmation that cannot be taken back is a one-way door on a payout signal.
  ok(/withdraw/i.test(card), 'a reviewer who was wrong can withdraw it');
  ok(/Save correction/.test(card), 'and a second answer reads as a correction');
  ok(/already confirmed/i.test(card), 'an existing confirmation is stated back before it is overwritten');

  // The hole this action creates has to be visible ON the card, not only in a
  // document nobody reads while doing the work.
  ok(/cannot check it again/i.test(card),
    'the card says plainly that nothing can ever re-check this one');

  // No local verdict-making: the server decides whether this may be recorded.
  ok(/review-visible/.test(card), 'the decision goes to the server, which owns every gate');

  // The reviewer has to FIND the review before they can confirm it. On a product
  // page with two hundred reviews that is not a task anybody does reliably from a
  // rating alone — and on Meesho nothing automatic can narrow it down for them.
  ok(/What to look for/.test(card), 'the review\'s own words are shown');
  ok(/reviewText/.test(card) && /reviewTitle/.test(card), 'both the body and the title');
  ok(/mediaCount/.test(card), 'and the photo count, which is what makes one easy to spot');
  ok(/no words from this review/.test(card),
    'and it says so plainly when there are none, rather than showing an empty heading');
}

console.log('\n=== 5b. no banner is invisible ===');
{
  // `.flash` on its own has padding but no colour or background — text in one is
  // effectively invisible. Every banner needs a modifier.
  ok(!/class:\s*"flash"/.test(script),
    'every flash banner carries flash-info or flash-err, never a bare flash');
}

console.log('\n=== 6. the hold is explained in words, never as an enum ===');
{
  ok(script.includes('heldExplanation'), 'the server sentence is rendered');
  ok(script.includes('whyNoMachineCheck'), 'and so is the review-check sentence');
  ok(!/quantity-unknown|quantity-not-divisible/.test(script),
    'no internal reason string is printed to the screen');
  ok(!/staff-confirmed-visible|publishedSource/.test(script),
    'no internal source name is printed to the screen either');
}

/** The section ids one team owns, read out of the sidebar's own structure. */
function teamsFor(key) {
  const block = (script.match(/var TEAMS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const all = new Function('return [' + block + ']')();
  const team = all.find((t) => t[0] === key);
  return team ? team[3].map((sec) => sec[0]) : [];
}

console.log('\n=== 7. the assistant screens ===');
{
  // Both sit under Customer support, because the answer book and the questions
  // people ask are that team's work.
  const teamsBlock = (script.match(/var TEAMS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const teams = new Function('return [' + teamsBlock + ']')();
  const support = teams.find((t) => t[0] === 'support');
  const ids = support[3].map((sec) => sec[0]);
  ok(ids.includes('chat'), 'Chat questions is a Customer support section');
  ok(ids.includes('answers'), 'the Answer book is a Customer support section');

  ok(/chat:\s*\["SUPPORT", "ADMIN"\]/.test(script),
    'chat questions are gated to support and admin on this side too');
  ok(/answers:\s*\["SUPPORT", "ADMIN"\]/.test(script),
    'the answer book is gated the same way');

  ok(script.includes('/admin/assistant/questions'), 'it reads the real queue');
  ok(script.includes('/admin/assistant/answers'), 'and the real answer book');
  ok(script.includes('/admin/assistant/stats'), 'and the real resolution times');

  // The plain-language check is the SERVER'S. A second copy of the rule in this
  // file would drift from the one that actually refuses an approval.
  ok(script.includes('/admin/assistant/answers/check'),
    'the wording warning comes from the server, not from a copy of the rule here');
  ok(!/JARGON|MAX_WORDS_PER_SENTENCE/.test(script),
    'the panel holds no copy of the plain-language rule');

  // A drafted answer must SAY it has not been read by anybody.
  ok(script.includes('No person has read this yet'),
    'a drafted answer says out loud that nobody has approved it');
  ok(script.includes('Nobody who speaks this language has checked the wording'),
    'and a non-English draft says the wording is unchecked');
  ok(script.includes('Approve and make live'), 'there is a clear approve action');
}

console.log('\n=== 7d. no personal detail travels in a web address ===');
{
  // A mobile number in an address lands in this laptop's browser history and in
  // every log between here and the server. The search sends it in the body.
  ok(!/\/admin\/users\/search\?/.test(script),
    'the user search does not put the mobile number in the address');
  ok(script.includes('"POST", "/admin/users/search"'),
    'it posts the number in the body instead');
  ok(!/api\("GET",\s*"[^"]*\?[^"]*mobile/.test(script),
    'and nothing else puts a mobile number in a query string either');
}

console.log('\n=== 7c. the live page check screen ===');
{
  ok(teamsFor('fops').includes('livepages'),
    'Live pages is a Front-end operations section');
  ok(/livepages:\s*\["OPERATIONS", "ADMIN"\]/.test(script),
    'gated to operations and admin, the team that owns what is live');
  ok(script.includes('/admin/live-check'), 'it reads the real findings');
  // The honest headline: most offers carry no shop page, so most of the catalogue
  // cannot be looked at, and the screen has to lead with that not with "all clear".
  ok(script.includes('have no page saved'), 'it says how many cannot be checked at all');
  ok(script.includes('Not a pass and not a failure'),
    'and says plainly that could-not-look is neither');
  ok(script.includes('go to My Profile, then Check offer pages'),
    'it says how to run it, because it cannot run itself');
}

console.log('\n=== 7b. the assistant screens actually render ===');
{
  // Same reasoning as 2d: a parse check cannot catch a call to a helper that does
  // not exist. Both screens are lifted out and rendered against realistic data.
  const from = script.indexOf('// ── assistant screens: begin');
  const to = script.indexOf('// ── assistant screens: end');
  const src = from >= 0 && to > from ? script.slice(from, to) : '';
  ok(src.includes('ChatQuestionsScreen') && src.includes('AnswerBookScreen'),
    "both screens' functions were found");

  const QUESTIONS = [
    {
      id: 'q1', askedAt: '2026-08-27T06:00:00.000Z',
      rawText: 'mera refund kab aayega',
      language: { tag: 'hi-en', name: 'Hindi written in English letters', confidence: 88 },
      status: 'ANSWERED',
      answer: {
        origin: 'ANSWER_BOOK', text: 'Aapka paisa review dikhne ke baad aata hai.',
        score: 91, revision: 1,
        entry: { id: 'a1', key: 'refund-not-arrived', language: 'hi-en', languageName: 'Hindi written in English letters', title: 'Aapka paisa abhi tak wapas nahi aaya', revision: 1, status: 'PUBLISHED' },
      },
      helpful: true, helpfulAt: '2026-08-27T06:01:00.000Z',
      resolvedAt: '2026-08-27T06:01:00.000Z', secondsToResolve: 60, timeToResolve: '1 minute',
      user: { id: 'u1', displayId: 'FAYR-100004' },
    },
    {
      id: 'q2', askedAt: '2026-08-27T05:00:00.000Z',
      rawText: 'do you deliver to Kathmandu',
      language: { tag: 'en', name: 'English', confidence: 80 },
      status: 'UNRESOLVED', answer: null, helpful: null, helpfulAt: null,
      resolvedAt: null, secondsToResolve: null, timeToResolve: null,
      user: { id: 'u2', displayId: 'FAYR-100011' },
    },
  ];
  const STATS = {
    windowDays: 30, asked: 40, answered: 12, unresolved: 8, resolved: 20,
    saidItHelped: 18, saidItDidNotHelp: 2, didNotSay: 20,
    resolution: {
      counted: 20,
      fastest: { seconds: 30, inWords: '30 seconds' },
      typical: { seconds: 1200, inWords: '20 minutes' },
      slowest: { seconds: 86400, inWords: '1 day' },
      nineOutOfTenWithin: { seconds: 7200, inWords: '2 hours' },
    },
  };
  const ANSWERS = [
    { id: 'a1', key: 'tickets', language: 'en', languageName: 'English', title: 'What tickets are', body: 'Tickets are what you spend to join an offer.', topic: 'tickets', status: 'DRAFT', origin: 'ASSISTANT', revision: 1, waysOfAsking: 5, updatedByStaffId: null, createdAt: '2026-08-27T05:00:00.000Z', updatedAt: '2026-08-27T05:00:00.000Z' },
    { id: 'a2', key: 'tickets', language: 'hi', languageName: 'Hindi', title: 'टिकट क्या हैं', body: 'ऑफर में शामिल होने के लिए टिकट खर्च होते हैं।', topic: 'tickets', status: 'DRAFT', origin: 'ASSISTANT', revision: 1, waysOfAsking: 3, updatedByStaffId: null, createdAt: '2026-08-27T05:00:00.000Z', updatedAt: '2026-08-27T05:00:00.000Z' },
    { id: 'a3', key: 'refund-timing', language: 'en', languageName: 'English', title: 'When your money comes back', body: 'After your review is live.', topic: 'refund', status: 'PUBLISHED', origin: 'STAFF', revision: 3, waysOfAsking: 8, updatedByStaffId: 's1', createdAt: '2026-08-27T05:00:00.000Z', updatedAt: '2026-08-27T05:00:00.000Z' },
    { id: 'a4', key: 'old-one', language: 'en', languageName: 'English', title: 'An old answer', body: 'Withdrawn.', topic: 'about', status: 'RETIRED', origin: 'SEED', revision: 2, waysOfAsking: 0, updatedByStaffId: null, createdAt: '2026-08-27T05:00:00.000Z', updatedAt: '2026-08-27T05:00:00.000Z' },
  ];

  const harness = `
    var seen = [];
    function h(tag, attrs) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var node = { tag: tag, attrs: attrs || {}, kids: kids, value: "",
                   oninput: null, onblur: null, onchange: null,
                   appendChild: function (k) { this.kids.push(k); } };
      seen.push(node);
      return node;
    }
    function fmtDate(iso) { return new Date(iso).toISOString(); }
    function Stat(v, l, tone) { return h("div", { class: "stat stat-" + (tone || "") }, v, l); }
    function sevPill(sev) { return h("span", { class: "sev sev-" + sev }, sev); }
    function setChatFilter() {} function closeChatQuestion() {}
    function setAnswerFilter() {} function editAnswer() {} function cancelAnswerEdit() {}
    function checkAnswerWords() {} function saveAnswer() {} function setAnswerLive() {}
    var state = STATE;
    ${src}
    return { chat: ChatQuestionsScreen(), book: AnswerBookScreen(), live: LivePagesScreen(), seen: seen };
  `;

  const LIVE = {
    lastRun: {
      ranAt: '2026-08-27T04:00:00.000Z', startedByStaffId: 's1', checked: 13,
      opened: 2, expired: 1, soldOut: 0, unavailable: 0, couldNotOpen: 1, noLink: 9,
      findings: [
        { campaignId: 'c1', title: 'Rate a Cotton Kurta Set', platform: 'MEESHO', state: 'expired', says: 'The page says this offer has ended.', httpStatus: 200, evidence: 'The page says "this offer has ended".', greyedOutInTheApp: true },
        { campaignId: 'c2', title: 'Carry Your Laptop', platform: 'AMAZON', state: 'no-link', says: 'This offer has no shop page saved, so there was nothing to open.', httpStatus: null, evidence: 'This offer has no shop page saved.', greyedOutInTheApp: false },
        { campaignId: 'c3', title: 'Prestige cooktop', platform: 'AMAZON', state: 'could-not-open', says: 'We could not open the page, so we do not know either way.', httpStatus: 0, evidence: 'Nothing came back from the shop.', greyedOutInTheApp: false },
      ],
    },
    recent: [
      { ranAt: '2026-08-27T04:00:00.000Z', startedByStaffId: 's1', checked: 13, opened: 2, expired: 1, soldOut: 0, unavailable: 0, couldNotOpen: 1, noLink: 9 },
      { ranAt: '2026-08-26T04:00:00.000Z', startedByStaffId: 's1', checked: 13, opened: 3, expired: 0, soldOut: 0, unavailable: 0, couldNotOpen: 1, noLink: 9 },
    ],
    toCheck: { total: 13, withAPage: 4, withNoPage: 9 },
  };

  const liveBranch = (over) => ({ loading: false, error: null, data: LIVE, ...over });

  const chatState = (over) => ({
    chat: { loading: false, error: null, items: QUESTIONS, total: 2, stats: STATS,
            filter: 'UNRESOLVED', busy: null, notice: null, actionError: null, ...over },
    answers: { loading: false, error: null, items: ANSWERS, total: 4,
               filter: { language: '', status: '' }, draft: null, warnings: [],
               busy: null, notice: null, actionError: null },
    livepages: liveBranch(),
  });
  const bookState = (over) => ({
    chat: { loading: false, error: null, items: QUESTIONS, total: 2, stats: STATS,
            filter: 'UNRESOLVED', busy: null, notice: null, actionError: null },
    answers: { loading: false, error: null, items: ANSWERS, total: 4,
               filter: { language: '', status: '' }, draft: null, warnings: [],
               busy: null, notice: null, actionError: null, ...over },
    livepages: liveBranch(),
  });
  const liveState = (over) => ({ ...chatState({}), livepages: liveBranch(over) });

  const states = [
    ['everything present', chatState({})],
    ['still loading', chatState({ loading: true, items: null, stats: null })],
    ['the queue failed', chatState({ items: null, error: 'Could not reach the Fayr server.' })],
    ['an empty queue', chatState({ items: [], total: 0 })],
    ['no resolution times yet', chatState({ stats: { ...STATS, resolution: { counted: 0, fastest: { seconds: null, inWords: null }, typical: { seconds: null, inWords: null }, slowest: { seconds: null, inWords: null }, nineOutOfTenWithin: { seconds: null, inWords: null } } } })],
    ['closing one', chatState({ busy: 'q2' })],
    ['a notice and an error at once', chatState({ notice: 'Closed.', actionError: 'That did not work.' })],
    ['the answer book, loading', bookState({ loading: true, items: null })],
    ['the answer book, empty', bookState({ items: [], total: 0 })],
    ['writing a new answer', bookState({ draft: { id: null, key: '', language: 'en', title: '', body: '', topic: 'refund', phrases: '' } })],
    ['correcting one, with warnings', bookState({ draft: { id: 'a1', key: 'tickets', language: 'en', title: 'What tickets are', body: 'The API endpoint failed.', topic: 'tickets', phrases: 'what are tickets' }, warnings: ['"api" is not a word a person here would use. Instead, say "the app".'] })],
    ['approving one', bookState({ busy: 'a1' })],
    ['the live pages screen', liveState({})],
    ['live pages, loading', liveState({ loading: true, data: null })],
    ['live pages, failed', liveState({ data: null, error: 'Could not reach the Fayr server.' })],
    ['live pages, nobody has run it yet', liveState({ data: { ...LIVE, lastRun: null, recent: [] } })],
    ['live pages, a clean run', liveState({ data: { ...LIVE, lastRun: { ...LIVE.lastRun, expired: 0, findings: [] } } })],
    ['live pages, no offer has a page at all', liveState({ data: { ...LIVE, toCheck: { total: 13, withAPage: 0, withNoPage: 13 } } })],
  ];

  for (const [label, st] of states) {
    let threw = null, out = null;
    try {
      out = new Function('STATE', 'QUESTIONS', 'STATS', 'ANSWERS', harness)(st, QUESTIONS, STATS, ANSWERS);
    } catch (e) { threw = e.message; }
    ok(!threw, `renders ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;

    const flat = JSON.stringify(out.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('NaN'), `${label}: no "NaN" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
  }

  // And no internal name leaks into what a person reads.
  ok(!/ANSWER_BOOK|UNRESOLVED"\s*,\s*"/.test(src) || src.includes('Waiting for approval'),
    'states are shown in words, not as stored names');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
