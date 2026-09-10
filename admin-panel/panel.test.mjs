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
  // THE RISK THIS SECTION EXISTS FOR. Nine sections were regrouped into teams by
  // hand. The way that goes wrong is silently: a section left out of the new
  // structure is still routed, still permitted, still loads — and simply cannot
  // be reached by anybody. Nothing errors.
  //
  // The count was four until 3 September 2026, when "How Fayr is running" was
  // added. It belongs to no single team: it is the answer to "is Fayr working",
  // and every role can open it. So it gets a group of its own, FIRST, and this
  // check counts five. The count is not the point of the check; the ownership
  // table and the orphan hunt below are.
  const teamsBlock = (script.match(/var TEAMS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const teams = [...teamsBlock.matchAll(/\n      \["([a-z]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
  ok(teams.length === 5, `five teams, found ${teams.length}: ${teams.map((t) => t[1]).join(', ')}`);
  ok(teams[0] && teams[0][0] === 'everyone',
    'the page everybody reads is the first thing in the sidebar');

  // Who owns what, as decided. Not a guess — the ownership was named, and if it
  // moves, it moves here first.
  const OWNERSHIP = {
    everyone: ['running'],
    finance: ['withdrawals', 'reports'],
    support: ['queue', 'chats', 'chat', 'answers', 'verifications', 'reviews'],
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

  // sevPill returns a CLASS NAME; statePill returns an ELEMENT. Two of these
  // screens used the first as if it were the second, and the literal text
  // "pill-bad" was drawn on screen. The render test could not catch it, because a
  // wrong string is still a valid child — so this checks it by name.
  ok(!/sevPill\((?!f\.severity|g\.severity)/.test(
        script.slice(script.indexOf('// ── assistant screens: begin'),
                     script.indexOf('// ── assistant screens: end'))),
    'the assistant screens use statePill, not the class-name helper');
  // The styles live in the <style> block, not the <script> one — a class used in
  // the code with no rule behind it renders as an unstyled stack, which is how
  // .stat-row shipped in the first place.
  ok(/\.stat-row\s*\{/.test(html), 'the row of headline numbers is actually styled');
  ok(/minmax\(/.test(html), 'and it wraps by itself, so it works at phone width');
  ok(!/class:\s*"sev /.test(script), 'no screen uses a "sev" class, which was never defined');
}

console.log('\n=== 7e. the conversations screen ===');
{
  ok(teamsFor('support').includes('chats'),
    'Conversations is a Customer support section');
  ok(/chats:\s*\["SUPPORT", "ADMIN"\]/.test(script),
    'gated to support and admin, the team whose work it is');
  ok(script.includes('"/admin/chats"'), 'it reads the real queue');
  ok(script.includes('/take'), 'there is a take action');
  ok(script.includes('/reply'), 'and a reply action');

  const from = script.indexOf('function ConversationsScreen');
  const to = script.indexOf('function ChatQuestionsScreen');
  const convo = script.slice(from, to);

  // TAKING IS SEPARATE FROM REPLYING. The reply box only appears once your name
  // is on it. Hiding it is a courtesy — the server refuses anyway — but a screen
  // that offers a box and then throws the words away is worse than no box.
  ok(/canReply\s*=\s*!chat\.closed\s*&&\s*\(mine \|\| admin\)/.test(convo),
    'the reply box is shown only to whoever took it, or an administrator');
  ok(convo.includes('Take this conversation'),
    'and somebody who has not taken it is told to take it');
  ok(convo.includes('Only they, or an administrator, can reply'),
    'a conversation somebody else has says so plainly');
  ok(convo.includes('This conversation is closed'),
    'and a closed one says nobody can add to it');

  // The plain-language rule WARNS here, it does not block. A reply to one person
  // who is waiting is not worth holding back over a word we do not like.
  ok(convo.includes('You can still send it'),
    'the wording warning says out loud that it is not a refusal');
  ok(!/JARGON|MAX_WORDS_PER_SENTENCE/.test(convo),
    'and the rule itself still lives on the server, not in a copy here');
  ok(/\.flash-warn\s*\{/.test(html),
    'the warning box is actually styled, not an unstyled stack');

  // statePill returns an ELEMENT, sevPill returns a CLASS NAME. This screen was
  // written after that mistake was found; this is the guard that keeps it out.
  ok(!convo.includes('sevPill'), 'this screen uses statePill, not the class-name helper');
  ok(convo.includes('statePill('), 'and it does use statePill');

  // A shopper's phone number has no business on a screen that is open all day.
  ok(!/mobile/.test(convo), 'no phone number is drawn on the conversation screens');
}

console.log('\n=== 7f. the suggested email ===');
{
  const from = script.indexOf('function ConversationsScreen');
  const to = script.indexOf('function ChatQuestionsScreen');
  const convo = script.slice(from, to);

  ok(script.includes('/email-draft'), 'it asks the server for the draft');
  ok(convo.includes('Fayr does not send email'),
    'and says out loud that Fayr does not send it');
  ok(convo.includes('send it from your own email'),
    'and who does send it');

  // The words are the SERVER'S. A copy of the wording here would drift from the
  // one the plain-language check is actually run against.
  ok(!/Hello,|Fayr customer support|You asked us/.test(convo),
    'the panel holds no copy of the email’s words');

  // A text box is always there. Copying to the clipboard is blocked on a plain
  // web address, which is exactly how the panel is reached from a phone.
  ok(/h\("textarea"[\s\S]{0,200}st\.email\.body/.test(convo),
    'the email is in a box you can select, not only behind a copy button');
  ok(convo.includes('copyEmailDraft('), 'there is a copy button too');
  ok(script.includes('copy it yourself'),
    'and it says what to do when the browser will not copy for you');

  ok(convo.includes('You can still send it'),
    'a wording warning on an email is a warning, not a refusal');
}

console.log('\n=== 7g. it learns from what the agents do ===');
{
  ok(script.includes('/admin/chats/what-to-write-next'),
    'the answer book asks the server what to write next');
  ok(script.includes('save-as-answer'),
    'and a reply can be turned into an answer');

  const from = script.indexOf('function WhatToWriteNext');
  const to = script.indexOf('function AnswerCard');
  const block = script.slice(from, to);

  // A COUNT ON A SCREEN IS BELIEVED. Two things have to be said out loud: how
  // many questions were looked at, and how two of them end up counted as one.
  ok(/out of the last/.test(block),
    'it says how many questions the count is out of');
  ok(block.includes('same meaningful words'),
    'and how two questions come to be counted as one');
  ok(/g\.examples/.test(block),
    'and it shows the real sentences, so anybody can see what was grouped');

  // The new answer must arrive needing approval, and the screen must say so.
  ok(script.includes('has to approve it in the Answer book'),
    'saving a reply as an answer says a person still has to approve it');
  ok(script.includes('An answer filed under the wrong kind is never found again'),
    'and it insists on a kind, with the reason');

  ok(!/statusPill|sevPill/.test(block),
    'this block uses statePill, not the class-name helper');
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
    function sevPill(sev) { return "pill-" + sev; }
    function statePill(text, tone) { return h("span", { class: "pill pill-" + (tone || "neutral") }, text); }
    function setChatFilter() {} function closeChatQuestion() {}
    function setAnswerFilter() {} function editAnswer() {} function cancelAnswerEdit() {}
    function checkAnswerWords() {} function saveAnswer() {} function setAnswerLive() {}
    function setChatsFilter() {} function openConversation() {} function backToConversations() {}
    function takeConversation() {} function sendChatReply() {} function checkChatReply() {}
    function closeConversation() {} function loadEmailDraft() {} function copyEmailDraft() {}
    function saveReplyAsAnswer() {} function loadWhatToWriteNext() {}
    var state = STATE;
    ${src}
    return { chat: ChatQuestionsScreen(), book: AnswerBookScreen(), live: LivePagesScreen(),
             convos: ConversationsScreen(), seen: seen };
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

  // Conversations. Deliberately mixed: one waiting, one taken by somebody else,
  // one closed — the three the reply box has to behave differently for.
  const CONVOS = [
    { chatId: 'c1', state: 'WAITING_FOR_PERSON', stateInWords: 'Waiting for a person',
      takenBy: null, user: { id: 'u1', displayId: 'FAYR-100001' },
      startedAt: '2026-08-31T05:00:00.000Z', lastMessageAt: '2026-08-31T05:01:00.000Z',
      handedOverAt: '2026-08-31T05:01:00.000Z', messageCount: 2,
      latest: { body: 'do you deliver to Kathmandu', author: 'PERSON', sentAt: '2026-08-31T05:01:00.000Z' } },
    { chatId: 'c2', state: 'TAKEN', stateInWords: 'Taken by Ravi',
      takenBy: { id: 's-ravi', name: 'Ravi' }, user: { id: 'u2', displayId: 'FAYR-100002' },
      startedAt: '2026-08-31T04:00:00.000Z', lastMessageAt: '2026-08-31T04:30:00.000Z',
      handedOverAt: '2026-08-31T04:10:00.000Z', messageCount: 5,
      latest: { body: 'thanks', author: 'PERSON', sentAt: '2026-08-31T04:30:00.000Z' } },
    { chatId: 'c3', state: 'CLOSED', stateInWords: 'Closed', takenBy: { id: 's-asha', name: 'Asha' },
      user: { id: 'u3', displayId: 'FAYR-100003' },
      startedAt: '2026-08-30T04:00:00.000Z', lastMessageAt: '2026-08-30T04:30:00.000Z',
      handedOverAt: '2026-08-30T04:05:00.000Z', messageCount: 4, latest: null },
  ];

  const oneConvo = (over) => ({
    chatId: 'c1', state: 'WAITING_FOR_PERSON', stateInWords: 'Waiting for a person',
    // WHOSE CONVERSATION IT IS. The real answer from GET /admin/chats/:id carries
    // this (backend/src/chat/chat.response.ts) and the fixture did not, so the
    // "every conversation from this person" button read as a crash the first time
    // it was drawn. A fixture thinner than the real answer hides real defects.
    user: { id: 'u1', displayId: 'FAYR-100001' },
    takenBy: null, startedAt: '2026-08-31T05:00:00.000Z',
    lastMessageAt: '2026-08-31T05:01:00.000Z',
    withTheAssistant: false, waitingForAPerson: true, closed: false,
    messages: [
      { id: 'm1', author: 'PERSON', from: 'Them', body: 'do you deliver to Kathmandu',
        language: 'en', sentAt: '2026-08-31T05:00:00.000Z', fromAPerson: false },
      { id: 'm2', author: 'ASSISTANT', from: 'Fayr assistant',
        body: 'I could not answer this one yet. A person from Fayr will read it and get back to you.',
        language: 'en', sentAt: '2026-08-31T05:01:00.000Z', fromAPerson: false },
    ],
    ...over,
  });

  const EMAIL = {
    subject: 'About your Fayr question',
    body: 'Hello,\n\nYou asked us:\n"do you deliver to Kathmandu"\n\n'
      + 'I am looking into this for you.\n\nAsha\nFayr customer support',
    plainLanguage: { ok: true, problems: [] },
    fromTheAnswerBook: false,
  };

  const chatsBranch = (over) => ({
    loading: false, error: null, items: CONVOS, total: 3,
    filter: 'WAITING_FOR_PERSON', busy: null, notice: null, actionError: null,
    open: null, draft: '', warnings: [], email: null, emailNote: null,
    saveTopic: '', savingFrom: null, ...over,
  });

  const chatState = (over) => ({
    chats: chatsBranch(),
    chat: { loading: false, error: null, items: QUESTIONS, total: 2, stats: STATS,
            filter: 'UNRESOLVED', busy: null, notice: null, actionError: null, ...over },
    answers: { loading: false, error: null, items: ANSWERS, total: 4,
               filter: { language: '', status: '' }, draft: null, warnings: [],
               busy: null, notice: null, actionError: null },
    livepages: liveBranch(),
  });
  const TO_WRITE = {
    readFrom: 137,
    groups: [
      { signature: 'deliver kathmandu', asked: 6, languages: ['en'], topics: [],
        examples: ['do you deliver to Kathmandu', 'deliver Kathmandu?'],
        lastAskedAt: '2026-08-31T05:00:00.000Z' },
      { signature: 'bhubaneswar fayr shop', asked: 1, languages: ['en', 'hi-en'],
        topics: ['about'], examples: ['is there a Fayr shop in Bhubaneswar'],
        lastAskedAt: '2026-08-30T05:00:00.000Z' },
    ],
  };

  const bookState = (over) => ({
    chats: chatsBranch(),
    chat: { loading: false, error: null, items: QUESTIONS, total: 2, stats: STATS,
            filter: 'UNRESOLVED', busy: null, notice: null, actionError: null },
    answers: { loading: false, error: null, items: ANSWERS, total: 4,
               filter: { language: '', status: '' }, draft: null, warnings: [],
               busy: null, notice: null, actionError: null, toWrite: TO_WRITE, ...over },
    livepages: liveBranch(),
  });
  const liveState = (over) => ({ ...chatState({}), livepages: liveBranch(over) });
  const convoState = (over, staff) => ({
    ...chatState({}), chats: chatsBranch(over),
    staff: staff || { id: 's-asha', name: 'Asha', role: 'SUPPORT' },
  });

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
    ['what to write next, with a pile', bookState({})],
    ['what to write next, with nothing waiting', bookState({
      toWrite: { readFrom: 137, groups: [] } })],
    ['what to write next, not loaded', bookState({ toWrite: null })],
    ['saving a reply as an answer', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' },
                       messages: [
                         { id: 'm1', author: 'PERSON', from: 'Them', body: 'do you deliver to Kathmandu',
                           language: 'en', sentAt: '2026-08-31T05:00:00.000Z', fromAPerson: false },
                         { id: 'm2', author: 'AGENT', from: 'Asha', body: 'We only send things inside India.',
                           language: 'en', sentAt: '2026-08-31T05:02:00.000Z', fromAPerson: true },
                       ] }),
      saveTopic: 'about', savingFrom: 'm2' })],
    ['the live pages screen', liveState({})],
    ['live pages, loading', liveState({ loading: true, data: null })],
    ['live pages, failed', liveState({ data: null, error: 'Could not reach the Fayr server.' })],
    ['live pages, nobody has run it yet', liveState({ data: { ...LIVE, lastRun: null, recent: [] } })],
    ['live pages, a clean run', liveState({ data: { ...LIVE, lastRun: { ...LIVE.lastRun, expired: 0, findings: [] } } })],
    ['live pages, no offer has a page at all', liveState({ data: { ...LIVE, toCheck: { total: 13, withAPage: 0, withNoPage: 13 } } })],
    ['the conversation queue', convoState({})],
    ['the queue, loading', convoState({ loading: true, items: null })],
    ['the queue, failed', convoState({ items: null, error: 'Could not reach the Fayr server.' })],
    ['the queue, empty', convoState({ items: [], total: 0 })],
    ['a conversation nobody has taken', convoState({ open: oneConvo({}) })],
    // ONE PERSON'S WHOLE HISTORY, which is what staff see and a shopper never
    // does. Both shapes: with the person on the conversation, and without —
    // because the real answer always carries one and a panel that dies on a
    // missing field shows a blank screen.
    ['one person\'s whole history', convoState({
      onlyUserId: 'u1', person: 'FAYR-100001', filter: '',
    })],
    // A conversation with no person on it must still draw rather than showing a
    // blank screen. It is not a shape the real server sends: GET /admin/chats/:id
    // always carries the person now, and the check below requires the button that
    // needs it. This is only here so a missing field is never a blank screen.
    ['a conversation with no person on it', convoState({
      open: oneConvo({ user: undefined }),
    })],
    ['a conversation I have taken', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }) })],
    ['a conversation somebody ELSE has taken', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Ravi', waitingForAPerson: false,
                       takenBy: { id: 's-ravi', name: 'Ravi' } }) })],
    ['a closed conversation', convoState({
      open: oneConvo({ state: 'CLOSED', stateInWords: 'Closed', closed: true,
                       waitingForAPerson: false, takenBy: { id: 's-asha', name: 'Asha' } }) })],
    ['a conversation with nothing said in it', convoState({ open: oneConvo({ messages: [] }) })],
    ['a reply that does not read plainly', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      draft: 'Please initiate the KYC workflow.',
      warnings: ['"kyc" is not a word a person here would use.'] })],
    ['sending a reply', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }), busy: 'reply' })],
    ['a suggested email', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      email: EMAIL })],
    ['a suggested email from the answer book', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      email: { ...EMAIL, fromTheAnswerBook: true } })],
    ['a suggested email that does not read plainly', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      email: { ...EMAIL, plainLanguage: { ok: false, problems: ['"kyc" is not a word a person here would use.'] } } })],
    ['a suggested email that could not be copied', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      email: EMAIL,
      emailNote: 'This browser will not let a page copy for you.' })],
    ['writing a suggested email', convoState({
      open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Asha', waitingForAPerson: false,
                       takenBy: { id: 's-asha', name: 'Asha' } }),
      busy: 'email' })],
    ['an administrator on somebody else\'s conversation', convoState(
      { open: oneConvo({ state: 'TAKEN', stateInWords: 'Taken by Ravi', waitingForAPerson: false,
                         takenBy: { id: 's-ravi', name: 'Ravi' } }) },
      { id: 's-boss', name: 'Boss', role: 'ADMIN' })],
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

  // THE WAY INTO ONE PERSON'S WHOLE HISTORY IS REALLY DRAWN, with their name on
  // it. The loop above only proves nothing crashed; this proves the button that
  // lets staff read every conversation somebody has had is actually there.
  {
    const drawn = new Function('STATE', 'QUESTIONS', 'STATS', 'ANSWERS', harness)(
      convoState({ open: oneConvo({}) }), QUESTIONS, STATS, ANSWERS,
    );
    const flat = JSON.stringify(drawn.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(/Every conversation from FAYR-100001/.test(flat),
      'the way into one person’s whole history is on screen, with their name on it');
  }
}

  // ── one person's whole history, which only staff can see ──────────────────
  //
  // THE OTHER SIDE OF THE OWNER'S RULE, 2 September 2026. A shopper never sees
  // their own older conversations. Whoever is helping them has to see every one,
  // or they will answer a question that was already answered last week.
  console.log('\n=== 7e. one person\'s whole history, for staff only ===');

  ok(/"\?userId=" \+ encodeURIComponent\(state\.chats\.onlyUserId\)/.test(script),
    'the panel can ask the server for one person’s conversations');
  ok(/function showEveryConversationFrom\(userId, displayId\)/.test(script),
    'and one place switches to reading one person');
  ok(/Every conversation from/.test(script),
    'the button that opens somebody’s history says what it does');
  ok(/newest first\. Closed ones included\./.test(script),
    'the header says what is in the list, closed ones included');
  ok(/Back to the queue/.test(script),
    'and there is one way back to the queue');
  // A state filter over one person's history would quietly hide most of it,
  // which is the opposite of what reading somebody's story is for.
  ok(/st\.onlyUserId \? null : filters/.test(script),
    'the state filters are left out while one person’s history is on screen');


console.log('\n=== 7f. the page that measures Fayr itself ===');
{
  // ── WHY THIS SECTION EXISTS ────────────────────────────────────────────────
  //
  // This is the page a room of directors reads. It has exactly one way of being
  // wrong that matters, and it is not a crash: A NOUGHT PRINTED WHERE NOTHING IS
  // BEING WATCHED. So the screen is lifted out and really drawn, and the checks
  // below require the words rather than the absence of an error.
  const from = script.indexOf('// ── how it is running: begin');
  const to = script.indexOf('// ── how it is running: end');
  const src = from >= 0 && to > from ? script.slice(from, to) : '';
  ok(src.includes('function RunningScreen'), 'the screen was found');

  // Wiring, all the way through.
  ok(teamsFor('everyone').includes('running'),
    'it is its own group in the sidebar, belonging to no single team');
  ok(/running:\s*\["SUPPORT", "FINANCE", "OPERATIONS", "ADMIN"\]/.test(script),
    'every role can open it, which is what the owner decided');
  ok(script.includes('"GET", "/admin/how-it-is-running"'), 'it reads the one route');

  // IT READS ON OPEN, WITH NO FORM. That is the whole difference from Reports.
  ok(/id === "running" && state\.running\.data === null/.test(script),
    'it loads the first time the tab is shown');
  ok(!/loadRunning\([^)]*from|loadRunning\([^)]*range|loadRunning\([^)]*granularity/.test(script),
    'it takes no date range, no granularity and no form of any kind');
  ok(!/how-it-is-running\?/.test(script), 'and it sends no query string');

  // NOTHING ON IT CHANGES ANYTHING. A button here would be a button on a page
  // nobody is watching for side effects.
  const writes = src.match(/api\("(POST|PATCH|PUT|DELETE)"/g) || [];
  ok(writes.length === 0, `the screen makes no write of any kind (found ${writes.length})`);

  // THE SCREEN WRITES NO WORDS OF ITS OWN. Every sentence comes down with the
  // data, out of running.words.ts, where a check walks it through the real
  // plain-language rule. A sentence written here would reach a director unread.
  const spoken = (src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    .match(/"[^"\n]{25,}"/g) || [])
    .filter((s) => !/^"[a-z-]+:[^"]*"$/.test(s))     // inline styles
    .filter((s) => !/[{};]|margin|padding|font|color|border|width|align|solid|var\(/.test(s))
    // A fragment of code caught between two quotes is not a sentence.
    .filter((s) => !/ \+ |===|!==/.test(s));
  ok(spoken.length === 0,
    `the screen writes NO sentence of its own (found ${spoken.length}: ${spoken.join(' | ')})`);

  // AND IT DOES NO ARITHMETIC ON MONEY. Whole paise in a string, grouped into
  // rupees by cutting the string. Four money defects so far came from a figure
  // reached by a second route, and a float division would be the fifth.
  const formatter = (script.match(/function paiseToRupees\(paise\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(formatter.length > 200, 'the money formatter was found');
  ok(!/\/\s*100\b/.test(formatter), 'it never divides by a hundred');
  ok(!/Number\(|parseFloat|parseInt|toLocaleString/.test(formatter),
    'and it never turns an amount into a Number at all');

  const RUNNING = {
    title: 'How Fayr is running',
    lead: 'Every number on this page is read out of our own records.',
    leadTwo: 'Nothing here is worked out from a guess.',
    leadThree: 'Nothing on this page changes anything, and nothing refreshes by itself.',
    readAt: 'Read at 9:14 in the morning on 3 September.',
    readAtIso: '2026-09-03T03:44:00.000Z',
    says: { nothingYet: 'nothing yet', notWatching: 'we are not watching this yet' },
    journey: {
      title: 'The journey, step by step',
      lead: 'The two columns answer different questions, so they are kept apart.',
      everythingSoFarLabel: 'Everything so far',
      everythingSoFarMeaning: 'Every place anybody has ever taken on an offer.',
      lastThirtyDaysLabel: 'The last 30 days',
      lastThirtyDaysMeaning: 'Only the places taken in the last 30 days.',
      bothMatchToday: null,
      whereTheyAreNow: 'This journey counts where people are now.',
      canGoBackwards: 'A review taken down sends somebody back a step.',
      stepHeading: 'The step',
      dropHeading: 'Did not get this far',
      agreesWithActivityReport: true,
      disagreesWithTheReports: null,
      steps: [
        { step: 'Took a place on an offer', meaning: 'Somebody spent their tickets.', whatItWouldTake: null,
          everythingSoFar: { kind: 'counted', count: 17 }, lastThirtyDays: { kind: 'counted', count: 17 },
          onThePath: true, dropSoFar: null, dropLastThirtyDays: null, disagreement: null },
        { step: 'Went to the shop', meaning: 'Opening a shop happens inside the phone.',
          whatItWouldTake: 'The phone would have to tell our side.',
          everythingSoFar: { kind: 'not-watching', whatItWouldTake: 'The phone would have to tell our side.' },
          lastThirtyDays: { kind: 'not-watching', whatItWouldTake: 'The phone would have to tell our side.' },
          onThePath: true,
          dropSoFar: { kind: 'cannot-tell', why: 'The step above this one is not recorded.' },
          dropLastThirtyDays: { kind: 'cannot-tell', why: 'The step above this one is not recorded.' },
          disagreement: null },
        { step: 'Gave us their order', meaning: 'Somebody told Fayr which order is theirs.', whatItWouldTake: null,
          everythingSoFar: { kind: 'counted', count: 0 }, lastThirtyDays: { kind: 'counted', count: 0 },
          onThePath: false,
          dropSoFar: { kind: 'not-a-step', why: 'Not everybody is asked this.' },
          dropLastThirtyDays: { kind: 'not-a-step', why: 'Not everybody is asked this.' },
          disagreement: null },
        { step: 'Review found live on the product page', meaning: 'The review can be read on the shop.',
          whatItWouldTake: null,
          everythingSoFar: { kind: 'counted', count: 7 }, lastThirtyDays: { kind: 'counted', count: 7 },
          onThePath: true,
          dropSoFar: { kind: 'dropped', count: 3 }, dropLastThirtyDays: { kind: 'dropped', count: 3 },
          disagreement: 'Counting the places moved on to the review step counts 1 fewer place than this.' },
        { step: 'Money taken out to their own account', meaning: 'This counts payouts and not places.',
          whatItWouldTake: null,
          everythingSoFar: { kind: 'counted', count: 2 }, lastThirtyDays: { kind: 'counted', count: 2 },
          onThePath: true,
          dropSoFar: { kind: 'does-not-line-up', by: 1, why: 'This counts 1 more place than the step above it.' },
          dropLastThirtyDays: { kind: 'does-not-line-up', by: 1, why: 'This counts 1 more place than the step above it.' },
          disagreement: null },
      ],
      expired: { step: 'Places that ran out of time', meaning: 'These are counted inside the top row too.',
        everythingSoFar: { kind: 'counted', count: 3 }, lastThirtyDays: { kind: 'counted', count: 3 } },
    },
    howOrders: {
      title: 'How each order was established',
      lead: 'Is Fayr reading orders by itself, or is somebody doing it by hand?',
      groups: [
        { heading: 'Read automatically off the shop', meaning: 'A machine read it.',
          names: ['dkim', 'order-details', 'order-history'], count: { kind: 'counted', count: 10 } },
        { heading: 'Read from a picture', meaning: 'Somebody sent a picture.',
          names: ['ocr', 'invoice'], count: { kind: 'counted', count: 0 } },
        { heading: 'Typed in by hand', meaning: 'A number was typed in.',
          names: ['manual'], count: { kind: 'counted', count: 0 } },
      ],
      doNotKnow: { heading: 'We do not know', meaning: 'It says something nobody has grouped yet.',
        names: [], count: { kind: 'counted', count: 0 } },
      established: { kind: 'counted', count: 10 },
      addsUp: true,
      addsUpConfirmed: 'These add up to the number of orders established above.',
      addsUpProblem: null,
      establishedLabel: 'Orders established',
      countHeading: 'Orders',
      namesHeading: 'What our own records call it',
      unmappedHeading: 'Names nobody has grouped yet',
      unmappedNames: [],
      candidatesNote: 'Our own records carry a list of three ways an order arrives.',
    },
    money: {
      title: 'Money',
      lead: 'Every figure here is counted exactly and shown in rupees.',
      lines: [
        { label: 'Refunds released into wallets, in all', meaning: 'What the money book has put into wallets.',
          amount: { kind: 'counted', paise: '899820' } },
        { label: 'Money sitting in wallets, not yet taken out', meaning: 'What people hold.',
          amount: { kind: 'counted', paise: '859820' } },
        { label: 'Money in the payout holding account, waiting to go out', meaning: 'Money that has left a wallet.',
          amount: { kind: 'counted', paise: '40000' } },
      ],
      hasLeftFayr: { label: 'Money that has actually left Fayr', amount: { kind: 'counted', paise: '0' },
        words: '2 payouts are marked paid. Fayr cannot send money yet.' },
      waiting: {
        title: "Refunds waiting for the shop's return time",
        lead: 'This is normal and nothing is wrong.',
        countLabel: 'Refunds waiting', count: { kind: 'counted', count: 4 },
        wouldPayLabel: 'What these would pay if they were all released today',
        wouldPayMeaning: 'This is not money anybody is owed yet.',
        workedOutBy: 'computeRefundPaise, in tasks/engine/money.ts',
        wouldPay: { kind: 'counted', paise: '373830' },
        cannotWorkOutLabel: 'Waiting refunds whose amount cannot be worked out yet',
        cannotWorkOutMeaning: 'These are in the held list below as well.',
        cannotWorkOut: { kind: 'counted', count: 2 },
      },
      held: {
        title: 'Money held and not released',
        leadOne: 'Held is not the same as waiting. Waiting is normal. Held is a decision.',
        leadTwo: 'No amount is shown against these.',
        theRule: 'Money is held when Fayr is not sure. Fayr would rather make somebody wait for a person than send the wrong amount.',
        allSix: 'All six reasons are listed.',
        reasonHeading: 'Why it is held', countHeading: 'Refunds held',
        reasons: [
          { explanation: 'No price could be read for this item.', reason: 'amount-unknown',
            count: { kind: 'counted', count: 2 }, nobodyCanClearIt: false , nobodyCanClearThisOne: null },
          { explanation: 'The order does not say how many units were bought.', reason: 'quantity-unknown',
            count: { kind: 'counted', count: 1 }, nobodyCanClearIt: false , nobodyCanClearThisOne: null },
          { explanation: 'The item price sits above the order total.', reason: 'item-price-above-total-and-ambiguous',
            count: { kind: 'counted', count: 1 }, nobodyCanClearIt: true,
            nobodyCanClearThisOne: 'Nobody has a control that can clear this one.' },
          { explanation: 'The amount does not divide evenly.', reason: 'quantity-not-divisible',
            count: { kind: 'counted', count: 0 }, nobodyCanClearIt: false , nobodyCanClearThisOne: null },
          { explanation: 'The unit count on file cannot be right.', reason: 'quantity-implausible',
            count: { kind: 'counted', count: 0 }, nobodyCanClearIt: false , nobodyCanClearThisOne: null },
          { explanation: 'The item price and the order total are too far apart.', reason: 'amount-gap-implausible',
            count: { kind: 'counted', count: 0 }, nobodyCanClearIt: true , nobodyCanClearThisOne: null },
        ],
        total: { kind: 'counted', count: 4 },
        alsoWaiting: '2 of these are in the waiting list above as well.',
        nobodyCanClearWarning: 'One of these reasons has no control anybody can use.',
      },
    },
    machine: {
      title: 'Is the machine still working',
      lead: 'Some of these are counted and some are not watched at all.',
      rows: [
        { label: 'Places sitting past their own deadline', meaning: 'A place has a deadline.',
          reading: { kind: 'counted', count: 0 } },
        { label: "Refunds sitting past the shop's return time", meaning: 'The money has not moved.',
          reading: { kind: 'counted', count: 2 } },
        { label: 'Conversations waiting for a person too long', meaning: 'Fayr promises a minute or two.',
          reading: { kind: 'counted', count: 0 } },
        { label: 'Payouts that failed', meaning: 'A nought here is a real nought.',
          reading: { kind: 'counted', count: 0 } },
        { label: 'Offer pages that could not be read', meaning: 'Whether each offer still opens.',
          reading: { kind: 'not-watching', whatItWouldTake: 'Somebody has to open each offer on a phone.' } },
        { label: 'Shops whose order list has stopped working', meaning: 'Whether Fayr can still read orders.',
          reading: { kind: 'not-watching', whatItWouldTake: 'Nothing adds it up across everybody.' } },
        { label: 'Messages we tried to send and could not', meaning: 'Whether a code reached a phone.',
          reading: { kind: 'not-watching', whatItWouldTake: 'Nothing records a send at all.' } },
      ],
    },
    offers: {
      title: 'The offers themselves',
      lead: 'Two checks already exist.',
      runs: [
        { label: 'The nightly offer check', meaning: 'Every live offer, once a night.',
          lastLooked: 'Last looked on 26 August, which was 8 days ago.', neverRun: null,
          howItStarted: 'Somebody ran this by hand.',
          counts: [
            { label: 'Offers looked at', reading: { kind: 'counted', count: 13 } },
            { label: 'Wrong enough to stop a shopper', reading: { kind: 'counted', count: 1 } },
            { label: 'Worth somebody looking', reading: { kind: 'counted', count: 13 } },
            { label: 'Could not be checked at all', reading: { kind: 'counted', count: 21 } },
          ] },
        { label: 'The real shop page check', meaning: 'Somebody opens each page on a phone.',
          lastLooked: null, neverRun: 'No offer page has ever been checked.', howItStarted: null,
          counts: [
            { label: 'Offers looked at', reading: { kind: 'nothing-yet' } },
            { label: 'Could not be checked at all', reading: { kind: 'nothing-yet' } },
          ] },
      ],
    },
    notRealYet: {
      title: 'What is not real yet',
      lead: 'This list is meant to be uncomfortable.',
      items: ['Fayr cannot send money to a bank yet.', 'Nobody is ever told anything.'],
    },
  };

  const runHarness = `
    var seen = [];
    function h(tag, attrs) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var node = { tag: tag, attrs: attrs || {}, kids: kids, appendChild: function (k) { this.kids.push(k); } };
      seen.push(node);
      return node;
    }
    function Stat(v, l, tone) { return h("div", { class: "kv" }, h("div", { class: "v stat" }, String(v)), h("div", { class: "k" }, l)); }
    function api() { throw new Error("the page must not call the server while drawing"); }
    function render() {}
    var state = STATE;
    ${src}
    return { page: RunningScreen(), seen: seen };
  `;

  const runState = (over) => ({ running: { loading: false, error: null, data: RUNNING, ...over } });
  const cases = [
    ['the page', runState({})],
    ['the page, reading', runState({ loading: true, data: null })],
    ['the page, could not be read', runState({ data: null, error: 'Could not reach the Fayr server.' })],
    ['the page with nothing on it at all', runState({
      data: {
        ...RUNNING,
        journey: { ...RUNNING.journey, bothMatchToday: 'Both columns match today.',
          steps: RUNNING.journey.steps.slice(0, 1) },
        money: { ...RUNNING.money,
          lines: [{ label: 'Refunds released into wallets, in all', meaning: 'Nothing has moved.',
                    amount: { kind: 'nothing-yet' } }],
          waiting: { ...RUNNING.money.waiting, count: { kind: 'counted', count: 0 },
                     wouldPay: { kind: 'nothing-yet' } },
          held: { ...RUNNING.money.held, nobodyCanClearWarning: null,
                  reasons: RUNNING.money.held.reasons.map((r) => ({ ...r, count: { kind: 'counted', count: 0 } })) } },
      },
    })],
    ['the page when the parts do not add up', runState({
      data: { ...RUNNING, howOrders: { ...RUNNING.howOrders, addsUp: false,
        addsUpProblem: 'These do not add up, and that is a fault.',
        unmappedNames: ['shiny-new-reader'] } },
    })],
    ['the page when it disagrees with the reports', runState({
      data: { ...RUNNING, journey: { ...RUNNING.journey, agreesWithActivityReport: false,
        disagreesWithTheReports: 'These numbers do not match the Reports tab, and that is a fault.' } },
    })],
  ];

  let drawn = null;
  for (const [label, st] of cases) {
    let threw = null, out = null;
    try { out = new Function('STATE', runHarness)(st); } catch (e) { threw = e.message; }
    ok(!threw, `renders ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;
    if (label === 'the page') drawn = out;
    const flat = JSON.stringify(out.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('NaN'), `${label}: no "NaN" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
  }

  if (drawn) {
    const flat = JSON.stringify(drawn.seen, (k, v) => (typeof v === 'function' ? undefined : v));

    // THE MOMENT IT WAS READ. A number with no time against it is a number
    // nobody can trust.
    ok(flat.includes('Read at 9:14 in the morning on 3 September.'),
      'the moment it was read is on the page, in words');

    // ── THE ONE THING THIS PAGE MUST NEVER DO ────────────────────────────────
    // A step nothing records shows the WORDS, never a nought.
    ok(flat.includes('we are not watching this yet'),
      'a step nothing records says so, in words');
    ok(flat.includes('The phone would have to tell our side'),
      'and says what it would take to start watching it');
    ok(flat.includes('nothing yet'),
      'and a thing with no data yet says "nothing yet", which is a different sentence');

    // A counted nought really is drawn as a number, because it is a real nought.
    ok(/"0"/.test(flat), 'a real nought is drawn as a number, not as an excuse');

    // The two steps nobody records must not be printed with a count beside them.
    const notWatchingNodes = drawn.seen.filter(
      (n) => JSON.stringify(n.kids || []).includes('we are not watching this yet'));
    ok(notWatchingNodes.length > 0, 'the unwatched wording is really rendered');

    // THE DROP, in all four of its shapes.
    ok(flat.includes('Did not get this far: 3'), 'the drop between two steps is shown');
    ok(flat.includes('The step above this one is not recorded'),
      'a drop across an unwatched step says it cannot be told');
    ok(flat.includes('Not everybody is asked this'),
      'a step that is not on the way says so instead of showing a drop');
    ok(flat.includes('This counts 1 more place than the step above it.'),
      'and two rows that do not line up are called out, never shown as a negative');

    // WHERE TWO COLUMNS DISAGREE, SAY SO.
    ok(flat.includes('counts 1 fewer place than this'),
      'a disagreement between two ways of counting is on the page');

    // EXPIRED IS OUTSIDE THE JOURNEY, and says it is already counted above.
    ok(flat.includes('counted inside the top row'),
      'the expired row says it is already inside the top row');

    // MONEY, formatted exactly, and no money has left Fayr.
    ok(flat.includes('₹8,998.20'), 'refunds released are grouped the Indian way, to the paise');
    ok(flat.includes('₹8,598.20'), 'and so is what is sitting in wallets');
    ok(flat.includes('₹400'), 'a whole-rupee amount shows no fraction');
    ok(flat.includes('₹0'), 'and money that has left Fayr is nought');
    ok(flat.includes('Fayr cannot send money yet'), 'with the reason said out loud');

    // WAITING AND HELD, KEPT APART.
    ok(flat.includes('Held is not the same as waiting'), 'held and waiting are told apart in words');
    ok(flat.includes('₹3,738.30'), 'what the waiting refunds would pay is shown');
    ok(flat.includes('computeRefundPaise'), 'and the code that worked it out is named');
    ok(flat.includes('Money is held when Fayr is not sure. Fayr would rather make somebody wait for a person than send the wrong amount.'),
      'the strongest sentence on the page is drawn whole');
    ok(flat.includes('No amount is shown against these'),
      'and no rupee figure is put against a held refund');
    // All six reasons, including the ones with nothing against them.
    ok(flat.includes('quantity-not-divisible') || flat.includes('does not divide evenly'),
      'a reason with nothing against it is still listed');
    ok(flat.includes('no control anybody can use'),
      'a hold nobody can clear is called out');

    // THE OFFER CHECKS. An old date beats a fresh looking nought.
    ok(flat.includes('Last looked on 26 August, which was 8 days ago.'),
      'the last run says how long ago it was, in words');
    ok(flat.includes('No offer page has ever been checked.'),
      'and a check nobody has ever run says exactly that');

    // WHAT IS NOT REAL YET.
    ok(flat.includes('Fayr cannot send money to a bank yet'),
      'the uncomfortable list is on the page');

    // The grouping table is on the screen, so nobody has to trust it.
    ok(flat.includes('order-details'), 'the stored source names are shown beside their group');
  }

  // And when it disagrees with the reports, it says so rather than staying quiet.
  {
    const bad = new Function('STATE', runHarness)(runState({
      data: { ...RUNNING, journey: { ...RUNNING.journey, agreesWithActivityReport: false,
        disagreesWithTheReports: 'These numbers do not match the Reports tab, and that is a fault.' } },
    }));
    const flat = JSON.stringify(bad.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(flat.includes('do not match the Reports tab'),
      'a page that disagrees with the Reports tab says so, and calls it a fault');
  }
}

console.log('\n=== the practice window mark, actually run ===');
{
  // ── WHY THIS IS RUN AND NOT READ ────────────────────────────────────────
  //
  // FOUND BY BREAKING THE CODE. The checks on this mark were string matches in a
  // backend spec, and a `return null;` inserted at the top of practiceMark left
  // every one of those strings in the file. So the mark could be switched off
  // completely with everything green. A function has to be CALLED.
  //
  // A widened order window is a window whose floor was lowered for testing. A
  // staff member looking at a held refund has to see that before they decide
  // whether to pay it, so this is the loudest thing on the row.
  const src = (script.match(/function practiceMark\(t\)[\s\S]*?\n    \}/) || [])[0] || '';
  ok(src.length > 0, 'practiceMark was found in the panel');

  const run = new Function(`
    function pill(text, tone) { return { text: text, tone: tone }; }
    ${src}
    return practiceMark;
  `)();

  // READ SAFELY, BECAUSE A CRASH IS NOT A CATCH. Switching the mark off makes the
  // first check below fail correctly and then made the NEXT line read .text off
  // null, which killed the process before any summary printed — so the harness
  // read a dead process as a catch. Found by breaking the code.
  const markFor = (task) => {
    const got = run(task);
    return got && typeof got === 'object' ? got : { text: null, tone: null };
  };

  ok(run({ practiceWindowDays: 400 }) != null,
    'A WIDENED TASK IS MARKED — the mark cannot be switched off silently');
  ok(markFor({ practiceWindowDays: 400 }).text === 'PRACTICE WINDOW 400d',
    'and it names the number of days, not just that it happened');
  ok(markFor({ practiceWindowDays: 1 }).text === 'PRACTICE WINDOW 1d',
    'one day says one day');
  ok(markFor({ practiceWindowDays: 400 }).tone === 'bad',
    'AND IT IS LOUD: a quiet mark can be mistaken for a real match, which is the '
    + 'one thing forbidden');

  // NULL ON EVERY REAL TASK, and every shape of nothing.
  for (const real of [
    { practiceWindowDays: null }, { practiceWindowDays: 0 }, {},
    { practiceWindowDays: undefined }, { practiceWindowDays: '400' },
    { practiceWindowDays: -1 }, null, undefined,
  ]) {
    ok(run(real) == null,
      `${JSON.stringify(real) ?? String(real)} carries no mark`);
  }
}

console.log('\n=== whether it went back, actually run ===');
{
  // ── WHY THIS IS RUN AND NOT READ, and it is the same lesson as the mark above ──
  //
  // A staff member on the amounts queue types a figure that becomes somebody's
  // refund, and the row showed neither when the order arrived nor whether it went
  // back. A RETURNED ORDER IS NEVER PAID — the refund gate refuses one — so a
  // reviewer was being asked to name an amount without the one fact that makes
  // the question moot.
  //
  // THE THREE ANSWERS ARE NOT TWO, and that is the whole subject of this block. A
  // dash for both false and null would tell a reviewer an order was fine when all
  // we know is that we never found out. Silence must not read as an all-clear on
  // the one row where money is typed.
  const src = (script.match(/function sentBack\(value\)[\s\S]*?\n    \}/) || [])[0] || '';
  ok(src.length > 0, 'sentBack was found in the panel');

  const run = new Function(`
    function h(tag, attrs, kids) { return { tag: tag, attrs: attrs, kids: kids }; }
    function pill(text, tone) { return { pill: true, text: text, tone: tone }; }
    ${src}
    return sentBack;
  `)();

  // READ SAFELY, BECAUSE A CRASH IS NOT A CATCH. Reading .text off a returned
  // string would kill the process before any summary printed, and the harness
  // would read a dead process as a catch.
  const shown = (value) => {
    const got = run(value);
    if (typeof got === 'string') return { word: got };
    return got && typeof got === 'object' ? got : { word: null };
  };

  ok(shown(true).pill === true,
    'A RETURNED ORDER IS A PILL, not a word — it has to be seen before a figure '
    + 'is typed');
  ok(shown(true).text === 'RETURNED', 'and it says so in one word');
  ok(shown(true).tone === 'bad',
    'AND IT IS LOUD, because the refund gate will refuse this order anyway');
  ok(shown(false).word === 'No', 'a page that said it was not returned reads "No"');
  ok(shown(false).pill !== true, 'and that is quiet, because it is the ordinary case');

  // THE NULL, WHICH IS THE POINT.
  for (const nothing of [null, undefined]) {
    const got = shown(nothing);
    ok(got.pill !== true, `${String(nothing)} is not shown as a return`);
    ok(got.word !== 'No',
      `${String(nothing)} does NOT read as "No" — we never found out, and that is `
      + 'not the same as finding out it was fine');
  }
  ok(JSON.stringify(shown(null)).toLowerCase().includes('not known'),
    'it says plainly that it is not known');

  // ── AND THE ROW ACTUALLY USES IT ────────────────────────────────────────
  //
  // The block above proves sentBack answers correctly. It says nothing about
  // whether anything CALLS it — deleting both fact cells from the amounts row
  // left every check above green, because a helper can be perfect and orphaned.
  // This is the other half.
  ok(/factCell\("Sent back", sentBack\(it\.returned\)\)/.test(script),
    'THE AMOUNTS ROW SHOWS IT — a correct helper nothing calls shows nobody '
    + 'anything');
  ok(/factCell\("Delivered", fmtDay\(it\.deliveredAt\)\)/.test(script),
    'and the row shows when it arrived, through the one day formatter');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
