// THE HALF THAT ACTUALLY OPENS SOMETHING, AND ACTUALLY WRITES THE CLIPBOARD.
//
// Every decision is next door in src/ui/shopApp.js, which is pure and is checked
// under node. This file is the wiring: it talks to the phone, and it holds no
// wording and no addresses of its own.
//
// THE FALLBACK IS THE WHOLE DESIGN. Linking.openURL REJECTS when nothing on the
// phone can open the address, and a shop's app that is not installed looks exactly
// like a scheme we guessed wrongly. So the app address is TRIED, and on any refusal
// the web address is opened instead. That is why a wrong guess in shopApp.js costs
// a person nothing, and it is why this needs no entries in app.json: it never asks
// the phone whether it CAN open something, it just tries.
//
// NOTHING HERE THROWS. A screen calling this is about to send somebody shopping,
// and a rejected promise on that path would be a crash at the worst moment. Every
// call answers with what happened instead.
import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';

import { addressesToTry, whatToCopy } from './ui/shopApp';

/**
 * Put the product's name on the clipboard.
 *
 * Answers true only if it really went on. A screen must say which, because
 * software that quietly changes somebody's clipboard and says nothing has taken
 * something without asking.
 */
export async function copyProductName(productName) {
  const what = whatToCopy(productName);
  if (what == null) return false;
  try {
    await Clipboard.setStringAsync(what);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Open the shop's own installed app, falling back to its website.
 *
 * `webUrl` is handed in by the caller, from the frozen platforms.js, so this file
 * never holds an address of its own and cannot disagree with where Fayr goes to
 * read an order.
 *
 * Answers 'app' | 'web' | 'nothing', so a screen and a test can tell a real
 * opening from a silent failure.
 */
export async function openShopApp(marketplaceKey, webUrl) {
  // The ORDER is decided in ui/shopApp.js, which is pure and is checked under node.
  // This walks the list and stops at the first one the phone accepts.
  //
  // ── WHY THE APP ADDRESS IS ASKED ABOUT BEFORE IT IS OPENED ─────────────────
  //
  // The old shape TRIED the app scheme and trusted a rejection to send us on to
  // the website. On a real phone with no app that rejection comes. On the iOS
  // SIMULATOR it does not: openURL on an unknown scheme like
  // com.amazon.mobile.shopping:// can RESOLVE — opening nothing — instead of
  // throwing, so this returned 'app', the screen believed the shop had opened,
  // and the person sat on a screen that had done nothing. That is the "I tap
  // Open Amazon and nothing happens" the owner hit, and it looked random because
  // whether openURL resolves or rejects on a dead scheme is not something the
  // caller controls.
  //
  // canOpenURL answers it for real. For an app scheme it is false unless that app
  // is installed and its scheme is declared (see app.json's
  // LSApplicationQueriesSchemes / Android intent queries), so the simulator now
  // falls through to the website every time, a phone with the app opens the app,
  // and a phone without it opens the website. The plain https address is opened
  // without asking — every phone can, and canOpenURL on http is itself flaky.
  for (const where of addressesToTry(marketplaceKey, webUrl)) {
    try {
      if (where.kind === 'app') {
        let can = false;
        try {
          can = await Linking.canOpenURL(where.url);
        } catch (e) {
          can = false; // an error asking is a no — the website is next.
        }
        if (!can) continue;
      }
      await Linking.openURL(where.url);
      return where.kind;
    } catch (e) {
      // Try the next one. A phone that refuses even the plain https address is a
      // phone with no browser, and the caller is told nothing opened.
    }
  }
  return 'nothing';
}
