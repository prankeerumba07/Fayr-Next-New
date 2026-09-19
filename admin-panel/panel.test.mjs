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
  //
  // "Signing up" (growth) joined the everyone team on 17 September 2026, for the
  // same reason "How Fayr is running" did: it answers a question no single team
  // owns. Finance, support and operations all have a reason to know how many
  // people reach each step of signing up, so it is readable by all four roles and
  // sits in the group that belongs to nobody. The section itself is correct and
  // staying; this list simply had not been told about it.
  const OWNERSHIP = {
    everyone: ['running', 'growth'],
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

console.log('\n=== the cash-out queue says where the money came from ===');
{
  // ── MEASURED 16 SEPTEMBER 2026 ──────────────────────────────────────────
  //
  // The owner read ₹100.00 on a queue card, beside an order whose product cost
  // ₹938.00 and whose bill was ₹1,331.00, and took it for that order's refund.
  // It never was. A withdrawal row has a user, a payout method and an amount,
  // and no link to a task or a campaign anywhere in the schema — the card was
  // showing a true figure with nothing behind it. ₹100.00 on the practice
  // account is ₹100.00 because the demo seed asks for exactly the minimum a
  // withdrawal may be, and for no other reason.
  //
  // THE AMOUNT ITSELF IS UNTOUCHED. It was right. What was missing was the rest
  // of the sentence.
  ok(/"cash-out requested"/.test(script),
    'the figure says what KIND of figure it is, so it cannot read as a refund');
  ok(/w\.basis \?/.test(script),
    'and the card draws the basis when the server sent one');
  ok(/rupees\(w\.basis\.walletBalancePaise\)/.test(script),
    'it shows what the wallet holds');
  ok(/rupees\(w\.basis\.refundsPaise\)/.test(script),
    'and how much of that arrived as refunds');
  ok(/w\.basis\.howManyRefunds === 1 \? " refund" : " refunds"/.test(script),
    'and it never says "1 refunds"');

  // ── THE TWO FIGURES SIT ON TWO DIFFERENT BASES, AND THE WORDS MUST SAY SO ──
  //
  // The balance is what is LEFT NOW — a requested withdrawal has already
  // reserved its own money out of it — while the refunds figure is everything
  // that has ever come IN that way. So the refunds total can legitimately be
  // LARGER than the balance, and the first wording said the larger number was
  // part of the smaller one: "₹1,338.00 · ₹1,438.00 of it from 2 refunds".
  ok(/" now · "/.test(script),
    'the balance is stated as what is there NOW');
  ok(/" has come in from "/.test(script),
    'and the refunds as what has come IN, not as a part of it');
  ok(!/" of it from "/.test(script),
    'the refunds are never called a part of the balance');

  // ── AND THE PANEL STILL DOES NO ARITHMETIC OF ITS OWN ──────────────────
  //
  // This file's opening comment names that as the defect it exists to prevent:
  // three defects so far came from a number reached by a second route. Every
  // figure on this card is a field the server sent, passed to the one formatter.
  const card = (script.match(/function wcard[\s\S]*?\n    }/) || [])[0] || script;
  ok(!/basis\.\w+\s*[-+*/]/.test(card),
    'the panel computes nothing from the basis it is handed');
}

console.log('\n=== one person\'s trail, actually run ===');
{
  // ── WHY THIS IS RUN AND NOT READ ────────────────────────────────────────
  //
  // The same lesson the practice-window mark taught. A string match would pass
  // on a grouping function that returned one day for everything, on a trim line
  // that printed the count without the total, and on an empty state that drew a
  // blank box — every one of those leaves the strings in the file. These call the
  // functions.
  const from = script.indexOf("// ── one person's trail: begin");
  const to = script.indexOf("// ── one person's trail: end");
  ok(from > 0 && to > from, 'the trail section is marked off in the panel');

  const src = script.slice(from, to);
  const run = new Function(`
    var seen = [];
    function h(tag, attrs) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var node = { tag: tag, attrs: attrs || {}, kids: kids };
      seen.push(node);
      return node;
    }
    // The panel's own fmtDay, copied because it lives outside the block. If these
    // two ever differ the grouping check below is measuring the wrong function,
    // which is why the next check asserts they agree.
    function fmtDay(iso) {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    }
    function api() {} function render() {}
    var state = { user: { id: "u1", activity: { loading: false, error: null, data: null, days: 30 } } };
    ${src}
    return {
      byDay: activityByDay, trim: activityTrimLine, empty: activityEmptyLine,
      setup: activitySetupLine, quiet: activityQuietLine, row: ActivityRow,
      timeline: ActivityTimeline, fmtDay: fmtDay,
      plural: plural, count: fmtCount, summary: ActivitySummary,
      kinds: ACTIVITY_KIND, windows: ACTIVITY_WINDOWS, steps: ACTIVITY_SETUP_STEPS,
      state: state, seen: seen,
    };
  `)();

  // Every text node anywhere in a rendered tree, so a sentence can be looked for
  // without knowing which element it landed in.
  const words = (node) => {
    if (node == null || node === false) return '';
    if (Array.isArray(node)) return node.map(words).join(' ');
    if (typeof node !== 'object') return String(node);
    return words(node.kids);
  };

  // ── 1. GROUPED BY DAY ───────────────────────────────────────────────────
  //
  // Three days, and two entries in the SAME MINUTE, which is the case that
  // separates "group by day" from "one heading per row".
  const SPAN = [
    { at: '2026-09-17T10:15:00.000Z', kind: 'task', what: 'Claimed an offer', detail: null },
    { at: '2026-09-17T09:30:10.000Z', kind: 'chat', what: 'Wrote in', detail: 'in English' },
    { at: '2026-09-17T09:30:40.000Z', kind: 'screen', what: 'Opened Wallet', detail: null },
    { at: '2026-09-16T18:00:00.000Z', kind: 'withdrawal', what: 'Asked to withdraw ₹250', detail: null },
    { at: '2026-09-14T08:00:00.000Z', kind: 'signup', what: 'Finished setting up', detail: null },
  ];
  const grouped = run.byDay(SPAN);
  ok(grouped.length === 3, `three days become three headings, got ${grouped.length}`);
  ok(grouped[0].entries.length === 3,
    `the three on the first day are under ONE heading, got ${grouped[0].entries.length}`);
  ok(grouped[1].entries.length === 1 && grouped[2].entries.length === 1,
    'the other two days carry one each');
  // Two in the same minute stay separate rows under one heading — a day is the
  // grouping, not a minute.
  ok(grouped[0].entries[1].what === 'Wrote in' && grouped[0].entries[2].what === 'Opened Wallet',
    'two entries in the same minute are both kept, in the order the server sent');
  // The heading IS the key, so a heading can never appear twice.
  const headings = grouped.map((g) => g.day);
  ok(new Set(headings).size === headings.length,
    `no date is printed twice, got [${headings.join(' | ')}]`);
  ok(grouped.every((g) => g.day === run.fmtDay(g.entries[0].at)),
    'each heading is the day its own entries fall on');
  // And it does not re-sort: the server's order is total, a second opinion here
  // would disagree with it the first time either changed.
  ok(run.byDay([SPAN[4], SPAN[0]])[0].entries[0].what === 'Finished setting up',
    'the panel preserves the order it was given rather than sorting again');
  ok(run.byDay([]).length === 0, 'no entries makes no headings');

  // ── 2. THE TRIM MESSAGE ─────────────────────────────────────────────────
  ok(run.trim({ shown: 500, total: 500, trimmed: 0 }) === null,
    'NOTHING is said when nothing was trimmed');
  ok(run.trim({ shown: 0, total: 0, trimmed: 0 }) === null, 'and not on an empty trail');
  const trimmed = run.trim({ shown: 500, total: 1342, trimmed: 842 });
  ok(typeof trimmed === 'string' && trimmed.includes('500') && trimmed.includes('1,342'),
    `it names BOTH numbers, got ${JSON.stringify(trimmed)}`);
  ok(/narrow the window/i.test(trimmed), 'and says what to do about it');
  // The defect this sentence exists to prevent: "Showing 500" reads as "there
  // were 500". There must be no branch that produces one number without the other.
  ok(!/^Showing \d[\d,]*\.?$/.test(trimmed.trim()),
    'THE COUNT IS NEVER SHOWN WITHOUT THE TOTAL');

  // ── 3. NINE KINDS, EACH WITH A WORD AND A COLOUR ────────────────────────
  //
  // Read out of the SERVER'S list, not copied. A kind added to
  // backend/src/events/activity.ts without a word and a colour here would render
  // unstyled and nobody would notice, so it fails here instead.
  const activityTs = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'backend', 'src', 'events', 'activity.ts'), 'utf8');
  const kindsBlock = (activityTs.match(/export const ACTIVITY_KINDS = \[([\s\S]*?)\] as const;/) || [])[1] || '';
  const serverKinds = [...kindsBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  ok(serverKinds.length === 9, `the server declares nine kinds, found ${serverKinds.length}`);
  const panelKinds = Object.keys(run.kinds);
  ok(JSON.stringify([...panelKinds].sort()) === JSON.stringify([...serverKinds].sort()),
    `the panel knows exactly the server's kinds — server [${serverKinds.join(', ')}], panel [${panelKinds.join(', ')}]`);
  for (const kind of serverKinds) {
    const k = run.kinds[kind];
    ok(k && typeof k.word === 'string' && k.word.length > 0, `${kind} has a word`);
    ok(k && typeof k.tone === 'string' && /^var\(--[a-z]+\)$/.test(k.tone),
      `${kind} has a colour, and it is a token rather than a hex value`);
  }
  // COLOUR IS NEVER THE ONLY SIGNAL. Every row prints its kind as a word, so the
  // screen works for somebody who cannot tell two of these colours apart.
  for (const kind of serverKinds) {
    const drawn = words(run.row({ at: '2026-09-17T10:00:00.000Z', kind, what: 'A thing happened', detail: null }));
    ok(drawn.includes(run.kinds[kind].word),
      `a ${kind} row prints its kind as a WORD, not only as a colour`);
    ok(drawn.includes('A thing happened'), `a ${kind} row prints the server's sentence`);
  }
  // The named groupings the design asks for, asserted rather than described.
  ok(run.kinds.withdrawal.tone === 'var(--ok)', 'money has its own colour');
  ok(run.kinds.task.tone === 'var(--info)', 'offers have another');
  ok(run.kinds.chat.tone === run.kinds.question.tone,
    'the two ways somebody reaches out share one colour');
  ok(run.kinds.chat.tone !== run.kinds.task.tone && run.kinds.chat.tone !== run.kinds.withdrawal.tone,
    'and support is not money and not offers');
  ok(run.kinds.screen.tone === 'var(--muted)', 'screens are the faintest');
  // A kind the server grows tomorrow still draws, under its own name, rather than
  // vanishing — a gap in a trail is invisible.
  const unknown = words(run.row({ at: '2026-09-17T10:00:00.000Z', kind: 'somethingnew', what: 'A new thing', detail: null }));
  ok(unknown.includes('somethingnew') && unknown.includes('A new thing'),
    'an unknown kind still draws rather than disappearing');
  // The detail goes underneath when there is one, and nothing is drawn when not.
  ok(words(run.row({ at: '2026-09-17T10:00:00.000Z', kind: 'chat', what: 'Wrote in', detail: 'in Hindi' })).includes('in Hindi'),
    'the detail is drawn under the sentence');

  // ── 4. THE EMPTY STATE IS A SENTENCE ────────────────────────────────────
  const emptyDrawn = words(run.timeline({
    window: { days: 30 }, timeline: { entries: [], total: 0, shown: 0, trimmed: 0 },
  }));
  ok(/nothing recorded for this person/i.test(emptyDrawn),
    `an empty trail says so in a sentence, got ${JSON.stringify(emptyDrawn)}`);
  ok(/last 30 days/.test(emptyDrawn), 'and names the window it looked in');
  ok(/try a longer window/i.test(emptyDrawn),
    'and says the window may be the reason, because it can be');
  // At a year there is nothing longer to suggest, so it must not suggest one.
  const emptyYear = words(run.timeline({
    window: { days: 365 }, timeline: { entries: [], total: 0, shown: 0, trimmed: 0 },
  }));
  ok(/last year/i.test(emptyYear) && !/try a longer window/i.test(emptyYear),
    'at a year it does not send somebody looking for a longer window that does not exist');

  // ── 5. THE WINDOW PICKER, AND THE LABEL ON THE LAST ONE ─────────────────
  ok(JSON.stringify(run.windows.map((w) => w[0])) === '[7,30,90,365]',
    'the four windows are 7, 30, 90 and 365 days');
  const yearLabel = (run.windows.find((w) => w[0] === 365) || [])[1];
  ok(yearLabel === 'a year', `365 days is labelled "a year", got ${JSON.stringify(yearLabel)}`);
  // THE LABEL THAT WOULD BE A LIE. The server caps at 365, so somebody on Fayr
  // longer than that would be shown less than everything under a label saying
  // "all".
  ok(!run.windows.some((w) => /^all$/i.test(w[1])),
    'NO WINDOW IS CALLED "all" — the server caps at a year and the label must not promise more');

  // ── 6. SETUP, IN WORDS ──────────────────────────────────────────────────
  ok(run.setup({ setupFinished: true, setupStoppedAt: null }) === 'Finished setting up.',
    'a finished setup says so');
  const stopped = run.setup({ setupFinished: false, setupStoppedAt: 2 });
  ok(/^Stopped at setup step 2 of 3\.?$/.test(stopped),
    `"Stopped at setup step 2 of 3", not a field name, got ${JSON.stringify(stopped)}`);
  ok(!/setupStoppedAt/.test(stopped), 'and never prints the field name');
  ok(/every step was done/i.test(run.setup({ setupFinished: false, setupStoppedAt: null })),
    'every step done but never marked finished is said in words, not left blank');
  // "of 3" is written in the panel and owned by the backend. If SETUP_STEPS moves,
  // this fails here rather than the screen quietly saying "of 3" forever.
  const serverSteps = (activityTs.match(/export const SETUP_STEPS = (\d+);/) || [])[1];
  ok(String(run.steps) === serverSteps,
    `the panel's "of ${run.steps}" matches SETUP_STEPS = ${serverSteps} on the server`);

  // ── 7. HOW LONG QUIET, IN WORDS ─────────────────────────────────────────
  ok(run.quiet({ daysQuiet: 0 }) === 'Seen today.', 'nought days is "seen today", never "0 days"');
  ok(run.quiet({ daysQuiet: 1 }) === 'Quiet for a day.', 'one day reads as a day');
  ok(/1,342/.test(run.quiet({ daysQuiet: 1342 })), 'a big number is grouped, 1,342 not 1342');

  // ── 7b. ONE OF A THING IS NOT "1 THINGS" ────────────────────────────────
  //
  // "1 offers joined" was on the screen. The number was right, which is exactly
  // why it mattered: a sentence that does not agree with itself makes a person
  // wonder what else on the page was written without being read.
  //
  // THE FUNCTION IS CALLED, not looked for. A helper can be defined, described
  // in a comment and never used, and every string in this file would still be
  // where a search expects it.
  ok(run.plural(1, 'screen', 'screens') === '1 screen',
    `one is singular, got ${JSON.stringify(run.plural(1, 'screen', 'screens'))}`);
  ok(run.plural(2, 'screen', 'screens') === '2 screens',
    `two is plural, got ${JSON.stringify(run.plural(2, 'screen', 'screens'))}`);
  // NOUGHT TAKES THE PLURAL, because that is what English does.
  ok(run.plural(0, 'screen', 'screens') === '0 screens',
    `nought is plural, got ${JSON.stringify(run.plural(0, 'screen', 'screens'))}`);
  ok(run.plural(1, 'entry', 'entries') === '1 entry'
    && run.plural(3, 'entry', 'entries') === '3 entries',
    'an irregular plural works too, which is why both forms are passed in');
  // Big numbers keep their grouping: this wraps fmtCount rather than replacing it.
  ok(run.plural(1342, 'screen', 'screens') === '1,342 screens',
    `a big count is still grouped, got ${JSON.stringify(run.plural(1342, 'screen', 'screens'))}`);

  // AND IT IS ACTUALLY USED, in both sentences, which a helper test alone cannot
  // show. These draw the summary and read what came out.
  // The harness's words() puts a space between every child, so the sentence is
  // reassembled before it is read: this is checking the wording, not the spacing
  // of a test double.
  const summaryWords = (screens, tasks) => words(run.summary({
    firstSeen: '2026-09-01T00:00:00.000Z', lastSeen: '2026-09-14T00:00:00.000Z',
    daysQuiet: 3, totalScreens: screens, totalTasks: tasks,
    setupFinished: true, setupStoppedAt: null,
  })).replace(/\s+/g, ' ');
  ok(/1 screen opened, 1 offer joined\./.test(summaryWords(1, 1)),
    `one of each reads "1 screen opened, 1 offer joined", got ${JSON.stringify(summaryWords(1, 1))}`);
  ok(/2 screens opened, 2 offers joined\./.test(summaryWords(2, 2)),
    'two of each keeps the plural');
  ok(/0 screens opened, 0 offers joined\./.test(summaryWords(0, 0)),
    'and nought of each does too');
  // The two are independent: one screen and two offers must not agree with
  // each other instead of with their own numbers.
  ok(/1 screen opened, 2 offers joined\./.test(summaryWords(1, 2)),
    'each count agrees with its OWN noun, not with the other one');

  // ── 8. IT ASKS THE RIGHT ROUTE, AND READS NOBODY'S WORDS ────────────────
  ok(/\/admin\/users\/" \+ state\.user\.id\s*\+ "\/activity\?days=/.test(src),
    'it reads GET /admin/users/:id/activity with the window on the query string');
  // THE ONE THING THIS SCREEN MUST NOT DO. Message bodies and screenshots are
  // audited through their own routes on purpose; reaching for them here would
  // widen who can read a conversation without anybody deciding to.
  //
  // COMMENTS STRIPPED FIRST, and that is not tidiness. Written against the whole
  // block, this check passed only because the block's own comment says the screen
  // never asks for a screenshot — it was reading the prose that PROMISES the rule
  // and calling that the rule being kept. Found by it failing on a comment.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok(codeOnly.length > 500, 'there is code left after the comments come out');
  ok(!/\/admin\/chats/.test(codeOnly), 'it never calls a chat route');
  ok(!/screenshot|\/uploads|imgSrc/i.test(codeOnly), 'and never asks for a screenshot');
  ok(!/<img|"img"/.test(codeOnly), 'and draws no image');
}

console.log('\n=== one light theme, in one place ===');
{
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  ok(style.length > 1000, 'the stylesheet was found');

  // ── COMMENTS COME OUT FIRST, FOR EVERY CHECK BELOW ──────────────────────
  //
  // Not tidiness, and it caught two of these checks before it caught anything
  // else. The token block EXPLAINS that the dark-mode block was deleted and NAMES
  // the design hex values each token was darkened from — so read as source, this
  // file's own explanation of the rule fails the rule. The same lesson the trail's
  // screenshot check taught: read the code, never the words beside it.
  const noComments = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  const hexIn = (t) => [...t.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  const htmlCode = noComments(html);
  const styleCode = noComments(style);

  // ── ONE THEME ───────────────────────────────────────────────────────────
  //
  // The dark block was a second, half-converted palette: Fayr's design system
  // has no dark counterpart, so whoever had their laptop set to dark was getting
  // a different product from the person beside them. Deleted, and kept deleted.
  ok(!/prefers-color-scheme/.test(htmlCode),
    'THE DARK-MODE BLOCK IS GONE and has not crept back');
  ok(!/@media[^{]*\bdark\b/.test(htmlCode),
    'and no other rule switches on a dark preference');

  // ── EVERY COLOUR IS A TOKEN ─────────────────────────────────────────────
  const root = (styleCode.match(/:root\s*\{[\s\S]*?\n {4}\}/) || [])[0] || '';
  ok(root.length > 200, 'the :root token block was found');
  ok(hexIn(root).length >= 12,
    `the palette lives in the tokens, found ${hexIn(root).length} values there`);

  const loose = hexIn(styleCode.replace(root, ' '));
  ok(loose.length === 0,
    `NO RULE NAMES A COLOUR ITSELF — every one is a var(--token). Found [${loose.join(', ')}]`);
  const inScript = hexIn(noComments(script));
  ok(inScript.length === 0,
    `and no render function invents one, so a future screen cannot add a sixth grey. Found [${inScript.join(', ')}]`);
  // Subtracting the STRIPPED style and script, not the raw ones. Removing the
  // raw text from stripped html matches nothing, which left the whole token block
  // in and failed this on the palette it was meant to protect.
  const elsewhere = hexIn(htmlCode.replace(styleCode, ' ').replace(noComments(script), ' '));
  ok(elsewhere.length === 0,
    `and none anywhere else in the document. Found [${elsewhere.join(', ')}]`);

  // ── THE FONTS, WITH A FLOOR UNDER THEM ──────────────────────────────────
  for (const face of ['Alexandria', 'Poppins', 'Inter']) {
    ok(new RegExp(`family=${face}`).test(html), `${face} is loaded`);
  }
  ok(/display=swap/.test(html),
    'the fonts swap rather than blocking, so the panel paints readable straight away');
  for (const [token, fallback] of [['--sans', 'system-ui'], ['--display', 'system-ui'], ['--logo', 'system-ui']]) {
    const line = (root.match(new RegExp(`${token}:[^;]+;`)) || [])[0] || '';
    ok(line.includes(fallback),
      `${token} names a system fallback, so a blocked CDN costs the look and not the reading`);
  }
  // The wordmark, as fayr-design.browser.jsx draws it.
  ok(/\.brand\s*\{[^}]*var\(--logo\)/.test(styleCode), 'the wordmark is set in Alexandria');
  ok(/\.sidebar \.brand \.dot\s*\{[^}]*var\(--yellow-deep\)/.test(styleCode),
    'and its full stop is the Fayr yellow');
}

console.log('\n=== every pill is readable on the cream (4.5:1) ===');
{
  // ── WHY THIS IS COMPUTED AND NOT REMEMBERED ─────────────────────────────
  //
  // MEASURED 17 September 2026. Fayr's published state colours are built for
  // large bold type on a phone, and as 11.5px pill text on these grounds not one
  // of them reached 4.5:1 — greenDeep 2.34:1, amber 1.64:1, red 3.04:1. Each was
  // darkened, keeping its hue and saturation, until it cleared.
  //
  // A note in a comment saying "these were checked" rots the first time somebody
  // nudges a token. This reads the tokens out of the file and does the arithmetic,
  // so the rule holds rather than having held once.
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const root = (style.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/:root\s*\{[\s\S]*?\n {4}\}/) || [])[0] || '';
  const tok = (name) => (root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // color-mix(in srgb, X 15%, transparent) is X at 15% composited over whatever
  // is behind the pill. The pill's own tint is what its text has to beat, and it
  // is always harder than the plain ground — which is why checking against the
  // background alone would pass colours that are unreadable in place.
  const over = (x, b, pct) => {
    const [xr, xg, xb] = hex(x), [br, bg, bb] = hex(b), a = pct / 100;
    const f = (c, d) => Math.round(c * a + d * (1 - a));
    return '#' + [f(xr, br), f(xg, bg), f(xb, bb)].map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  const GROUNDS = [['white', tok('--surface')], ['creamDeep', tok('--surface-2')], ['cream', tok('--bg')]];
  for (const [, g] of GROUNDS) ok(/^#[0-9a-f]{6}$/i.test(g || ''), `a ground token was read: ${g}`);

  // Every pill the panel can draw. The list is the five pill- classes in the
  // stylesheet, read from it rather than typed here, so a sixth state cannot be
  // added without being measured.
  const pillClasses = [...style.matchAll(/\.pill-([a-z]+)\s*\{[^}]*var\(--([a-z]+)\)/g)].map((m) => m[2]);
  ok(pillClasses.length === 5, `five pills in the stylesheet, found ${pillClasses.length}`);
  for (const name of pillClasses) {
    const fg = tok(`--${name}`);
    ok(/^#[0-9a-f]{6}$/i.test(fg || ''), `--${name} is a colour`);
    for (const [gname, g] of GROUNDS) {
      const r = ratio(fg, over(fg, g, 15));
      ok(r >= 4.5, `.pill-${name} on ${gname}: ${r.toFixed(2)}:1`);
    }
  }

  // The rest of the text, on every ground it can land on.
  for (const name of ['text', 'muted', 'accent', 'ok', 'warn', 'bad', 'info', 'neutral']) {
    const fg = tok(`--${name}`);
    for (const [gname, g] of GROUNDS) {
      const r = ratio(fg, g);
      ok(r >= 4.5, `--${name} as text on ${gname}: ${r.toFixed(2)}:1`);
    }
  }
  // The accent also carries text ON ITS OWN TINT — the active section and the
  // open team's glyph — which is a harder pair than the plain ground and the one
  // that a first attempt at this palette failed on at 4.21:1.
  const acc = tok('--accent');
  for (const pct of [12, 15]) {
    const r = ratio(acc, over(acc, tok('--surface'), pct));
    ok(r >= 4.5, `--accent on its own ${pct}% tint: ${r.toFixed(2)}:1`);
  }
  // And white on the accent, which is the primary button and the count badge.
  const btn = ratio(tok('--accent-fg'), acc);
  ok(btn >= 4.5, `--accent-fg on --accent (the primary button): ${btn.toFixed(2)}:1`);

  // BRAND GREEN IS NOT A TEXT COLOUR, and the tokens must not quietly become it.
  // #30A90F as published reaches 2.34:1 as pill text. It is kept out of the panel
  // until the layout step gives it a large fill with no words on it.
  ok(!/#30A90F/i.test(root.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'the published brand green is not used raw as a token — it cannot carry text at these sizes');
}

console.log('\n=== the user page, actually run ===');
{
  // ── WHY THIS IS RUN AND NOT READ ────────────────────────────────────────
  //
  // The same lesson the practice-window mark and the trail both taught. A string
  // match would pass on a page that drew an empty box where a name should be, on
  // a journey strip that marked every step done, and on a split that quietly
  // dropped every entry belonging to no offer. Every check below CALLS the
  // functions and reads what came out.
  const trailFrom = script.indexOf("// ── one person's trail: begin");
  const trailTo = script.indexOf("// ── one person's trail: end");
  const pageFrom = script.indexOf('// ── the user page: begin');
  const pageTo = script.indexOf('// ── the user page: end');
  ok(pageFrom > 0 && pageTo > pageFrom, 'the user page is marked off in the panel');
  const src = script.slice(pageFrom, pageTo);
  const trailSrc = script.slice(trailFrom, trailTo);
  // The REAL practice-window mark, not a stub. It is the loudest thing on an
  // offer card and it has to still be there after the page was rebuilt around it.
  const markSrc = (script.match(/function practiceMark\(t\)[\s\S]*?\n {4}\}/) || [])[0] || '';
  ok(markSrc.length > 0, 'the practice-window mark is still in the file for the card to draw');

  const harness = `
    var seen = [];
    function h(tag, attrs) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var node = { tag: tag, attrs: attrs || {}, kids: kids };
      seen.push(node);
      return node;
    }
    function fmtDay(iso) { return iso ? "17 Sep 2026" : "—"; }
    function fmtDate(iso) { return iso ? "17 Sep 2026, 10:15 am" : "—"; }
    function rupees(p) { return p == null ? "—" : "₹" + (Number(p) / 100).toFixed(2); }
    function pill(txt, kind) { return h("span", { class: "pill pill-" + (kind || "neutral"), text: txt }); }
    function WalletTable(e) { return h("div", { class: "table-wrap" }, "wallet rows " + ((e || []).length)); }
    function TicketTable(e) { return h("div", { class: "table-wrap" }, "ticket rows " + ((e || []).length)); }
    function ThreadCard(q) { return h("div", { class: "thread" }, "a question thread"); }
    var USER_PILL = { ACTIVE: "ok", BLOCKED: "bad" };
    var TASK_PILL = { CLAIMED: "info", PURCHASED: "info", DELIVERED: "info",
                      REVIEWED: "info", HOLDING: "warn", REFUNDED: "ok" };
    function api() { throw new Error("the page must not call the server while drawing"); }
    function render() {}
    var state = STATE;
    ${markSrc}
    ${trailSrc}
    ${src}
    return {
      page: UserScreen(), seen: seen, journey: JOURNEY,
      steps: journeySteps, split: splitActivityByOffer, offers: offersByCampaign,
    };
  `;

  const words = (node) => {
    if (node == null || node === false) return '';
    if (Array.isArray(node)) return node.map(words).join(' ');
    if (typeof node !== 'object') return String(node);
    return words(node.kids);
  };
  const cls = (n, name) => new RegExp(`\\b${name}\\b`).test((n && n.attrs && n.attrs.class) || '');
  // One tile, found by the LABEL a person reads, so the big number is checked
  // where it is drawn and not by looking for the digit anywhere on the page.
  const tile = (out, label) => {
    const box = out.seen.find((n) =>
      cls(n, 'kv') && (n.kids || []).some((k) => k && k.attrs && cls(k, 'k') && words(k).trim() === label));
    if (!box) return { big: null, under: null };
    const kids = box.kids.filter((k) => k && typeof k === 'object');
    return { big: words(kids[0]).trim(), under: words(kids[2]).trim() };
  };

  // ── THE FIXTURE ─────────────────────────────────────────────────────────
  const entry = (kind, what, campaignId, campaignTitle) => ({
    at: '2026-09-17T10:15:00.000Z', kind, what, detail: null,
    campaignId, campaignTitle,
  });
  const ENTRIES = [
    entry('task', 'Claimed “Keep the Oil Flowing”', 'c1', 'Keep the Oil Flowing'),
    entry('evidence', 'Sent a picture of the review', 'c1', 'Keep the Oil Flowing'),
    entry('task', 'Claimed “A kettle”', 'c2', 'A kettle'),
    entry('screen', 'Opened Wallet', null, null),
    entry('chat', 'Wrote in', null, null),
    entry('withdrawal', 'Asked to withdraw ₹250', null, null),
    // An offer this person has no task for. It must not vanish.
    entry('task', 'Claimed “An offer with no card”', 'c-gone', 'An offer with no card'),
  ];
  const task = (over) => ({
    id: 't-' + (over.state || 'x'),
    state: 'CLAIMED',
    campaign: { id: 'c1', title: 'Keep the Oil Flowing', productName: 'A product', platform: 'AMAZON' },
    refund: { eligible: false, reasons: ['the review is not public yet'], amountPaise: '29500' },
    windowEndsAt: '2026-10-01T00:00:00.000Z',
    practiceWindowDays: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });
  const TASKS = [
    task({ state: 'REVIEWED' }),
    task({
      state: 'CLAIMED',
      campaign: { id: 'c2', title: 'A kettle', productName: 'A kettle', platform: 'FLIPKART' },
      refund: { eligible: false, reasons: [], amountPaise: null },
      windowEndsAt: null,
    }),
  ];
  const ACTIVITY = {
    window: { from: '2026-08-18T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z', days: 30 },
    summary: {
      firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-09-14T00:00:00.000Z',
      daysQuiet: 3, totalScreens: 12, totalTasks: 2,
      setupFinished: true, setupStoppedAt: null,
    },
    timeline: { entries: ENTRIES, total: ENTRIES.length, shown: ENTRIES.length, trimmed: 0 },
  };
  const VIEW = (over) => ({
    profile: {
      id: 'u1', displayId: 'FAYR-100001', name: null, mobile: '+919876543210',
      status: 'ACTIVE', createdAt: '2026-01-02T00:00:00.000Z',
    },
    tickets: { balance: 10, entries: [{ id: 'te1' }, { id: 'te2' }] },
    wallet: { balancePaise: '79900', entries: [{ id: 'w1' }, { id: 'w2' }] },
    withdrawals: [{ id: 'w2' }],
    tasks: TASKS,
    questions: [],
    ...over,
  });
  const ST = (view, activity) => ({
    screen: 'user',
    user: {
      loading: false, error: null, from: 'search', id: 'u1',
      data: view,
      activity: { loading: false, error: null, days: 30, data: activity, ...(activity === undefined ? {} : {}) },
    },
  });
  const draw = (view, activity) => new Function('STATE', harness)(ST(view, activity));

  // ── 1. IT DRAWS AT ALL, IN EVERY STATE IT CAN BE IN ─────────────────────
  const cases = [
    ['the page', VIEW(), ACTIVITY],
    ['the page before the trail has come back', VIEW(), null],
    ['the page for somebody with no offers', VIEW({ tasks: [] }), ACTIVITY],
    ['the page for somebody with nothing at all', VIEW({
      tasks: [], questions: [], withdrawals: [],
      tickets: { balance: 0, entries: [] }, wallet: { balancePaise: '0', entries: [] },
    }), { ...ACTIVITY, timeline: { entries: [], total: 0, shown: 0, trimmed: 0 } }],
    ['the page with a name', VIEW({
      profile: { ...VIEW().profile, name: 'Asha Kumari' },
    }), ACTIVITY],
  ];
  let drawn = null;
  for (const [label, view, activity] of cases) {
    let threw = null, out = null;
    try { out = draw(view, activity); } catch (e) { threw = e.message; }
    ok(!threw, `renders ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;
    if (label === 'the page') drawn = out;
    const flat = JSON.stringify(out.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('NaN'), `${label}: no "NaN" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
  }

  // ── 2. WHO THEY ARE, WITH NO NAME — THE ORDINARY CASE ───────────────────
  //
  // Most people have none: setup can be finished without giving one and the
  // practice data creates none at all. So this is the case the header is built
  // for, not the exception.
  const nameless = draw(VIEW(), ACTIVITY);
  const namelessWords = words(nameless.page);
  ok(namelessWords.includes('+919876543210'),
    'with no name, the MOBILE is what the page leads with');
  ok(namelessWords.includes('No name given'),
    'and it says so in words, under the mobile');
  const big = nameless.seen.filter((n) => /\bwho-name\b/.test(n.attrs.class || ''));
  ok(big.length === 1, `exactly one large identity line, found ${big.length}`);
  ok(words(big[0]).trim() === '+919876543210',
    `and it is the mobile, got ${JSON.stringify(words(big[0]).trim())}`);
  // THE DEFECT THIS EXISTS FOR. A blank where a name should be reads as a page
  // that failed to load, and is its own kind of invention.
  const identity = nameless.seen.filter((n) =>
    /\b(who-name|who-mobile|no-name)\b/.test(n.attrs.class || ''));
  ok(identity.length > 0 && identity.every((n) => words(n).trim().length > 0),
    'NO EMPTY ELEMENT IS DRAWN WHERE THE NAME WOULD BE');
  // And no invented stand-in, which is the other way to fill that space.
  ok(!/Unknown|Anonymous|No name\b(?! given)|N\/A/.test(namelessWords),
    'and no placeholder that could be read back to somebody as their name');

  // ── 3. WITH A NAME, BOTH FACTS ARE ON THE PAGE ──────────────────────────
  const named = draw(VIEW({ profile: { ...VIEW().profile, name: 'Asha Kumari' } }), ACTIVITY);
  const namedWords = words(named.page);
  ok(namedWords.includes('Asha Kumari'), 'a name is drawn when there is one');
  ok(namedWords.includes('+919876543210'),
    'AND THE MOBILE IS STILL DRAWN — an agent confirms both, not one');
  ok(!namedWords.includes('No name given'),
    'and the no-name line is gone, rather than sitting under a real name');
  const namedBig = named.seen.filter((n) => /\bwho-name\b/.test(n.attrs.class || ''));
  ok(namedBig.length === 1 && words(namedBig[0]).trim() === 'Asha Kumari',
    'the name is the large line, and the mobile moves under it');

  // ── 4. THE SPLIT: EVERY ENTRY LANDS SOMEWHERE ───────────────────────────
  const offers = drawn.offers(TASKS);
  const split = drawn.split(ENTRIES, offers);
  const bucketed = Object.keys(split.byOffer).reduce((n, k) => n + split.byOffer[k].length, 0);
  ok(bucketed + split.rest.length === ENTRIES.length,
    `every entry lands somewhere: ${bucketed} on offers + ${split.rest.length} elsewhere = ${ENTRIES.length}`);
  ok(split.byOffer.c1.length === 2 && split.byOffer.c2.length === 1,
    `entries group under the offer they name (c1 ${split.byOffer.c1.length}, c2 ${split.byOffer.c2.length})`);
  // THE MUTATION THIS CATCHES: an entry with no offer pushed into an offer card.
  for (const id of Object.keys(split.byOffer)) {
    ok(split.byOffer[id].every((e) => e.campaignId === id),
      `NO OFFER CARD HOLDS AN ENTRY THAT IS NOT ITS OWN (${id})`);
  }
  const restWhat = split.rest.map((e) => e.what);
  ok(restWhat.includes('Opened Wallet') && restWhat.includes('Wrote in')
    && restWhat.includes('Asked to withdraw ₹250'),
    'an entry belonging to NO offer lands in "everything else" rather than being dropped');
  ok(restWhat.includes('Claimed “An offer with no card”'),
    'and so does one naming an offer this person has no card for — a gap in a trail is invisible');
  ok(split.rest.length === 4, `four entries belong to the person, got ${split.rest.length}`);

  // ── ONE CARD PER CAMPAIGN, EVEN WHEN IT WAS CLAIMED TWICE ───────────────
  //
  // A trail entry names the OFFER and not the claim. Two cards for one campaign
  // would therefore show the same entries twice, and neither card would be wrong
  // about it — which is exactly the kind of duplicate a reader believes.
  const twice = [task({ state: 'HOLDING', id: 't-new' }), ...TASKS];
  const deduped = drawn.offers(twice);
  ok(deduped.length === 2,
    `three claims on two offers make TWO cards, got ${deduped.length}`);
  ok(deduped[0].claims === 2 && deduped[1].claims === 1,
    `and the card counts the claims behind it, got [${deduped.map((o) => o.claims).join(', ')}]`);
  ok(deduped[0].task.state === 'HOLDING',
    'the newest claim is the one drawn — the server sends tasks newest first');
  const twiceOut = draw(VIEW({ tasks: twice }), ACTIVITY);
  const cards = twiceOut.seen.filter((n) => cls(n, 'offer') && cls(n, 'card'));
  ok(cards.length === 2, `and the page draws two offer cards, not three (got ${cards.length})`);
  ok(/claimed 2 times/.test(words(twiceOut.page)),
    'and says in words that there was more than one claim rather than hiding it');

  // ── 5. THE JOURNEY STRIP IS REAL STATE, IN ALL SIX STATES ───────────────
  //
  // Read against the SERVER'S own ordering. A strip that stopped knowing about a
  // state would draw every task in it as though it had never started.
  const statesTs = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'backend', 'src', 'tasks', 'engine', 'states.ts'), 'utf8');
  const orderBlock = (statesTs.match(/export const ORDER: TaskStateName\[\] = \[([\s\S]*?)\];/) || [])[1] || '';
  const serverOrder = [...orderBlock.matchAll(/STATES\.([A-Z_]+)/g)].map((m) => m[1]);
  ok(serverOrder.length === 6, `the server orders six states, found ${serverOrder.length}`);
  ok(JSON.stringify(drawn.journey.map((j) => j[0])) === JSON.stringify(serverOrder),
    `the strip's six steps ARE the server's six states in order — server [${serverOrder.join(', ')}]`);
  const EXPECTED = {
    CLAIMED: ['current', 'later', 'later', 'later', 'later', 'later'],
    PURCHASED: ['done', 'current', 'later', 'later', 'later', 'later'],
    DELIVERED: ['done', 'done', 'current', 'later', 'later', 'later'],
    REVIEWED: ['done', 'done', 'done', 'current', 'later', 'later'],
    HOLDING: ['done', 'done', 'done', 'done', 'current', 'later'],
    // The money is out and nothing is in progress, so the last step is FINISHED
    // rather than current.
    REFUNDED: ['done', 'done', 'done', 'done', 'done', 'done'],
  };
  for (const [state, want] of Object.entries(EXPECTED)) {
    const got = drawn.steps({ state }).map((s) => s.status);
    ok(JSON.stringify(got) === JSON.stringify(want),
      `${state} marks exactly [${want.join(', ')}], got [${got.join(', ')}]`);
  }
  // A state nothing here has heard of reaches nothing, rather than guessing a
  // position. The state pill beside the strip still tells the truth.
  ok(drawn.steps({ state: 'SOMETHING_NEW' }).every((s) => s.status === 'later'),
    'a state this list has never heard of reaches no step rather than being placed');
  // COLOUR IS NEVER THE ONLY SIGNAL: every step says what it is in words.
  const anyStep = drawn.steps({ state: 'HOLDING' });
  ok(anyStep.every((s) => typeof s.mark === 'string' && s.mark.length > 0),
    'every step carries a word for its own status, not only a colour');
  ok(anyStep.every((s) => s.word && s.word === s.word.toLowerCase() && s.word !== s.key),
    'and the steps read as words — "bought", never "PURCHASED"');
  const stripWords = words(drawn.page);
  for (const word of ['claimed', 'bought', 'arrived', 'reviewed', 'holding', 'refunded']) {
    ok(stripWords.includes(word), `the strip draws "${word}" on the page`);
  }

  // ── 6. NOTHING IS A BLANK BOX ───────────────────────────────────────────
  const noOffers = words(draw(VIEW({ tasks: [] }), ACTIVITY).page);
  ok(/have not joined an offer yet/i.test(noOffers),
    'a person with no offers gets a SENTENCE where the cards would be');
  ok(/Everything else/.test(noOffers),
    'and the rest of the page still draws');
  // Everything belonging to an offer is a different emptiness from nothing at all.
  const allOnOffers = words(draw(VIEW(), {
    ...ACTIVITY,
    timeline: {
      entries: ENTRIES.filter((e) => e.campaignId === 'c1' || e.campaignId === 'c2'),
      total: 3, shown: 3, trimmed: 0,
    },
  }).page);
  ok(/belongs to an offer above/i.test(allOnOffers),
    'when every entry belongs to an offer, "everything else" says THAT rather than "nothing recorded"');
  ok(!/Nothing recorded for this person/i.test(allOnOffers),
    'and never sends somebody looking for a longer window that would not help');
  const nothing = words(draw(VIEW({ tasks: [] }), {
    ...ACTIVITY, timeline: { entries: [], total: 0, shown: 0, trimmed: 0 },
  }).page);
  ok(/Nothing recorded for this person/i.test(nothing),
    'and a person with nothing recorded is still told so in a sentence');

  // ── 7. THE FOUR TILES, AND THE ONE THAT MUST NOT GUESS ──────────────────
  const tiles = words(drawn.page);
  for (const label of ['Wallet balance', 'Tickets', 'Offers joined', 'Days quiet']) {
    ok(tiles.includes(label), `the ${label} tile is on the page`);
  }
  // Read off the tiles themselves. Looking for "1 of 3" anywhere on the page
  // would pass on a number drawn in the wrong tile.
  const refundedFixture = draw(VIEW({
    tasks: [...TASKS, task({ state: 'REFUNDED', id: 't-paid' })],
  }), ACTIVITY);
  const joined = tile(refundedFixture, 'Offers joined');
  ok(joined.big === '3', `the offers tile counts the offers, got ${JSON.stringify(joined.big)}`);
  ok(joined.under === '1 of 3 refunded',
    `and counts refunded AGAINST joined — two real counts, never a proportion. Got ${JSON.stringify(joined.under)}`);
  ok(tile(drawn, 'Wallet balance').big === '₹799.00',
    'the wallet tile draws the balance the server sent');
  ok(tile(drawn, 'Tickets').big === '10', 'the tickets tile draws the balance');
  // The tiles say "1 entry in the ledger", never "1 entries in the ledger".
  const single = draw(VIEW({
    wallet: { balancePaise: '25000', entries: [{ id: 'w1' }] },
    tickets: { balance: 1, entries: [{ id: 'te1' }] },
  }), ACTIVITY);
  ok(tile(single, 'Wallet balance').under === '1 entry in the ledger',
    `one ledger entry reads as one, got ${JSON.stringify(tile(single, 'Wallet balance').under)}`);
  ok(tile(single, 'Tickets').under === '1 change recorded',
    `and one ticket change too, got ${JSON.stringify(tile(single, 'Tickets').under)}`);
  ok(tile(drawn, 'Wallet balance').under === '2 entries in the ledger',
    'and two of them stay plural');
  const quiet = tile(drawn, 'Days quiet');
  ok(quiet.big === '3', `days quiet draws the number the trail gave, got ${JSON.stringify(quiet.big)}`);
  ok(/Quiet for 3 days\./.test(quiet.under), 'and says it again in words underneath');

  // ── THE TILE THAT MUST NOT GUESS ────────────────────────────────────────
  //
  // The trail loads AFTER the profile, so for a moment there is no number of
  // quiet days. A nought there says "seen today" about somebody nobody has
  // looked up yet — which is a false statement about a person, drawn in the
  // largest type on the page.
  const early = draw(VIEW(), null);
  const earlyQuiet = tile(early, 'Days quiet');
  ok(earlyQuiet.big === '—',
    `A NOUGHT IS NEVER DRAWN BEFORE THE TRAIL IS READ — got ${JSON.stringify(earlyQuiet.big)}`);
  ok(/Reading the trail/.test(earlyQuiet.under),
    'and it says it is still reading rather than leaving the space to be guessed at');
  ok(!/Seen today/.test(words(early.page)),
    'and nothing anywhere on the page claims they were seen today');
  const failed = draw(VIEW(), null);
  ok(tile(failed, 'Days quiet').big === '—',
    'and the same when the trail is not there at all');

  // ── 8. WHAT THE PAGE STILL REFUSES TO DO ────────────────────────────────
  //
  // Comments stripped first: read the code, never the words beside it.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok(codeOnly.length > 1000, 'there is code left after the comments come out');
  ok(!/\/admin\/chats|\/chats\//.test(codeOnly), 'it never calls a chat route');
  ok(!/screenshot|\/uploads|imgSrc|<img|"img"/i.test(codeOnly),
    'it never asks for a picture and draws none');
  // NO CHART. One person does not produce a distribution, and a chart of one
  // person's fortnight is a picture pretending to be analysis.
  ok(!/\bs\(\s*"(svg|rect|path|circle|line|polyline)"/.test(codeOnly),
    'THE PAGE DRAWS NO CHART — no svg, no bars, no sparkline');
  // NO PERCENTAGE THAT IS NOT A RATIO OF TWO REAL COUNTS. The page does no
  // arithmetic at all beyond counting rows.
  ok(!/%/.test(codeOnly), 'and no percentage anywhere — the strip is state, not progress');
  ok(!/Math\./.test(codeOnly), 'and it works nothing out for itself');
}

console.log('\n=== the signing-up funnel, actually drawn ===');
{
  // ── WHY THIS IS RUN AND NOT READ ────────────────────────────────────────
  //
  // A chart is the easiest thing in this file to get silently wrong. A bar
  // drawn against the wrong denominator, a zero drawn as a bar, a colour typed
  // in as a hex — every one of those leaves the right strings in the file and
  // looks like a chart on the screen. So these compute the lengths from the two
  // counts the fixture sets and compare them with what was actually drawn.
  const from = script.indexOf('// ── signing up: begin');
  const to = script.indexOf('// ── signing up: end');
  ok(from > 0 && to > from, 'the signing-up screen is marked off in the panel');
  const src = script.slice(from, to);

  const harness = `
    var seen = [];
    function node(kind, tag, attrs, rest) {
      var kids = Array.prototype.slice.call(rest, 2);
      var n = { kind: kind, tag: tag, attrs: attrs || {}, kids: kids };
      seen.push(n);
      return n;
    }
    function h(tag, attrs) { return node("html", tag, attrs, arguments); }
    function s(tag, attrs) { return node("svg", tag, attrs, arguments); }
    function api() { throw new Error("the screen must not call the server while drawing"); }
    function render() {}
    var state = STATE;
    ${src}
    return {
      screen: GrowthScreen(), seen: seen,
      base: funnelBase, share: funnelShare, geom: FUNNEL_CHART,
    };
  `;

  const words = (n) => {
    if (n == null || n === false) return '';
    if (Array.isArray(n)) return n.map(words).join(' ');
    if (typeof n !== 'object') return String(n);
    return (n.attrs && n.attrs.text ? n.attrs.text + ' ' : '') + words(n.kids);
  };
  const cls = (n, name) => new RegExp(`(^| )${name}( |$)`).test((n.attrs && n.attrs.class) || '');

  // ── THE FIXTURE. Every count is set here, so every length below is checked
  // against arithmetic this file does itself rather than against the panel's.
  const step = (key, label, count, dropped, thin) => ({
    key, label, count, dropped, thin,
    ofPrevious: null, ofStart: null, // the table's job; the chart never draws them
  });
  const FULL = [
    step('opened', 'Opened the app', 200, 0, false),
    step('onboarded', 'Finished onboarding', 150, 50, false),
    step('phone', 'Reached the phone screen', 120, 30, false),
    step('asked', 'Asked for a code', 40, 80, false),
    step('verified', 'Entered a correct code', 30, 10, false),
    step('account', 'Account created', 30, 0, false),
    step('setup', 'Finished setup', 10, 20, false),
    step('claimed', 'Claimed a campaign', 5, 5, true),
  ];
  // Today's real shape: the first three are reported by the app and nothing
  // sends them yet, so they read nought while the rest are real.
  const UNREPORTED = [
    step('opened', 'Opened the app', 0, 0, true),
    step('onboarded', 'Finished onboarding', 0, 0, true),
    step('phone', 'Reached the phone screen', 0, 0, true),
    step('asked', 'Asked for a code', 53, 0, true),
    step('verified', 'Entered a correct code', 40, 13, false),
    step('account', 'Account created', 38, 2, false),
    step('setup', 'Finished setup', 20, 18, false),
    step('claimed', 'Claimed a campaign', 6, 14, false),
  ];
  const DATA = (funnel, worst) => ({
    window: { from: 'x', to: 'y', days: 30 },
    funnel,
    worst,
    codesRequested: 53, codesVerified: 40, codeDeliveryRate: 75.5,
    sessions: { expiredUnused: 4, cameBack: 1, cameBackRate: 25, signedOut: 2, sessionDays: 30 },
  });
  const draw = (data, over) => new Function('STATE', harness)({
    growth: { loading: false, error: null, days: 30, data, ...over },
  });

  const full = draw(DATA(FULL, { key: 'asked', label: 'Asked for a code', dropped: 80 }));
  const g = full.geom;
  const innerW = g.w - g.padL - g.padR;
  const svgOf = (out) => out.seen.filter((n) => n.kind === 'svg');
  const rectsOf = (out, name) => svgOf(out).filter((n) => n.tag === 'rect' && cls(n, name));
  const textOf = (out, name) => svgOf(out).filter((n) => n.tag === 'text' && cls(n, name));

  // ── 1. IT DRAWS, IN EVERY STATE THE SCREEN CAN BE IN ────────────────────
  for (const [label, data, over] of [
    ['the screen', DATA(FULL, { key: 'asked', label: 'Asked for a code', dropped: 80 }), {}],
    ['the screen with nothing reported yet', DATA(UNREPORTED, { key: 'setup', label: 'Finished setup', dropped: 18 }), {}],
    ['the screen with no drop anywhere', DATA(FULL.map((x) => ({ ...x, dropped: 0 })), null), {}],
    ['the screen while it is reading', null, { loading: true }],
    ['the screen that could not be read', null, { error: 'Could not reach the Fayr server.' }],
  ]) {
    let threw = null, out = null;
    try { out = draw(data, over); } catch (e) { threw = e.message; }
    ok(!threw, `renders ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;
    const flat = JSON.stringify(out.seen, (k, v) => (typeof v === 'function' ? undefined : v));
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('NaN'), `${label}: no "NaN" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
  }

  // ── 2. EVERY BAR IS THE REAL RATIO OF TWO REAL COUNTS ───────────────────
  const bars = rectsOf(full, 'fbar');
  ok(bars.length === FULL.length,
    `one bar per step, got ${bars.length} for ${FULL.length} steps`);
  FULL.forEach((st, i) => {
    // Worked out here, from the fixture's own two numbers, against the FIRST
    // step's count — not read back out of the panel.
    const want = Math.max(1, (st.count / FULL[0].count) * innerW);
    ok(Math.abs(bars[i].attrs.width - want) < 0.001,
      `${st.label}: ${st.count} of ${FULL[0].count} is ${want.toFixed(1)} wide, drew ${Number(bars[i].attrs.width).toFixed(1)}`);
  });
  // IN FUNNEL ORDER, NEVER SORTED BY SIZE. The order is the journey.
  ok(JSON.stringify(textOf(full, 'flabel').map((t) => words(t).trim()))
    === JSON.stringify(FULL.map((st) => st.label)),
    'the steps are drawn in funnel order, not biggest first');
  // LABELLED DIRECTLY WITH ITS COUNT, and no legend anywhere.
  ok(JSON.stringify(textOf(full, 'fcount').map((t) => words(t).trim()))
    === JSON.stringify(FULL.map((st) => String(st.count))),
    'every bar carries its own count beside it');
  const chartCode = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok(chartCode.length > 1000, 'there is code left after the comments come out');
  ok(!/legend/i.test(chartCode), 'and there is no legend');

  // ── 3. THE DROP IS THE GAP, AND THE WIDEST GAP IS THE WORST DROP ────────
  const drops = rectsOf(full, 'fdrop');
  ok(drops.length === FULL.filter((st, i) => i > 0 && st.dropped > 0).length,
    `one gap per real drop, got ${drops.length}`);
  const askedAt = FULL.findIndex((st) => st.key === 'asked');
  const wantGap = ((FULL[askedAt - 1].count - FULL[askedAt].count) / FULL[0].count) * innerW;
  const worstRect = drops.find((n) => cls(n, 'worst'));
  ok(worstRect != null, 'the server’s worst drop is marked on the chart');
  ok(Math.abs(worstRect.attrs.width - wantGap) < 0.001,
    `the worst gap is ${FULL[askedAt - 1].count} − ${FULL[askedAt].count} wide (${wantGap.toFixed(1)}), drew ${Number(worstRect.attrs.width).toFixed(1)}`);
  // THE POINT OF THE WHOLE CHART: the eye lands on the biggest drop without
  // reading anything, so the widest gap must BE the worst one. Both come from
  // the same two counts over the same base, so they cannot disagree — except on
  // a step drawn longer than the track, where the drawing is clamped and the
  // table's own column is the one to read. This fixture has no such step.
  const widest = drops.reduce((a, b) => (Number(b.attrs.width) > Number(a.attrs.width) ? b : a));
  ok(widest === worstRect,
    'THE WIDEST GAP IS THE ONE THE SERVER CALLS THE WORST DROP');
  ok(drops.filter((n) => cls(n, 'worst')).length === 1, 'and only one is marked');
  // A gap starts where its own bar ends: it is the space between two steps.
  const askedBar = bars[askedAt];
  ok(Math.abs(worstRect.attrs.x - (Number(askedBar.attrs.x) + Number(askedBar.attrs.width))) < 0.001,
    'the gap begins exactly where the bar under it ends');

  // ── 4. A THIN BASE IS NOT DRAWN AS THOUGH IT WERE SOLID ─────────────────
  const thinAt = FULL.findIndex((st) => st.thin);
  const thinBar = bars[thinAt];
  ok(cls(thinBar, 'thin'), 'a step whose base is too small is marked as thin');
  ok(/var\(--muted\)/.test(thinBar.attrs.style || ''),
    'and drawn muted rather than in the ink of a solid number');
  ok(/dash|opacity/.test(thinBar.attrs.style || ''),
    'and NOT SOLID, so it does not depend on telling two greys apart');
  ok(!/var\(--text\)/.test(thinBar.attrs.style || ''),
    'and never in the same ink as a bar that stands up');
  ok(words(textOf(full, 'fcount')[thinAt]).trim() === String(FULL[thinAt].count),
    'and it still shows its count — muted is not hidden');
  ok(bars.filter((b) => cls(b, 'thin')).length === 1,
    'and no bar with a solid base is muted');

  // ── 5. A STEP WITH NOTHING COUNTED DRAWS NO BAR, AND SAYS SO ────────────
  const early = draw(DATA(UNREPORTED, { key: 'setup', label: 'Finished setup', dropped: 18 }));
  const earlyBars = rectsOf(early, 'fbar');
  const counted = UNREPORTED.filter((st) => st.count > 0);
  ok(earlyBars.length === counted.length,
    `only the ${counted.length} steps with a count get a bar, got ${earlyBars.length}`);
  const nones = textOf(early, 'fnone');
  ok(nones.length === UNREPORTED.length - counted.length,
    `and each of the ${UNREPORTED.length - counted.length} with nothing counted says so, got ${nones.length}`);
  ok(nones.every((t) => /nothing counted/i.test(words(t))),
    'IN WORDS — a nought and a thing nobody has measured are different facts');
  // The counts are still drawn for those rows: the table beside it says 0 too,
  // and the chart must not disagree with it.
  ok(words(textOf(early, 'fcount')[0]).trim() === '0',
    'the count is still drawn for a step with no bar');
  // The base fell through to the first step that counted anybody, and the chart
  // NAMES it rather than leaving the denominator to be guessed at.
  ok(early.base(UNREPORTED).key === 'asked',
    'the base is the first step that has counted anybody');
  ok(early.base(FULL).key === 'opened',
    'and it is the first step of the journey whenever that step has a count');
  const said = words(early.screen);
  ok(/Measured against “Asked for a code”/.test(said),
    'the chart says which step it measured against when it is not the first');
  ok(/Every bar is that step’s count against “Opened the app”/.test(words(full.screen)),
    'and says so plainly when it is the first');
  // 53 of 53 is the whole track.
  ok(Math.abs(earlyBars[0].attrs.width - innerW) < 0.001,
    'the base step fills the track, because it is the number the others are drawn against');
  // NO GAP IS DRAWN BACK TO A STEP THAT COUNTED NOTHING — that would draw an
  // absence as a collapse, which is the misreading this rule exists for.
  const gapForAsked = rectsOf(early, 'fdrop').length;
  ok(gapForAsked === UNREPORTED.filter((st, i) => i > 0 && st.dropped > 0 && UNREPORTED[i - 1].count > 0).length,
    `no gap is drawn back to a step with nothing counted, got ${gapForAsked} gaps`);

  // ── 6. NOTHING AT ALL IS A SENTENCE, NOT AN EMPTY CHART ─────────────────
  const nothing = draw(DATA(FULL.map((x) => ({ ...x, count: 0, dropped: 0, thin: true })), null));
  ok(svgOf(nothing).length === 0, 'with nothing counted anywhere, no chart is drawn at all');
  ok(/Nothing has been counted at any step/.test(words(nothing.screen)),
    'and it says so, rather than drawing eight empty rows');
  ok(nothing.base([]) === null && nothing.share(5, null) === null,
    'and the two helpers answer null rather than guessing a base');
  ok(nothing.share(5, { count: 0 }) === null,
    'a share of nobody is null here too, the same as it is in funnel.ts');

  // ── 7. A STEP BIGGER THAN THE BASE IS REPORTED, NOT CLAMPED AWAY ────────
  //
  // funnel.ts says so itself: a window shows people finishing setup who started
  // it last week. The DRAWN length stops at the end of the track because there
  // is nowhere else for it to go; the count beside it stays the real one.
  const over = draw(DATA([
    step('opened', 'Opened the app', 100, 0, false),
    step('onboarded', 'Finished onboarding', 140, 0, false),
  ], null));
  const overBars = rectsOf(over, 'fbar');
  const OVERSHOOT = [
    step('opened', 'Opened the app', 100, 0, false),
    step('onboarded', 'Finished onboarding', 140, 0, false),
  ];
  // THE BASE IS THE FIRST STEP THAT COUNTED ANYBODY, NOT THE BIGGEST ONE. Those
  // are the same number most days, which is exactly why this needs its own
  // fixture: a base quietly taken from the largest step would draw a chart that
  // looked right on ordinary data and was measured against something nobody
  // named.
  ok(over.base(OVERSHOOT).key === 'opened',
    'the base is the first counted step even when a later one is bigger');
  ok(Math.abs(overBars[0].attrs.width - innerW) < 0.001,
    'so the FIRST step fills the track, and the bigger one below it is what overflows');
  ok(Math.abs(overBars[1].attrs.width - innerW) < 0.001,
    'a step bigger than the base draws to the end of the track and no further');
  ok(words(textOf(over, 'fcount')[1]).trim() === '140',
    'AND ITS COUNT IS STILL THE REAL ONE — the drawing is clamped, the number is not');

  // ── 8. WHAT THE CHART IS NOT ────────────────────────────────────────────
  const svgTags = [...new Set(svgOf(full).map((n) => n.tag))].sort();
  ok(JSON.stringify(svgTags) === JSON.stringify(['rect', 'svg', 'text', 'title']),
    `the chart is bars and words only — no pie, no donut, no area, no line. Drew [${svgTags.join(', ')}]`);
  ok(full.seen.filter((n) => n.kind === 'svg' && n.tag === 'svg').length === 1,
    'ONE chart on the screen: the table already carries the numbers, so nothing is measured twice');
  ok(!svgOf(full).some((n) => /%/.test(words(n))),
    'and no percentage is drawn on it — those live in the table, written once');
  const styles = svgOf(full).map((n) => (n.attrs.style || '') + ' ' + (n.attrs.fill || '') + ' ' + (n.attrs.stroke || ''));
  ok(!styles.some((v) => /#[0-9a-f]{3}|rgb|hsl/i.test(v)),
    'NO SVG ELEMENT CARRIES A COLOUR OF ITS OWN — every one is a var(--token)');
  ok(styles.filter((v) => /fill:/.test(v)).every((v) => /fill:\s*var\(--[a-z0-9-]+\)/.test(v)),
    'every fill names a token');
  ok(styles.some((v) => /fill:\s*var\(--/.test(v)), 'and there are fills to check');
  ok(!/animate|transition|@keyframes/i.test(chartCode), 'nothing on this screen moves');
  // The numbers it draws are the ones it was handed, and no others.
  const drawnNumbers = svgOf(full)
    .filter((n) => n.tag === 'text' && cls(n, 'fcount'))
    .map((n) => Number(words(n).trim()));
  ok(drawnNumbers.every((v) => FULL.some((st) => st.count === v)),
    'every number on the chart is one the server sent');
}

console.log('\n=== WHY A REFUND IS NOT THE NUMBER ON THE OFFER — Phase 8B-a ===');
{
  // The server works a watched purchase's refund out from what the person paid
  // for that one product, capped at the offer's price, and records WHICH printed
  // line explains the difference. The panel is where a person reads it.
  const words = (script.match(/var PRICE_GAP_WORDS = \{([\s\S]*?)\};/) || [])[1] || '';
  ok(words.length > 100, 'the panel has a sentence for each price-gap reason');

  // EVERY NAME THE SERVER CAN SEND HAS ONE, read off the server's own list so
  // the two cannot drift apart.
  const ruleFile = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'backend', 'src', 'tasks', 'engine', 'watched-price.ts'),
    'utf8',
  );
  const listed = (ruleFile.match(/PRICE_GAP_REASONS = \[([\s\S]*?)\] as const;/) || [])[1] || '';
  const names = [...listed.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  ok(names.length === 6, `the server names ${names.length} reasons`);
  for (const name of names) {
    ok(new RegExp(`"${name}"\\s*:`).test(words), `the panel has an answer for "${name}"`);
  }

  // "none" IS NOTHING TO SAY, and says nothing rather than a reassuring line.
  ok(/"none":\s*null/.test(words), '"none" draws no line at all');

  // AND IT IS DRAWN ON THE OFFER CARD, which is where the refund figure is.
  ok(/priceGapLine\(t\)/.test(script), 'the offer card draws it');
  ok(/function priceGapLine\(t\)/.test(script), 'and the helper exists');
  ok(/t\.order \? t\.order\.priceGapReason : null/.test(script),
    'read off the order the server sent, and nowhere else');

  // THE PANEL DOES NO ARITHMETIC WITH IT. It is a note, and the panel treats it
  // as one: no comparison of amounts anywhere near it.
  const helper = (script.match(/function priceGapLine\(t\) \{([\s\S]*?)\n    \}/) || [])[1] || '';
  ok(helper.length > 50, 'the helper body was found');
  ok(!/[*/+-]\s*\d|Paise|amount/i.test(helper), 'and it computes nothing');

  // A NAME THE PANEL DOES NOT KNOW IS SHOWN, NOT SWALLOWED.
  ok(/Price gap recorded as/.test(script), 'an unknown reason is printed as itself');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
