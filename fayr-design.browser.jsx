import React, { useState, useEffect, useRef, useCallback } from "react";
// The REAL verification logic (plain JS, no RN/DOM) — same modules the device
// app runs. This is the only bridge between the prototype and the state machine.
import * as bridge from "./src/bridge.js";
import { formatPaise } from "./src/money.js";

// ── Real backend wiring (auth) ───────────────────────────────────────────────
// This prototype talks to the actual NestJS auth API under backend/. The base URL
// is resolved in priority order:
//   1. window.FAYR_API_BASE, if set — explicit override.
//   2. Page served on a STANDARD port (443/80/none) → it came through a tunnel or
//      reverse proxy that also routes the API, so the backend is SAME-ORIGIN.
//   3. Otherwise the page came straight from the static preview server (e.g.
//      :8000), so the backend is the same host on :3000 — covers localhost and a
//      LAN address (phone on the same hotspot) with zero config.
function resolveApiBase() {
  if (typeof window === "undefined" || !window.location) return "http://localhost:3000";
  if (window.FAYR_API_BASE) return window.FAYR_API_BASE;
  const { protocol, hostname, port, origin } = window.location;
  if (!port || port === "80" || port === "443") return origin; // tunnel / reverse proxy
  return `${protocol}//${hostname}:3000`; // direct static server (localhost / LAN)
}
const API_BASE = resolveApiBase();

async function apiPost(path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    const e = new Error(`Can't reach the Fayr server at ${API_BASE}. Is the backend running?`);
    e.kind = "network";
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* no / empty body */ }
  if (!res.ok) {
    const msg = data && (Array.isArray(data.message) ? data.message[0] : data.message);
    const e = new Error(msg || `Request failed (${res.status})`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

const toE164 = (p) => "+91" + String(p || "").replace(/\D/g, "").slice(-10);
const authApi = {
  requestOtp: (phone) => apiPost("/auth/otp/request", { mobile: toE164(phone) }),
  verifyOtp: (phone, code) => apiPost("/auth/otp/verify", { mobile: toE164(phone), code }),
  // Revoke the refresh token server-side (idempotent). Best-effort on logout —
  // the local session is cleared regardless of the network result.
  logout: (refreshToken) => apiPost("/auth/logout", { refreshToken }),
};

// Display only: integer paise -> "1,240.00". The wallet is stored in INTEGER
// PAISE (per CLAUDE.md: append-only ledger, never floats). Formatting happens
// HERE, at the edge, and never round-trips through a float — formatPaise is
// string-based and the thousands grouping is done on the integer part as a
// string. Round at the edges, never in the stored balance.
function rupees(paise) {
  const s = formatPaise(paise);
  if (s == null) return "0.00";
  const neg = s[0] === "-";
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const grouped = body.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + "." + body.slice(dot + 1);
}

// ── Authenticated backend calls ──────────────────────────────────────────────
// Login stores the access token here; every authed call attaches it as a Bearer.
// One module-level slot keeps the token out of every call site.
let AUTH_TOKEN = null;
const setAuthToken = (t) => { AUTH_TOKEN = t || null; };

async function apiAuth(method, path, body) {
  if (!AUTH_TOKEN) { const e = new Error("Not signed in"); e.status = 401; throw e; }
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + AUTH_TOKEN },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch {
    const e = new Error(`Can't reach the Fayr server at ${API_BASE}. Is the backend running?`);
    e.kind = "network"; throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = data && (Array.isArray(data.message) ? data.message[0] : data.message);
    const e = new Error(msg || `Request failed (${res.status})`);
    e.status = res.status; e.data = data; throw e;
  }
  return data;
}
const apiGet = (path) => apiAuth("GET", path);
const apiPostAuth = (path, body) => apiAuth("POST", path, body);

// Authed multipart upload — the JSON apiAuth can't carry a file. The browser sets
// the multipart boundary; we add only the Bearer token.
async function apiUpload(path, file, fields) {
  if (!AUTH_TOKEN) { const e = new Error("Not signed in"); e.status = 401; throw e; }
  const fd = new FormData();
  fd.append("file", file);
  if (fields) for (const k in fields) fd.append(k, fields[k]);
  let res;
  try {
    res = await fetch(API_BASE + path, { method: "POST", headers: { Authorization: "Bearer " + AUTH_TOKEN }, body: fd });
  } catch {
    const e = new Error(`Can't reach the Fayr server at ${API_BASE}. Is the backend running?`);
    e.kind = "network"; throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = data && (Array.isArray(data.message) ? data.message[0] : data.message);
    const e = new Error(msg || `Upload failed (${res.status})`);
    e.status = res.status; e.data = data; throw e;
  }
  return data;
}

// The real backend endpoints the campaign / task / wallet screens use.
const backendApi = {
  listCampaigns: () => apiGet("/campaigns"),
  claim: (campaignId) => apiPostAuth("/tasks", { campaignId }),
  listTasks: () => apiGet("/tasks"),
  getTask: (id) => apiGet("/tasks/" + id),
  wallet: () => apiGet("/me/wallet"),
  // Demo-only: walk a task to REFUNDED through the REAL endpoints, with synthetic
  // evidence and a back-dated delivery so the return window is already closed. On
  // device this same evidence is produced by the real scraper (ConnectScreen).
  submitEvidence: (id, ev) => apiPostAuth("/tasks/" + id + "/evidence", ev),
  // Tier-3 screenshot proof (the manual fallback to the scraper). Upload one, and
  // list the caller's own with status + the staff reason for rejected / needs_more.
  uploadScreenshot: (id, kind, file) => apiUpload("/tasks/" + id + "/screenshot", file, { kind }),
  listScreenshots: (id) => apiGet("/tasks/" + id + "/screenshots"),
  markReviewed: (id) => apiPostAuth("/tasks/" + id + "/reviewed"),
  startHold: (id) => apiPostAuth("/tasks/" + id + "/start-hold"),
  releaseRefund: (id) => apiPostAuth("/tasks/" + id + "/release-refund"),
  // Withdrawal / cash-out (Phase 3). Money crosses the wire as a paise STRING.
  listPayoutMethods: () => apiGet("/me/payout-methods"),
  addPayoutMethod: (body) => apiPostAuth("/me/payout-methods", body),
  requestWithdrawal: (amountPaise, payoutMethodId) =>
    apiPostAuth("/withdrawals", { amountPaise: String(amountPaise), payoutMethodId }),
  listWithdrawals: () => apiGet("/withdrawals"),
};

// ── Backend ⇄ prototype mapping ──────────────────────────────────────────────
// The prototype card is far richer than the backend campaign. The backend is the
// source of truth for id / product / price / percent / tickets; the visual-only
// fields (theme, heroBg, rail, ribbon) are derived or defaulted so the existing
// UI renders unchanged.
const PLATFORM_KEY = { AMAZON: "amazon", FLIPKART: "flipkart", MEESHO: "meesho", MYNTRA: "myntra", BLINKIT: "blinkit", ZEPTO: "zepto", INSTAMART: "instamart" };
const CATEGORY_THEME = { electronics: "toothpaste", apparel: "bodywash", home: "umbrella", grocery: "oil" };
const REAL_RAILS = ["featured", "trending", "new", "recommended", "popular"];
const HERO_BGS = ["#EFE4FA", "#FBF3D9", "#E3EEFB", "#FAE7EE", "#EAF3DC"];

function refundRupeesFromCampaign(cp) {
  const price = Number(cp.productPricePaise);
  const pct = Number(cp.payoutPercent);
  let paise = Math.floor((price * pct) / 100);
  if (cp.payoutCapPaise != null) paise = Math.min(paise, Number(cp.payoutCapPaise));
  return Math.floor(paise / 100); // whole rupees, for the maxBack display
}

function mapCampaign(cp, i) {
  return {
    id: cp.id, // backend UUID — the claim target
    product: cp.productName,
    short: cp.productName,
    marketplace: PLATFORM_KEY[cp.platform] || "amazon",
    theme: CATEGORY_THEME[cp.category] || "oil",
    pct: cp.payoutPercent,
    maxBack: refundRupeesFromCampaign(cp),
    examplePay: Math.round(Number(cp.productPricePaise) / 100),
    pricePaise: Number(cp.productPricePaise), // for simulate evidence
    tickets: cp.ticketCost,
    seats: cp.totalSlots || 200,
    filled: 0,
    joined: 0,
    slots: cp.totalSlots || 40,
    days: cp.returnWindowDays || 7,
    ribbon: i === 0 ? "RECOMMENDED" : "",
    heroBg: HERO_BGS[i % HERO_BGS.length],
    state: "open",
    variant: cp.category || "",
    rail: REAL_RAILS[i % REAL_RAILS.length],
    asin: cp.asin || null,
    category: cp.category || null,
    productName: cp.productName,
    // Operator-authored Terms & Conditions (one rule per line), or null → the
    // Detail screen falls back to the app's default T&C copy.
    terms: cp.terms || null,
  };
}

// A backend TaskResponse carries `.refund` and `.campaign`; a client bridge task
// does not — so the whole app can tell them apart and treat each correctly.
function isBackendTask(t) {
  return !!(t && typeof t === "object" && t.refund !== undefined && t.campaign !== undefined);
}

// Real backend task state -> the prototype's step integer (mirrors bridge.stateToStep).
function backendStateToStep(state, eligible) {
  switch (state) {
    case "CLAIMED": return 1;
    case "PURCHASED": return 3;
    case "DELIVERED": return 4;
    case "REVIEWED": return 5;
    case "HOLDING": return eligible ? 7 : 6;
    case "REFUNDED": return 9;
    default: return 1;
  }
}

// A backend TaskResponse -> the same shape bridge.view() returns, so TaskStatus
// renders REAL state with no other change.
function backendTaskView(t, c) {
  const eligible = !!(t.refund && t.refund.eligible);
  const paise = t.refund && t.refund.amountPaise != null ? Number(t.refund.amountPaise) : null;
  return {
    step: backendStateToStep(t.state, eligible),
    state: t.state,
    refundPaise: paise,
    refundRupees: paise != null ? Math.floor(paise / 100) : (c && c.maxBack != null ? c.maxBack : null),
    refundDisplay: paise != null ? rupees(paise) : (c && c.maxBack != null ? c.maxBack + ".00" : null),
    eligible,
    order: t.order || null,
  };
}

/* ============================================================================
   FAYR — v3 · built from "User Flows 1–20" + "Wireframes 1–7" PDFs
   ----------------------------------------------------------------------------
   Model: ticket economy (start 20; campaigns lock tickets, completion returns
   them) · campaigns = "Review {product} from {marketplace} — {pct}% back up to
   ₹{max}" · 6 card states (Open / In progress / Closing soon / Full·Waitlist /
   Completed / Missed) · 7-step journey (Buy → Order proof → Review → Review
   proof → Verification → Return window → Paid) · 4-tab nav.
   Wireframes are low-fi; structure/content/states follow them exactly while
   the visual language stays fayr's hi-fi system (cream/green/Alexandria).
   ========================================================================== */

/* ---------- design tokens ------------------------------------------------ */
const C = {
  cream: "#F9FAE9", creamDeep: "#F1F2D9", ink: "#191919", ink2: "#262626",
  sub: "#5C5C5C", blue: "#6CAAFC", blueBg: "#EAF2FF", green: "#68B642",
  greenDeep: "#30A90F", greenBg: "#F1F5DB", yellow: "#FFE000", yellowDeep: "#F5C400",
  purple: "#7926D9", purpleBg: "#EFE7FF", purpleBg2: "#FAF6FF", red: "#E5392B",
  redBg: "#FFDCDC", amber: "#F5A623", amberBg: "#FFF8E1", amberLine: "#FECA3A",
  white: "#FFFFFF", line: "#ECEDDC",
  headYellow: "#F6E14B", headYellow2: "#FBF3C0", refundBg: "#E4F5C0", refundInk: "#3E8E00",
  ribbon: "#E23B3B", pending: "#F5A623", pendingBg: "#FFF8E1",
};
const FONT_DISPLAY = "'Poppins', 'Inter', system-ui, sans-serif"; // screenshot headers
const FONT_LOGO = "'Alexandria', 'Poppins', sans-serif"; // fayr. wordmark
const FONT_BODY = "'Inter', system-ui, sans-serif";

function useGlobalStyle() {
  useEffect(() => {
    if (document.getElementById("fayr-style")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Alexandria:wght@700;800;900&family=Poppins:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
    const s = document.createElement("style");
    s.id = "fayr-style";
    s.textContent = `
      @keyframes fayr-rise { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      @keyframes fayr-screen{ from{opacity:0;transform:translateY(10px) scale(.992)} to{opacity:1;transform:none} }
      @keyframes fayr-pop  { 0%{opacity:0;transform:scale(.82)} 60%{transform:scale(1.04)} 100%{opacity:1;transform:scale(1)} }
      @keyframes fayr-float{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
      @keyframes fayr-spin { to{transform:rotate(360deg)} }
      @keyframes fayr-shimmer{ 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      @keyframes fayr-shake{ 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
      @keyframes fayr-slidein{ from{opacity:0;transform:translateX(18px)} to{opacity:1;transform:translateX(0)} }
      @keyframes fayr-ticker{ from{transform:translateX(0)} to{transform:translateX(-50%)} }
      @keyframes fayr-pulse{ 0%{transform:scale(1);opacity:.7} 70%{transform:scale(1.35);opacity:0} 100%{opacity:0} }
      @keyframes fayr-spin{ to{transform:rotate(360deg)} }
      @keyframes fayr-ring{ 0%{transform:scale(.4);opacity:0} 40%{opacity:.5} 100%{transform:scale(1.9);opacity:0} }
      @keyframes fayr-badge-in{ 0%{transform:scale(.3);opacity:0} 55%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
      @keyframes fayr-glow-breathe{ 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:.9;transform:scale(1.08)} }
      @keyframes fayr-check-draw{ from{stroke-dashoffset:40} to{stroke-dashoffset:0} }
      @keyframes fayr-confetti{ 0%{transform:translateY(0) rotate(0);opacity:0} 12%{opacity:1} 100%{transform:translateY(140px) rotate(var(--r));opacity:0} }
      @keyframes fayr-count-up{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      @keyframes fayr-amount-pop{ 0%{transform:scale(.9);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
      @keyframes deck-chev{ 0%{opacity:0;transform:translateY(10px)} 30%{opacity:.9} 60%{opacity:.9} 100%{opacity:0;transform:translateY(-12px)} }
      @media (prefers-reduced-motion: reduce){ *{animation-duration:.001ms!important;transition-duration:.001ms!important} }
      .fayr-scroll::-webkit-scrollbar{width:0;height:0} .fayr-scroll{scrollbar-width:none}
    `;
    document.head.appendChild(s);
  }, []);
}

/* ---------- brand atoms -------------------------------------------------- */
function GridFloor({ style }) {
  const stroke = "rgba(120,130,90,.20)";
  const lines = [];
  for (let i = -7; i <= 7; i++) lines.push(<line key={"v" + i} x1={180 + i * 4} y1="0" x2={180 + i * 26} y2="240" stroke={stroke} strokeWidth="1" />);
  for (let j = 1; j <= 9; j++) { const y = 240 - Math.pow(j / 9, 1.9) * 240; lines.push(<line key={"h" + j} x1="-40" y1={y} x2="400" y2={y} stroke={stroke} strokeWidth="1" />); }
  return <svg viewBox="0 0 360 240" preserveAspectRatio="none" style={style} aria-hidden>{lines}</svg>;
}
function LogoMark({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="fayr">
      <rect x="2" y="6" width="60" height="58" rx="18" fill={C.yellowDeep} />
      <rect x="2" y="2" width="60" height="58" rx="18" fill={C.yellow} />
      <path d="M38 20c-1.2-3-4-4.5-7.2-4.5-5 0-8.3 3.4-8.3 9.2V27h-3.2v6.3h3.2V49h6.6V33.3h5.1V27h-5.1v-2.2c0-2.1 1-3.1 2.8-3.1 1 0 1.8.3 2.4 1.1L38 20Z" fill={C.ink} />
      <circle cx="33.5" cy="46.5" r="3.4" fill={C.ink} />
      <path d="M46 16l1.4 3.6L51 21l-3.6 1.4L46 26l-1.4-3.6L41 21l3.6-1.4L46 16Z" fill={C.ink} />
    </svg>
  );
}
const Wordmark = ({ size = 44, color = C.ink, dot = C.yellowDeep }) => (
  <span style={{ fontFamily: FONT_LOGO, fontWeight: 800, fontSize: size, letterSpacing: "-0.04em", color, lineHeight: 1 }}>fayr<span style={{ color: dot }}>.</span></span>
);

/* Real product photos: paste data-URIs or hosted URLs here (per campaign
   theme) and every surface — cards, hero, detail, confirm — uses them.
   Falls back to illustrated art until provided. */
const CAMPAIGN_IMAGES = { oil: null, earbuds: null, facewash: null, toothpaste: null, bodywash: null, snacks: null, umbrella: null };
const CATEGORY_IMAGES = {}; // label -> data-URI/URL of the real category renders
const CAMPAIGN_IMG_BY_ID = {
  c1: "data:image/jpeg;base64,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",
  c2: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAFIASwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6ZoooryjpCiiigAooooAKKKKACiiigAooooAKKKKACvB/2nZt8nhyAdVnya95HUfWvnD9o3Uon8V6ZB5gYW7bmwelbYdfvETPY8E+J751VB6DFcSpwV/3hXZfEE/b9RM8IzH61x3lOMfKRg5r0GYH6IfCe9a/8AaXK5BKwqn6V11eY/s6axFq/wAMrUrKhkjbYUB+YYxXp1eXNWkzoi9AoooqRhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFADZW2QzN/djYivib4g38+peIr+aeUyHeygn0r7VvWCWN0x7Qt/KvhnxHIZNTvPeZ+fxrrwi1bM6hzF25LrETkdayb7iVgFHFaU433gGegrOvh+9JrrbMj239kTXLiDxte6bJO32VoMrETxur67HAr4b/AGbrz7H8S4+ceYAtfcr8OR7CuDEL3jansJRRRWBYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQBmeJblbTQL2Z2CqImGT9K+JbtftVzduPm/esQfxr6c/aM8QHRPhxdRRvtuJ3AXB5xXzFZym30QnqzruJPriu7Cx0bMaj1OauikN6S7KBj1rJvZ4ix2tzVbUnaS6diT19aouTnrXQyDvvg1fiz+I2ksGx5k6r+tfoJJ/rD9BX5neG9SOka9p9+Dj7POsmfoa/Rvwvqo1zw3pupg5+0xK2fwrjxK1TNabNSiiiuU0CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKANxxn6n0rM1zxLpXhuETapdCBW+7714946+P4e2msNDg++Cv2nuKuFOUtkJySOI/ac8Ut4h12HS7CUNFZfLKoPBNeUi8u7mzFtHCQwGOlad1cNc3UlzcEyzyElnP8AFTk1KK3jLBQreuK9OnFRjYwbucBqWl3drKTOhUnms54WrsNbFxqT5L7uM/hXPtZybd+OKbQjOWBjxkZNfbP7MvjmHxH4LXSJJl+06cBGsZPzMPUV8dQXFrb/ACzwBj611Hgvx+PBmrR6npjNDInVQeGFZVafPGxUXZn6A+3eivEvBn7UnhfWQkGtuNPlOBu/vGvZdP1G01W0jvLGYTW8gyrg9RXnyg47mydyxRRRUjCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAClHUUlKOo+tAHhf7QEjte2aEnaOg7GvELoBt2ABj0r2n4/SltTtV7LXi0xG9hXp0PgRhLczphyv0qpKNyvnoKtzn5+lVCDtk961JKjsVlxnqmBWa4Ih2dxWjLzMGHRU5rOY7gT2PSi4GPej5qqqB6VbvPvGqq96kBWA29ADkc190fs3XElx8NozI7OVIALHpXwwwyv4ivtv9l2Uy/DVs/wy4rnxPwlx3PX6KKK4TYKKKKACiiigAooooAKKKKACiiigAooooAKKKKA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",
  c3: "data:image/jpeg;base64,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",
  c4: "data:image/jpeg;base64,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",
  c5: "data:image/jpeg;base64,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",
};

const PROD_THEMES = {
  oil: { bg: ["#E7F6E0", "#CBEBC0"], glyph: "🌿" }, earbuds: { bg: ["#E4EFFF", "#C9DEFF"], glyph: "🎧" },
  facewash: { bg: ["#FFE6EF", "#FFD0E0"], glyph: "🧴" }, toothpaste: { bg: ["#EDE3FF", "#D9C7FF"], glyph: "🪥" },
  bodywash: { bg: ["#FFF1DC", "#FFE0B8"], glyph: "🧼" }, snacks: { bg: ["#FFEFD6", "#FFE0AE"], glyph: "🍫" }, umbrella: { bg: ["#E3EEFB", "#C9DEF6"], glyph: "☂️" },
};
function ProductArt({ theme = "oil", cid, img: imgProp, radius = 16, style }) {
  const t = PROD_THEMES[theme] || PROD_THEMES.oil;
  const img = imgProp || (cid && CAMPAIGN_IMG_BY_ID[cid]) || CAMPAIGN_IMAGES[theme];
  if (img) {
    return (
      <div style={{ position: "relative", borderRadius: radius, overflow: "hidden", background: "#fff", ...style }}>
        <img src={img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", borderRadius: radius, background: `linear-gradient(150deg, ${t.bg[0]}, ${t.bg[1]})`, overflow: "hidden", ...style }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 70% 25%, rgba(255,255,255,.6), transparent 45%)" }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "clamp(28px, 42%, 60px)", filter: "drop-shadow(0 6px 10px rgba(0,0,0,.12))" }}>{t.glyph}</div>
    </div>
  );
}

/* ---------- UI atoms ------------------------------------------------------ */
const Pill = ({ children, onClick, color = C.ink, text = "#fff", style, disabled }) => (
  <button onClick={onClick} disabled={disabled}
    style={{ width: "100%", border: "none", borderRadius: 26, padding: "15px 24px", background: disabled ? "#cfcfcf" : color, color: text, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, letterSpacing: ".02em", cursor: disabled ? "default" : "pointer", boxShadow: disabled ? "none" : "0 10px 22px rgba(20,20,20,.18)", transition: "transform .12s ease", ...style }}
    onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>{children}</button>
);
const Ghost = ({ children, onClick, style }) => (
  <button onClick={onClick} style={{ width: "100%", background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 26, padding: "14px 24px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.ink2, cursor: "pointer", ...style }}>{children}</button>
);
const TextBtn = ({ children, onClick, style }) => (
  <button onClick={onClick} style={{ width: "100%", background: "none", border: "none", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.sub, cursor: "pointer", padding: "10px 0", ...style }}>{children}</button>
);

const STATUS_H = 56;
function DeviceStatusBar({ tone = "dark" }) {
  const col = tone === "light" ? "#fff" : C.ink;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: STATUS_H, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", pointerEvents: "none" }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: col }}>9:41</span>
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", width: 124, height: 34, background: "#000", borderRadius: 20 }} />
      <span style={{ display: "flex", gap: 6, alignItems: "center", color: col }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" /><rect x="4.5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" /><rect x="9" y="3" width="3" height="9" rx="1" fill="currentColor" /><rect x="13.5" y="0" width="3" height="12" rx="1" fill="currentColor" opacity=".35" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M8 2.4c2.6 0 5 1 6.8 2.7l-1.3 1.4A7.7 7.7 0 0 0 8 4.3 7.7 7.7 0 0 0 2.5 6.5L1.2 5.1A9.7 9.7 0 0 1 8 2.4Z" fill="currentColor" /><path d="M8 6c1.4 0 2.7.5 3.7 1.4l-1.4 1.4A3.3 3.3 0 0 0 8 7.9c-.9 0-1.7.3-2.3.9L4.3 7.4A5.3 5.3 0 0 1 8 6Z" fill="currentColor" /><circle cx="8" cy="10.4" r="1.4" fill="currentColor" /></svg>
        <svg width="26" height="13" viewBox="0 0 26 13" fill="none"><rect x="0.5" y="0.5" width="22" height="12" rx="3.2" stroke="currentColor" opacity=".5" /><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor" /><rect x="24" y="4" width="1.6" height="5" rx="0.8" fill="currentColor" opacity=".5" /></svg>
      </span>
    </div>
  );
}
const StatusSpacer = () => <div style={{ height: STATUS_H, flex: "0 0 auto" }} aria-hidden />;
function Screen({ children, bg = C.cream, noPad }) {
  return <div style={{ position: "absolute", inset: 0, background: bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>{!noPad && <StatusSpacer />}{children}</div>;
}
function TopBar({ title, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 18px 8px", flex: "0 0 auto" }}>
      {onBack && <button onClick={onBack} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "#fff", fontSize: 17, cursor: "pointer", boxShadow: "0 4px 10px rgba(0,0,0,.08)", display: "grid", placeItems: "center" }}>←</button>}
      {title && <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: C.ink2 }}>{title}</span>}
    </div>
  );
}
const ProgressDots = ({ n, i }) => (
  <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
    {Array.from({ length: n }).map((_, k) => (
      <span key={k} style={{ width: k === i ? 22 : 7, height: 7, borderRadius: 6, background: k === i ? C.ink : "rgba(25,25,25,.22)", transition: "all .3s" }} />
    ))}
  </div>
);
const hTitle = { fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 27, color: C.ink2, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.12 };
const hSub = { fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, color: C.sub, marginTop: 8, lineHeight: 1.5 };
const CardBox = ({ children, style }) => <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 4px 12px rgba(20,20,20,.05)", ...style }}>{children}</div>;

/* ---------- marketplaces (direct links, no affiliate/UTM) ----------------- */
const MARKETPLACES = {
  amazon: { id: "amazon", name: "Amazon", emoji: "📦", color: "#FF9900", inkOn: C.ink, home: "https://www.amazon.in" },
  flipkart: { id: "flipkart", name: "Flipkart", emoji: "🛒", color: "#2874F0", inkOn: "#fff", home: "https://www.flipkart.com" },
  meesho: { id: "meesho", name: "Meesho", emoji: "🏷️", color: "#570D48", inkOn: "#fff", home: "https://www.meesho.com" },
  blinkit: { id: "blinkit", name: "Blinkit", emoji: "⚡", color: "#F8CB46", inkOn: C.ink, home: "https://blinkit.com" },
  zepto: { id: "zepto", name: "Zepto", emoji: "🛵", color: "#7C3AED", inkOn: "#fff", home: "https://www.zeptonow.com" },
  instamart: { id: "instamart", name: "Instamart", emoji: "🧺", color: "#FC8019", inkOn: "#fff", home: "https://www.swiggy.com/instamart" },
  myntra: { id: "myntra", name: "Myntra", emoji: "👗", color: "#FF3F6C", inkOn: "#fff", home: "https://www.myntra.com" },
};
const marketplaceHome = (mid) => (MARKETPLACES[mid] || MARKETPLACES.amazon).home; // homepage only — no search/UTM/deep link

/* Official marketplace logos (user-supplied brand assets). */
const MP_LOGO = {
  amazon: "assets/mp/amazon.png",
  flipkart: "assets/mp/flipkart.png",
  meesho: "assets/mp/meesho.png",
  blinkit: "assets/mp/blinkit.png",
  zepto: "assets/mp/zepto.png",
  instamart: "assets/mp/instamart.png",
  myntra: "assets/mp/myntra.png",
};
/* Official marketplace logo in a clean white tile — object-fit:contain keeps
   each wordmark intact and on-brand at any size. */
function BrandLogo({ mid, size = 44 }) {
  const src = MP_LOGO[mid];
  return (
    <div style={{ width: size, height: size, flex: "0 0 auto", borderRadius: size * 0.24, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,.10)", display: "grid", placeItems: "center", overflow: "hidden" }}>
      {src ? <img src={src} alt="" style={{ width: "84%", height: "84%", objectFit: "contain" }} /> : null}
    </div>
  );
}
/* Marketplace logo integrated into the product image: a white panel flush to the
   image's bottom-left corner (sharing its corner radius so it reads as part of
   the tile, not a floating pill). Logo image keeps its aspect ratio. */
/* Marketplace logo integrated into the product image: a white rounded panel
   HORIZONTALLY CENTERED at the bottom of the tile (bottom flush), ~78% wide,
   ~20% tall, uniform corner radius. Logo image is large & centered. */
function BrandTab({ mid, h = 20, w = "78%" }) {
  const src = MP_LOGO[mid];
  return (
    <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: w, height: h, background: "#fff", borderRadius: Math.round(h * 0.28), boxShadow: "0 2px 6px rgba(0,0,0,.08)", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px", boxSizing: "border-box" }}>
      {src ? <img src={src} alt="" style={{ maxWidth: "82%", maxHeight: "50%", objectFit: "contain", display: "block" }} /> : null}
    </div>
  );
}

/* ---------- campaign data (wireframe 5/6 content) -------------------------- */
const CAMPAIGNS = [
  { id: "c1", product: "Perfora Magic Whitening Toothpaste", short: "Perfora Purple Whitening Toothpaste", marketplace: "flipkart", theme: "toothpaste", pct: 100, maxBack: 299, examplePay: 299, tickets: 4, seats: 200, filled: 180, joined: 940, slots: 20, days: 6, ribbon: "RECOMMENDED", heroBg: "#EFE4FA", state: "open", variant: "Purple 100g", rail: "featured" },
  { id: "c2", product: "Brillare 100% Natural Rosemary Oil", short: "Brillare Natural Rosemary Oil", marketplace: "amazon", theme: "oil", pct: 90, maxBack: 404, examplePay: 449, tickets: 5, seats: 300, filled: 268, joined: 1248, slots: 32, days: 4, ribbon: "", heroBg: "#FBF3D9", state: "open", variant: "50ml", rail: "featured" },
  { id: "c3", product: "Brillare Pure Rosemary Essential Oil", short: "Brillare Pure Essential Oil", marketplace: "flipkart", theme: "oil", pct: 90, maxBack: 404, examplePay: 449, tickets: 5, seats: 300, filled: 268, joined: 1180, slots: 32, days: 4, ribbon: "TRENDING", heroBg: "#EAF3DC", state: "open", variant: "30ml", rail: "trending" },
  { id: "c4", product: "Robust Ring Buckle Umbrella", short: "Robust Ring Buckle Umbrella", marketplace: "flipkart", theme: "umbrella", pct: 100, maxBack: 599, examplePay: 599, tickets: 4, seats: 200, filled: 180, joined: 620, slots: 20, days: 6, ribbon: "NEW", heroBg: "#E3EEFB", state: "open", variant: "Blue", rail: "new" },
  { id: "c5", product: "Dove Refreshing Sakura Body Wash", short: "Dove Sakura Body Wash", marketplace: "amazon", theme: "bodywash", pct: 90, maxBack: 314, examplePay: 349, tickets: 4, seats: 200, filled: 168, joined: 2100, slots: 32, days: 4, ribbon: "RECOMMENDED", heroBg: "#FAE7EE", state: "open", variant: "250ml", rail: "recommended" },
  { id: "c6", product: "Perfora Electric Toothbrush", short: "Perfora Electric Toothbrush", marketplace: "meesho", theme: "toothpaste", pct: 80, maxBack: 640, examplePay: 799, tickets: 5, seats: 150, filled: 141, joined: 780, slots: 9, days: 2, ribbon: "TRENDING", heroBg: "#EFE4FA", state: "closing", variant: "Black", rail: "trending" },
  { id: "c7", product: "Brillare Rosemary Hair Serum", short: "Brillare Rosemary Serum", marketplace: "zepto", theme: "oil", pct: 100, maxBack: 499, examplePay: 499, tickets: 4, seats: 250, filled: 92, joined: 340, slots: 40, days: 8, ribbon: "NEW", heroBg: "#EAF3DC", state: "open", variant: "60ml", rail: "new" },
  { id: "c8", product: "Dove Deep Moisture Body Wash", short: "Dove Deep Moisture Wash", marketplace: "blinkit", theme: "bodywash", pct: 85, maxBack: 297, examplePay: 349, tickets: 3, seats: 400, filled: 356, joined: 3100, slots: 22, days: 3, ribbon: "", heroBg: "#FAE7EE", state: "open", variant: "500ml", rail: "popular" },
  { id: "c9", product: "Compact Travel Umbrella", short: "Compact Travel Umbrella", marketplace: "instamart", theme: "umbrella", pct: 90, maxBack: 359, examplePay: 399, tickets: 3, seats: 300, filled: 210, joined: 1450, slots: 30, days: 5, ribbon: "POPULAR", heroBg: "#E3EEFB", state: "open", variant: "Grey", rail: "popular" },
  { id: "c10", product: "Perfora Whitening Kit", short: "Perfora Whitening Kit", marketplace: "amazon", theme: "toothpaste", pct: 100, maxBack: 899, examplePay: 899, tickets: 6, seats: 120, filled: 44, joined: 260, slots: 76, days: 9, ribbon: "NEW", heroBg: "#EFE4FA", state: "open", variant: "Combo", rail: "new" },
  { id: "c11", product: "Brillare Argan Hair Oil", short: "Brillare Argan Oil", marketplace: "flipkart", theme: "oil", pct: 95, maxBack: 475, examplePay: 499, tickets: 4, seats: 200, filled: 188, joined: 1620, slots: 12, days: 2, ribbon: "TRENDING", heroBg: "#FBF3D9", state: "closing", variant: "100ml", rail: "trending" },
  { id: "c12", product: "Dove Sakura Shampoo", short: "Dove Sakura Shampoo", marketplace: "meesho", theme: "bodywash", pct: 90, maxBack: 324, examplePay: 360, tickets: 4, seats: 350, filled: 300, joined: 2680, slots: 50, days: 6, ribbon: "RECOMMENDED", heroBg: "#FAE7EE", state: "open", variant: "340ml", rail: "recommended" },
];
const RAILS = [
  { key: "recommended", title: "Recommended for you" },
  { key: "trending", title: "Trending campaigns 🔥" },
  { key: "new", title: "New arrivals ✨" },
  { key: "popular", title: "Popular this week" },
];
const STEPS7 = ["Buy the exact product", "Upload order proof", "Use it & review honestly", "Submit review proof", "Verification (~2 days)", "Return window closes (7 days)", "Get paid"];

const STATE_BADGE = {
  open: { label: "Open", bg: C.greenBg, fg: C.greenDeep, line: "#1FD75D" },
  closing: { label: "Closing soon", bg: C.redBg, fg: C.red, line: "#F19A9A" },
  full: { label: "Full · Waitlist", bg: C.creamDeep, fg: C.sub, line: "#D8D9C8" },
  progress: { label: "In progress", bg: C.blueBg, fg: "#2F6FD0", line: "#9CC3FF" },
  completed: { label: "Completed", bg: C.greenBg, fg: C.greenDeep, line: "#1FD75D" },
  missed: { label: "Missed", bg: "#F0F0EA", fg: "#8B8C7F", line: "#D8D9C8" },
};
const Badge = ({ k }) => {
  const b = STATE_BADGE[k] || STATE_BADGE.open;
  return <span style={{ display: "inline-block", background: b.bg, color: b.fg, border: `1px solid ${b.line}`, borderRadius: 6, padding: "3px 8px", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 10.5 }}>{b.label}</span>;
};
const MktTag = ({ mid }) => {
  const m = MARKETPLACES[mid] || MARKETPLACES.amazon;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY, fontWeight: 800, fontSize: 10, letterSpacing: ".08em", color: C.sub }}><BrandLogo mid={mid} size={16} /> {m.name.toUpperCase()}</span>;
};

/* ============================================================================
   1 · APP LAUNCH
   ========================================================================== */
function Splash({ go }) {
  useEffect(() => { const t = setTimeout(() => go("onboard"), 1800); return () => clearTimeout(t); }, [go]);
  return (
    <Screen>
      <div style={{ flex: 1, display: "grid", placeItems: "center", position: "relative" }}>
        <div style={{ textAlign: "center", animation: "fayr-pop .7s ease both" }}>
          <div style={{ animation: "fayr-float 3s ease-in-out infinite" }}><LogoMark size={76} /></div>
          <div style={{ marginTop: 20 }}><Wordmark size={44} /></div>
        </div>
        <GridFloor style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 220 }} />
      </div>
    </Screen>
  );
}
function ForceUpdate() {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 60 }}>🔄</div>
        <h1 style={{ ...hTitle, marginTop: 18 }}>A new version is required</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>This version of fayr is no longer supported. Update to keep earning securely.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Pill>UPDATE NOW</Pill></div>
    </Screen>
  );
}
function Maintenance() {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 60 }}>🛠️</div>
        <h1 style={{ ...hTitle, marginTop: 18 }}>We'll be right back</h1>
        <p style={{ ...hSub, maxWidth: 280 }}>fayr is under scheduled maintenance. Your campaigns and earnings are safe.</p>
        <div style={{ marginTop: 14, background: "#fff", borderRadius: 12, padding: "9px 16px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink2 }}>Expected back by 6:00 PM</div>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Ghost>Check status page</Ghost></div>
    </Screen>
  );
}

/* ============================================================================
   2 · ONBOARDING — 3 slides (wireframe copy)
   ========================================================================== */
const ONBOARD_ART = {
  earn: "data:image/jpeg;base64,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",
  clock: "data:image/jpeg;base64,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",
  wallet: "data:image/jpeg;base64,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",
};
const ONBOARD = [
  { bg: "#8BB4F2", art: "earn", title: "Shop the brands you love", sub: "Buy products you already want, from Amazon, Flipkart, Meesho, Blinkit, Zepto & Instamart." },
  { bg: "#B776A1", art: "clock", title: "Review what you buy — honestly", sub: "Share what you really think. Good or bad, your honest opinion is what counts." },
  { bg: "#D0E995", art: "wallet", title: "Get your refund in your wallet", sub: "Complete a campaign and get up to 100% of your money back." },
];
function Onboarding({ go }) {
  const [i, setI] = useState(0);
  const swipeX = useRef(0);
  const o = ONBOARD[i];
  return (
    <Screen bg={o.bg} noPad>
      <div onClick={() => (i < 2 ? setI(i + 1) : go("authlanding"))}
        onTouchStart={(e) => { swipeX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - swipeX.current; if (dx < -42 && i < 2) setI(i + 1); else if (dx > 42 && i > 0) setI(i - 1); }}
        style={{ position: "relative", flex: "1 1 auto", overflow: "hidden", background: o.bg, transition: "background 1.1s cubic-bezier(.4,0,.2,1)", cursor: "pointer" }}>
        <button onClick={(e) => { e.stopPropagation(); go("authlanding"); }} style={{ position: "absolute", top: 64, right: 18, zIndex: 40, background: "rgba(255,255,255,.85)", border: "none", borderRadius: 20, padding: "7px 14px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.ink2, cursor: "pointer" }}>Skip</button>
        {/* one continuous scene, not pages: full-bleed artwork; the outgoing
            shot drifts past the camera (scale-up + slide + fade) while the
            next settles in from the opposite depth. The white dome baked into
            every artwork never moves — it anchors the whole journey — and the
            backdrop colour morphs instead of switching. Tap or swipe to move;
            swipe back to revisit. */}
        {ONBOARD.map((sl, j) => {
          const active = j === i;
          const past = j < i;
          return (
            <div key={j} style={{
              position: "absolute", inset: 0,
              opacity: active ? 1 : 0,
              transform: active ? "none" : past ? "translateX(-30px) scale(1.09)" : "translateX(30px) scale(1.06)",
              transition: "opacity .65s cubic-bezier(.4,0,.2,1), transform .95s cubic-bezier(.22,.61,.36,1)",
              pointerEvents: "none", willChange: "transform, opacity",
            }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: -12, bottom: -12, animation: "fayr-float " + (7 + j * 1.5) + "s ease-in-out infinite" }}>
                {ONBOARD_ART[sl.art]
                  ? <img src={ONBOARD_ART[sl.art]} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center bottom" }} />
                  : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 90 }}>{["🛍️", "⭐", "💸"][j]}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: "0 0 auto", background: C.cream, borderTopLeftRadius: "50% 30px", borderTopRightRadius: "50% 30px", marginTop: -22, padding: "32px 30px 24px", position: "relative", zIndex: 45, minHeight: 265, display: "flex", flexDirection: "column" }}>
        <div key={i} style={{ animation: "fayr-rise .55s cubic-bezier(.22,.61,.36,1) both", animationDelay: ".16s" }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 32, lineHeight: 1.06, letterSpacing: "-0.03em", margin: 0, color: C.ink2 }}>{o.title}</h1>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14.5, lineHeight: 1.45, color: C.ink2, marginTop: 14, maxWidth: 300 }}>{o.sub}</p>
        </div>
        <div style={{ flex: 1, minHeight: 16 }} />
        <div style={{ marginBottom: 16 }}><ProgressDots n={3} i={i} /></div>
        <Pill onClick={() => (i < 2 ? setI(i + 1) : go("authlanding"))}>{i < 2 ? "NEXT" : "GET STARTED"}</Pill>
      </div>
    </Screen>
  );
}

/* ============================================================================
   3 · AUTH — landing, Truecaller, phone, OTP (+ fail ladder), locked, blocked,
       new-device. Flow 2: no path dead-ends.
   ========================================================================== */
function AuthLanding({ go, setAuthVia }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, position: "relative" }}>
        <GridFloor style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 170 }} />
        <LogoMark size={64} />
        <h1 style={{ ...hTitle, fontSize: 30, marginTop: 20 }}>Shop. Review. Earn.</h1>
        <p style={{ ...hSub, textAlign: "center" }}>We only use your number to verify you.</p>
      </div>
      <div style={{ padding: "0 26px 26px", position: "relative", zIndex: 2 }}>
        <Pill onClick={() => { setAuthVia("truecaller"); go("truecaller"); }} color="#0087FF">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>📱 Continue with Truecaller</span>
        </Pill>
        <div style={{ height: 10 }} />
        <Ghost onClick={() => { setAuthVia("phone"); go("phone"); }}>Continue with phone number</Ghost>
        <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.sub, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>By continuing you agree to our <u>Terms</u> & <u>Privacy Policy</u>.</p>
      </div>
    </Screen>
  );
}
function TruecallerSheet({ go, setName, setPhone, setTcName }) {
  return (
    <Screen>
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,20,20,.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ flex: 1 }} onClick={() => go("authlanding")} />
      <div style={{ position: "relative", background: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: "24px 24px 26px", animation: "fayr-rise .35s cubic-bezier(.22,.61,.36,1) both", textAlign: "center" }}>
        <div style={{ width: 44, height: 4, background: "#e2e2d6", borderRadius: 4, margin: "0 auto 18px" }} />
        <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15, color: "#0087FF" }}>Verify with Truecaller</div>
        <div style={{ width: 70, height: 70, borderRadius: "50%", background: C.blueBg, display: "grid", placeItems: "center", fontSize: 32, margin: "16px auto 10px" }}>👤</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, color: C.ink2 }}>Prakash Tamang</div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: C.sub, marginTop: 2 }}>+91 79••• ••792</div>
        <div style={{ marginTop: 18 }}>
          <Pill color="#0087FF" onClick={() => { setName("Prakash"); setTcName && setTcName("Prakash Tamang"); setPhone("7980952792"); go("setupintro"); }}>Continue</Pill>{/* first name for greetings; full name pre-fills onboarding */}
        </div>
        <TextBtn onClick={() => go("phone")}>Use another method</TextBtn>
        <p style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#a3a49a", marginTop: 4 }}>Truecaller shares your verified name & number with fayr.</p>
      </div>
    </Screen>
  );
}
function PhoneEntry({ go, phone, setPhone }) {
  const [num, setNum] = useState(phone || "");
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const valid = num.length === 10 && /^[6-9]/.test(num);
  const send = async () => {
    if (!valid) { setTouchedInvalid(true); return; }
    setErr(""); setSending(true);
    try {
      await authApi.requestOtp(num); // real POST /auth/otp/request
      setPhone(num);
      go("otp");
    } catch (e) {
      setErr(e.message || "Couldn't send the code. Please try again.");
    } finally {
      setSending(false);
    }
  };
  return (
    <Screen>
      <TopBar title="Enter your number" onBack={() => go("authlanding")} />
      <div style={{ padding: "6px 26px 26px", flex: 1, display: "flex", flexDirection: "column" }}>
        <h1 style={hTitle}>What's your mobile number?</h1>
        <p style={hSub}>We'll send a one-time code to verify.</p>
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 6 }}>Mobile number</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1.5px solid ${touchedInvalid && !valid ? C.red : valid ? C.green : C.line}`, borderRadius: 16, padding: "14px 16px", transition: "border-color .2s" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontFamily: FONT_BODY, fontWeight: 700, color: C.ink2, fontSize: 16, flex: "0 0 auto" }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🇮🇳</span><span>+91</span>
            </span>
            <span style={{ width: 1, height: 22, background: C.line }} />
            <input autoFocus inputMode="numeric" placeholder="10-digit number"
              value={num.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? a + " " + b : a))}
              onChange={(e) => { setNum(e.target.value.replace(/\D/g, "").slice(0, 10)); setTouchedInvalid(false); }}
              onKeyDown={(e) => e.key === "Enter" && send()}
              style={{ border: "none", outline: "none", flex: 1, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 17, color: C.ink2, background: "transparent", letterSpacing: ".04em" }} />
            {valid && <span style={{ color: C.green, fontWeight: 800 }}>✓</span>}
          </div>
          {touchedInvalid && !valid && <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.red, marginTop: 8 }}>Please enter a valid 10-digit mobile number.</p>}
        </div>
        {err && <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.red, marginTop: 12 }}>{err}</p>}
        <div style={{ flex: 1 }} />
        <Pill onClick={send} disabled={!valid || sending} color={valid && !sending ? C.ink : "#cfcfcf"}>{sending ? "SENDING…" : "SEND OTP"}</Pill>
        <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: "#a9aa9c", textAlign: "center", marginTop: 10 }}>We'll text a 6-digit code to this number.</p>
      </div>
    </Screen>
  );
}
function Otp({ go, phone, onVerified }) {
  const N = 6;
  const [code, setCode] = useState(Array(N).fill(""));
  const refs = useRef(Array.from({ length: N }, () => React.createRef()));
  const [secs, setSecs] = useState(30); // matches backend OTP_RESEND_COOLDOWN_SECONDS
  const [fails, setFails] = useState(0);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shown = "+91 " + (phone || "7980952792").replace(/(\d{5})(\d{5})/, "$1 $2");
  useEffect(() => {
    refs.current[0].current && refs.current[0].current.focus();
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const submit = async (full) => {
    if (busy || full.length !== N) return;
    setBusy(true); setErr("");
    try {
      const res = await authApi.verifyOtp(phone, full); // real POST /auth/otp/verify
      onVerified && onVerified(res);                     // stash the real session
      go("setupintro");
    } catch (e) {
      setBusy(false);
      if (e.status === 403) { go("blocked"); return; }   // backend: account blocked
      const f = fails + 1; setFails(f);
      setShake(true); setTimeout(() => setShake(false), 300);
      setCode(Array(N).fill("")); refs.current[0].current && refs.current[0].current.focus();
      // the backend locks the challenge after 5 wrong tries
      if (/too many/i.test(e.message || "") || f >= 5) { go("otplocked"); return; }
      setErr(e.message || "That code didn't match.");
    }
  };
  const set = (i, v) => {
    v = v.replace(/\D/g, "").slice(-1);
    const c = [...code]; c[i] = v; setCode(c);
    if (v && i < N - 1) refs.current[i + 1].current.focus();
    if (c.every((x) => x)) setTimeout(() => submit(c.join("")), 250);
  };
  return (
    <Screen>
      <TopBar title="Verify OTP" onBack={() => go("phone")} />
      <div style={{ padding: "6px 26px 26px", flex: 1, display: "flex", flexDirection: "column" }}>
        <h1 style={hTitle}>Enter the 6-digit code</h1>
        <p style={hSub}>Sent to <b style={{ color: C.ink2 }}>{shown}</b> · <span onClick={() => go("phone")} style={{ color: C.green, fontWeight: 700, cursor: "pointer" }}>Wrong number? Edit</span></p>
        <div style={{ display: "flex", gap: 8, marginTop: 26, animation: shake ? "fayr-shake .3s ease" : "none" }}>
          {code.map((v, i) => (
            <input key={i} ref={refs.current[i]} value={v} inputMode="numeric"
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => e.key === "Backspace" && !v && i > 0 && refs.current[i - 1].current.focus()}
              style={{ flex: 1, minWidth: 0, height: 58, padding: 0, textAlign: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink2, borderRadius: 13, border: `1.5px solid ${fails > 0 && !v ? C.red : v ? C.green : C.line}`, background: "#fff", outline: "none", transition: "border-color .2s" }} />
          ))}
        </div>
        {err
          ? <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.red, marginTop: 14 }}>{err}{fails > 0 ? ` · ${Math.max(0, 5 - fails)} attempts left` : ""}</p>
          : <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "#a9aa9c", marginTop: 14 }}>Enter the 6-digit code sent to your number.</p>}
        <p style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.sub, marginTop: 10 }}>
          {secs > 0 ? <>Resend code in <b style={{ color: C.ink2 }}>00:{String(secs).padStart(2, "0")}</b></> : <span onClick={async () => { try { const r = await authApi.requestOtp(phone); setErr(""); setSecs((r && r.resendInSeconds) || 30); } catch (e) { setErr(e.message || "Couldn't resend the code."); } }} style={{ color: C.green, fontWeight: 700, cursor: "pointer" }}>Resend code</span>}
        </p>
        <p style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#b9baa9", marginTop: 8 }}>Dev build: your 6-digit code is printed in the backend server console.</p>
        <div style={{ flex: 1 }} />
        <Pill onClick={() => submit(code.join(""))} disabled={!code.every((x) => x) || busy} color={code.every((x) => x) && !busy ? C.ink : "#cfcfcf"}>{busy ? "VERIFYING…" : "VERIFY"}</Pill>
      </div>
    </Screen>
  );
}
function OtpLocked({ go }) {
  const [t, setT] = useState(14 * 60 + 32);
  useEffect(() => { const i = setInterval(() => setT((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(i); }, []);
  return (
    <Screen>
      <TopBar title="Verify OTP" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>🔒</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>Too many attempts</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>For your security, OTP entry is paused. Try again in <b style={{ color: C.ink2 }}>{Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}</b>.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Ghost onClick={() => go("phone")}>Contact support</Ghost></div>
    </Screen>
  );
}
function Blocked({ go }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>🚫</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>Your account is restricted</h1>
        <p style={{ ...hSub, maxWidth: 280 }}>Some activity on this account needs a closer look. You can submit an appeal and our team will review it.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => go("authlanding")}>SUBMIT AN APPEAL</Pill>
        <TextBtn onClick={() => go("authlanding")}>Contact support</TextBtn>
      </div>
    </Screen>
  );
}
function NewDevice({ go }) {
  return (
    <Screen>
      <TopBar title="Security check" onBack={() => go("authlanding")} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>🛡️</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>Let's make sure it's you</h1>
        <p style={{ ...hSub, maxWidth: 285 }}>You're signing in on a new device and your wallet has a balance. We'll re-verify with an OTP to keep your earnings safe.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Pill onClick={() => go("otp")}>SEND OTP</Pill></div>
    </Screen>
  );
}

/* ============================================================================
   4 · PERSONALISATION — intro(+resume), Q1–Q4, building feed, How Fayr works
   ========================================================================== */
function SetupIntro({ go, resume }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center", position: "relative" }}>
        <GridFloor style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 160 }} />
        <div style={{ fontSize: 58, animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>👋</div>
        <h1 style={{ ...hTitle, marginTop: 18 }}>{resume ? "Pick up where you left off" : "Let's set up your profile"}</h1>
        <p style={{ ...hSub, maxWidth: 280 }}>{resume ? "You're halfway there. Your earlier answers are saved." : "Takes about 30 seconds — so we can show you campaigns worth your time."}</p>
      </div>
      <div style={{ padding: "0 28px 28px", position: "relative", zIndex: 2 }}>
        <Pill onClick={() => go("setup")}>{resume ? "CONTINUE SETUP" : "LET'S GO"}</Pill>
      </div>
    </Screen>
  );
}
const CAT_CARDS = [
  { label: "Fashion & Apparel", emoji: "👗" }, { label: "Beauty & Personal Care", emoji: "🧴" },
  { label: "Electronics & Mobile", emoji: "📱" }, { label: "Footwear", emoji: "👟" },
  { label: "Home & Kitchen", emoji: "🍳" }, { label: "Grocery & Daily Needs", emoji: "🧺" },
  { label: "Sports & Fitness", emoji: "🏋️" }, { label: "Toys, Babies & Kids", emoji: "🧸" },
];
const PLAT_ROWS = ["amazon", "flipkart", "meesho", "blinkit", "zepto", "instamart"];
function Setup({ go, profile, setProfile, authVia }) {
  const [step, setStep] = useState(0); // 0 age+gender · 1 categories · 2 platforms
  const [age, setAge] = useState(profile.age || "");
  const [gender, setGender] = useState(profile.gender || "");
  const [cats, setCats] = useState(profile.cats || []);
  const [plats, setPlats] = useState(profile.plats || []);
  const [othersOn, setOthersOn] = useState(false);
  const [hint, setHint] = useState("");
  const [cardOrder] = useState(() => [...CAT_CARDS].sort(() => Math.random() - 0.5));
  const save = (patch) => setProfile((p) => ({ ...p, ...patch }));

  const next = () => {
    setHint("");
    if (step === 0) { if (!age || !gender) return; save({ age, gender }); setStep(1); }
    else if (step === 1) {
      if (cats.length < 3) { setHint("Pick at least 3 categories to continue."); return; }
      save({ cats }); setStep(2);
    } else { save({ plats }); go("namelast"); }
  };
  const back = () => (step > 0 ? setStep(step - 1) : go("setupintro"));

  const RadioRow = ({ label, on, onClick }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: on ? "#F4FBEF" : "#fff", border: `1.5px solid ${on ? C.green : "rgba(0,0,0,.04)"}`, borderRadius: 16, padding: "17px 18px", cursor: "pointer", boxShadow: "0 4px 12px rgba(20,20,20,.05)", transition: "all .18s", marginBottom: 12 }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink }}>{label}</span>
      <span style={{ width: 21, height: 21, borderRadius: "50%", border: `2px solid ${on ? C.green : "#D9DACB"}`, display: "grid", placeItems: "center", transition: "all .15s" }}>
        {on && <span style={{ width: 11, height: 11, borderRadius: "50%", background: C.green }} />}
      </span>
    </div>
  );
  const CheckCircle = ({ on }) => (
    <span style={{ width: 22, height: 22, borderRadius: 7, flex: "0 0 auto", display: "grid", placeItems: "center", background: on ? C.green : "#fff", border: `1.5px solid ${on ? C.green : "#D9DACB"}`, color: "#fff", fontSize: 13, fontWeight: 900, transition: "all .15s" }}>{on ? "✓" : ""}</span>
  );

  return (
    <Screen bg="#FBFBEF">
      {/* segmented progress + STEP x/3 — per reference design */}
      <div style={{ padding: "10px 24px 0", flex: "0 0 auto" }}>
        <div style={{ display: "flex", gap: 10 }}>
          {[0, 1, 2].map((k) => (
            <span key={k} style={{ flex: 1, height: 6, borderRadius: 6, background: k <= step ? C.ink : "#E3E4D3", transition: "background .3s" }} />
          ))}
        </div>
        <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, fontSize: 11, letterSpacing: ".18em", color: "#8a8b7c", marginTop: 12 }}>STEP {step + 1}/3</div>
      </div>

      <div className="fayr-scroll" style={{ padding: "18px 24px 8px", flex: 1, overflowY: "auto" }}>
        {step === 0 && (
          <div key="s1" style={{ animation: "fayr-rise .4s ease both" }}>
            <h1 style={{ ...hTitle, fontSize: 30, lineHeight: 1.12 }}>How Young<br />Are you?</h1>
            <div style={{ marginTop: 24 }}>
              {["18 - 24", "25 - 34", "35 - 44", "45 and above"].map((a) => <RadioRow key={a} label={a} on={age === a} onClick={() => setAge(a)} />)}
            </div>
            <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: C.ink, margin: "10px 0 8px" }}>Gender</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Female", "Male", "Other", "Prefer not to say"].map((g) => (
                <button key={g} onClick={() => setGender(g)} style={{ border: `1.5px solid ${gender === g ? C.ink : "rgba(0,0,0,.06)"}`, borderRadius: 999, padding: "9px 16px", background: gender === g ? C.ink : "#fff", color: gender === g ? "#fff" : C.sub, fontFamily: FONT_DISPLAY, fontWeight: gender === g ? 600 : 500, fontSize: 13, cursor: "pointer", transition: "all .18s", boxShadow: "0 3px 8px rgba(0,0,0,.05)" }}>{g}</button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div key="s2" style={{ animation: "fayr-rise .4s ease both" }}>
            <h1 style={{ ...hTitle, fontSize: 30, lineHeight: 1.12 }}>What do you love shopping?</h1>
            {hint && <p style={{ ...hSub, color: C.red, fontWeight: 700 }}>{hint}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 22 }}>
              {cardOrder.map((cat) => {
                const on = cats.includes(cat.label);
                return (
                  <div key={cat.label}
                    onClick={() => { setCats((x) => x.includes(cat.label) ? x.filter((y) => y !== cat.label) : [...x, cat.label]); setHint(""); }}
                    style={{ background: on ? "#F4FBEF" : "#fff", border: `1.5px solid ${on ? C.green : "rgba(0,0,0,.04)"}`, borderRadius: 18, padding: "13px 13px 8px", cursor: "pointer", boxShadow: "0 4px 12px rgba(20,20,20,.05)", transition: "all .18s", display: "flex", flexDirection: "column", minHeight: 140 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, color: C.ink, lineHeight: 1.3 }}>{cat.label}</span>
                      <CheckCircle on={on} />
                    </div>
                    {/* CATEGORY_IMAGES slot: real 3D renders drop in here when provided */}
                    {CATEGORY_IMAGES[cat.label]
                      ? <div style={{ flex: 1, marginTop: 6, borderRadius: 10, overflow: "hidden" }}><img src={CATEGORY_IMAGES[cat.label]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                      : <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 46, filter: "drop-shadow(0 6px 8px rgba(0,0,0,.12))", paddingTop: 6 }}>{cat.emoji}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div key="s3" style={{ animation: "fayr-rise .4s ease both" }}>
            <h1 style={{ ...hTitle, fontSize: 30, lineHeight: 1.12 }}>Where do you shop the most?</h1>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 22 }}>
              {PLAT_ROWS.map((mid) => {
                const m = MARKETPLACES[mid];
                const on = plats.includes(mid);
                return (
                  <div key={mid}
                    onClick={() => setPlats((x) => x.includes(mid) ? x.filter((y) => y !== mid) : [...x, mid])}
                    style={{ display: "flex", alignItems: "center", gap: 14, background: on ? "#F4FBEF" : "#fff", border: `1.5px solid ${on ? C.green : "rgba(0,0,0,.04)"}`, borderRadius: 18, padding: "12px 15px", cursor: "pointer", boxShadow: "0 4px 12px rgba(20,20,20,.05)", transition: "all .18s" }}>
                    <BrandLogo mid={mid} size={42} />
                    <span style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink }}>{m.name}</span>
                    <CheckCircle on={on} />
                  </div>
                );
              })}
              <div onClick={() => setOthersOn(!othersOn)}
                style={{ display: "flex", alignItems: "center", gap: 14, background: othersOn ? "#F4FBEF" : "#fff", border: `1.5px solid ${othersOn ? C.green : "rgba(0,0,0,.04)"}`, borderRadius: 18, padding: "17px 15px", cursor: "pointer", boxShadow: "0 4px 12px rgba(20,20,20,.05)", transition: "all .18s" }}>
                <span style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink }}>Others</span>
                <CheckCircle on={othersOn} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* back circle + Next pill — per reference design */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 24px 24px", flex: "0 0 auto" }}>
        {step > 0 && (
          <button onClick={back}
            style={{ width: 62, height: 62, borderRadius: "50%", border: "none", background: "#fff", fontSize: 22, cursor: "pointer", boxShadow: "0 6px 16px rgba(0,0,0,.10)", flex: "0 0 auto", display: "grid", placeItems: "center" }}>←</button>
        )}
        <Pill onClick={next}
          disabled={step === 0 ? !(age && gender) : false}
          color={(step === 0 ? !!(age && gender) : step === 1 ? cats.length >= 3 : true) ? C.ink : "#cfcfcf"}
          style={{ flex: 1, borderRadius: 34, padding: "19px 24px", fontSize: 16, fontFamily: FONT_DISPLAY }}>
          Next
        </Pill>
      </div>
    </Screen>
  );
}

/* Last question — "What shall we Call You?" (coral accent, per reference) */
function NameLast({ go, setName, setProfile, authVia, tcName }) {
  const [nm, setNm] = useState(authVia === "truecaller" ? (tcName || "") : "");
  const ok = nm.trim().length >= 2;
  const start = () => {
    if (!ok) return;
    const n = nm.trim().replace(/\b\w/g, (c) => c.toUpperCase());
    setName(n); setProfile((p) => ({ ...p, name: n }));
    go("buildfeed");
  };
  return (
    <Screen bg="#FBFBEF">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "26px 26px 0", position: "relative" }}>
        <GridFloor style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 190, transform: "scaleY(-1)", opacity: .5 }} />
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17, color: C.ink, margin: 0 }}>Lastly</p>
          <h1 style={{ ...hTitle, fontSize: 29, marginTop: 4 }}>What shall we <span style={{ color: "#E8604C" }}>Call You?</span></h1>
          {authVia === "truecaller" && <p style={{ ...hSub }}>Pre-filled from Truecaller — just confirm.</p>}
          <input autoFocus placeholder="Your name" value={nm} onChange={(e) => setNm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()}
            style={{ marginTop: 22, width: "100%", boxSizing: "border-box", background: "#fff", border: `2px solid ${ok ? "#7B61FF" : "#CBBFF7"}`, borderRadius: 14, padding: "16px 18px", fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 17, color: C.ink, outline: "none", boxShadow: "0 4px 14px rgba(123,97,255,.10)", transition: "border-color .2s" }} />
        </div>
        <div style={{ flex: 1.4 }} />
      </div>
      <div style={{ padding: "0 26px 28px" }}>
        <Pill onClick={start} disabled={!ok} color={ok ? C.ink : "#cfcfcf"} style={{ borderRadius: 34, padding: "18px 24px", fontSize: 16, fontFamily: FONT_DISPLAY }}>Start</Pill>
      </div>
    </Screen>
  );
}
function BuildFeed({ go, profile }) {
  const picks = (profile.cats || []).slice(0, 2).map((c) => c.replace(/\s*\p{Extended_Pictographic}.*$/u, "").trim());
  useEffect(() => { const t = setTimeout(() => go("howfayr"), 2400); return () => clearTimeout(t); }, [go]); // ≤5s hard timeout per Flow 3
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ position: "relative", width: 110, height: 110 }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "4px solid #E7E8D6" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", borderTop: `4px solid ${C.green}`, borderRight: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "4px solid transparent", animation: "fayr-spin 1s linear infinite" }} />
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 40 }}>✨</div>
        </div>
        <p style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: C.ink2, marginTop: 24 }}>
          Finding {picks.length ? picks.join(" & ") : "the best"} campaigns for you…
        </p>
        <p style={{ fontFamily: FONT_BODY, fontSize: 12, color: "#a9aa9c", marginTop: 8 }}>Auto-advances — no tap needed.</p>
      </div>
    </Screen>
  );
}
function HowFayr({ go }) {
  const items = [
    { n: "1", t: "Claims & slots", s: "Every product has limited slots. Claiming reserves one for you for a short window — buy within it to keep your spot." },
    { n: "2", t: "Honest reviews only", s: "Write what you really think. 1★ or 5★ — your refund is exactly the same." },
    { n: "3", t: "Know the risk", s: "Marketplaces may act on rewarded reviews. In rare cases your marketplace account could be affected. Join only if you're okay with this." },
  ];
  return (
    <Screen>
      <TopBar />
      <div className="fayr-scroll" style={{ padding: "4px 26px 26px", flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <h1 style={hTitle}>Before your first campaign</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          {items.map((x) => (
            <CardBox key={x.n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: x.n === "3" ? C.amberBg : C.greenBg, color: x.n === "3" ? "#A66A12" : C.greenDeep, display: "grid", placeItems: "center", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, flex: "0 0 auto" }}>{x.n}</div>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14.5, color: C.ink2 }}>{x.t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{x.s}</div>
              </div>
            </CardBox>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 16 }} />
        <Pill onClick={() => go("home")}>I UNDERSTAND — CONTINUE</Pill>
      </div>
    </Screen>
  );
}

/* ============================================================================
   4b · SETUP FLOW — cinematic 3D-corridor onboarding (welcome → age+gender →
   categories → platforms → name → building feed → before-your-first-campaign).
   Replaces the old setupintro/setup/namelast/buildfeed/howfayr page sequence;
   writes name + profile, then go("home").
   ========================================================================== */
function SetupFlow({ go, setName, setProfile, authVia, tcName }) {
  const NS = 7, RAIL_START = 1;
  const [step, setStep] = useState(0);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [cats, setCats] = useState([]);
  const [plats, setPlats] = useState([]);
  const [nm, setNm] = useState(authVia === "truecaller" ? (tcName || "") : "");
  const R = useRef({ scenes: [], segs: [] }).current;

  const SCENE_BG = [
    "radial-gradient(130% 90% at 50% 8%,#F4F6E2 0%,#E6EFD7 55%,#D9ECD2 100%)",
    "radial-gradient(130% 90% at 50% 8%,#F1ECFB 0%,#E7E0F7 55%,#DED4F2 100%)",
    "radial-gradient(130% 90% at 50% 8%,#FDEEE0 0%,#FBE0CE 55%,#F7D3BC 100%)",
    "radial-gradient(130% 90% at 50% 8%,#E4F1FB 0%,#D2E7F7 55%,#C6DEF3 100%)",
    "radial-gradient(130% 90% at 50% 8%,#EAF6EC 0%,#DBEFDD 55%,#CDE9D2 100%)",
    "radial-gradient(130% 90% at 50% 8%,#EAF6E2 0%,#D6EDCB 55%,#C6E6BC 100%)",
    "radial-gradient(130% 90% at 50% 8%,#F4F6E2 0%,#E6EFD7 55%,#D7ECCF 100%)",
  ];
  const BLOB_A = ["#BFE9A8","#C9B8F2","#F7C9A0","#A8CFEF","#A8E4BC","#BFE9A8","#BFE9A8"];
  const BLOB_B = ["#F7D9A0","#E7C7A8","#F5B98F","#C7D9F2","#CDE9B8","#EAD79A","#F7D9A0"];
  const FOOTER_BG = ["#EDEFDA","#EDE7F8","#FBE9DC","#DFEDF8","#E6F3E4","#E6F3DC","#EBEFD8"];
  const CATS_S = [["👗","Fashion & Apparel"],["🧴","Beauty & Personal Care"],["📱","Electronics & Mobile"],["👟","Footwear"],["🍳","Home & Kitchen"],["🧺","Grocery & Daily Needs"],["🏋️","Sports & Fitness"],["🧸","Toys, Babies & Kids"]];
  const PLATS_S = [["🟠","Amazon","#FF9900"],["🔵","Flipkart","#2874F0"],["🟣","Meesho","#570D48"],["🟡","Blinkit","#F8CB46"],["🟪","Zepto","#4F1D9E"],["🟧","Instamart","#FC8019"],["➕","Others","#8a8b7c"]];
  const AGES = ["18 - 24","25 - 34","35 - 44","45 and above"];
  const GENDERS = ["Female","Male","Other","Prefer not to say"];
  const EASE = "cubic-bezier(.7,0,.18,1)";
  const sceneBase = { position:"absolute", inset:0, overflowX:"hidden", transformStyle:"preserve-3d", backfaceVisibility:"hidden", willChange:"transform,opacity,filter", transition:"transform 1s "+EASE+",opacity .8s ease,filter .8s ease" };

  const injectKeyframes = () => {
    if (document.getElementById("cs-kf")) return;
    const st = document.createElement("style"); st.id = "cs-kf";
    st.textContent = "@keyframes cs-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-16px)}}@keyframes cs-spin{to{transform:rotate(360deg)}}@keyframes cs-pop{0%{opacity:0;transform:scale(.6)}60%{transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}@keyframes cs-sweep{0%{transform:translate(-30%,-10%) rotate(8deg);opacity:.35}50%{opacity:.6}100%{transform:translate(40%,10%) rotate(8deg);opacity:.35}}@keyframes cs-drift{0%{transform:translate(0,0);opacity:0}12%{opacity:.7}88%{opacity:.7}100%{transform:translate(var(--dx),-120px);opacity:0}}@keyframes cs-orb{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(14px,-12px) scale(1.06)}66%{transform:translate(-10px,10px) scale(.96)}}";
    document.head.appendChild(st);
  };

  const revealChildren = (el) => {
    Array.prototype.slice.call(el.children).forEach(function (ch, i) {
      if (ch.__baseT === undefined) ch.__baseT = ch.style.transform || "";
      ch.style.transition = "opacity .5s ease, transform .7s cubic-bezier(.22,.61,.36,1)";
      ch.style.transitionDelay = (0.12 + i * 0.08) + "s";
      ch.style.opacity = "0";
      ch.style.transform = ch.__baseT + " translateY(18px)";
      requestAnimationFrame(function () { requestAnimationFrame(function () { ch.style.opacity = "1"; ch.style.transform = ch.__baseT; }); });
    });
  };

  const applyScene = (el, d) => {
    let t, op, blur, pe, z;
    if (d === 0) { t = "translate3d(0,0,0) rotateX(0deg) rotateY(0deg) scale(1)"; op = 1; blur = 0; pe = "auto"; z = 5; }
    else if (d > 0) { const k = Math.min(d, 1); t = "translate3d(" + (56 * k) + "%,6%," + (-460 * d) + "px) rotateX(7deg) rotateY(-26deg) scale(.92)"; op = 0; blur = 9; pe = "none"; z = 1; }
    else { const k2 = Math.min(-d, 1); t = "translate3d(" + (-66 * k2) + "%,-5%,230px) rotateX(-9deg) rotateY(28deg) scale(1.16)"; op = 0; blur = 12; pe = "none"; z = 2; }
    el.style.transform = t; el.style.opacity = op; el.style.filter = "blur(" + blur + "px)"; el.style.pointerEvents = pe; el.style.zIndex = z;
    if (d === 0) { el.scrollTop = 0; revealChildren(el); }
  };

  const canAdvance = (sv) => {
    if (sv === 1) return !!(age && gender);
    if (sv === 4) return nm.trim().length >= 2;
    return true;
  };
  const syncNext = (sv) => {
    if (!R.nextBtn) return;
    const okv = canAdvance(sv);
    R.nextBtn.style.background = okv ? "#1c1c1c" : "#cfcfcf";
    R.nextBtn.style.cursor = okv ? "pointer" : "default";
    R.nextBtn.style.boxShadow = okv ? "0 12px 26px rgba(20,20,20,.24)" : "none";
  };

  const finishFinale = () => {
    if (R.finaleRing) { R.finaleRing.style.animation = "none"; R.finaleRing.style.border = "4px solid #30A90F"; }
    if (R.finaleIcon) { R.finaleIcon.textContent = "🎉"; R.finaleIcon.style.animation = "cs-pop .5s cubic-bezier(.22,.61,.36,1) both"; }
    let name = (nm.trim() || "there"); name = name.charAt(0).toUpperCase() + name.slice(1);
    if (R.finaleTitle) R.finaleTitle.textContent = "Your feed is ready, " + name + "!";
    if (R.finaleSub) R.finaleSub.textContent = (cats.length || 3) + " interests · " + (plats.length || "your") + " stores matched.";
    if (R._finT) R._finT.push(setTimeout(function () { setStep(function (sv) { return sv === 5 ? 6 : sv; }); }, 1400));
  };
  const runFinale = () => {
    if (R._finT) return;
    const msgs = [["Matching campaigns to what you love.","✨"], ["Filtering by " + (plats.length ? plats.slice(0, 2).join(" & ") : "your stores") + ".","🛒"], ["Reserving your best-fit refunds.","💸"]];
    let i = 0; R._finT = [];
    const cycle = function () {
      if (!R.finaleSub) return;
      R.finaleSub.textContent = msgs[i][0];
      if (R.finaleIcon) R.finaleIcon.textContent = msgs[i][1];
      i++;
      if (i < msgs.length) R._finT.push(setTimeout(cycle, 900));
      else R._finT.push(setTimeout(finishFinale, 900));
    };
    cycle();
  };

  const layout = (sv) => {
    R.scenes.forEach(function (el, i) { if (el) applyScene(el, i - sv); });
    if (R.cam) { R.cam.style.perspective = "980px"; clearTimeout(R._camT); R._camT = setTimeout(function () { if (R.cam) R.cam.style.perspective = "1400px"; }, 70); }
    if (R.bg) { R.bg.style.background = SCENE_BG[sv]; R.bg.style.transform = "scale(" + (1 + sv * 0.03) + ")"; }
    if (R.blobA) { R.blobA.style.background = "radial-gradient(circle," + BLOB_A[sv] + ",transparent 68%)"; R.blobA.style.transform = "translate(" + (-sv * 68) + "px," + (sv * 26) + "px)"; }
    if (R.blobB) { R.blobB.style.background = "radial-gradient(circle," + BLOB_B[sv] + ",transparent 68%)"; R.blobB.style.transform = "translate(" + (sv * 60) + "px," + (-sv * 20) + "px)"; }
    if (R.footerEl) R.footerEl.style.background = "linear-gradient(to top," + FOOTER_BG[sv] + " 66%,rgba(0,0,0,0))";
    const inRail = sv >= RAIL_START && sv <= RAIL_START + 3;
    if (R.rail) R.rail.style.opacity = inRail ? "1" : "0";
    if (R.stepLbl) { R.stepLbl.style.opacity = inRail ? "1" : "0"; if (inRail) R.stepLbl.textContent = "STEP " + (sv - RAIL_START + 1) + " / 4"; }
    R.segs.forEach(function (seg, i) { if (seg) seg.style.background = i <= (sv - RAIL_START) ? "#1c1c1c" : "rgba(28,28,28,.14)"; });
    if (R.backBtn) R.backBtn.style.display = (sv >= RAIL_START && sv <= RAIL_START + 3) ? "grid" : "none";
    if (R.footerEl) R.footerEl.style.display = (sv === 5) ? "none" : "flex";
    if (R.nextBtn) R.nextBtn.textContent = sv === 0 ? "Begin the journey" : (sv === 4 ? "Build my feed" : (sv === 6 ? "I understand — continue" : "Continue"));
    syncNext(sv);
    if (sv === 5) runFinale();
    else if (R._finT) { R._finT.forEach(clearTimeout); R._finT = null; }
    if (sv === 4 && R.nameInput) setTimeout(function () { R.nameInput && R.nameInput.focus({ preventScroll: true }); }, 400);
  };

  const finish = () => {
    let name = (nm.trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); })) || "there";
    setName(name);
    setProfile(function (p) { return Object.assign({}, p, { name: name, age: age, gender: gender, cats: cats, plats: plats }); });
    go("home");
  };
  const next = () => { if (!canAdvance(step)) return; if (step === 6) { finish(); return; } setStep(step < NS - 1 ? step + 1 : 0); };
  const back = () => { if (step > 0) setStep(step - 1); };
  const skip = () => setStep(6);
  const toggleCat = (label) => setCats(function (prev) { return prev.indexOf(label) >= 0 ? prev.filter(function (x) { return x !== label; }) : prev.concat([label]); });
  const togglePlat = (name) => setPlats(function (prev) { return prev.indexOf(name) >= 0 ? prev.filter(function (x) { return x !== name; }) : prev.concat([name]); });

  useEffect(function () {
    injectKeyframes();
    const scenes = R.scenes.filter(Boolean);
    scenes.forEach(function (el) { el.dataset.tr = el.style.transition; el.style.transition = "none"; });
    layout(0);
    if (R.track) void R.track.offsetHeight;
    requestAnimationFrame(function () { scenes.forEach(function (el) { el.style.transition = el.dataset.tr || ""; }); });
    return function () { clearTimeout(R._camT); if (R._finT) R._finT.forEach(clearTimeout); };
  }, []);
  useEffect(function () { if (!R._m) { R._m = true; return; } layout(step); }, [step]);
  useEffect(function () { syncNext(step); }, [age, gender, cats, plats, nm, step]);

  const cardChk = (on) => ({ width: 22, height: 22, borderRadius: 7, flex: "0 0 auto", display: "grid", placeItems: "center", background: on ? "#68B642" : "#fff", border: "1.6px solid " + (on ? "#68B642" : "#D9DACB"), color: "#fff", fontSize: 13, fontWeight: 900 });

  return (
    <Screen noPad bg="#EDEFDA">
      <div ref={function (el) { R.root = el; }} style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: FONT_BODY }}>
        <div ref={function (el) { R.bg = el; }} style={{ position: "absolute", inset: 0, zIndex: 0, transition: "background 1.1s cubic-bezier(.4,0,.2,1),transform 1.2s " + EASE }} />
        <div ref={function (el) { R.blobA = el; }} style={{ position: "absolute", zIndex: 0, top: -90, left: -70, width: 320, height: 320, borderRadius: "50%", filter: "blur(46px)", opacity: .6, animation: "cs-orb 14s ease-in-out infinite", transition: "background 1.1s" }} />
        <div ref={function (el) { R.blobB = el; }} style={{ position: "absolute", zIndex: 0, bottom: 120, right: -90, width: 300, height: 300, borderRadius: "50%", filter: "blur(52px)", opacity: .55, animation: "cs-orb 18s ease-in-out infinite reverse", transition: "background 1.1s" }} />
        <div style={{ position: "absolute", zIndex: 0, top: "-20%", left: 0, width: "70%", height: "140%", pointerEvents: "none", background: "linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.5) 48%,rgba(255,255,255,0) 100%)", filter: "blur(26px)", animation: "cs-sweep 11s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
          {[["16%","18%",7,"24px","9s","0s"],["38%","8%",5,"-18px","12s",".8s"],["64%","24%",6,"30px","10.5s","1.6s"],["82%","12%",5,"-22px","13s","2.4s"],["50%","30%",4,"16px","8.5s","3.1s"]].map(function (p, i) {
            return <span key={i} style={{ position: "absolute", left: p[0], bottom: p[1], width: p[2], height: p[2], borderRadius: "50%", background: "rgba(255,255,255,.88)", boxShadow: "0 0 9px rgba(255,255,255,.75)", "--dx": p[3], animation: "cs-drift " + p[4] + " ease-in-out " + p[5] + " infinite" }} />;
          })}
        </div>

        {/* progress rail + skip */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 6, padding: "46px 24px 0", pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Wordmark size={20} />
          </div>
          <div ref={function (el) { R.rail = el; }} style={{ display: "flex", gap: 7, marginTop: 16, opacity: 0, transition: "opacity .5s" }}>
            {[0, 1, 2, 3].map(function (i) { return <span key={i} ref={function (el) { R.segs[i] = el; }} style={{ flex: 1, height: 5, borderRadius: 6, background: "rgba(28,28,28,.14)", transition: "background .4s" }} />; })}
          </div>
          <div ref={function (el) { R.stepLbl = el; }} style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10.5, letterSpacing: ".16em", color: "#8a8b7c", marginTop: 11, opacity: 0, transition: "opacity .5s" }}>STEP 1 / 4</div>
        </div>

        {/* camera + track */}
        <div ref={function (el) { R.cam = el; }} style={{ position: "absolute", inset: 0, zIndex: 2, overflow: "hidden", perspective: "1400px", perspectiveOrigin: "50% 44%", transition: "perspective .9s " + EASE + ",perspective-origin .9s ease" }}>
          <div ref={function (el) { R.track = el; }} style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>

            {/* SCENE 0 · welcome */}
            <section ref={function (el) { R.scenes[0] = el; }} style={Object.assign({}, sceneBase, { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 34px", textAlign: "center" })}>
              <div style={{ fontSize: 66, animation: "cs-float 5s ease-in-out infinite" }}>🛍️</div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 33, lineHeight: 1.08, letterSpacing: "-.03em", color: "#1c1c1c", margin: "26px 0 0" }}>Let's shape<br />your world</h1>
              <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14.5, lineHeight: 1.55, color: "#5c5c5c", margin: "14px 0 0", maxWidth: 280 }}>A 30-second journey — so every campaign we show you is worth your time.</p>
            </section>

            {/* SCENE 1 · age + gender */}
            <section ref={function (el) { R.scenes[1] = el; }} className="fayr-scroll" style={Object.assign({}, sceneBase, { overflowY: "auto", padding: "128px 28px 150px" })}>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29, lineHeight: 1.12, letterSpacing: "-.02em", color: "#1c1c1c", margin: 0 }}>How young<br />are you?</h1>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 22 }}>
                {AGES.map(function (a) {
                  const on = age === a;
                  return <div key={a} onClick={function () { setAge(a); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: on ? "#F4FBEF" : "#fff", border: "1.6px solid " + (on ? "#68B642" : "rgba(0,0,0,.05)"), borderRadius: 16, padding: "17px 18px", cursor: "pointer", boxShadow: "0 5px 14px rgba(20,20,20,.05)", transition: "background .2s,border-color .2s" }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: "#1c1c1c" }}>{a}</span>
                    <span style={{ width: 21, height: 21, borderRadius: "50%", border: "2px solid " + (on ? "#68B642" : "#D9DACB"), display: "grid", placeItems: "center" }}>{on ? <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#68B642" }} /> : null}</span>
                  </div>;
                })}
              </div>
              <p style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: "#1c1c1c", margin: "20px 0 10px" }}>Gender</p>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                {GENDERS.map(function (g) {
                  const on = gender === g;
                  return <button key={g} onClick={function () { setGender(g); }} style={{ border: "1.6px solid " + (on ? "#1c1c1c" : "rgba(0,0,0,.07)"), borderRadius: 999, padding: "10px 17px", background: on ? "#1c1c1c" : "#fff", color: on ? "#fff" : "#5c5c5c", fontFamily: FONT_DISPLAY, fontWeight: on ? 600 : 500, fontSize: 13, cursor: "pointer", boxShadow: "0 3px 9px rgba(0,0,0,.05)", transition: "all .2s" }}>{g}</button>;
                })}
              </div>
            </section>

            {/* SCENE 2 · categories */}
            <section ref={function (el) { R.scenes[2] = el; }} className="fayr-scroll" style={Object.assign({}, sceneBase, { overflowY: "auto", padding: "128px 28px 150px" })}>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29, lineHeight: 1.12, letterSpacing: "-.02em", color: "#1c1c1c", margin: 0 }}>What do you<br />love shopping?</h1>
              <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: cats.length ? "#30A90F" : "#8a8b7c", margin: "9px 0 0" }}>{cats.length ? cats.length + " selected" : "Choose whatever you love — as many as you like."}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
                {CATS_S.map(function (row) {
                  const on = cats.indexOf(row[1]) >= 0;
                  return <div key={row[1]} onClick={function () { toggleCat(row[1]); }} style={{ background: on ? "#F4FBEF" : "#fff", border: "1.6px solid " + (on ? "#68B642" : "rgba(0,0,0,.05)"), borderRadius: 18, padding: "13px 13px 10px", cursor: "pointer", boxShadow: "0 5px 14px rgba(20,20,20,.05)", display: "flex", flexDirection: "column", minHeight: 132, transition: "background .2s,border-color .2s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, color: "#1c1c1c", lineHeight: 1.3 }}>{row[1]}</span>
                      <span style={cardChk(on)}>{on ? "✓" : ""}</span>
                    </div>
                    <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 44, filter: "drop-shadow(0 6px 8px rgba(0,0,0,.12))", paddingTop: 6 }}>{row[0]}</div>
                  </div>;
                })}
              </div>
            </section>

            {/* SCENE 3 · platforms */}
            <section ref={function (el) { R.scenes[3] = el; }} className="fayr-scroll" style={Object.assign({}, sceneBase, { overflowY: "auto", padding: "128px 28px 150px" })}>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29, lineHeight: 1.12, letterSpacing: "-.02em", color: "#1c1c1c", margin: 0 }}>Where do you<br />shop the most?</h1>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 20 }}>
                {PLATS_S.map(function (row) {
                  const on = plats.indexOf(row[1]) >= 0;
                  return <div key={row[1]} onClick={function () { togglePlat(row[1]); }} style={{ display: "flex", alignItems: "center", gap: 14, background: on ? "#F4FBEF" : "#fff", border: "1.6px solid " + (on ? "#68B642" : "rgba(0,0,0,.05)"), borderRadius: 18, padding: "13px 15px", cursor: "pointer", boxShadow: "0 5px 14px rgba(20,20,20,.05)", transition: "background .2s,border-color .2s" }}>
                    <span style={{ width: 40, height: 40, borderRadius: 11, flex: "0 0 auto", display: "grid", placeItems: "center", fontSize: 20, background: row[2] + "22" }}>{row[0]}</span>
                    <span style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: "#1c1c1c" }}>{row[1]}</span>
                    <span style={cardChk(on)}>{on ? "✓" : ""}</span>
                  </div>;
                })}
              </div>
            </section>

            {/* SCENE 4 · name */}
            <section ref={function (el) { R.scenes[4] = el; }} className="fayr-scroll" style={Object.assign({}, sceneBase, { overflowY: "auto", padding: "128px 28px 150px" })}>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 11, letterSpacing: ".18em", color: "#8a8b7c" }}>ALMOST THERE</div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29, lineHeight: 1.12, letterSpacing: "-.02em", color: "#1c1c1c", margin: "12px 0 0" }}>What shall we<br /><span style={{ color: "#E8604C" }}>call you?</span></h1>
              <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13.5, lineHeight: 1.5, color: "#5c5c5c", margin: "12px 0 0" }}>This is how fayr will greet you every time you open the app.</p>
              <input ref={function (el) { R.nameInput = el; }} value={nm} placeholder="Your name" onChange={function (e) { setNm(e.target.value); }} onKeyDown={function (e) { if (e.key === "Enter") next(); }} style={{ marginTop: 26, width: "100%", boxSizing: "border-box", background: "#fff", border: "2px solid #CBBFF7", borderRadius: 14, padding: "16px 18px", fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 17, color: "#1c1c1c", outline: "none", boxShadow: "0 6px 18px rgba(123,97,255,.12)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "#F2E9FD", fontSize: 15 }}>🔒</span>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: "#8a8b7c" }}>Your name stays private — used only inside fayr.</span>
              </div>
            </section>

            {/* SCENE 5 · building feed */}
            <section ref={function (el) { R.scenes[5] = el; }} style={Object.assign({}, sceneBase, { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 34px", textAlign: "center" })}>
              <div style={{ position: "relative", width: 120, height: 120 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "4px solid rgba(48,169,15,.16)" }} />
                <div ref={function (el) { R.finaleRing = el; }} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "4px solid transparent", borderTopColor: "#30A90F", animation: "cs-spin 1s linear infinite" }} />
                <div ref={function (el) { R.finaleIcon = el; }} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 44 }}>✨</div>
              </div>
              <h1 ref={function (el) { R.finaleTitle = el; }} style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", color: "#1c1c1c", margin: "26px 0 0" }}>Building your feed…</h1>
              <p ref={function (el) { R.finaleSub = el; }} style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13.5, color: "#5c5c5c", margin: "10px 0 0", maxWidth: 280 }}>Matching campaigns to what you love.</p>
            </section>

            {/* SCENE 6 · before your first campaign */}
            <section ref={function (el) { R.scenes[6] = el; }} className="fayr-scroll" style={Object.assign({}, sceneBase, { overflowY: "auto", padding: "120px 28px 150px" })}>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 11, letterSpacing: ".18em", color: "#8a8b7c" }}>GOOD TO KNOW</div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 27, lineHeight: 1.12, letterSpacing: "-.02em", color: "#1c1c1c", margin: "12px 0 0" }}>Before your<br />first campaign</h1>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
                {[["1", "Claims & slots", "Every product has limited slots. Claiming reserves one for you for a short window — buy within it to keep your spot.", "#E9F7E4", "#30A90F"], ["2", "Honest reviews only", "Write what you really think. 1★ or 5★ — your refund is exactly the same.", "#E9F7E4", "#30A90F"], ["3", "Know the risk", "Marketplaces may act on rewarded reviews. In rare cases your marketplace account could be affected. Join only if you're okay with this.", "#FFF3D6", "#A66A12"]].map(function (x) {
                  return <div key={x[0]} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "#fff", border: "1.6px solid rgba(0,0,0,.05)", borderRadius: 18, padding: "16px 16px", boxShadow: "0 6px 16px rgba(20,20,20,.05)" }}>
                    <div style={{ width: 38, height: 38, borderRadius: 11, flex: "0 0 auto", display: "grid", placeItems: "center", background: x[3], color: x[4], fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16 }}>{x[0]}</div>
                    <div><div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: "#1c1c1c" }}>{x[1]}</div><div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: "#5c5c5c", marginTop: 3, lineHeight: 1.5 }}>{x[2]}</div></div>
                  </div>;
                })}
              </div>
            </section>

          </div>
        </div>

        {/* footer nav */}
        <div ref={function (el) { R.footerEl = el; }} style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5, padding: "14px 24px 30px", display: "flex", gap: 13, alignItems: "center", background: "linear-gradient(to top,#EDEFDA 66%,rgba(237,239,218,0))" }}>
          <button ref={function (el) { R.backBtn = el; }} onClick={back} style={{ width: 58, height: 58, borderRadius: "50%", border: "none", background: "#fff", fontSize: 21, color: "#1c1c1c", cursor: "pointer", boxShadow: "0 6px 16px rgba(0,0,0,.10)", flex: "0 0 auto", display: "none", placeItems: "center" }}>←</button>
          <button ref={function (el) { R.nextBtn = el; }} onClick={next} style={{ flex: 1, border: "none", borderRadius: 32, padding: "18px 24px", background: "#1c1c1c", color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, cursor: "pointer", boxShadow: "0 12px 26px rgba(20,20,20,.24)", transition: "transform .12s ease" }}
            onMouseDown={function (e) { e.currentTarget.style.transform = "scale(.975)"; }} onMouseUp={function (e) { e.currentTarget.style.transform = "scale(1)"; }} onMouseLeave={function (e) { e.currentTarget.style.transform = "scale(1)"; }}>Begin the journey</button>
        </div>
      </div>
    </Screen>
  );
}

/* ============================================================================
   5 · HOME — rails, cards (6 states), header chips, bottom nav, error/offline
   ========================================================================== */
function BottomNav({ tab, go }) {
  const items = [["home", "🏠", "Home"], ["myproducts", "🛍️", "My Products"], ["earnings", "💰", "Earnings"], ["insights", "👤", "My Profile"]];
  return (
    <div style={{ flex: "0 0 auto", background: "#fff", borderTop: `1px solid ${C.line}`, padding: "8px 10px 12px", display: "flex", boxShadow: "0 -6px 18px rgba(0,0,0,.05)" }}>
      {items.map(([k, icon, label]) => {
        const active = tab === k;
        return (
          <button key={k} onClick={() => go(k)} style={{ background: active ? "#FDF9DF" : "none", borderRadius: 12, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, padding: "5px 0", transition: "background .25s ease" }}>
            <span style={{ fontSize: 19, filter: active ? "none" : "grayscale(1)", opacity: active ? 1 : 0.55, transform: active ? "translateY(-1px) scale(1.1)" : "none", transition: "transform .3s cubic-bezier(.34,1.56,.64,1), opacity .2s ease" }}>{icon}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: active ? 700 : 500, fontSize: 10.5, color: active ? C.ink : "#8b8c80" }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
function cardStateFor(c, enrolled) {
  const e = enrolled[c.id];
  if (e) return e.done ? "completed" : e.missed ? "missed" : "progress";
  return c.state; // open | closing | full
}
function stateLine(c, k, e) {
  if (k === "open") return `${STATE_BADGE.open.label} · ${c.joined.toLocaleString()} joined`;
  if (k === "closing") return `Closing soon · ${c.closes} left`;
  if (k === "full") return "All seats taken";
  if (k === "progress") return `Step ${e.step} of 7 · ${e.stepLabel} · due in 22h`;
  if (k === "completed") return `₹${e.earned} earned · 12 Jun`;
  if (k === "missed") return "Window closed · 4 Jun";
  return "";
}
function CampaignCard({ c, enrolled, onClick, hero, delay = 0 }) {
  const k = cardStateFor(c, enrolled);
  const e = enrolled[c.id] || {};
  return (
    <div onClick={onClick} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 6px 16px rgba(20,20,20,.06)", cursor: "pointer", width: hero ? "100%" : 220, flex: "0 0 auto", animation: "fayr-rise .45s cubic-bezier(.22,.61,.36,1) both", animationDelay: delay + "ms", opacity: k === "missed" ? 0.75 : 1 }}>
      <div style={{ position: "relative" }}>
        <ProductArt theme={c.theme} cid={c.id} radius={0} style={{ width: "100%", height: hero ? 120 : 92 }} />
        <span style={{ position: "absolute", top: 8, left: 8 }}><Badge k={k} /></span>
        {k === "closing" && <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.75)", color: "#fff", borderRadius: 6, padding: "3px 7px", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 10 }}>{c.closes}</span>}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <MktTag mid={c.marketplace} />
        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.ink2, marginTop: 4, lineHeight: 1.3 }}>
          Review {c.product}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.greenDeep, marginTop: 4 }}>
          {c.pct}% back, up to ₹{c.maxBack}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 10.5, color: k === "closing" ? C.red : C.sub, marginTop: 5 }}>
          {stateLine(c, k, e)}
        </div>
      </div>
    </div>
  );
}
/* ── Campaign Deck — scroll-driven stacked cards ────────────────────────────
   The feed's own scroll is the input: as the page scrolls, the next campaign
   card rides up while the previous one recedes into a pile behind it (peek +
   scale + dim), so ~10 campaigns read as a curated sequence instead of four
   stacked rails. Native scrolling is never hijacked — the deck is a tall,
   sticky section that releases naturally when it's done. Rail names become
   chapter chips (tap to jump); tuning comes from the Tweaks panel via
   window.__deckTweaks (peek / recede / motion). */
const deckClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deckEase = (t) => 1 - Math.pow(1 - t, 3);
function deckTweaks() { return Object.assign({ peek: 10, recede: 0.045, motion: 0.8 }, window.__deckTweaks || {}); }

/* Deck card — a 1:1 dimensional twin of ClaimCard ("Products for you"):
   same 18px radius, same 108x122 tile + logo tab, same chip/name/button
   metrics, same slots/days footer — so every campaign card in the app reads
   as one family. Only the stack transform differs. */
function DeckCard({ c, bare }) {
  const slotPct = Math.min(100, Math.round((c.slots / 50) * 100));
  return (
    <div onMouseDown={(e) => { e.currentTarget.style.transform = "scale(.984)"; }} onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }} onTouchStart={(e) => { e.currentTarget.style.transform = "scale(.984)"; }} onTouchEnd={(e) => { e.currentTarget.style.transform = "scale(1)"; }} style={{ position: "relative", width: "100%", height: "100%", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: bare ? "none" : "0 6px 16px rgba(20,20,20,.07)", transition: "transform .18s ease", willChange: "transform" }}>
      {c.ribbon && (
        <div style={{ position: "absolute", top: 10, left: 0, zIndex: 3, background: C.ribbon, color: "#fff", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 8.5, letterSpacing: ".06em", padding: "4px 8px 4px 8px", borderRadius: "0 4px 4px 0", boxShadow: "0 2px 6px rgba(226,59,59,.4)" }}>{c.ribbon}</div>
      )}
      <div style={{ display: "flex", gap: 12, padding: "14px 14px 10px" }}>
        <div style={{ position: "relative", width: 108, height: 122, flex: "0 0 auto" }}>
          <ProductArt theme={c.theme} cid={c.id} radius={12} style={{ position: "absolute", inset: 0, background: c.heroBg }} />
          <BrandTab mid={c.marketplace} h={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.refundBg, borderRadius: 6, padding: "3px 9px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 12.5, color: C.refundInk }}>{c.pct}% Refund 💵</span>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink, marginTop: 7, lineHeight: 1.3 }}>{c.short}</div>
          <button style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, background: C.ink, color: "#fff", border: "none", borderRadius: 12, padding: "10px 22px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, cursor: "pointer", boxShadow: "0 6px 14px rgba(20,20,20,.22)" }}>
            Claim <span>→</span>
          </button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid " + C.line, padding: "9px 14px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 600, fontSize: 11.5, color: "#54554a" }}>
          👥 {c.slots} Slots Remaining
          <span style={{ width: 46, height: 4, borderRadius: 4, background: "#F3E0D3", overflow: "hidden", display: "inline-block" }}>
            <span style={{ display: "block", width: slotPct + "%", height: "100%", background: "linear-gradient(90deg,#FF6D1D,#FFA26F)" }} />
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11.5, color: C.red }}>⏰ {c.days} days left</span>
      </div>
    </div>
  );
}

/* Campaign deck, take 3 — the canonical sticky-stack. Cards are ordinary
   flowing content; each pins just under the section header as it scrolls past,
   so the next card slides up and covers it (peek + recede via transforms).
   Because everything is normal document flow there is NOWHERE for dead space
   to exist: the heading sits directly on the first card, upcoming cards fill
   the lower viewport while browsing, and the last card + sign-off end flush
   against the bottom nav. */
function CampaignDeck({ chapters, onOpen, onSeeAll }) {
  const flat = [];
  chapters.forEach((ch, ci) => ch.items.forEach((c) => flat.push({ c, ci })));
  const N = flat.length;
  const CARD_H = 182, HEAD = 92, STEP = 172;
  const wrapRef = useRef(null);
  const refs = useRef([]);
  const msgRef = useRef(null);
  const cueRef = useRef(null);
  const prog = useRef(0);
  const [front, setFront] = useState(0);
  const [vh, setVh] = useState(560);
  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current; if (!wrap) return;
      const sc = wrap.closest(".fayr-scroll"); if (!sc) return;
      if (sc.clientHeight) setVh(sc.clientHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const VH = vh;
  const BASE_TOP = HEAD + 14;                 // first card sits right under the heading
  const ENTER = VH + 10;                      // cards rise from just off the bottom
  useEffect(() => {
    let raf;
    const smooth = (x) => x * x * (3 - 2 * x);  // smoothstep — eases each card into place
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wrap = wrapRef.current; if (!wrap) return;
      const sc = wrap.closest(".fayr-scroll"); if (!sc) return;
      const y = sc.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      const tw = deckTweaks();
      // Eased per-step mapping: cards linger when stacked and glide through the
      // hand-off, so scrolling feels like the deck settling rather than sliding.
      const raw = deckClamp(y / STEP, 0, N - 1);
      const b = Math.floor(raw), t = b + smooth(raw - b);
      const k = deckClamp(0.14 + 0.13 * tw.motion, 0.08, 0.42);
      let p = prog.current + (t - prog.current) * k;
      if (Math.abs(t - p) < 0.0008) p = t;
      prog.current = p;
      for (let i = 0; i < N; i++) {
        const el = refs.current[i]; if (!el) continue;
        const rel = p - i;
        let top, scale, opacity, bright, sy, sb, sa;
        if (rel >= 0) {                        // front, then receding up behind the header
          const d = Math.min(rel, 5);
          top = BASE_TOP - d * tw.peek;
          scale = 1 - d * tw.recede;
          opacity = deckClamp(5.6 - rel, 0, 1);
          bright = 1 - Math.min(rel, 4) * 0.045;
          const near = Math.max(0, 1 - rel / 2.2);   // depth-scaled shadow, front 2-3 only
          sy = 6 + 12 * near; sb = 14 + 16 * near; sa = 0.05 + 0.13 * near;
        } else if (rel > -1) {                 // rising from below to the front
          const tt = deckEase(rel + 1);
          top = ENTER + (BASE_TOP - ENTER) * tt;
          scale = 0.955 + 0.045 * tt;
          opacity = deckClamp(tt * 2, 0, 1);
          bright = 1;
          sy = 6 + 12 * tt; sb = 14 + 16 * tt; sa = 0.05 + 0.13 * tt;
        } else {                               // waiting off-screen
          top = ENTER; scale = 0.955; opacity = 0; bright = 1; sy = 0; sb = 0; sa = 0;
        }
        el.style.top = top.toFixed(2) + "px";
        el.style.transform = "translateZ(0) scale(" + scale.toFixed(4) + ")";
        el.style.opacity = opacity.toFixed(3);
        el.style.filter = "brightness(" + bright.toFixed(3) + ") drop-shadow(0 " + sy.toFixed(1) + "px " + sb.toFixed(1) + "px rgba(20,20,20," + sa.toFixed(3) + "))";
        el.style.pointerEvents = rel > -0.55 && rel < 0.5 ? "auto" : "none";
      }
      // end message: fades up from the stage floor as the last card settles
      if (msgRef.current) {
        const mo = deckClamp((p - (N - 1.7)) / 1.3, 0, 1);
        msgRef.current.style.opacity = mo.toFixed(3);
        msgRef.current.style.transform = "translate(-50%,-50%) translateY(" + ((1 - mo) * 12).toFixed(1) + "px)";
      }
      // scroll cue: teaches first-timers the deck continues; visible near the
      // top, fades as they advance the stack
      if (cueRef.current) {
        cueRef.current.style.opacity = deckClamp(1 - p / 1.1, 0, 1).toFixed(3);
      }
      const f = deckClamp(Math.round(p), 0, N - 1);
      setFront((old) => (old === f ? old : f));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [N, VH, BASE_TOP, ENTER]);
  const jump = (target) => {
    const wrap = wrapRef.current; if (!wrap) return;
    const sc = wrap.closest(".fayr-scroll"); if (!sc) return;
    const y = sc.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    const wrapStart = sc.scrollTop - y;
    sc.scrollTo({ top: wrapStart + target * STEP + 2, behavior: "smooth" });
  };
  const jumpCh = (ci) => jump(flat.findIndex((f) => f.ci === ci));
  if (!N) return null;
  const activeCh = flat[front].ci;
  const floorTop = BASE_TOP + CARD_H - 46;
  const bandCenter = (BASE_TOP + CARD_H + VH) / 2;
  return (
    <div ref={wrapRef} style={{ position: "relative", height: VH + (N - 1) * STEP, marginTop: 16 }}>
      <div style={{ position: "sticky", top: 0, height: VH, overflow: "hidden" }}>
        {/* perspective floor beneath the stack — quiet depth, and the canvas the
            end message rests on */}
        <div style={{ position: "absolute", left: -30, right: -30, top: floorTop, height: Math.max(120, VH - floorTop), opacity: 0.28, pointerEvents: "none" }}>
          <GridFloor style={{ width: "100%", height: "100%" }} />
        </div>
        {/* end-of-list message — page text, not a card; centred in the stage floor */}
        <div ref={msgRef} style={{ position: "absolute", left: "50%", top: bandCenter, transform: "translate(-50%,-50%)", width: 260, textAlign: "center", opacity: 0, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: "#6f6a59", letterSpacing: "-.01em" }}>You've reached the end of today's live campaigns.</div>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: "#a29b8a", marginTop: 7, lineHeight: 1.45 }}>More exciting campaigns are coming soon. Stay tuned!</div>
        </div>
        {/* scroll cue — upward chevrons rising in sequence + hint; fades out as the deck advances */}
        <div ref={cueRef} style={{ position: "absolute", left: "50%", top: bandCenter, transform: "translate(-50%,-50%)", width: 240, textAlign: "center", opacity: 0, pointerEvents: "none", zIndex: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, marginBottom: 10 }}>
            {[0, 1, 2].map((i) => (
              <svg key={i} width="30" height="13" viewBox="0 0 30 13" style={{ opacity: 0.22, animation: "deck-chev 1.8s ease-in-out " + (i * 0.18) + "s infinite" }}>
                <path d="M3 10 L15 3 L27 10" fill="none" stroke="#4a463c" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ))}
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: "#8a8574", letterSpacing: "-.01em" }}>Keep scrolling to explore more campaigns</div>
        </div>
        {/* header — always above the stack */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 200, background: "linear-gradient(180deg, #FBFBEF 82%, rgba(251,251,239,0))", padding: "0 16px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, margin: 0 }}>Browse campaigns</h2>
            <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 11, color: C.sub }}>{front + 1}/{N}</span>
            <button onClick={onSeeAll} style={{ border: "none", background: "#fff", borderRadius: 20, padding: "6px 12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: C.ink, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.08)", display: "inline-flex", alignItems: "center", gap: 4 }}>See all <span style={{ fontSize: 13, lineHeight: 1 }}>›</span></button>
          </div>
          <div className="fayr-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "9px 0 0" }}>
            {chapters.map((ch, ci) => {
              const active = ci === activeCh;
              return (
                <button key={ch.key} onClick={() => jumpCh(ci)} style={{ flex: "0 0 auto", border: "none", borderRadius: 20, padding: "7px 13px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11.5, cursor: "pointer", background: active ? C.ink : "#fff", color: active ? "#fff" : "#54554a", boxShadow: active ? "0 4px 10px rgba(20,20,20,.18)" : "0 2px 6px rgba(0,0,0,.05)", transition: "all .3s" }}>{ch.title}</button>
              );
            })}
          </div>
        </div>
        {/* stacked campaign cards */}
        {flat.map((f, i) => (
          <div key={f.c.id} ref={(el) => { refs.current[i] = el; }}
            onClick={() => { const d = i - prog.current; if (Math.abs(d) < 0.5) onOpen(f.c); else if (d > 0) jump(i); }}
            style={{ position: "absolute", left: 16, right: 16, height: CARD_H, top: ENTER, transformOrigin: "center top", zIndex: 20 + i, cursor: "pointer", willChange: "transform, top, opacity" }}>
            <DeckCard c={f.c} bare />
          </div>
        ))}
      </div>
    </div>
  );
}

/* Chapters for the deck: closing-soon first (urgency), then the old rails,
   deduped; the two featured products above the deck are skipped. */
function deckChapters() {
  const seen = new Set(CAMPAIGNS.filter((c) => c.rail === "featured").map((c) => c.id));
  const take = (pred) => CAMPAIGNS.filter((c) => !seen.has(c.id) && pred(c)).map((c) => { seen.add(c.id); return c; });
  return [
    { key: "closing", title: "Closing soon ⚡", items: take((c) => c.state === "closing") },
    { key: "recommended", title: "For you", items: take((c) => c.rail === "recommended") },
    { key: "trending", title: "Trending 🔥", items: take((c) => c.rail === "trending") },
    { key: "new", title: "New ✨", items: take((c) => c.rail === "new") },
    { key: "popular", title: "Popular", items: take((c) => c.rail === "popular") },
  ].filter((ch) => ch.items.length);
}

/* See-all: every live campaign (featured included), grouped by chapter, in a
   plain scrollable list of the same standard cards. */
function AllCampaigns({ go, openCampaign }) {
  const sections = [{ key: "featured", title: "Featured", items: CAMPAIGNS.filter((c) => c.rail === "featured") }, ...deckChapters()];
  const total = sections.reduce((n, ch) => n + ch.items.length, 0);
  return (
    <Screen bg="#FBFBEF">
      <TopBar title={"All campaigns · " + total} onBack={() => go("home")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 20px" }}>
        {sections.map((ch) => (
          <div key={ch.key}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink, margin: "14px 0 10px" }}>{ch.title} <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11, color: "#8b8c80" }}>· {ch.items.length}</span></h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ch.items.map((c) => (
                <div key={c.id} onClick={() => openCampaign(c)} style={{ height: 182, cursor: "pointer" }}><DeckCard c={c} /></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

const BANNERS = [
  { a: "Buy. Use. Share", b: "Feedback", tone: C.ink },
  { a: "Get up to", b: "100% refund", tone: "#3E8E00" },
  { a: "Give your", b: "honest feedback", tone: "#7926D9" },
];
function Home({ go, name, wallet, enrolled, claimed, openCampaign, netState, continueStep, hasUnread, openProof, reminderDismissed, dismissReminder }) {
  const [bi, setBi] = useState(0);
  useEffect(() => { const t = setInterval(() => setBi((x) => (x + 1) % BANNERS.length), 3500); return () => clearInterval(t); }, []);
  const banner = BANNERS[bi];
  const claimedIds = Object.keys(claimed || {});
  return (
    <Screen noPad bg="#FBFBEF">
      {/* yellow gradient header — wordmark · wallet chip · bell (no search bar) */}
      <div style={{ background: `linear-gradient(180deg, ${C.headYellow} 0%, ${C.headYellow2} 78%, #FBFBEF 100%)`, padding: "0 18px 6px", flex: "0 0 auto", position: "relative", overflow: "hidden" }}>
        <GridFloor style={{ position: "absolute", inset: "auto 0 0 0", width: "100%", height: 130, opacity: .5 }} />
        <StatusSpacer />
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2, position: "relative" }}>
          <Wordmark size={30} />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => go("earnings")} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "none", borderRadius: 20, height: 36, padding: "0 14px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>👛 ₹{rupees(wallet)}</button>
            <button onClick={() => go("notifcenter")} style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", background: "#fff", border: "none", fontSize: 16, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
              🔔{hasUnread && <span style={{ position: "absolute", top: 6, right: 7, width: 8, height: 8, borderRadius: "50%", background: C.red, border: "1.5px solid #fff" }} />}
            </button>
          </div>
        </div>
        {/* rotating banner */}
        <div style={{ height: 96, display: "grid", placeItems: "center", position: "relative" }}>
          <div key={bi} style={{ textAlign: "center", animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 25, color: C.ink, letterSpacing: "-0.02em", lineHeight: 1.05, transform: "rotate(-1.5deg)" }}>{banner.a}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29, color: banner.tone, letterSpacing: "-0.02em", lineHeight: 1.1, transform: "rotate(-1.5deg)", textShadow: "0 2px 0 rgba(255,255,255,.6)" }}>{banner.b} {bi === 1 && "💵"}</div>
          </div>
          <div style={{ position: "absolute", bottom: 4, display: "flex", gap: 5 }}>
            {BANNERS.map((_, k) => <span key={k} style={{ width: k === bi ? 16 : 6, height: 6, borderRadius: 6, background: k === bi ? C.ink : "rgba(25,25,25,.25)", transition: "all .3s" }} />)}
          </div>
        </div>
      </div>

      {netState === "offline" && (
        <div style={{ background: C.amberBg, borderBottom: `1px solid ${C.amberLine}`, padding: "8px 16px", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: "#7a5a10", flex: "0 0 auto" }}>
          You're offline — showing your last feed. We'll refresh automatically.
        </div>
      )}

      {netState === "error" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 52 }}>⚠️</div>
          <h2 style={{ ...hTitle, fontSize: 22, marginTop: 14 }}>Something went wrong</h2>
          <p style={{ ...hSub, maxWidth: 260 }}>We couldn't load your feed. Your products and earnings are unaffected.</p>
          <div style={{ maxWidth: 160, width: "100%", marginTop: 18 }}><Pill>RETRY</Pill></div>
        </div>
      ) : (
        <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px 0 0" }}>
          {/* Products for you — 2 full cards, then the rest in a carousel */}
          <div style={{ padding: "0 16px" }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, margin: "4px 0 12px" }}>Products for you</h2>
            {CAMPAIGNS.filter((c) => c.rail === "featured").slice(0, 2).map((c, i) => (
              <ClaimCard key={c.id} c={c} enrolled={enrolled} claimed={claimed} onOpen={() => openCampaign(c)} continueStep={continueStep} delay={i * 60} />
            ))}
          </div>

          {/* campaign deck — carousel + four rails folded into one scroll-driven
              stack; every card stacks, end message lives in the stage floor */}
          <CampaignDeck chapters={deckChapters()} onOpen={openCampaign} onSeeAll={() => go("allcampaigns")} />
        </div>
      )}
      {/* purchased-product reminder — FIXED just above the nav (does not scroll),
          layered above the deck so it never interferes with the stacking */}
      {!reminderDismissed && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, padding: "0 12px", zIndex: 60, pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto" }}>
            <RotatingStatusCard
              campaigns={CAMPAIGNS.filter((c) => (claimed[c.id] || enrolled[c.id]) && !(enrolled[c.id] || {}).done && statusCard(c, enrolled[c.id], claimed))}
              enrolled={enrolled} claimed={claimed} onDismiss={dismissReminder}
              onAct={(c, sc) => { if (!sc.cta) return; if (sc.to === "detail") continueStep(c); else if (sc.to === "proofprimer") openProof(c); else go(sc.to); }}
            />
          </div>
        </div>
      )}
      <BottomNav tab="home" go={go} />
    </Screen>
  );
}

/* Auto-advancing hero carousel — slides L→R every 3.5s, drag/swipe enabled,
   the centered card pops out. Tap the active card to start the claim flow. */
function HeroCarousel({ campaigns, onOpen }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const scRef = useRef(null);
  const programmatic = useRef(false);   // true while we drive scrollTo, so onScroll won't fight it
  const settleTimer = useRef(null);
  const resumeTimer = useRef(null);
  const n = campaigns.length;
  const CARD_W = 240, GAP = 14, PAD = 16;

  // center a given card index
  const scrollToIdx = (i) => {
    const el = scRef.current; if (!el) return;
    const target = Math.max(0, i * (CARD_W + GAP) + PAD + CARD_W / 2 - el.clientWidth / 2);
    programmatic.current = true;
    el.scrollTo({ left: target, behavior: "smooth" });
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { programmatic.current = false; }, 550);
  };

  // auto-advance
  useEffect(() => {
    if (paused || n <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 3200);
    return () => clearInterval(t);
  }, [paused, n]);

  // whenever idx changes (auto or dot/tap), scroll it to center
  useEffect(() => { scrollToIdx(idx); /* eslint-disable-next-line */ }, [idx]);

  // while the USER drags, keep the active card in sync — but ignore our own programmatic scrolls
  const onScroll = () => {
    if (programmatic.current) return;
    const el = scRef.current; if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestD = Infinity;
    campaigns.forEach((_, i) => {
      const cardCenter = PAD + i * (CARD_W + GAP) + CARD_W / 2;
      const d = Math.abs(cardCenter - center);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== idx) setIdx(best);
  };

  // pause on manual interaction, resume a few seconds after the user stops
  const holdPause = () => { setPaused(true); clearTimeout(resumeTimer.current); };
  const scheduleResume = () => { clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => setPaused(false), 3000); };

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", margin: "0 0 12px" }}>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink, margin: 0 }}>Don't miss out ⚡</h2>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 10.5, color: C.sub, background: "#fff", borderRadius: 20, padding: "3px 9px", boxShadow: "0 2px 6px rgba(0,0,0,.06)" }}>Auto-playing</span>
      </div>
      <div ref={scRef} onScroll={onScroll}
        onPointerDown={holdPause} onPointerUp={scheduleResume} onTouchStart={holdPause} onTouchEnd={scheduleResume}
        className="fayr-scroll" style={{ display: "flex", gap: GAP, overflowX: "auto", padding: "20px 16px 10px", scrollSnapType: "none", WebkitOverflowScrolling: "touch" }}>
        {campaigns.map((c, i) => {
          const active = i === idx;
          return (
            <div key={c.id} onClick={() => (active ? onOpen(c) : setIdx(i))}
              style={{ width: CARD_W, flex: "0 0 auto", cursor: "pointer", transformOrigin: "center bottom", transform: active ? "scale(1.07)" : "scale(0.9)", opacity: active ? 1 : 0.65, transition: "transform .5s cubic-bezier(.2,.7,.3,1), opacity .5s, filter .5s", filter: active ? "none" : "saturate(.8)", zIndex: active ? 2 : 1 }}>
              <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: active ? "0 20px 38px rgba(20,20,20,.18)" : "0 6px 16px rgba(20,20,20,.07)", transition: "box-shadow .5s" }}>
                <div style={{ position: "relative", height: 150, background: c.heroBg }}>
                  <ProductArt theme={c.theme} cid={c.id} radius={0} style={{ position: "absolute", inset: 0 }} />
                  {c.ribbon && <span style={{ position: "absolute", top: 10, left: 0, background: C.ribbon, color: "#fff", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 8.5, letterSpacing: ".06em", padding: "4px 8px", borderRadius: "0 4px 4px 0" }}>{c.ribbon}</span>}
                  <span style={{ position: "absolute", top: 10, right: 10, background: "rgba(255,255,255,.95)", borderRadius: 8, padding: "3px 6px" }}><BrandLogo mid={c.marketplace} size={22} /></span>
                  {c.state === "closing" && <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(0,0,0,.78)", color: "#fff", borderRadius: 6, padding: "3px 8px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 9.5 }}>⏰ {c.days} days left</span>}
                </div>
                <div style={{ padding: "12px 13px 13px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.refundBg, borderRadius: 6, padding: "3px 9px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 12, color: C.refundInk }}>{c.pct}% Refund 💵</span>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink, marginTop: 7, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.short}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 600, fontSize: 10.5, color: "#54554a" }}>👥 {c.slots} slots left</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: active ? C.ink : "#F1F1E6", color: active ? "#fff" : C.sub, borderRadius: 10, padding: "7px 14px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 12, transition: "all .3s" }}>Claim →</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 8 }}>
        {campaigns.map((_, k) => (
          <span key={k} onClick={() => { holdPause(); setIdx(k); scheduleResume(); }} style={{ width: k === idx ? 18 : 6, height: 6, borderRadius: 6, background: k === idx ? C.ink : "rgba(25,25,25,.2)", transition: "all .3s", cursor: "pointer" }} />
        ))}
      </div>
    </div>
  );
}

/* Compact card for horizontal rails */
function MiniCard({ c, onOpen, delay = 0 }) {
  return (
    <div onClick={onOpen} style={{ width: 168, flex: "0 0 auto", scrollSnapAlign: "start", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 5px 14px rgba(20,20,20,.07)", cursor: "pointer", animation: "fayr-rise .45s cubic-bezier(.22,.61,.36,1) both", animationDelay: delay + "ms" }}>
      <div style={{ position: "relative", height: 118, background: c.heroBg }}>
        <ProductArt theme={c.theme} cid={c.id} radius={0} style={{ position: "absolute", inset: 0 }} />
        {c.ribbon && <span style={{ position: "absolute", top: 8, left: 0, background: C.ribbon, color: "#fff", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 8, letterSpacing: ".05em", padding: "3px 7px", borderRadius: "0 4px 4px 0" }}>{c.ribbon}</span>}
        <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,.95)", borderRadius: 7, padding: "2px 5px" }}><BrandLogo mid={c.marketplace} size={18} /></span>
      </div>
      <div style={{ padding: "10px 11px 11px" }}>
        <span style={{ display: "inline-block", background: C.refundBg, borderRadius: 5, padding: "2px 7px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 10.5, color: C.refundInk }}>{c.pct}% Refund</span>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 12.5, color: C.ink, marginTop: 6, lineHeight: 1.3, height: 32, overflow: "hidden" }}>{c.short}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}>
          <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontSize: 9.5, color: c.state === "closing" ? C.red : "#8b8c80", fontWeight: 600 }}>{c.state === "closing" ? `⏰ ${c.days}d left` : `${c.slots} slots`}</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11.5, color: C.ink }}>Claim →</span>
        </div>
      </div>
    </div>
  );
}

/* Home campaign card — screenshot layout: ribbon, product image w/ marketplace
   logo ribbon, refund badge, name, Claim button, slots + days footer. */
function ClaimCard({ c, enrolled, claimed, onOpen, continueStep, delay = 0 }) {
  const e = (enrolled || {})[c.id];
  const isClaimed = !!(claimed || {})[c.id];
  const [t, setT] = useState(25 * 60 + 35);
  useEffect(() => { if (!isClaimed) return; const id = setInterval(() => setT((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(id); }, [isClaimed]);
  const slotPct = Math.min(100, Math.round((c.slots / 50) * 100));
  return (
    <div style={{ background: "#fff", borderRadius: 18, marginBottom: 14, boxShadow: "0 6px 16px rgba(20,20,20,.07)", animation: "fayr-rise .45s cubic-bezier(.22,.61,.36,1) both", animationDelay: delay + "ms", overflow: "hidden", position: "relative" }}>
      {c.ribbon && (
        <div style={{ position: "absolute", top: 10, left: 0, zIndex: 3, background: C.ribbon, color: "#fff", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 8.5, letterSpacing: ".06em", padding: "4px 8px 4px 8px", borderRadius: "0 4px 4px 0", boxShadow: "0 2px 6px rgba(226,59,59,.4)" }}>{c.ribbon}</div>
      )}
      <div style={{ display: "flex", gap: 12, padding: "14px 14px 10px" }}>
        {/* product tile + marketplace logo ribbon */}
        <div style={{ position: "relative", width: 108, height: 122, flex: "0 0 auto" }}>
          <ProductArt theme={c.theme} cid={c.id} radius={12} style={{ position: "absolute", inset: 0, background: c.heroBg }} />
          <BrandTab mid={c.marketplace} h={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.refundBg, borderRadius: 6, padding: "3px 9px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 12.5, color: C.refundInk }}>{c.pct}% Refund 💵</span>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink, marginTop: 7, lineHeight: 1.3 }}>{c.short}</div>
          {!isClaimed ? (
            <button onClick={onOpen} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, background: C.ink, color: "#fff", border: "none", borderRadius: 12, padding: "10px 22px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, cursor: "pointer", boxShadow: "0 6px 14px rgba(20,20,20,.22)" }}>
              Claim <span>→</span>
            </button>
          ) : (
            /* clean claimed state — the floating reminder handles the next-step nudge */
            <button onClick={() => continueStep(c)} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7, background: "#EDF9E4", color: C.greenDeep, border: "1px solid #BCE4A2", borderRadius: 12, padding: "10px 18px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              ✓ Claimed — continue <span>›</span>
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.line}`, padding: "9px 14px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 600, fontSize: 11.5, color: "#54554a" }}>
          👥 {c.slots} Slots Remaining
          <span style={{ width: 46, height: 4, borderRadius: 4, background: "#F3E0D3", overflow: "hidden", display: "inline-block" }}>
            <span style={{ display: "block", width: slotPct + "%", height: "100%", background: "linear-gradient(90deg,#FF6D1D,#FFA26F)" }} />
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11.5, color: C.red }}>⏰ {c.days} days left</span>
      </div>
    </div>
  );
}
function HowWorksVideo({ go, c }) {
  return (
    <Screen noPad bg="#FBFBEF">
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,20,20,.5)", backdropFilter: "blur(2px)" }} onClick={() => go("detail")} />
      <div style={{ flex: 1 }} onClick={() => go("detail")} />
      <div style={{ position: "relative", margin: "0 14px 26px", background: "linear-gradient(180deg,#FDF6C9,#FFFDF2)", borderRadius: 22, padding: "20px 18px 22px", animation: "fayr-rise .35s cubic-bezier(.22,.61,.36,1) both", boxShadow: "0 -10px 40px rgba(0,0,0,.25)" }}>
        <button onClick={() => go("detail")} style={{ position: "absolute", top: -46, left: "50%", transform: "translateX(-50%)", width: 38, height: 38, borderRadius: "50%", border: "none", background: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,.2)" }}>✕</button>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 22, color: C.ink, textAlign: "center", margin: 0 }}>How it works?</h2>
        {/* video placeholder — drop the real video URL here */}
        <div style={{ marginTop: 14, borderRadius: 14, background: "linear-gradient(135deg,#F7E4EC,#FBF0F4)", height: 168, position: "relative", overflow: "hidden", border: "1px solid rgba(0,0,0,.05)" }}>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(255,255,255,.92)", display: "grid", placeItems: "center", boxShadow: "0 6px 18px rgba(0,0,0,.15)", cursor: "pointer" }}>
              <span style={{ marginLeft: 4, width: 0, height: 0, borderTop: "11px solid transparent", borderBottom: "11px solid transparent", borderLeft: "18px solid " + C.ink }} />
            </div>
          </div>
          <span style={{ position: "absolute", bottom: 8, right: 10, fontFamily: "ui-monospace, monospace", fontSize: 9.5, color: "#a08a92" }}>VIDEO PLACEHOLDER · 0:45</span>
        </div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 11 }}>
          {[["01", "Select a product you like & buy it", "#3E8E00"], ["02", "Try it to gain experience", "#2F6FD0"], ["03", "Share your fayr feedback", "#7926D9"], ["04", "Get upto 100% Refund 💵", "#E5392B"]].map(([n, t, col]) => (
            <div key={n} style={{ display: "flex", gap: 12, alignItems: "center", borderBottom: n !== "04" ? "1px solid rgba(0,0,0,.06)" : "none", paddingBottom: n !== "04" ? 11 : 0 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: col, borderBottom: `2.5px solid ${col}`, lineHeight: 1.4 }}>{n}</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontStyle: "italic", fontSize: 13.5, color: C.ink }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
const FAQS = [
  ["When do I get my refund?", "Right after the marketplace's return window closes and your feedback is verified. You'll see the exact date on your product card the whole time."],
  ["Does my star rating change my refund?", "Never. 1 star or 5 stars — your refund is identical. fayr pays for a real opinion, not a good one."],
  ["Why claim before buying?", "Claiming reserves one of the limited slots for you. Your slot is held for a short window so someone else can't take it while you shop."],
  ["What if I miss my purchase window?", "Your slot is released back to the drop — nothing is charged and nothing is lost. If slots remain, you can claim again."],
  ["Which purchase counts?", "The exact product and variant shown here, bought from your own account on the listed marketplace, within your reserved window."],
];
// Placeholder hero model (the reference soda-can GLB) — every campaign points
// here until a real per-product .glb is supplied via c.model. It is a genuine
// 3D model rendered by <model-viewer> (neutral-env lighting + reflections),
// not a flat image.
const HERO_MODEL = "./models/hero-soda.glb"; // self-hosted in web-preview/ (decoded from Draco → plain glTF); no external/login-gated fetch

function Detail({ go, c, enrolled, claimed, claim, buyNow, linked }) {
  // Campaign detail as a premium product reveal. The product is a REAL 3D model
  // (<model-viewer>) that idle-spins, floats, tilts toward the cursor and picks
  // up neutral-environment lighting + reflections. As you scroll, it recedes
  // and dissolves BEHIND the rising content sheet — it is never pinned. Fully
  // reversible. One rAF drives the orbit + scroll transforms.
  const isClaimed = !!(claimed || {})[c.id];
  const [faqOpen, setFaqOpen] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [resv, setResv] = useState(25 * 60 + 35);
  useEffect(() => { if (!isClaimed) return; const id = setInterval(() => setResv((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(id); }, [isClaimed]);
  const m = MARKETPLACES[c.marketplace];
  const brand = c.product.split(" ")[0];
  const th = PROD_THEMES[c.theme] || PROD_THEMES.oil;
  const rgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const HERO = { oil: ["#2f6b3d", "#0f3a20"], toothpaste: ["#4a2f8f", "#1c1140"], bodywash: ["#9a3f68", "#38131f"], umbrella: ["#2b5f9e", "#0f2842"], earbuds: ["#2a3550", "#0c1120"], facewash: ["#a13c6d", "#3a1226"], snacks: ["#7c4a1f", "#2f1a0a"] };
  const hero = HERO[c.theme] || HERO.oil;
  const lighten = (h, amt) => { const [r0, g0, b0] = rgb(h); const mx = (v) => Math.round(v + (255 - v) * amt); return "rgb(" + mx(r0) + "," + mx(g0) + "," + mx(b0) + ")"; };
  const accent = lighten(hero[0], 0.5);
  const gl = rgb(hero[0]).map((v) => Math.min(255, v + 64));   // brighter halo behind the product
  const rating = (4.5 + ((c.joined % 40) / 100)).toFixed(1);
  const model = c.model || HERO_MODEL;

  const rootRef = useRef(null);
  const mvRef = useRef(null);
  const ds = useRef(0);
  const spin = useRef(0);
  const mouse = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  const lastT = useRef(0);
  const t0 = useRef(performance.now());

  const SPACER = 470;

  useEffect(() => {
    const onMove = (e) => { mouse.current.x = (e.clientX / window.innerWidth) - 0.5; mouse.current.y = (e.clientY / window.innerHeight) - 0.5; };
    window.addEventListener("mousemove", onMove);
    let raf;
    const q = (sel) => rootRef.current && rootRef.current.querySelector(sel);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const root = rootRef.current; if (!root) return;
      const now = performance.now();
      const t = (now - t0.current) / 1000;
      const dt = Math.min(now - (lastT.current || now), 50); lastT.current = now;
      const enter = 1 - Math.pow(1 - Math.min((now - t0.current) / 820, 1), 3);
      const par = Math.max(0, Math.min(ds.current / (SPACER * 0.62), 1));

      cur.current.x += (mouse.current.x - cur.current.x) * 0.05;
      cur.current.y += (mouse.current.y - cur.current.y) * 0.05;
      spin.current = (spin.current + (dt / 1000) * 16) % 360;   // idle rotation
      const mv = mvRef.current;
      if (mv && mv.cameraOrbit !== undefined) {
        mv.cameraOrbit = (spin.current + cur.current.x * 26).toFixed(1) + "deg " + (84 + cur.current.y * 12).toFixed(1) + "deg 128%";
      }

      const floatY = (-6 * Math.sin(t * 0.6) - 3 * Math.sin(t * 0.24 + 0.7)) * enter;
      const prod = q("[data-c=prod]");
      if (prod) {
        const scale = (0.86 + 0.14 * enter) * (1 - 0.16 * par);
        prod.style.opacity = (enter * (1 - Math.min(par * 1.35, 1))).toFixed(3);
        prod.style.transform = "translate(-50%,-50%) translateY(" + (floatY - par * 46).toFixed(1) + "px) rotate(11deg) scale(" + scale.toFixed(4) + ")";
      }
      const gw = q("[data-c=glow]"); if (gw) { gw.style.opacity = ((0.66 + 0.14 * Math.sin(t * 0.5)) * enter * (1 - par)).toFixed(3); gw.style.transform = "translate(-50%,-50%) scale(" + ((1 + 0.05 * Math.sin(t * 0.45)) * (1 - 0.3 * par)).toFixed(3) + ")"; }
      const orb = q("[data-c=orbitring]"); if (orb) orb.style.transform = "rotateZ(" + (-spin.current * 1.35).toFixed(1) + "deg)";
      const orbW = q("[data-c=orbit]"); if (orbW) orbW.style.opacity = (enter * (1 - Math.min(par * 1.5, 1))).toFixed(3);
      const psh = q("[data-c=pshadow]"); if (psh) { psh.style.opacity = (0.5 * enter * (1 - Math.min(par * 1.4, 1))).toFixed(3); psh.style.transform = "translateX(-50%) translateY(" + (par * 30).toFixed(1) + "px) scaleX(" + (1 - 0.12 * Math.sin(t * 0.6)).toFixed(3) + ")"; }
      const fade = (sel, delay) => { const el = q(sel); if (!el) return; const e2 = 1 - Math.pow(1 - Math.max(0, Math.min((enter - delay) / (1 - delay), 1)), 3); el.style.opacity = (e2 * (1 - Math.min(par * 1.8, 1))).toFixed(3); el.style.transform = "translateY(" + ((1 - e2) * 16 + par * -10).toFixed(1) + "px)"; };
      fade("[data-c=sideL]", 0.3); fade("[data-c=sideR]", 0.45); fade("[data-c=meta]", 0.55);
      const bg = q("[data-c=bg]"); if (bg) bg.style.opacity = (1 - par * 0.7).toFixed(3);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", onMove); };
  }, [c.id]);

  const onScroll = (e) => { ds.current = e.target.scrollTop; };
  const doClaim = () => { if (loading) return; setLoading(true); setTimeout(() => { setLoading(false); (isClaimed ? buyNow : claim)(c); }, 720); };

  const steps = [
    ["🛍️", "Claim your product", "Reserves this product for you for 48 hours."],
    ["📦", "Buy on " + m.name, "as you always do — from your own account."],
    ["🧾", "Submit order details", "Order ID + invoice, under a minute."],
    ["⭐", "Share your fayr feedback", "An honest review once you've tried it."],
    ["💸", "Get your refund", "After the return window closes. Straight to your wallet."],
  ];

  return (
    <Screen noPad bg="#FBFBEF">
      <div ref={rootRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {/* z0 — hero backdrop + light */}
        <div data-c="bg" style={{ position: "absolute", top: 0, left: 0, right: 0, height: SPACER + 60, background: "radial-gradient(135% 88% at 50% 26%, " + hero[0] + " 0%, " + hero[1] + " 76%)" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 34% at 50% 8%, rgba(255,255,255,.14), rgba(255,255,255,0) 70%)" }} />
        </div>

        {/* z1 — the 3D product stage (BEHIND the sheet, so it recedes as content rises) */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: SPACER, zIndex: 1, pointerEvents: "none" }}>
          <div data-c="glow" style={{ position: "absolute", left: "52%", top: 360, width: 324, height: 324, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle at 50% 44%, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",.55) 0%, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",.16) 46%, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",0) 70%)" }} />
          <div data-c="pshadow" style={{ position: "absolute", left: "52%", top: 470, transform: "translateX(-50%)", width: 168, height: 26, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,0,0,.42), rgba(0,0,0,0) 70%)", filter: "blur(2px)" }} />

          <div data-c="sideL" style={{ position: "absolute", left: 22, top: 96, width: 190 }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 10.5, letterSpacing: ".16em", color: accent }}>{(c.ribbon || "FEATURED").toUpperCase()}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24, color: "#fff", lineHeight: 1.14, marginTop: 10, letterSpacing: "-.02em", textWrap: "balance", textShadow: "0 2px 16px rgba(0,0,0,.35)" }}>{c.product}</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: "rgba(255,255,255,.72)", marginTop: 10 }}>{brand} · {c.variant}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 12, background: "rgba(255,255,255,.94)", borderRadius: 20, padding: "5px 12px", boxShadow: "0 6px 16px rgba(0,0,0,.22)", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 12, color: C.ink }}>★ {rating} <span style={{ color: "#8a8574", fontWeight: 600 }}>({(c.joined / 1000).toFixed(1)}k)</span></div>
          </div>

          <div data-c="sideR" style={{ position: "absolute", right: 18, top: 96, width: 138, height: 340, display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", textAlign: "right" }}>
            <div style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 14, padding: "9px 12px", backdropFilter: "blur(6px)" }}>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 9.5, letterSpacing: ".12em", color: "rgba(255,255,255,.6)" }}>REFUND</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16, color: "#8bf0ad", marginTop: 3 }}>{c.pct}% · ₹{c.maxBack}</div>
            </div>
            {[["PLATFORM", m.name, "#ffffff"], ["SLOTS LEFT", c.slots + " of " + c.seats, "#ffffff"], ["ENDS IN", c.days + " days", "#ffb066"]].map(([k, v, col]) => (
              <div key={k} style={{ paddingTop: 11, borderTop: "1px solid rgba(255,255,255,.14)" }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 9.5, letterSpacing: ".12em", color: "rgba(255,255,255,.55)" }}>{k}</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: col, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>

          <div data-c="prod" style={{ position: "absolute", left: "52%", top: 320, width: 236, height: 300, transform: "translate(-50%,-50%)", willChange: "transform, opacity" }}>
            <model-viewer
              ref={(el) => { mvRef.current = el; }}
              src={model}
              alt={c.product}
              environment-image="neutral"
              loading="eager"
              reveal="auto"
              exposure="1.25"
              shadow-intensity="0.9"
              shadow-softness="1"
              interaction-prompt="none"
              disable-zoom
              camera-orbit="0deg 84deg 128%"
              field-of-view="28deg"
              style={{ width: "100%", height: "100%", "--progress-bar-color": "transparent", "--poster-color": "transparent", backgroundColor: "transparent" }}>
            </model-viewer>
          </div>

          <div data-c="orbit" style={{ position: "absolute", left: "52%", top: 416, width: 296, height: 296, transform: "translate(-50%,-50%) rotateX(74deg)", transformStyle: "preserve-3d", pointerEvents: "none", willChange: "opacity" }}>
            <div data-c="orbitring" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",0) 150deg, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",.85) 300deg, rgba(240,255,225,.98) 345deg, rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",0) 360deg)", WebkitMaskImage: "radial-gradient(closest-side, transparent 69%, #000 73%, #000 93%, transparent 98%)", maskImage: "radial-gradient(closest-side, transparent 69%, #000 73%, #000 93%, transparent 98%)", filter: "blur(2.5px)" }} />
          </div>
        </div>

        {/* z2 — the scroller: transparent hero spacer, then the bottom sheet */}
        <div className="fayr-scroll" onScroll={onScroll} style={{ position: "absolute", inset: 0, zIndex: 2, overflowY: "auto" }}>
          <div style={{ height: SPACER, flex: "none", pointerEvents: "none" }} />
          <div style={{ position: "relative", background: "#FBF8F0", borderRadius: "28px 28px 0 0", boxShadow: "0 -16px 34px rgba(0,0,0,.16)", minHeight: 640, padding: "10px 18px 150px" }}>
            <div style={{ width: 42, height: 5, borderRadius: 9, background: "rgba(28,26,21,.16)", margin: "0 auto 4px" }} />
            <div style={{ textAlign: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12.5, color: "#a29b8a", letterSpacing: ".02em", marginBottom: 18 }}>Campaign details</div>

            <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
              <div style={{ flex: 1, background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 16, padding: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: "#8a8574", lineHeight: 1.25 }}>Slots<br />Remaining</div>
                <div style={{ marginTop: 9, display: "inline-flex", alignItems: "center", gap: 5, background: "#F2E9FD", borderRadius: 20, padding: "4px 10px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.purple }}>👥 {c.slots} left</div>
                <div style={{ height: 5, borderRadius: 6, background: "#efece3", overflow: "hidden", marginTop: 11 }}><div style={{ width: Math.round((c.filled / c.seats) * 100) + "%", height: "100%", background: "linear-gradient(90deg,#FF8A3D,#FF6A3D)" }} /></div>
              </div>
              <div style={{ flex: 1, background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 16, padding: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: "#8a8574", lineHeight: 1.25 }}>Time<br />Remaining</div>
                <div style={{ marginTop: 9, display: "inline-flex", alignItems: "center", gap: 5, background: "#FDEEDE", borderRadius: 20, padding: "4px 10px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: "#d0642e" }}>⏰ {c.days} days left</div>
              </div>
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 6px" }}>Campaign overview</div>
            <p style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 13.5, lineHeight: 1.55, color: "#6b6555", margin: "0 0 22px", textWrap: "pretty" }}>Buy the {c.product} on {m.name} as you normally would, submit your order details, and get {c.pct}% back — up to ₹{c.maxBack} — straight to your fayr Wallet once the return window closes.</p>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 8px" }}>How it works</div>
            <div style={{ marginBottom: 22 }}>
              {steps.map(([ic, ti, su], i) => (
                <div key={ti} style={{ display: "flex", gap: 13, alignItems: "flex-start", position: "relative", paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
                  {i < steps.length - 1 && <span style={{ position: "absolute", left: 20, top: 42, bottom: 2, borderLeft: "2px dashed #E4E5D6" }} />}
                  <div style={{ width: 42, height: 42, borderRadius: 13, flex: "0 0 auto", display: "grid", placeItems: "center", fontSize: 19, background: ["#FDEBF0", "#EAF2FF", "#EAE7FD", "#F2E9FD", "#E9F7E4"][i] }}>{ic}</div>
                  <div style={{ paddingTop: 2 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{ti}</div>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 12.5, color: "#7b7565", marginTop: 2, lineHeight: 1.4 }}>{su}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, background: "#FFF7DF", border: "1px solid #F2E6BD", borderRadius: 14, padding: "12px 14px" }}>
                <LogoMark size={22} />
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: "#4a463c" }}>Your refund is credited to your <b style={{ color: C.ink }}>fayr Wallet</b></span>
              </div>
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 12px" }}>Eligibility &amp; requirements</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 22 }}>
              {["Your " + m.name + " account must use the same mobile number or email registered on fayr.", "Exact product & variant only — " + c.variant + ".", "One entry per user · slots are first come, first served.", "Order & delivery are verified from your marketplace emails or uploaded screenshots."].map((e2) => (
                <div key={e2} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 18px", width: 18, height: 18, borderRadius: "50%", background: "#e2f3e6", color: "#1f7a3d", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800 }}>✓</span>
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 13.5, lineHeight: 1.5, color: "#6b6555" }}>{e2}</span>
                </div>
              ))}
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 10px" }}>How to purchase</div>
            <p style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 13.5, lineHeight: 1.55, color: "#6b6555", margin: "0 0 12px" }}>We open the {m.name} homepage — you search and buy the exact product yourself, from your own account. No affiliate or tracking links.</p>
            <div style={{ background: "#FBF3DD", borderRadius: 14, padding: "2px 15px", marginBottom: 12 }}>
              {[["Product", c.product], ["Brand", brand], ["Variant / size", c.variant], ["Marketplace", m.name]].map(([k, v], i, a) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: i < a.length - 1 ? "1px solid rgba(0,0,0,.06)" : "none" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500, color: "#7b7565" }}>{k}</span>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.ink, textAlign: "right", maxWidth: "62%" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, color: "#d0422e", marginBottom: 22 }}>
              <span>⚠️</span><span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, lineHeight: 1.45 }}>Buy only this exact product &amp; variant. Any other product, size or seller won't be eligible.</span>
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 10px" }}>Frequently asked</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 22 }}>
              {FAQS.map(([q2, a2], i) => (
                <div key={i} onClick={() => setFaqOpen(faqOpen === i ? -1 : i)} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 14, padding: "14px 15px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>{q2}</span>
                    <span style={{ color: "#a8a08e", transform: faqOpen === i ? "rotate(180deg)" : "none", transition: "transform .25s", flex: "0 0 auto" }}>⌄</span>
                  </div>
                  {faqOpen === i && <p style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 13, color: "#6b6555", margin: "10px 0 0", lineHeight: 1.55, animation: "fayr-rise .25s ease both" }}>{a2}</p>}
                </div>
              ))}
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.ink, margin: "0 0 12px" }}>Terms &amp; conditions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {/* Operator-authored T&C (one rule per line) when the campaign has
                  them; otherwise the app's default rule set. */}
              {(c.terms
                ? c.terms.split("\n").map((l) => l.trim()).filter(Boolean)
                : ["Your " + m.name + " account must match your fayr number or email.", "Buy the exact product & variant only: " + c.variant + ".", "One entry per user.", "Reviews must be genuine — your rating never affects your refund.", "Refund releases after the marketplace return window closes."]).map((r) => (
                <div key={r} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 5px", width: 5, height: 5, borderRadius: "50%", background: "#c7bfa9", marginTop: 8 }} />
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 450, fontSize: 13.5, lineHeight: 1.5, color: "#6b6555" }}>{r}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              {[["🔒", "Password never seen"], ["🧾", "Refund tracked upfront"], ["⭐", "Any rating pays same"]].map(([ic, ti]) => (
                <div key={ti} style={{ flex: 1, background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 14, padding: "14px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 18 }}>{ic}</div>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: "#6b6555", marginTop: 6, lineHeight: 1.3 }}>{ti}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* z6 — header (back only; no marketplace logo) */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 6, display: "flex", alignItems: "center", padding: "44px 16px 0", pointerEvents: "none" }}>
          <button onClick={() => go("home")} style={{ pointerEvents: "auto", width: 40, height: 40, borderRadius: "50%", border: "none", background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,.16)", color: C.ink, fontSize: 18, cursor: "pointer" }}>⌄</button>
        </div>

        {/* z8 — sticky claim */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 8, padding: "14px 16px 26px", background: "linear-gradient(to top, #FBFBEF 74%, rgba(251,251,239,0))" }}>
          {isClaimed && (
            <div style={{ textAlign: "center", marginBottom: 8, fontFamily: FONT_DISPLAY, fontWeight: 800, fontStyle: "italic", fontSize: 13.5 }}>
              <span style={{ background: C.ink, color: "#fff", borderRadius: 5, padding: "2px 8px" }}>Slot Reserved</span> <span style={{ color: C.red }}>{Math.floor(resv / 60)}m : {String(resv % 60).padStart(2, "0")}s</span>
            </div>
          )}
          <button onClick={doClaim} disabled={loading}
            onMouseDown={(e) => !loading && (e.currentTarget.style.transform = "scale(.975)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            style={{ width: "100%", border: "none", borderRadius: 22, padding: "16px 0", background: isClaimed ? "linear-gradient(to bottom,#2E9E00,#1D7400)" : C.ink, color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15.5, cursor: loading ? "default" : "pointer", boxShadow: isClaimed ? "0 12px 26px rgba(46,158,0,.34)" : "0 12px 26px rgba(20,20,20,.28)", transition: "transform .12s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            {loading
              ? <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2.5px solid rgba(255,255,255,.35)", borderTopColor: "#fff", animation: "fayr-spin .7s linear infinite" }} />
              : <span>{isClaimed ? "Buy on " + m.name + " →" : "Claim Campaign →"}</span>}
          </button>
          <div style={{ textAlign: "center", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11, color: "#a8a08e", marginTop: 9 }}>{isClaimed ? "Complete your purchase to start earning" : "Claiming reserves your slot for 48 hours"}</div>
        </div>
      </div>
    </Screen>
  );
}

/* "Product Claimed!" sheet — screenshot 18 */
function ClaimedSheet({ go, c, buyNow }) {
  const [t, setT] = useState(25 * 60 + 35);
  useEffect(() => { const id = setInterval(() => setT((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(id); }, []);
  const m = MARKETPLACES[c.marketplace];
  return (
    <Screen noPad bg="#FBFBEF">
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,20,20,.5)", backdropFilter: "blur(2px)" }} onClick={() => go("detail")} />
      <div style={{ flex: 1 }} onClick={() => go("detail")} />
      <div style={{ position: "relative", margin: "0 14px 26px", background: "linear-gradient(180deg,#FDF6C9,#FFFDF2)", borderRadius: 22, padding: "22px 20px 24px", animation: "fayr-rise .35s cubic-bezier(.22,.61,.36,1) both", textAlign: "center", boxShadow: "0 -10px 40px rgba(0,0,0,.25)" }}>
        <div style={{ width: 44, height: 4, background: "#E5DCA6", borderRadius: 4, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 52, animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>✔️</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24, color: C.ink, margin: "10px 0 0" }}>Product Claimed!</h2>
        <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: C.sub, margin: "8px auto 0", maxWidth: 280, lineHeight: 1.55 }}>
          This product is yours for the next <b style={{ color: C.ink }}>2 hours</b>. Buy it on {m.name} before the timer runs out.
        </p>
        <div style={{ margin: "12px auto 0", display: "inline-flex", alignItems: "center", gap: 6, background: "#FFF3D6", border: "1px solid #EAD79A", borderRadius: 100, padding: "5px 13px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: "#8a6d10" }}>🎟 5 tickets held · returned if the claim expires</div>
        <div style={{ margin: "16px auto 0", background: "#FFE9E6", borderRadius: 12, padding: "12px 14px", maxWidth: 250 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontStyle: "italic", fontSize: 26, color: C.red, letterSpacing: ".02em" }}>{Math.floor(t / 60)}m : {String(t % 60).padStart(2, "0")}s</div>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11, color: "#8f6a63", marginTop: 2 }}>Remaining</div>
        </div>
        <div style={{ marginTop: 18 }}>
          <Pill onClick={() => buyNow(c)} style={{ borderRadius: 16, background: "linear-gradient(to bottom,#2E9E00,#1D7400)", boxShadow: "0 10px 22px rgba(46,158,0,.35)" }}>
            Go to {m.name} →
          </Pill>
        </div>
        <TextBtn onClick={() => go("detail")}>I'll buy in a bit</TextBtn>
      </div>
    </Screen>
  );
}

/* "Taking you to Amazon…" — redirects to the marketplace HOMEPAGE.
   User searches and buys the exact product themselves (no deep link / UTM). */
function RedirectScreen({ go, c, afterRedirect }) {
  const m = MARKETPLACES[c.marketplace];
  const link = marketplaceHome(c.marketplace);
  const specs = [["Product", c.product], ["Brand", c.product.split(" ")[0]], ["Variant / size", c.variant], ["Marketplace", m.name]];
  return (
    <Screen bg="#FBFBEF">
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px 24px 12px", position: "relative" }}>
        <GridFloor style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 180, transform: "scaleY(-1)", opacity: .5 }} />
        <div style={{ textAlign: "center", position: "relative", paddingTop: 6 }}>
          <h1 style={{ ...hTitle, fontSize: 23 }}>Taking you to {m.name}…</h1>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 18 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: "10px 16px", boxShadow: "0 6px 16px rgba(0,0,0,.08)" }}><Wordmark size={22} /></div>
            <span style={{ fontSize: 18, color: "#b9baa9", letterSpacing: "-4px" }}>»»</span>
            <div style={{ background: "#fff", borderRadius: 14, padding: "8px 12px", boxShadow: "0 6px 16px rgba(0,0,0,.08)" }}><BrandLogo mid={c.marketplace} size={34} /></div>
          </div>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.sub, marginTop: 14, lineHeight: 1.55 }}>
            We'll open the <b style={{ color: C.ink }}>{m.name} homepage</b>. Search for the exact product below and buy it from your own account.
          </p>
        </div>

        {/* How to purchase — exact product identity */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 15, boxShadow: "0 4px 12px rgba(20,20,20,.06)", marginTop: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 }}>How to purchase</div>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, margin: "0 0 12px", lineHeight: 1.5 }}>Only the exact product below is eligible for verification and refund. Buying any other product or variant will not qualify.</p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", background: c.heroBg, borderRadius: 12, padding: 10, marginBottom: 12 }}>
            <ProductArt theme={c.theme} cid={c.id} radius={9} style={{ width: 52, height: 52, flex: "0 0 auto", background: "transparent" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13, color: C.ink, lineHeight: 1.3 }}>{c.product}</div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 10.5, color: C.refundInk, marginTop: 3 }}>{c.pct}% Refund · up to ₹{c.maxBack}</div>
            </div>
          </div>
          {specs.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < specs.length - 1 ? `1px solid ${C.line}` : "none", fontFamily: FONT_BODY, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: C.sub }}>{k}</span><span style={{ fontWeight: 700, color: C.ink, textAlign: "right", maxWidth: "60%" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, background: "#FFF8E1", border: `1px solid ${C.amberLine}`, borderRadius: 10, padding: "9px 11px" }}>
            {["Search this exact product name on the " + m.name + " homepage", "Match the brand, variant and size shown above", "Buy from the account linked to fayr", "Don't buy a different product, size or seller — it won't qualify"].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0", fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: "#7a5a10", lineHeight: 1.45 }}>
                <span style={{ fontWeight: 800 }}>{i + 1}.</span><span>{s}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { try { window.open(link, "_blank", "noopener,noreferrer"); } catch (e) {} }}
            style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "11px", fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: C.greenDeep, cursor: "pointer" }}>
            🔗 Opens {link}
          </button>
        </div>
      </div>
      <div style={{ padding: "8px 24px 16px" }}>
        <Pill onClick={() => { try { window.open(link, "_blank", "noopener,noreferrer"); } catch (e) {} afterRedirect(c); }} color={m.color} text={m.inkOn}>OPEN {m.name.toUpperCase()} HOMEPAGE →</Pill>
        <TextBtn onClick={() => go("myproducts")}>I'll buy later — remind me</TextBtn>
        <p style={{ textAlign: "center", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 9.5, letterSpacing: "1.8px", color: "#b0b1a2", marginTop: 4 }}>SECURE FAYR TRACKING · NO AFFILIATE LINKS</p>
      </div>
    </Screen>
  );
}
function LinkAccount({ go, c, linked, linkAccount }) {
  const m = MARKETPLACES[c.marketplace];
  const url = marketplaceHome(c.marketplace);
  // REAL connection, browser-adapted. The native app connects by loading the
  // marketplace in an in-app WebView (react-native-webview) and capturing the
  // logged-in session cookie — that native module can't run on the web, so this
  // prototype opens the SAME marketplace in a browser tab where the user actually
  // logs in, then returns to continue. window.open fires straight off the click
  // gesture, so it is NOT popup-blocked (the old code never opened anything — it
  // only ran a fake "confirming…" timer, which is why nothing happened).
  const [phase, setPhase] = useState("intro"); // intro | opened
  const openMarketplace = () => { try { window.open(url, "_blank", "noopener,noreferrer"); } catch (e) {} };
  const connect = () => { openMarketplace(); setPhase("opened"); };
  const finishConnect = () => { linkAccount(c.marketplace); go("redirect"); };
  const points = [
    ["🛡️", "Protects your refunds", `Makes sure only you can claim refunds against your ${m.name} purchases — no one else can.`],
    ["🤝", "Keeps campaigns fair", "Confirms one real person per claim, so bots and duplicates don't take the slots."],
    ["⚡", "Just once", `Confirm once — every future ${m.name} campaign skips this entirely.`],
  ];
  return (
    <Screen>
      <TopBar title="Connect your account" onBack={() => go("detail")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 22px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
          <BrandLogo mid={c.marketplace} size={54} />
          <div>
            <h1 style={{ ...hTitle, fontSize: 22 }}>Connect your<br />{m.name} account</h1>
          </div>
        </div>
        {/* Mandatory-step banner: this is the required gate before the purchase
            journey — the user cannot reach the marketplace without connecting. */}
        <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7, background: "#FFF3D6", border: "1px solid #EAD79A", borderRadius: 100, padding: "5px 12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11.5, color: "#8a6d10" }}>🔒 Required before you can buy</div>
        <p style={{ ...hSub, marginTop: 12 }}>Before you shop on {m.name}, connect the account you'll buy from — the one using your fayr number or email. This is a <b style={{ color: C.ink2 }}>one-time, required step</b>; you can't continue to the purchase without it.</p>

        {/* prominent reassurance banner — what we DON'T do */}
        <div style={{ marginTop: 16, background: "linear-gradient(135deg,#EAF2FF,#F3F8FF)", border: "1px solid #CBE0FF", borderRadius: 16, padding: "13px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: "#2F6FD0", marginBottom: 8 }}>🔒 What we never do</div>
          {[`See or store your ${m.name} password`, "Access, read, or place your orders", "Touch anything beyond confirming it's you"].map((t) => (
            <div key={t} style={{ display: "flex", gap: 8, padding: "3px 0", fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: "#3a5478", lineHeight: 1.45 }}>
              <span style={{ color: "#2F6FD0", fontWeight: 800 }}>✕</span><span>{t}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {points.map(([i, t, s]) => (
            <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#fff", borderRadius: 14, padding: 13, boxShadow: "0 4px 12px rgba(20,20,20,.05)" }}>
              <span style={{ fontSize: 19 }}>{i}</span>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink2 }}>{t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginTop: 2, lineHeight: 1.45 }}>{s}</div>
              </div>
            </div>
          ))}
        </div>
        {phase === "opened" && (
          <div style={{ marginTop: 14, background: "#F1FAEC", border: "1px solid #CDE9BE", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: C.greenDeep, marginBottom: 4 }}>✓ {m.name} opened in a new tab</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, lineHeight: 1.5 }}>
              Log in to {m.name} there with your fayr mobile number (sign in if it asks). Once you're logged in, come back and tap <b style={{ color: C.ink2 }}>I've logged in — continue</b>.
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        {phase === "intro" ? (
          <Pill onClick={connect} color={m.color} text={m.inkOn}>
            CONNECT MY {m.name.toUpperCase()} ACCOUNT →
          </Pill>
        ) : (
          <>
            <Pill onClick={finishConnect} color="linear-gradient(to bottom,#2E9E00,#1D7400)">
              I'VE LOGGED IN — CONTINUE →
            </Pill>
            <TextBtn onClick={openMarketplace}>Didn't open? Open {m.name} again</TextBtn>
          </>
        )}
        {/* MANDATORY: no "skip / not now" here. Connecting (open the marketplace,
            log in, continue) is the only way forward. The back arrow (top-left)
            just cancels back to the campaign — it never reaches checkout. */}
        <div style={{ textAlign: "center", marginTop: 9, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 10.5, color: C.sub, lineHeight: 1.4 }}>
          Connecting your {m.name} account is required to continue your purchase.
        </div>
      </div>
    </Screen>
  );
}

function ConfirmJoin({ go, c, tickets, commit }) {
  const [ack, setAck] = useState(false);
  const enough = tickets.balance >= 5;
  const [result, setResult] = useState(null); // null | "insufficient"
  useEffect(() => { if (!enough) setResult("insufficient"); }, [enough]);
  const join = () => {
    if (!enough) { setResult("insufficient"); return; }
    // Flow 5: race/failure simulation hooks exist in dev menu; happy path here.
    commit(c);
  };
  return (
    <Screen>
      <TopBar title="Confirm participation" onBack={() => go("detail")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        <CardBox style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <ProductArt theme={c.theme} cid={c.id} style={{ width: 56, height: 56, flex: "0 0 auto" }} radius={12} />
          <div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.ink2 }}>Review {c.product}</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: C.sub, marginTop: 2 }}>{MARKETPLACES[c.marketplace].name} · exact variant: {c.variant}</div>
            <div style={{ marginTop: 5, display: "flex", gap: 6 }}><Badge k="open" /><span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 11, color: C.greenDeep }}>₹{c.maxBack} max</span></div>
          </div>
        </CardBox>
        <CardBox style={{ marginTop: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.ink2, marginBottom: 8 }}>Your refund</div>
          <Row a="Refund" b={`${c.pct}% of what you pay`} />
          <Row a="Maximum" b={`₹${c.maxBack}`} last />
        </CardBox>
        <CardBox style={{ marginTop: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.ink2, marginBottom: 8 }}>Tickets</div>
          <Row a="This claim uses" b={`5 tickets`} />
          <Row a="Your balance after" b={`${tickets.balance - 5} tickets`} last />
          <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.sub, marginTop: 8 }}>5 tickets are deducted now. They return if your claim expires before you buy.</p>
        </CardBox>
        <CardBox style={{ marginTop: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.ink2, marginBottom: 6 }}>Deadline</div>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>Buy the product within <b style={{ color: C.ink2 }}>48 hours</b> of joining — by 6 Jul, 6:00 PM.</p>
        </CardBox>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: C.green }} />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>I'll write an honest review. I understand my rating never affects my refund.</span>
        </label>
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        <Pill onClick={join} disabled={!ack} color={ack ? C.ink : "#cfcfcf"}>CONFIRM & JOIN</Pill>
      </div>

      {result === "insufficient" && <InsufficientSheet go={go} c={c} tickets={tickets} onClose={() => go("detail")} />}
    </Screen>
  );
}
const Row = ({ a, b, last }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: last ? "none" : `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 13 }}>
    <span style={{ fontWeight: 600, color: C.sub }}>{a}</span><span style={{ fontWeight: 800, color: C.ink2 }}>{b}</span>
  </div>
);
function InsufficientSheet({ go, c, tickets, onClose }) {
  const need = 5 - tickets.balance;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,20,20,.45)" }} onClick={onClose} />
      <div style={{ flex: 1 }} />
      <div style={{ position: "relative", background: C.cream, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: "22px 22px 24px", animation: "fayr-rise .35s cubic-bezier(.22,.61,.36,1) both" }}>
        <h2 style={{ ...hTitle, fontSize: 21 }}>You need {need} more ticket{need > 1 ? "s" : ""}</h2>
        <p style={hSub}>This claim needs 5 tickets. You have {tickets.balance} available.</p>
        <CardBox style={{ marginTop: 14 }}>
          <Row a="Available" b={`${tickets.balance} tickets`} />
          <Row a="Held in active claims" b={`${Object.values(tickets.held||{}).reduce((s,n)=>s+n,0)} tickets`} last />
        </CardBox>
        <p style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.sub, marginTop: 10 }}>Held tickets return automatically if a claim expires before you buy.</p>
        <div style={{ marginTop: 8, background: C.greenBg, border: `1px solid #1FD75D`, borderRadius: 12, padding: "10px 12px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: C.greenDeep }}>
          Complete a campaign to earn tickets back →
        </div>
        <div style={{ marginTop: 14 }}><Pill onClick={() => go("campaigns")}>GO TO MY PRODUCTS</Pill></div>
        <TextBtn onClick={onClose}>Not now</TextBtn>
      </div>
    </div>
  );
}
function SeatLost({ go }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>🪑</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>That was the last seat</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>Someone got there just before you. <b style={{ color: C.ink2 }}>Your tickets were not used.</b></p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => go("waitlisted")}>JOIN THE WAITLIST</Pill>
        <TextBtn onClick={() => go("home")}>Explore similar campaigns</TextBtn>
      </div>
    </Screen>
  );
}
function EnrollFailed({ go, retry }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>⚠️</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>Something went wrong</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>Your enrollment didn't go through. <b style={{ color: C.ink2 }}>No tickets were used.</b></p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={retry}>TRY AGAIN</Pill>
        <TextBtn onClick={() => go("detail")}>Back to campaign</TextBtn>
      </div>
    </Screen>
  );
}
function EnrollSuccess({ go, c, notifAsked }) {
  const next = notifAsked ? "buyinterstitial" : "notifprime"; // first-enrollment priming (Flow 5 → 20.1)
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        <MilestoneCelebration tone="green" icon="🎯" eyebrow="Slot reserved" title="You're in!"
          sub="Step 1: buy the product by 6 Jul, 6:00 PM. We'll remind you before the deadline." />
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => go(next)}>BUY NOW</Pill>
        <TextBtn onClick={() => go(notifAsked ? "campaigns" : "notifprime")}>Later — find it in My Products</TextBtn>
      </div>
    </Screen>
  );
}

/* ============================================================================
   NOTIFICATION PRIME — fires once, right after first enrollment (Flow 5→20.1).
   The ask lands when a real deadline exists; denial is never a wall.
   ========================================================================== */
function NotifPrime({ go, c, setNotifAsked, dest }) {
  const [done, setDone] = useState(false);
  const finish = (granted) => {
    setNotifAsked(true);
    setDone(true);
    setTimeout(() => go(dest || "buyinterstitial"), granted ? 500 : 250);
  };
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", fontSize: 40, boxShadow: "0 10px 24px rgba(0,0,0,.08)", animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>🔔</div>
        <h1 style={{ ...hTitle, marginTop: 20 }}>Want a reminder<br />before it expires?</h1>
        <p style={{ ...hSub, maxWidth: 285 }}>
          Your claim is held until <b style={{ color: C.ink2 }}>6 Jul, 6:00 PM</b>. We'll nudge you before it runs out, and let you know the moment your refund lands — so nothing slips.
        </p>
        {done && <p style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.green, marginTop: 14 }}>✓ Done</p>}
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => finish(true)} disabled={done}>REMIND ME</Pill>
        <TextBtn onClick={() => finish(false)}>No thanks</TextBtn>
        <p style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#a9aa9c", textAlign: "center", marginTop: 2 }}>Asked once. Declining never blocks anything.</p>
      </div>
    </Screen>
  );
}
function Waitlisted({ go }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>⏳</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>You're on the waitlist</h1>
        <p style={{ ...hSub, maxWidth: 280 }}>0 tickets to queue. If a seat opens we'll invite you — invites are time-boxed, so claim fast when it comes.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Pill onClick={() => go("home")}>BACK TO CAMPAIGNS</Pill></div>
    </Screen>
  );
}

/* ============================================================================
   FLOWS 6–12 · the 7-step journey: buy → proof(OCR) → delivery → review →
   review proof → under review → return window → reward
   ========================================================================== */
function BuyInterstitial({ go, c, advance }) {
  const m = MARKETPLACES[c.marketplace];
  const link = marketplaceHome(c.marketplace);
  const open = () => { try { window.open(link, "_blank", "noopener,noreferrer"); } catch (e) {} advance(c.id, 2, "upload your order proof"); go("returncatch"); };
  return (
    <Screen>
      <TopBar title="Before you go" onBack={() => go("detail")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        <CardBox>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15, color: C.ink2, marginBottom: 10 }}>Buy exactly this</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <ProductArt theme={c.theme} cid={c.id} style={{ width: 56, height: 56, flex: "0 0 auto" }} radius={12} />
            <div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.ink2 }}>{c.product}</div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: C.sub, marginTop: 2 }}>Variant: {c.variant}</div>
            </div>
          </div>
        </CardBox>
        <CardBox style={{ marginTop: 12 }}>
          {[["👤", `Use your own ${m.name} account`], ["💳", "Any payment method works"], ["🔎", "Opens the homepage — search & buy the exact product yourself"]].map(([i, t]) => (
            <div key={t} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.ink2 }}><span>{i}</span><span>{t}</span></div>
          ))}
        </CardBox>
        <div style={{ marginTop: 12, background: "#fff", border: `1px dashed ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#a9aa9c", letterSpacing: ".06em" }}>OPENS</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.greenDeep, wordBreak: "break-all", marginTop: 3 }}>{link}</div>
        </div>
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        <Pill onClick={open} color={m.color} text={m.inkOn}>OPEN {m.name.toUpperCase()} →</Pill>
      </div>
    </Screen>
  );
}
function ReturnCatch({ go, c }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <ProductArt theme={c.theme} cid={c.id} style={{ width: 92, height: 92 }} radius={20} />
        <h1 style={{ ...hTitle, marginTop: 18 }}>Did you buy it?</h1>
        <p style={{ ...hSub, maxWidth: 260 }}>Tell us once your {c.product} order is placed so we can move you to Step 2.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => go("proofprimer")}>I'VE PURCHASED ✓</Pill>
        <TextBtn onClick={() => go("campaigns")}>Not yet — remind me</TextBtn>
      </div>
    </Screen>
  );
}
function ProofPrimer({ go, c, gmail }) {
  const m = MARKETPLACES[c.marketplace];
  return (
    <Screen>
      <TopBar title="Order proof" onBack={() => go("campaigns")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        {/* Gmail auto-verify — the moment-of-need ask; explains scope in one line */}
        <div onClick={() => go(gmail.connected ? "ocrconfirm" : "emailconnect")}
          style={{ display: "flex", alignItems: "center", gap: 12, background: gmail.connected ? C.greenBg : "#fff", border: `1.5px solid ${gmail.connected ? "#1FD75D" : C.line}`, borderRadius: 16, padding: "13px 14px", marginBottom: 14, cursor: "pointer", boxShadow: "0 4px 12px rgba(20,20,20,.05)" }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: gmail.connected ? "#fff" : C.creamDeep, display: "grid", placeItems: "center", fontSize: 20, flex: "0 0 auto" }}>📧</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13.5, color: C.ink2 }}>
              {gmail.connected ? "Gmail connected — verify automatically" : "Skip screenshots — connect Gmail"}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: C.sub, marginTop: 2, lineHeight: 1.45 }}>
              {gmail.connected ? "We found your order email. No upload needed." : `We read only order emails from ${m.name} & supported marketplaces — never personal mail.`}
            </div>
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: gmail.connected ? C.greenDeep : C.blue, flex: "0 0 auto" }}>{gmail.connected ? "Verify →" : "Connect"}</span>
        </div>
        <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#a9aa9c", margin: "0 0 12px" }}>or upload manually</div>

        <h1 style={{ ...hTitle, fontSize: 23 }}>Grab a screenshot of your order</h1>
        <p style={hSub}>From your <b style={{ color: C.ink2 }}>{m.name} orders page</b> — here's exactly what we need:</p>
        <div style={{ marginTop: 16, background: "#fff", borderRadius: 16, padding: 14, boxShadow: "0 4px 12px rgba(20,20,20,.05)" }}>
          {/* annotated sample */}
          <div style={{ border: `1.5px dashed ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 11, color: "#232f3e" }}>{m.emoji} {m.name} · Your Orders</div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
              <ProductArt theme={c.theme} cid={c.id} style={{ width: 44, height: 44 }} radius={9} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11.5, color: C.ink2 }}>{c.product}</div>
                <div style={{ position: "relative", display: "inline-block", marginTop: 4 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.ink2, background: "#FFF3B0", padding: "2px 6px", borderRadius: 5, border: `1.5px solid ${C.red}` }}>Order # 402-3925017-7784521</span>
                </div>
              </div>
            </div>
          </div>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: C.red, marginTop: 10 }}>⭕ The order ID must be visible — that's the circled bit.</p>
        </div>
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        <Pill onClick={() => go("proofupload")}>UPLOAD SCREENSHOT</Pill>
      </div>
    </Screen>
  );
}

/* ============================================================================
   EMAIL CONNECT — v2's S7, placed at the moment of need (order proof) and in
   Profile. Gmail OAuth proves ownership (no code); typed email → 6-digit code.
   ========================================================================== */
function EmailConnect({ go, c, gmail, setGmail, email, setEmail, returnTo }) {
  const [val, setVal] = useState(email || "");
  const [connecting, setConnecting] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  const typoFix = /@(gmial|gamil|gmali)\./.test(val) ? val.replace(/@(gmial|gamil|gmali)\./, "@gmail.") : null;
  const connectGmail = () => {
    if (connecting) return;
    setConnecting(true);
    // Simulated OAuth: ownership proven by Google token → no code needed.
    setTimeout(() => { setGmail({ connected: true }); setConnecting(false); go(returnTo || "ocrconfirm"); }, 1500);
  };
  const scopes = [
    ["🔎", "Marketplace order emails only", "Amazon, Flipkart, Meesho, Blinkit, Zepto, Instamart — purchase, delivery & return updates."],
    ["📥", "Read-only", "We can never send, delete, or edit anything."],
    ["🚫", "Never your personal mail", "Not read, not stored. Disconnect anytime in Profile."],
  ];
  return (
    <Screen>
      <TopBar title="Connect your inbox" onBack={() => go(returnTo === "profile" ? "profile" : "proofprimer")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 22px 22px" }}>
        <h1 style={{ ...hTitle, fontSize: 24 }}>Skip the screenshots?</h1>
        <p style={hSub}>Totally optional. Connect your inbox and we'll confirm your orders automatically — or keep uploading screenshots, whichever you prefer.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {scopes.map(([i, t, s]) => (
            <div key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#fff", borderRadius: 14, padding: 13, boxShadow: "0 4px 12px rgba(20,20,20,.05)" }}>
              <span style={{ fontSize: 19 }}>{i}</span>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink2 }}>{t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginTop: 2, lineHeight: 1.45 }}>{s}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <Pill onClick={connectGmail} disabled={connecting} color="#fff" text={C.ink2} style={{ border: `1.5px solid ${C.line}`, boxShadow: "0 4px 12px rgba(20,20,20,.06)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, background: "linear-gradient(90deg,#4285F4,#EA4335,#FBBC05,#34A853)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>G</span>
              {connecting ? "Opening Google…" : "Connect Gmail — instant verify"}
            </span>
          </Pill>
        </div>
        <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#a9aa9c", margin: "12px 0" }}>or verify by code</div>
        <div style={{ display: "flex", alignItems: "center", background: "#fff", border: `1.5px solid ${valid ? C.green : C.line}`, borderRadius: 14, padding: "12px 14px", transition: "border-color .2s" }}>
          <input type="email" placeholder="you@example.com" value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && (setEmail(val.trim().toLowerCase()), go("emailcode"))}
            style={{ border: "none", outline: "none", flex: 1, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14.5, color: C.ink2, background: "transparent" }} />
          {valid && <span style={{ color: C.green, fontWeight: 800 }}>✓</span>}
        </div>
        {typoFix && (
          <button onClick={() => setVal(typoFix)} style={{ alignSelf: "flex-start", marginTop: 8, background: C.purpleBg, border: "none", borderRadius: 8, padding: "6px 10px", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.purple, cursor: "pointer" }}>
            Did you mean {typoFix}?
          </button>
        )}
        <div style={{ marginTop: 12 }}>
          <Pill onClick={() => { setEmail(val.trim().toLowerCase()); go("emailcode"); }} disabled={!valid} color={valid ? C.ink : "#cfcfcf"}>SEND VERIFICATION CODE</Pill>
        </div>
        <TextBtn onClick={() => go(returnTo === "profile" ? "profile" : "proofprimer")}>{returnTo === "profile" ? "Maybe later" : "No thanks — I'll upload screenshots"}</TextBtn>
        <p style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#a9aa9c", textAlign: "center", lineHeight: 1.5 }}>You can connect or disconnect anytime in Profile. Gmail sign-in proves ownership instantly — the code is only for typed emails.</p>
      </div>
    </Screen>
  );
}

/* v2's S8 — 6-digit email code, typed-email path only */
function EmailCode({ go, email, setEmailVerified, returnTo }) {
  const N = 6;
  const [code, setCode] = useState(Array(N).fill(""));
  const refs = useRef(Array.from({ length: N }, () => React.createRef()));
  const [secs, setSecs] = useState(41);
  useEffect(() => {
    refs.current[0].current && refs.current[0].current.focus();
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const set = (i, v) => {
    v = v.replace(/\D/g, "").slice(-1);
    const c = [...code]; c[i] = v; setCode(c);
    if (v && i < N - 1) refs.current[i + 1].current.focus();
    if (c.every((x) => x)) setTimeout(() => { setEmailVerified(true); go(returnTo === "profile" ? "profile" : "proofprimer"); }, 350);
  };
  return (
    <Screen>
      <TopBar title="Check your inbox" onBack={() => go("emailconnect")} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 24px 24px" }}>
        <h1 style={{ ...hTitle, fontSize: 24 }}>Enter the 6-digit code</h1>
        <p style={hSub}>Sent to <b style={{ color: C.ink2 }}>{email || "your email"}</b> · <span onClick={() => go("emailconnect")} style={{ color: C.green, fontWeight: 700, cursor: "pointer" }}>Edit</span></p>
        <div style={{ display: "flex", gap: 8, marginTop: 26, justifyContent: "center" }}>
          {code.map((v, i) => (
            <input key={i} ref={refs.current[i]} value={v} inputMode="numeric"
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => e.key === "Backspace" && !v && i > 0 && refs.current[i - 1].current.focus()}
              style={{ width: 42, height: 54, textAlign: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 21, color: C.ink2, borderRadius: 13, border: `1.5px solid ${v ? C.green : C.line}`, background: "#fff", outline: "none", transition: "border-color .2s" }} />
          ))}
        </div>
        <button style={{ margin: "18px auto 0", background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "10px 20px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink2, cursor: "pointer" }}>
          Open Gmail app
        </button>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#a9aa9c", textAlign: "center", marginTop: 12 }}>
          {secs > 0 ? `Resend in 00:${String(secs).padStart(2, "0")}` : "Resend code"} · Can't find it? Check spam / promotions
        </p>
      </div>
    </Screen>
  );
}
// The REAL screenshot-proof screen (tier-3 manual path). Uploads a chosen image
// to POST /tasks/:id/screenshot, then lists the caller's own for this kind and
// surfaces the staff reason when a prior upload was REJECTED or NEEDS_MORE — so
// the user knows exactly what to fix or re-send. Never shows the match verdict /
// confidence / diff (those are staff-only).
const SHOT_STATUS_UI = {
  pending_review: { bg: C.blueBg, line: C.blue, ink: "#1C5BB8", label: "Under review", note: "A Fayr reviewer is checking your screenshot — we'll update you here." },
  approved: { bg: C.greenBg, line: C.green, ink: C.greenDeep, label: "Accepted ✓", note: "Your proof was accepted." },
  needs_more: { bg: C.amberBg, line: C.amberLine, ink: "#8A5A00", label: "More proof needed" },
  rejected: { bg: C.redBg, line: C.red, ink: "#B3271C", label: "Not accepted" },
};
function ScreenshotProof({ go, task, kind, kindLabel, backTo = "proofprimer" }) {
  const [shots, setShots] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const taskId = task && task.id;

  function load() {
    if (!taskId) { setShots([]); return; }
    backendApi.listScreenshots(taskId)
      .then((list) => setShots((list || []).filter((s) => s.kind === kind)))
      .catch((e) => { setErr(e.message); setShots([]); });
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [taskId, kind]);

  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // let the user re-pick the same file after a failure
    if (!f || !taskId) return;
    setBusy(true); setErr(null);
    backendApi.uploadScreenshot(taskId, kind, f)
      .then(() => load())
      .catch((e2) => setErr(e2.message))
      .finally(() => setBusy(false));
  };

  const latest = shots && shots.length ? shots[0] : null;
  const ui = latest ? SHOT_STATUS_UI[latest.status] : null;
  const needsAction = latest && (latest.status === "rejected" || latest.status === "needs_more");
  const dropLabel = needsAction ? "Upload a new screenshot" : (latest ? "Replace / add another" : "Tap to choose your screenshot");

  return (
    <Screen>
      <TopBar title={"Upload " + kindLabel + " proof"} onBack={() => go(backTo)} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 24px 24px" }}>
        {shots === null ? (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.sub, padding: "18px 2px" }}>Loading…</div>
        ) : (
          <React.Fragment>
            {latest && ui && (
              <div style={{ marginTop: 6, background: ui.bg, border: `1px solid ${ui.line}`, borderRadius: 14, padding: "13px 15px" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: ui.ink }}>{ui.label}</div>
                {needsAction ? (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink2, marginTop: 5, lineHeight: 1.5 }}>
                    <b>Reviewer’s note:</b> {latest.reviewReason || "Please re-upload a clearer screenshot."}
                  </div>
                ) : (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>{ui.note}</div>
                )}
              </div>
            )}

            {latest && latest.status === "approved" ? null : (
              <label style={{ display: "block", marginTop: 14, border: `2px dashed ${busy ? C.green : C.line}`, borderRadius: 18, background: "#fff", minHeight: 168, cursor: busy ? "default" : "pointer", transition: "border-color .2s" }}>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} disabled={busy} style={{ display: "none" }} />
                <div style={{ display: "grid", placeItems: "center", minHeight: 168, textAlign: "center", padding: 20 }}>
                  {busy ? (
                    <div>
                      <div style={{ fontSize: 34 }}>🖼️</div>
                      <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.sub, marginTop: 10 }}>Uploading…</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 40 }}>📤</div>
                      <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.ink2, marginTop: 10 }}>{dropLabel}</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.sub, marginTop: 4 }}>JPG / PNG / WebP · up to 10 MB</div>
                    </div>
                  )}
                </div>
              </label>
            )}

            {err && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.red, marginTop: 10 }}>{err}</div>}

            <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: "#a9aa9c", marginTop: 12, lineHeight: 1.5 }}>
              A screenshot is <b>supporting</b> proof — a Fayr reviewer makes the final call, and your refund still follows the normal holding period.
            </p>

            {shots.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 11, letterSpacing: ".06em", color: C.sub, textTransform: "uppercase" }}>Your uploads</div>
                {shots.map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.sub }}>{new Date(s.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11, color: (SHOT_STATUS_UI[s.status] || {}).ink || C.sub }}>{(SHOT_STATUS_UI[s.status] || {}).label || s.status}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <Pill onClick={() => go(backTo)} color={C.creamDeep} text={C.ink2}>{needsAction ? "I’ll do it now" : "Done"}</Pill>
            </div>
          </React.Fragment>
        )}
      </div>
    </Screen>
  );
}

// Router: a real backend task → the real uploader above; otherwise the design-time
// mock animation (so the prototype still runs with no backend).
function ProofUpload({ go, task, kind = "PURCHASE", kindLabel = "order" }) {
  if (task && task.id && isBackendTask(task)) {
    return <ScreenshotProof go={go} task={task} kind={kind} kindLabel={kindLabel} backTo="proofprimer" />;
  }
  return <ProofUploadMock go={go} />;
}
function ProofUploadMock({ go }) {
  const [pct, setPct] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    const t = setInterval(() => setPct((p) => { if (p >= 100) { clearInterval(t); return 100; } return p + 7; }), 90);
    return () => clearInterval(t);
  }, [started]);
  useEffect(() => { if (pct >= 100) setTimeout(() => go("ocrconfirm"), 400); }, [pct, go]);
  return (
    <Screen>
      <TopBar title="Upload proof" onBack={() => go("proofprimer")} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 24px 24px" }}>
        <div onClick={() => setStarted(true)} style={{ marginTop: 8, border: `2px dashed ${started ? C.green : C.line}`, borderRadius: 18, background: "#fff", minHeight: 220, display: "grid", placeItems: "center", cursor: "pointer", transition: "border-color .2s" }}>
          {started ? (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 34 }}>🖼️</div>
              <div style={{ width: 180, height: 6, background: "#E7E8D6", borderRadius: 6, margin: "14px auto 0", overflow: "hidden" }}>
                <div style={{ width: pct + "%", height: "100%", background: C.green, borderRadius: 6, transition: "width .1s linear" }} />
              </div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.sub, marginTop: 8 }}>{pct < 100 ? `Uploading… ${pct}%` : "Uploaded ✓"}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#a9aa9c", marginTop: 4 }}>Resumable — a dropped connection picks up where it left off.</div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 40 }}>📤</div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.ink2, marginTop: 10 }}>Tap to choose your screenshot</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.sub, marginTop: 4 }}>JPG/PNG · compressed on-device before upload</div>
            </div>
          )}
        </div>
        <p style={{ fontFamily: FONT_BODY, fontSize: 11, color: "#a9aa9c", marginTop: 12, lineHeight: 1.5 }}>Size and type are checked before any bytes move. Offline? It queues and auto-sends.</p>
      </div>
    </Screen>
  );
}
function OcrConfirm({ go, c, advance, trackPending, source = "screenshot" }) {
  // Details are auto-populated — from email reading (DKIM) or OCR on the uploaded screenshot.
  const [oid, setOid] = useState("1269146612");
  const [amt, setAmt] = useState("₹" + c.examplePay);
  const [date, setDate] = useState("2 Jul 2026");
  const [editing, setEditing] = useState(false);
  const submit = () => {
    trackPending(c);              // reward now tracked as PENDING
    advance(c.id, 3, "await delivery, then upload delivery proof");
    go("orderverified");
  };
  const via = source === "email" ? "your order email" : "your screenshot";
  const rows = [["Order ID", oid, setOid, true], ["Order Amount", amt, setAmt], ["Order Date", date, setDate], ["Product Name", c.product, null]];
  return (
    <Screen bg="#FBFBEF">
      <TopBar title="Confirm order" onBack={() => go("proofprimer")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 24px 20px", position: "relative" }}>
        <GridFloor style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 150, opacity: .4 }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.greenBg, borderRadius: 100, padding: "6px 13px", marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>{source === "email" ? "📧" : "🔍"}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: C.greenDeep }}>{source === "email" ? "Fetched from email" : "Read from screenshot"}</span>
          </div>
          <h1 style={{ ...hTitle, fontSize: 26 }}>Are these order<br />details correct?</h1>
          <p style={{ ...hSub }}>We pulled these from {via}. Check them, edit if needed, then confirm.</p>
        </div>

        {/* extracted details card */}
        <div style={{ marginTop: 18, background: "#fff", borderRadius: 18, padding: "6px 16px", boxShadow: "0 5px 14px rgba(20,20,20,.06)" }}>
          {rows.map(([label, val, setter, mono], i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : "none" }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.sub, flex: "0 0 auto" }}>{label}</span>
              {editing && setter ? (
                <input value={val} onChange={(e) => setter(e.target.value)} style={{ flex: 1, maxWidth: "62%", textAlign: "right", background: C.cream, border: `1.5px solid ${C.line}`, borderRadius: 9, padding: "7px 10px", fontFamily: mono ? "ui-monospace, monospace" : FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, outline: "none" }} />
              ) : (
                <span style={{ fontFamily: mono ? "ui-monospace, monospace" : FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, textAlign: "right", maxWidth: "62%", lineHeight: 1.3 }}>{val}</span>
              )}
            </div>
          ))}
        </div>
        {!editing && <button onClick={() => setEditing(true)} style={{ marginTop: 12, background: "none", border: "none", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12.5, color: C.blue, cursor: "pointer", padding: 0 }}>✎ Edit details</button>}
      </div>

      <div style={{ padding: "10px 24px 22px" }}>
        <Pill onClick={submit} color={C.green} text="#fff">Yes, these are correct →</Pill>
        <TextBtn onClick={() => go("proofupload")}>No — {source === "email" ? "upload screenshot instead" : "re-upload screenshot"}</TextBtn>
      </div>
    </Screen>
  );
}
function UnderReview({ go, next, title = "Proof under review", eta = "Usually within 2 hours", cta = "CONTINUE (DEMO: SKIP WAIT)" }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: C.blueBg, display: "grid", placeItems: "center", fontSize: 38 }}>🔎</div>
        <h1 style={{ ...hTitle, marginTop: 18 }}>{title}</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>{eta}. You can close the app — every transition notifies you, nothing is silent.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={next}>{cta}</Pill>
        <TextBtn onClick={() => go("campaigns")}>Back to My Products</TextBtn>
      </div>
    </Screen>
  );
}
function DeliveryConfirm({ go, c, advance }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 56 }}>📦</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>Delivered?</h1>
        <p style={{ ...hSub, maxWidth: 270 }}>Your {c.product} should have arrived around now. Confirm delivery to unlock the review step.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => { advance(c.id, 4, "submit review proof"); go("honesty"); }}>YES — IT'S DELIVERED</Pill>
        <TextBtn onClick={() => go("deliverydelayed")}>It's delayed / there's a problem</TextBtn>
      </div>
    </Screen>
  );
}
function DeliveryDelayed({ go }) {
  return (
    <Screen>
      <TopBar title="Delivery issue" onBack={() => go("delivery")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        {[
          ["🕐", "It's delayed", "Share tracking proof — your deadline auto-extends and the adjusted date stays visible.", C.blueBg],
          ["📦", "Wrong / damaged item", "Replace via the marketplace (campaign pauses, deadlines frozen) or return & exit — outcome stated up front.", C.amberBg],
          ["❌", "Order lost", "No-fault exit: tickets returned, seat released. Couriers aren't your fault.", C.redBg],
        ].map(([i, t, s, bg]) => (
          <div key={t} style={{ background: "#fff", borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 4px 12px rgba(20,20,20,.05)", display: "flex", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: bg, display: "grid", placeItems: "center", fontSize: 20, flex: "0 0 auto" }}>{i}</div>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.ink2 }}>{t}</div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{s}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 20px 20px" }}><Ghost onClick={() => go("delivery")}>Back</Ghost></div>
    </Screen>
  );
}
function Honesty({ go }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 54 }}>⭐</div>
        <h1 style={{ ...hTitle, marginTop: 16 }}>1★ or 5★ — you're paid the same</h1>
        <p style={{ ...hSub, maxWidth: 285 }}>Write what you really think. Quality tips: mention how you used it, what surprised you, and who it's for. That's it — shown once, never again.</p>
      </div>
      <div style={{ padding: "0 28px 28px" }}><Pill onClick={() => go("reviewguide")}>GOT IT</Pill></div>
    </Screen>
  );
}
function ReviewGuide({ go, c }) {
  const m = MARKETPLACES[c.marketplace];
  // Neutral prompts to help structure an honest review — never steering sentiment.
  const topics = [
    ["✨", "Product quality", "How it looks, feels, and performs"],
    ["📦", "Packaging", "How it arrived — sealed, intact, presentable"],
    ["💰", "Value for money", "Whether it felt worth the price you paid"],
    ["🖐", "Ease of use", "How simple or fiddly it was to use"],
    ["🛡", "Durability", "How it's holding up over time"],
    ["💬", "Overall experience", "Anything else you genuinely felt"],
  ];
  return (
    <Screen bg="#FBFBEF">
      <TopBar title="Write your review" onBack={() => go("taskstatus")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 16px" }}>
        <h1 style={{ ...hTitle, fontSize: 23 }}>Share your honest review</h1>
        <p style={{ ...hSub }}>We'll open the <b style={{ color: C.ink2 }}>{m.name} homepage</b> — search for your product and post your review there. Say exactly what you think; a low or high rating pays the same.</p>

        <div style={{ marginTop: 16, background: "#fff", borderRadius: 16, padding: "14px 15px", boxShadow: "0 5px 14px rgba(20,20,20,.05)" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 4 }}>Things you might mention</div>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginBottom: 12, lineHeight: 1.5 }}>Just prompts to help you structure it — cover any, all, or none. Your honest opinion is entirely yours.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {topics.map(([ic, t, d]) => (
              <div key={t} style={{ background: C.cream, borderRadius: 12, padding: "10px 11px" }}>
                <div style={{ fontSize: 17 }}>{ic}</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12.5, color: C.ink, marginTop: 5 }}>{t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 10.5, color: "#9a9b8c", marginTop: 2, lineHeight: 1.35 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12, background: "#EAF2FF", border: "1px solid #CBE0FF", borderRadius: 12, padding: "10px 12px", display: "flex", gap: 9 }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11, color: "#2F6FD0", lineHeight: 1.5 }}>fayr never asks for positive reviews or a set star rating. Honest feedback — good or bad — earns the same refund.</span>
        </div>
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        <Pill onClick={() => { try { window.open(marketplaceHome(c.marketplace), "_blank", "noopener,noreferrer"); } catch (e) {} go("reviewproof"); }} color={m.color} text={m.inkOn}>Open {m.name} & write review →</Pill>
      </div>
    </Screen>
  );
}
function ReviewProof({ go, c, advance }) {
  const [url, setUrl] = useState("");
  return (
    <Screen>
      <TopBar title="Review proof" onBack={() => go("reviewguide")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        <h1 style={{ ...hTitle, fontSize: 23 }}>Posted? Prove it your way</h1>
        <p style={hSub}>A review URL is preferred; a screenshot is accepted.</p>
        <CardBox style={{ marginTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 6 }}>Review URL</div>
          <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: C.cream, border: `1.5px solid ${url ? C.green : C.line}`, borderRadius: 12, padding: "12px 13px", fontFamily: "ui-monospace, monospace", fontSize: 13, color: C.ink2, outline: "none" }} />
        </CardBox>
        <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#a9aa9c", margin: "12px 0" }}>or</div>
        <Ghost>📤 Upload a screenshot instead</Ghost>
        <div style={{ marginTop: 14, background: C.blueBg, borderRadius: 12, padding: "10px 12px", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: "#2F6FD0", lineHeight: 1.5 }}>
          If moderation holds your review, your deadline freezes — the frozen clock is visible on your campaign card.
        </div>
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        <Pill onClick={() => { advance(c.id, 5, "review under verification"); go("taskstatus"); }}>SUBMIT REVIEW PROOF</Pill>
      </div>
    </Screen>
  );
}
function ReturnWindow({ go, c, advance }) {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center" }}>
        <div style={{ width: 110, height: 110, borderRadius: "50%", border: `5px solid ${C.greenBg}`, borderTopColor: C.green, display: "grid", placeItems: "center", fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
          <div><div style={{ fontSize: 26, color: C.ink2 }}>5</div><div style={{ fontSize: 10, color: C.sub, letterSpacing: ".08em" }}>DAYS</div></div>
        </div>
        <h1 style={{ ...hTitle, marginTop: 20 }}>Refund unlocks in 5 days</h1>
        <p style={{ ...hSub, maxWidth: 285 }}>After {MARKETPLACES[c.marketplace].name}'s return window closes on <b style={{ color: C.ink2 }}>11 Jul</b>. Festival return extensions adjust this date — with an honest one-line explanation.</p>
        <div style={{ marginTop: 14, background: "#fff", borderRadius: 12, padding: "10px 14px", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: C.sub, maxWidth: 280, lineHeight: 1.5 }}>
          Final step: a quick no-return precheck when the window closes — announced since the detail page, so it's routine, not a surprise.
        </div>
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => { advance(c.id, 7, "get paid", { done: true, earned: c.maxBack }); go("reward"); }}>CONTINUE (DEMO: SKIP WAIT)</Pill>
        <TextBtn onClick={() => go("campaigns")}>Back to My Products</TextBtn>
      </div>
    </Screen>
  );
}
/* ============================================================================
   TASK STATUS — refund timeline (reference: Task status screenshot)
   Reached from My Products (tap a product) or the claimed campaign page.
   ========================================================================== */
function TaskStatus({ go, c, enrolled, rewards, onAction, finalize, task, taskDispatch, simulate }) {
  const e = enrolled[c.id] || { step: 1 };
  const m = MARKETPLACES[c.marketplace];
  // REAL state machine when a task exists. A backend task (from POST/GET /tasks)
  // is mapped to the same view shape as the client bridge, so this timeline
  // renders real state either way; seeded demo campaigns with no task keep their
  // static legacy step.
  const backed = isBackendTask(task);
  const v = task ? (backed ? backendTaskView(task, c) : bridge.view(task, c, Date.now())) : null;
  const step = v ? v.step : (e.step || 1);
  // The refund shown is the verified per-item figure (₹404.10, exact). The wallet
  // still credits WHOLE rupees on the legacy creditReward path until the paise-
  // wallet migration lands, so `amt` is that wallet number and `refundStr` is the
  // exact amount the ledger owes.
  const amt = v ? v.refundRupees : ((rewards[c.id] && rewards[c.id].amount) || c.maxBack);
  const refundStr = v ? v.refundDisplay : (amt != null ? amt + ".00" : null);

  // Per-marketplace review behaviour — the middle of the journey differs by platform.
  // amazon: reviews pass through 48–72h moderation before they're public → a real "under verification" wait.
  // flipkart/myntra: reviews appear after a short indexing lag → a brief "indexing" wait.
  // meesho: text reviews are never shown publicly → verify from the submitted signal, no public-visibility wait.
  // blinkit/zepto/instamart: no public review pages → verify the in-app rating action, no wait.
  const REVIEW_FLOW = {
    amazon:    { verifyTitle: "Review Under Verification", verifySub: "Amazon moderates new reviews (48–72h) before they're public", verifyDelay: 3200 },
    flipkart:  { verifyTitle: "Review Indexing",           verifySub: "Flipkart is indexing your review — appears shortly",        verifyDelay: 2600 },
    myntra:    { verifyTitle: "Review Indexing",           verifySub: "Myntra is publishing your review",                          verifyDelay: 2200 },
    meesho:    { verifyTitle: "Review Confirmed",          verifySub: "Meesho text reviews aren't shown publicly — confirmed from your submission", verifyDelay: 1400, instant: true },
    blinkit:   { verifyTitle: "Rating Confirmed",          verifySub: "Confirmed from your in-app rating — no public review page",  verifyDelay: 1200, instant: true },
    zepto:     { verifyTitle: "Rating Confirmed",          verifySub: "Confirmed from your in-app rating — no public review page",  verifyDelay: 1200, instant: true },
    instamart: { verifyTitle: "Rating Confirmed",          verifySub: "Confirmed from your in-app rating — no public review page",  verifyDelay: 1200, instant: true },
  };
  const rf = REVIEW_FLOW[c.marketplace] || REVIEW_FLOW.amazon;

  // Real payout status for the FINAL timeline stage. A refunded task credits the
  // WALLET — that is not "sent to your bank" until the user actually withdraws and
  // ops marks it PAID. Withdrawals are wallet-level (the ledger pools every refund,
  // there is no per-task link), so this reflects the user's real withdrawal status:
  // "paid" only once a withdrawal reaches PAID, "pending" while one is in flight,
  // otherwise the money is simply sitting in the wallet, withdrawable anytime.
  const [payout, setPayout] = useState({ loaded: false, status: "none" });
  useEffect(() => {
    if (!backed) return;
    let alive = true;
    backendApi
      .listWithdrawals()
      .then((ws) => {
        if (!alive) return;
        const list = ws || [];
        const status = list.some((w) => w.status === "PAID")
          ? "paid"
          : list.some((w) => w.status === "REQUESTED" || w.status === "APPROVED")
            ? "pending"
            : "none";
        setPayout({ loaded: true, status });
      })
      .catch(() => alive && setPayout({ loaded: true, status: "none" }));
    return () => {
      alive = false;
    };
  }, [backed, v && v.state]);

  // Full journey. reach = step at which the stage is DONE. The current pending stage is "active".
  // step machine: 2 order-verified · 3 delivered · 4 review-submitted · 5 verifying · 6 return-window
  //               · 7 reward-pending · 8 reward-confirmed · 9 paid
  // Refund is tracked (Pending) the moment the ORDER is verified — not after review.
  // It only becomes Confirmed once the review is approved AND the return window has closed.
  // With a real task, "Confirmed" means the machine actually says eligible (or
  // already refunded) — window closed, review still public, not returned — not
  // just that a step counter passed 8.
  const refundState = v
    ? (v.state === "REFUNDED" || v.eligible ? "confirmed" : v.order ? "pending" : null)
    : (step >= 8 ? "confirmed" : step >= 3 ? "pending" : null);
  const refunded = !!(v && v.state === "REFUNDED");
  // Final stage, driven by the REAL withdrawal status (not just "task refunded"):
  //   paid    → money actually reached the bank (a withdrawal is PAID)
  //   pending → a withdrawal is in flight (REQUESTED / APPROVED)
  //   refunded, none → the refund is in the wallet, withdrawable anytime
  //   not yet refunded → an upcoming step, greyed out
  const paidStage =
    payout.status === "paid"
      ? { key: "paid", icon: "🏦", title: "Payment Processed",   sub: "Sent to your bank account",         reach: 9, coin: true, force: "done" }
      : payout.status === "pending"
        ? { key: "paid", icon: "🏦", title: "Withdrawal Requested", sub: "On its way to your bank account",  reach: 9, force: "active" }
        : refunded
          ? { key: "paid", icon: "👛", title: "Refund in Your Wallet", sub: "Withdraw anytime from Earnings", reach: 9, force: "active" }
          : { key: "paid", icon: "🏦", title: "Payment Processed", sub: "Withdraw your refund to your bank", reach: 9 };
  const stages = [
    { key: "claimed",   icon: "🎯", title: "Product Claimed",          sub: "28 May · 4:12 PM",                 reach: 2 },
    { key: "order",     icon: "📦", title: "Order Placed & Verified",  sub: "Fetched from your email",          reach: 3, action: "order" },
    { key: "tracked",   icon: "💸", title: "Refund Tracked",           sub: `₹${refundStr} added to your fayr Wallet`, reach: 3, refundChip: "pending" },
    { key: "delivered", icon: "🚚", title: "Order Delivered",          sub: "Confirm & verify delivery",        reach: 4, action: "delivery" },
    { key: "review",    icon: "✍️", title: "Review Submitted",         sub: `Posted on ${m.name}`,              reach: 5, action: "review" },
    { key: "verifying", icon: rf.instant ? "✔️" : "🔎", title: rf.verifyTitle, sub: rf.verifySub,              reach: 6, autoInfo: true },
    { key: "window",    icon: "⏳", title: "Return Window",            sub: "Refund confirms after it closes",  reach: 7, autoInfo: true },
    { key: "confirmed", icon: "✅", title: "Refund Confirmed",         sub: "Review approved · window closed",   reach: 8, refundChip: "confirmed", action: "withdraw" },
    paidStage,
  ];
  // A stage's state is its step position, unless it carries an explicit `force`
  // (the final payout stage decides its own state from real withdrawal data).
  const stateFor = (reach) => (step >= reach ? "done" : step >= reach - 1 ? "active" : "pending");

  // Replaces the old setTimeout step machine. Once the review is marked, ENTER
  // the return-window hold for real. From there, eligibility is gated by actual
  // elapsed time + a still-public review (see refundEligibility), not a timer -
  // so a task with an open window sits in HOLDING with a live countdown, and one
  // whose window has closed becomes eligible on its own. No-op without a real
  // task (the seeded demos keep their static step and their old animation).
  useEffect(() => {
    if (task && !backed && task.state === "REVIEWED") {
      taskDispatch(c.id, bridge.events.startHold(Date.now()));
    }
  }, [task && task.state]);



  // what the active-stage button does
  const actLabel = { order: "Verify order", delivery: "Confirm delivery", review: "Write review", withdraw: "Withdraw ₹" + refundStr };
  const doAction = (a) => onAction(a, c);

  return (
    <Screen noPad bg="#F5F4EC">
      {/* header — premium gradient, floating product chip */}
      <div style={{ background: "linear-gradient(165deg,#E7DCFA 0%,#EDE4FB 45%,#F5F4EC 100%)", padding: "0 16px 20px", flex: "0 0 auto", position: "relative" }}>
        <StatusSpacer />
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 2 }}>
          <button onClick={() => go("myproducts")} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.9)", backdropFilter: "blur(8px)", fontSize: 15, cursor: "pointer", boxShadow: "0 3px 10px rgba(80,50,140,.14)", flex: "0 0 auto" }}>←</button>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 19, color: "#2B1D45", margin: 0 }}>Task status</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 13, background: "rgba(255,255,255,.72)", backdropFilter: "blur(12px)", borderRadius: 18, padding: "11px 13px", marginTop: 14, boxShadow: "0 8px 24px rgba(80,50,140,.12)", border: "0.5px solid rgba(255,255,255,.7)" }}>
          <div style={{ position: "relative", width: 54, height: 54, flex: "0 0 auto" }}>
            <ProductArt theme={c.theme} cid={c.id} radius={13} style={{ position: "absolute", inset: 0, background: c.heroBg }} />
            <div style={{ position: "absolute", left: "50%", bottom: -4, transform: "translateX(-50%)", background: "#fff", borderRadius: 6, padding: "1px 5px", boxShadow: "0 2px 5px rgba(0,0,0,.14)" }}><BrandLogo mid={c.marketplace} size={16} /></div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: "#2B1D45", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.product}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontStyle: "italic", fontSize: 12.5, color: C.refundInk }}>{c.pct}% Refund</span>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#c9bce6" }} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: "#8a7ba8" }}>up to ₹{amt}</span>
            </div>
          </div>
        </div>
        {/* progress ring summary */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12.5, color: "#5B4880" }}>Step {Math.min(step - 1, stages.length)} of {stages.length}</div>
          <div style={{ flex: 1, height: 6, background: "rgba(123,97,255,.14)", borderRadius: 6, margin: "0 12px", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, ((step - 1) / stages.length) * 100)}%`, height: "100%", background: "linear-gradient(90deg,#8B5CF6,#22A80E)", borderRadius: 6, transition: "width .6s cubic-bezier(.3,.8,.3,1)" }} />
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12.5, color: "#22A80E" }}>{Math.round(((step - 1) / stages.length) * 100)}%</div>
        </div>
      </div>

      {/* timeline */}
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 16px 22px" }}>
        {/* Demo control: real backend task not yet refunded → let the tester jump
            the whole verification on the backend and watch the wallet update. */}
        {backed && task.state !== "REFUNDED" && (
          <button onClick={() => simulate && simulate(c)} style={{ width: "100%", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#fff", border: "1.5px dashed #C9B8F5", borderRadius: 14, padding: "12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: "#7926D9", cursor: "pointer", boxShadow: "0 4px 12px rgba(123,97,255,.10)" }}>
            ⚡ Simulate verification (demo) → refund
          </button>
        )}
        {backed && task.state === "REFUNDED" && (
          <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#E7F6E0", border: "1px solid #9FD97F", borderRadius: 14, padding: "12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: "#2E8B0F" }}>
            ✅ Refund released — check your wallet
          </div>
        )}
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16, color: C.ink, margin: "0 0 4px", paddingLeft: 2 }}>Refund Timeline</div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: "#9a9b8c", margin: "0 0 16px", paddingLeft: 2 }}>Updates automatically as your refund progresses</div>

        <div style={{ position: "relative" }}>
          {stages.map((stg, i) => {
            const st = stg.force || stateFor(stg.reach);
            const last = i === stages.length - 1;
            return (
              <div key={stg.key} style={{ display: "flex", gap: 14, position: "relative", animation: "fayr-rise .4s cubic-bezier(.22,.61,.36,1) both", animationDelay: i * 45 + "ms" }}>
                {/* rail + node */}
                <div style={{ position: "relative", flex: "0 0 auto", width: 38, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {!last && <div style={{ position: "absolute", top: 20, bottom: -8, width: 3, background: st === "done" ? "linear-gradient(#22A80E,#3FBF1E)" : "#E4E4D6", borderRadius: 3 }} />}
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", zIndex: 2, display: "grid", placeItems: "center", position: "relative",
                    background: st === "done" ? "linear-gradient(145deg,#34B81C,#1F8E0A)" : st === "active" ? "#fff" : "#EDEDE2",
                    border: st === "active" ? "2.5px solid #22A80E" : "none",
                    boxShadow: st === "done" ? "0 5px 14px rgba(34,168,14,.32)" : st === "active" ? "0 5px 16px rgba(34,168,14,.22)" : "none",
                  }}>
                    {st === "active" && <span style={{ position: "absolute", inset: -5, borderRadius: "50%", border: "2px solid rgba(34,168,14,.28)", animation: "fayr-pulse 1.8s ease-out infinite" }} />}
                    <span style={{ fontSize: st === "done" ? 15 : 16, filter: st === "pending" ? "grayscale(1) opacity(.5)" : "none" }}>{st === "done" ? "✓" : stg.icon}</span>
                  </div>
                </div>

                {/* card */}
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
                  <div style={{
                    borderRadius: 16, padding: st === "active" ? "13px 14px" : "11px 13px",
                    background: st === "active" ? "linear-gradient(135deg,#EAFBE0,#F4FCEE)" : st === "done" ? "#fff" : "#FAFAF3",
                    border: st === "active" ? "1.5px solid #B6E79E" : "1px solid rgba(0,0,0,.04)",
                    boxShadow: st === "active" ? "0 10px 26px rgba(34,168,14,.14)" : st === "done" ? "0 3px 10px rgba(20,20,20,.05)" : "none",
                    transition: "all .4s", opacity: st === "pending" ? .72 : 1,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: st === "active" ? 15 : 13.5, color: st === "pending" ? "#AEAFA0" : C.ink, lineHeight: 1.2 }}>{stg.title}</div>
                        <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: st === "pending" ? "#c2c3b5" : "#98998a", marginTop: 3, lineHeight: 1.4 }}>{stg.sub}</div>
                      </div>
                      {stg.refundChip === "pending" && st === "done" && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#FFF7DE", border: "1px solid #F3D97A", borderRadius: 100, padding: "5px 12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: "#A07D12", flex: "0 0 auto" }}>● Pending</span>}
                      {stg.refundChip === "confirmed" && (st === "done" || st === "active") && refundState === "confirmed" && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#E7F6E0", border: "1px solid #9FD97F", borderRadius: 100, padding: "5px 12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, color: "#2E8B0F", flex: "0 0 auto" }}>● Confirmed</span>}
                      {!stg.refundChip && st === "done" && <StatusPill kind="completed" />}
                      {!stg.refundChip && st === "active" && stg.autoInfo && <StatusPill kind="progress" />}
                      {!stg.refundChip && st === "pending" && <StatusPill kind="pending" />}
                      {stg.refundChip === "confirmed" && st === "pending" && <StatusPill kind="pending" />}
                    </div>
                    {/* active action button (only for stages that need the user).
                        For a REAL backend task the sole control is the demo
                        "Simulate verification" button below — the per-stage
                        actions (which drive the on-device journey) are hidden so
                        they can't desync from the backend. */}
                    {st === "active" && stg.action && !backed && (
                      <button onClick={() => {
                        if (stg.action === "withdraw") {
                          // Release is the money move: the machine only lets it
                          // through if still eligible at click time (window closed,
                          // review public, not returned). Then to the payout screen.
                          if (task && !backed) taskDispatch(c.id, bridge.events.release(Date.now()));
                          go("withdraw");
                        } else doAction(stg.action);
                      }} style={{ width: "100%", marginTop: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "linear-gradient(to bottom,#2FA00E,#1F8106)", color: "#fff", border: "none", borderRadius: 12, padding: "11px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, cursor: "pointer", boxShadow: "0 6px 14px rgba(33,130,0,.28)" }}>
                        {actLabel[stg.action]} →
                      </button>
                    )}
                    {/* auto stages progress on their own — subtle spinner, no action */}
                    {st === "active" && stg.autoInfo && (
                      <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11, color: "#7B61FF" }}>
                        <span style={{ width: 14, height: 14, border: "2px solid #C9B8F5", borderTopColor: "#7B61FF", borderRadius: "50%", animation: "fayr-spin .8s linear infinite" }} />
                        Processing automatically — nothing needed from you
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EarnerTicker />
    </Screen>
  );
}

/* status pill (Completed / Pending / In progress) — compact */
function StatusPill({ kind }) {
  if (kind === "completed") return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#E7F6E0", border: "1px solid #BEE6AC", borderRadius: 100, padding: "4px 11px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 11.5, color: "#3B8B1A", flex: "0 0 auto" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5FBF33" }} />Completed</span>;
  if (kind === "progress") return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F1EAFB", border: "1px solid #D9C6F5", borderRadius: 100, padding: "4px 11px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 11.5, color: "#7926D9", flex: "0 0 auto" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7926D9" }} />In progress</span>;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#FFF7DE", border: "1px solid #F3D97A", borderRadius: 100, padding: "4px 11px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 11.5, color: "#A07D12", flex: "0 0 auto" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F5C518" }} />Pending</span>;
}

/* horizontally scrolling ticker of recent earners — rAF-driven for reliability,
   with manual swipe (pauses) and auto-resume. */
const TICKER_ITEMS = [
  ["Rajesh", 200], ["Akansha", 150], ["Priya", 320], ["Vikram", 99],
  ["Sneha", 275], ["Arjun", 410], ["Neha", 180], ["Rohit", 260],
  ["Divya", 340], ["Karan", 120], ["Meera", 500], ["Sahil", 210],
];
function EarnerTicker() {
  const trackRef = useRef(null);
  const offset = useRef(0);
  const raf = useRef(null);
  const paused = useRef(false);
  const drag = useRef(null);
  const resumeT = useRef(null);
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  useEffect(() => {
    const el = trackRef.current; if (!el) return;
    const step = () => {
      if (!paused.current) {
        offset.current -= 0.55; // px/frame → smooth continuous scroll
        const half = el.scrollWidth / 2;
        if (-offset.current >= half) offset.current += half; // seamless loop
        el.style.transform = `translateX(${offset.current}px)`;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  const onDown = (x) => { paused.current = true; drag.current = { x, start: offset.current }; clearTimeout(resumeT.current); };
  const onMove = (x) => { if (!drag.current) return; offset.current = drag.current.start + (x - drag.current.x); if (trackRef.current) trackRef.current.style.transform = `translateX(${offset.current}px)`; };
  const onUp = () => { drag.current = null; clearTimeout(resumeT.current); resumeT.current = setTimeout(() => { paused.current = false; }, 2000); };
  return (
    <div style={{ flex: "0 0 auto", background: "linear-gradient(90deg,#161612,#26261F)", overflow: "hidden", position: "relative", borderTop: "1px solid rgba(255,255,255,.06)" }}
      onTouchStart={(e) => onDown(e.touches[0].clientX)} onTouchMove={(e) => onMove(e.touches[0].clientX)} onTouchEnd={onUp}
      onMouseDown={(e) => onDown(e.clientX)} onMouseMove={(e) => drag.current && onMove(e.clientX)} onMouseUp={onUp} onMouseLeave={onUp}>
      {/* edge fades */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 28, background: "linear-gradient(90deg,#161612,transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 28, background: "linear-gradient(270deg,#161612,transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div ref={trackRef} style={{ display: "inline-flex", gap: 24, whiteSpace: "nowrap", padding: "9px 0", willChange: "transform", cursor: "grab" }}>
        {row.map(([name, amt], i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "0 0 auto", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 12.5, color: "#EDEDE2" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#3A3A30", display: "grid", placeItems: "center", fontSize: 10 }}>🎉</span>
            {name} earned <span style={{ color: "#7BD34F", fontWeight: 800 }}>₹{amt}</span>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#4a4a3e", marginLeft: 4 }} />
          </span>
        ))}
      </div>
    </div>
  );
}

/* Delivery image upload — leads to Images Uploaded sheet */
/* Has your order been delivered? Yes → auto-verify via email (fallback: upload). */
function DeliveryCheck({ go, c, gmail, advance }) {
  const m = MARKETPLACES[c.marketplace];
  const [phase, setPhase] = useState("ask"); // ask · checking · done
  const yes = () => {
    if (gmail.connected) {
      setPhase("checking");
      setTimeout(() => setPhase("done"), 2200);
      setTimeout(() => { advance(c.id, 4, "write your review"); go("reviewguide"); }, 3400);
    } else {
      go("deliveryupload");
    }
  };
  return (
    <Screen bg="#FBFBEF">
      <TopBar title="Delivery" onBack={() => go("taskstatus")} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "30px 28px", textAlign: "center", position: "relative" }}>
        <GridFloor style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 200, opacity: .4 }} />
        {phase === "ask" && (
          <div style={{ position: "relative", animation: "fayr-rise .4s ease both" }}>
            <div style={{ fontSize: 66 }}>🚚</div>
            <h1 style={{ ...hTitle, fontSize: 25, marginTop: 14 }}>Has your order<br />been delivered?</h1>
            <p style={{ ...hSub, maxWidth: 290 }}>{gmail.connected ? `If yes, we'll confirm it automatically from your ${m.name} email — no screenshot needed.` : "Let us know so we can verify the delivery."}</p>
            <div style={{ display: "flex", gap: 12, marginTop: 26, width: "100%", maxWidth: 320 }}>
              <button onClick={() => go("deliverydelayed")} style={{ flex: 1, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: "15px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.sub, cursor: "pointer" }}>Not yet</button>
              <button onClick={yes} style={{ flex: 1.4, background: "linear-gradient(to bottom,#2FA00E,#1F8106)", color: "#fff", border: "none", borderRadius: 16, padding: "15px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 16px rgba(33,130,0,.3)" }}>Yes, delivered ✓</button>
            </div>
            {!gmail.connected && <TextBtn onClick={() => go("deliveryupload")}>I'll upload a screenshot instead</TextBtn>}
          </div>
        )}
        {phase === "checking" && (
          <div style={{ position: "relative", animation: "fayr-rise .3s ease both" }}>
            <div style={{ width: 66, height: 66, margin: "0 auto", border: "4px solid #E2E3D4", borderTopColor: C.green, borderRadius: "50%", animation: "fayr-spin .8s linear infinite" }} />
            <h1 style={{ ...hTitle, fontSize: 21, marginTop: 22 }}>Checking your email…</h1>
            <p style={{ ...hSub, maxWidth: 280 }}>Reading your {m.name} delivery confirmation. This only takes a moment.</p>
          </div>
        )}
        {phase === "done" && (
          <div style={{ position: "relative", animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>
            <div style={{ fontSize: 72 }}>✅</div>
            <h1 style={{ ...hTitle, fontSize: 23, marginTop: 12 }}>Delivery verified</h1>
            <p style={{ ...hSub, maxWidth: 280 }}>Confirmed from your email. Taking you to the review step…</p>
          </div>
        )}
      </div>
    </Screen>
  );
}

function DeliveryUpload({ go, c, advance }) {
  const [uploaded, setUploaded] = useState(false);
  const [phase, setPhase] = useState("upload"); // upload · verifying · done
  const submit = () => {
    setPhase("verifying");
    setTimeout(() => setPhase("done"), 1800);
    setTimeout(() => { advance(c.id, 4, "write your review"); go("reviewguide"); }, 3000);
  };
  return (
    <Screen bg="#FBFBEF">
      <TopBar title="Delivery proof" onBack={() => go("taskstatus")} />
      {phase === "upload" && (<>
        <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 24px 20px", position: "relative" }}>
          <GridFloor style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 160, opacity: .4 }} />
          <h1 style={{ ...hTitle, fontSize: 28, position: "relative" }}>Upload your<br />delivery proof</h1>
          <p style={{ ...hSub }}>Show the delivered product so we can confirm it arrived. We'll verify it and take you straight to the review step.</p>
          <div onClick={() => setUploaded(true)} style={{ marginTop: 20, border: `2px dashed ${uploaded ? C.green : "#C9D89E"}`, borderRadius: 18, background: "#fff", padding: "34px 20px", display: "grid", placeItems: "center", cursor: "pointer" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: uploaded ? C.green : "#7B61FF", display: "grid", placeItems: "center", fontSize: 24, color: "#fff", boxShadow: "0 6px 16px rgba(123,97,255,.3)" }}>{uploaded ? "✓" : "↑"}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 12 }}>{uploaded ? "Image added ✓" : "Tap to upload delivery screenshot"}</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: "#a3a49a", marginTop: 4 }}>PNG or JPG · up to 5 MB</div>
          </div>
        </div>
        <div style={{ padding: "10px 24px 22px" }}>
          <Pill onClick={submit} disabled={!uploaded} color={C.ink}>Verify &amp; continue</Pill>
        </div>
      </>)}
      {phase !== "upload" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "30px 28px", textAlign: "center" }}>
          {phase === "verifying" ? (
            <div style={{ animation: "fayr-rise .3s ease both" }}>
              <div style={{ width: 66, height: 66, margin: "0 auto", border: "4px solid #E2E3D4", borderTopColor: C.green, borderRadius: "50%", animation: "fayr-spin .8s linear infinite" }} />
              <h1 style={{ ...hTitle, fontSize: 21, marginTop: 22 }}>Verifying delivery…</h1>
              <p style={{ ...hSub, maxWidth: 280 }}>Reading your screenshot to confirm the product was delivered.</p>
            </div>
          ) : (
            <div style={{ animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>
              <div style={{ fontSize: 72 }}>✅</div>
              <h1 style={{ ...hTitle, fontSize: 23, marginTop: 12 }}>Delivery verified</h1>
              <p style={{ ...hSub, maxWidth: 280 }}>Confirmed. Taking you to the review step…</p>
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}

/* Images Uploaded! — after delivery proof (reference: bottom sheet) */
function ImagesUploaded({ go, c }) {
  const m = MARKETPLACES[c.marketplace];
  return (
    <Screen bg="rgba(20,20,20,.5)">
      <div style={{ flex: 1 }} onClick={() => go("taskstatus")} />
      <div style={{ position: "relative", background: "linear-gradient(180deg,#FBEE9E 0%,#FBFBEF 30%)", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: "22px 26px 26px", animation: "fayr-rise .4s ease both", textAlign: "center" }}>
        <div style={{ width: 46, height: 4, background: "rgba(0,0,0,.12)", borderRadius: 4, margin: "0 auto 22px" }} />
        <div style={{ fontSize: 72, animation: "fayr-pop .5s cubic-bezier(.22,.61,.36,1) both" }}>✅</div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 28, color: C.ink, margin: "12px 0 20px" }}>Images Uploaded!</h1>
        <div style={{ textAlign: "left", maxWidth: 320, margin: "0 auto" }}>
          {[`Once ready, share your feedback on the ${m.name} product page.`, "After it's visible, upload screenshots of your feedback here to proceed with the refund."].map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 14, fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14.5, color: "#555", lineHeight: 1.5 }}>
              <span style={{ fontWeight: 800, color: C.ink }}>•</span><span>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Pill onClick={() => go("honesty")} color={C.green} text="#fff">Share Feedback →</Pill>
        </div>
      </div>
    </Screen>
  );
}
function OrderVerified({ go, c, rewards }) {
  const amt = (rewards[c.id] && rewards[c.id].amount) || c.maxBack;
  return (
    <Screen bg="#FBFBEF">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <MilestoneCelebration tone="green" icon="check" eyebrow="Order verified" title="Refund tracked" amount={`₹${amt}`}
          chip="● Pending in your fayr Wallet"
          sub="Tracked to your fayr Wallet as Pending. It confirms once your review is approved and the return window closes." />
      </div>
      <div style={{ padding: "0 24px 26px" }}>
        <Pill onClick={() => go("taskstatus")} color={C.green} text="#fff">Continue →</Pill>
      </div>
    </Screen>
  );
}
/* ============================================================================
   PREMIUM MILESTONE CELEBRATION — elegant, tasteful, rewarding.
   A breathing radial glow, a spring-in badge with an animated check/icon,
   concentric ring sweeps, refined confetti, and a soft amount reveal.
   No pouring money, no cartoon coins.
   ========================================================================== */
function MilestoneCelebration({ tone = "green", icon = "check", eyebrow, title, amount, sub, chip, children }) {
  const T = {
    green:  { a: "#22A80E", b: "#3FCB1E", glow: "rgba(34,168,14,.30)", ink: "#1C7A0A" },
    gold:   { a: "#E0A008", b: "#F5C518", glow: "rgba(224,160,8,.28)",  ink: "#9A6B00" },
    violet: { a: "#7B4DF0", b: "#9B6BFF", glow: "rgba(123,77,240,.28)", ink: "#5B2FC0" },
  }[tone] || {};
  const confetti = ["#22A80E", "#F5C518", "#7B4DF0", "#FF7A59", "#3FCB1E"];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", position: "relative", padding: "12px 24px" }}>
      {/* refined confetti — small, sparse, tasteful */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const left = 12 + (i * 5.6) % 76, size = 5 + (i % 3) * 2, dur = 1.5 + (i % 4) * 0.35, delay = (i % 6) * 0.12;
          const rot = (i % 2 ? 1 : -1) * (120 + (i % 5) * 60);
          return <span key={i} style={{ position: "absolute", left: left + "%", top: "18%", width: size, height: size * 1.6, borderRadius: 1.5, background: confetti[i % confetti.length], opacity: 0, "--r": rot + "deg", animation: `fayr-confetti ${dur}s cubic-bezier(.25,.6,.4,1) both`, animationDelay: delay + "s" }} />;
        })}
      </div>

      {/* badge stack: breathing glow + ring sweeps + spring-in badge */}
      <div style={{ position: "relative", width: 132, height: 132, display: "grid", placeItems: "center", marginBottom: 22 }}>
        <div style={{ position: "absolute", width: 132, height: 132, borderRadius: "50%", background: `radial-gradient(circle, ${T.glow} 0%, transparent 68%)`, animation: "fayr-glow-breathe 2.6s ease-in-out infinite" }} />
        {[0, 1].map((k) => <span key={k} style={{ position: "absolute", width: 92, height: 92, borderRadius: "50%", border: `2px solid ${T.a}`, opacity: 0, animation: "fayr-ring 2s ease-out infinite", animationDelay: k * 0.7 + "s" }} />)}
        <div style={{ position: "relative", width: 92, height: 92, borderRadius: "50%", background: `linear-gradient(145deg, ${T.b}, ${T.a})`, display: "grid", placeItems: "center", boxShadow: `0 16px 34px ${T.glow}, inset 0 2px 4px rgba(255,255,255,.35)`, animation: "fayr-badge-in .7s cubic-bezier(.34,1.56,.5,1) both" }}>
          {icon === "check" ? (
            <svg width="46" height="46" viewBox="0 0 46 46" fill="none"><path d="M13 24l7 7 13-15" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 40, animation: "fayr-check-draw .5s .35s ease-out both" }} /></svg>
          ) : (
            <span style={{ fontSize: 42, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.15))" }}>{icon}</span>
          )}
        </div>
      </div>

      {eyebrow && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: T.ink, opacity: .85, marginBottom: 8, animation: "fayr-count-up .5s .3s both" }}>{eyebrow}</div>}
      <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 27, color: C.ink, margin: 0, animation: "fayr-count-up .5s .38s both" }}>{title}</h1>
      {amount && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginTop: 14, animation: "fayr-amount-pop .6s .46s cubic-bezier(.34,1.56,.5,1) both" }}>
          <span style={{ height: 1.5, width: 30, background: `linear-gradient(90deg, transparent, ${T.a})` }} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontStyle: "italic", fontSize: 30, color: T.a }}>{amount}</span>
          <span style={{ height: 1.5, width: 30, background: `linear-gradient(90deg, ${T.a}, transparent)` }} />
        </div>
      )}
      {chip && <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, background: tone === "gold" ? "#FFF7DE" : "#EAF7E4", border: `1px solid ${tone === "gold" ? "#F3D97A" : "#9FD97F"}`, borderRadius: 100, padding: "6px 14px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 12.5, color: T.ink, animation: "fayr-count-up .5s .54s both" }}>{chip}</div>}
      {sub && <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13.5, color: C.sub, marginTop: 15, lineHeight: 1.6, maxWidth: 300, animation: "fayr-count-up .5s .6s both" }}>{sub}</p>}
      {children}
    </div>
  );
}

function Reward({ go, c, creditReward }) {
  useEffect(() => { creditReward(c); }, []); // idempotent in root
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        <MilestoneCelebration tone="green" icon="check" eyebrow="Refund paid" title="You've been paid" amount={`₹${c.maxBack}`}
          chip="✓ Credited to fayr Wallet"
          sub={`Paid ₹${c.examplePay} × ${c.pct}% refund. Your honest review made this happen.`} />
      </div>
      <div style={{ padding: "0 28px 28px" }}>
        <Pill onClick={() => go("earnings")}>VIEW WALLET</Pill>
        <TextBtn onClick={() => go("home")}>Explore more campaigns</TextBtn>
      </div>
    </Screen>
  );
}

/* ============================================================================
   MY CAMPAIGNS (Flow 16 resume) · EARNINGS/WALLET (Flow 12) · TICKETS (Flow 17)
   · PROFILE (Flows 18–19)
   ========================================================================== */
/* ============================================================================
   JOURNEY STATUS + NOTIFICATION TIMELINE
   ----------------------------------------------------------------------------
   Order & delivery are verified from marketplace emails (primary) or uploaded
   screenshots (fallback) — never from the account link. The step machine drives
   both the My Products reminder card and the notification center timeline.
   ========================================================================== */
// enrolled[id].step: 1 buy · 2 order-proof · 3 delivery-proof · 4 review · 5 verify · 6 return-window · 7 paid
function statusCard(c, e, claimed) {
  if (!e) return null;
  const s = e.step || 1;
  const mp = MARKETPLACES[c.marketplace].name;
  // status = one short line; cta = compact button label; to = destination; timer = one-line countdown
  if (s === 1) return { tone: "amber", status: "Product Claimed", cta: "Complete Purchase", to: "detail", timer: "25m 35s" };
  if (s === 2) return { tone: "amber", status: "Purchase Completed", cta: "Submit Proof", to: "proofprimer", timer: "23h 59m" };
  if (s === 3) return { tone: "blue", status: "Waiting for Delivery", cta: "Upload Delivery", to: "proofprimer", timer: null };
  if (s === 4) return { tone: "purple", status: "Review Pending", cta: "Write Review", to: "honesty", timer: null };
  if (s === 5) return { tone: "blue", status: "Waiting for Review Approval", cta: "View Status", to: "myproducts", timer: null };
  if (s === 6) return { tone: "green", status: "Refund Under Verification", cta: "View Status", to: "myproducts", timer: null };
  return { tone: "green", status: "Refund Paid", cta: "Withdraw Refund", to: "earnings", timer: null };
}
// Full activity timeline for the notification center (newest first).
function buildTimeline(campaigns, enrolled) {
  const items = [];
  const push = (icon, tone, title, sub, when) => items.push({ icon, tone, title, sub, when });
  Object.keys(enrolled).forEach((id) => {
    const c = campaigns.find((x) => x.id === id); if (!c) return;
    const e = enrolled[id]; const s = e.step || 1; const p = c.short;
    // Emit the timeline entries the user has passed, in journey order.
    if (s >= 1) push("🎯", "amber", "Product claimed", `${p} — slot reserved`, "just now");
    if (s >= 2) { push("📦", "amber", "Purchase pending", `Buy ${p} to continue`, "just now"); }
    if (s >= 2) push("🧾", "amber", "Order confirmation not submitted yet", `${p}`, "just now");
    if (s > 2) push("✅", "green", "Order confirmation uploaded", `${p}`, "1h ago");
    if (s === 3) push("🚚", "blue", "Delivery screenshot pending", `${p}`, "just now");
    if (s > 3) push("✅", "green", "Delivery screenshot uploaded", `${p}`, "2h ago");
    if (s === 4) push("✍️", "purple", "Review pending", `${p}`, "just now");
    if (s > 4) push("✅", "green", "Review submitted successfully", `${p}`, "3h ago");
    if (s > 4) push("🌟", "green", "Review approved & live", `${p}`, "4h ago");
    if (s >= 5) push("💰", "amber", "Refund added to Pending", `₹${c.maxBack} — ${p}`, "4h ago");
    if (s >= 5) push("🔎", "blue", "Refund under verification", `${p}`, "5h ago");
    if (s >= 6) push("✅", "green", "Refund approved", `₹${c.maxBack} — ${p}`, "1d ago");
    if (s >= 7) {
      push("✔️", "green", "Refund confirmed", `₹${e.earned || c.maxBack} — ${p}`, "1d ago");
      push("🏦", "green", "Payment processed", `${p}`, "1d ago");
      push("💸", "green", "Payment credited to your bank", `₹${e.earned || c.maxBack} · HDFC ••4821 · UTR 4029XX · ${new Date().toLocaleDateString("en-IN")}`, "1d ago");
    }
  });
  return items.reverse();
}
const NOTE_TONE = { amber: { bg: "#FFF8E1", dot: "#F5A623" }, blue: { bg: "#EAF2FF", dot: "#2F6FD0" }, purple: { bg: "#F2E9FD", dot: "#7926D9" }, green: { bg: "#EAF7E4", dot: "#30A90F" } };

function NotificationCenter({ go, campaigns, enrolled, onClose }) {
  const items = buildTimeline(campaigns, enrolled);
  return (
    <Screen noPad bg="#FBFBEF">
      <div style={{ background: `linear-gradient(180deg, ${C.headYellow}, ${C.headYellow2} 80%, #FBFBEF)`, padding: "0 16px 12px", flex: "0 0 auto" }}>
        <StatusSpacer />
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#fff", fontSize: 16, cursor: "pointer", boxShadow: "0 3px 8px rgba(0,0,0,.1)" }}>←</button>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, color: C.ink, margin: 0 }}>Notifications</h1>
        </div>
      </div>
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px 30px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 46 }}>🔔</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 10 }}>Nothing yet</div>
            <div style={{ ...hSub }}>Claim a product and every update — purchase, delivery, review, refund, payment — lands here as a timeline.</div>
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 8 }}>
            {items.map((n, i) => {
              const tn = NOTE_TONE[n.tone] || NOTE_TONE.blue;
              return (
                <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12, animation: "fayr-rise .4s ease both", animationDelay: i * 30 + "ms" }}>
                  <div style={{ position: "relative", flex: "0 0 auto" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: tn.bg, display: "grid", placeItems: "center", fontSize: 18 }}>{n.icon}</div>
                    {i < items.length - 1 && <span style={{ position: "absolute", left: 19, top: 42, height: "calc(100% - 30px)", borderLeft: "2px dashed #E4E5D6" }} />}
                  </div>
                  <div style={{ flex: 1, background: "#fff", borderRadius: 14, padding: "11px 13px", boxShadow: "0 3px 10px rgba(20,20,20,.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13, color: C.ink }}>{n.title}</span>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: "#a3a496", flex: "0 0 auto" }}>{n.when}</span>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{n.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Screen>
  );
}

/* Rotating reminder card — cycles through each active campaign's pending action
   every 3.5s, sliding smoothly. Dismissible. Hides itself when nothing pending. */
function RotatingStatusCard({ campaigns, enrolled, claimed, onDismiss, onAct }) {
  const [idx, setIdx] = useState(0);
  const [entering, setEntering] = useState(true);
  const [paused, setPaused] = useState(false);
  const touchX = useRef(null);
  const resumeT = useRef(null);
  const n = campaigns.length;
  useEffect(() => {
    if (n <= 1 || paused) return;
    const t = setInterval(() => {
      setEntering(false);
      setTimeout(() => { setIdx((i) => (i + 1) % n); setEntering(true); }, 200);
    }, 3500);
    return () => clearInterval(t);
  }, [n, paused]);
  useEffect(() => { if (idx >= n && n > 0) setIdx(0); }, [n, idx]);
  if (n === 0) return null;
  const c = campaigns[idx % n];
  const sc = statusCard(c, enrolled[c.id], claimed);
  if (!sc) return null;
  const tn = NOTE_TONE[sc.tone] || NOTE_TONE.green;
  const act = () => onAct(c, sc);
  const holdPause = () => { setPaused(true); clearTimeout(resumeT.current); };
  const resumeSoon = () => { clearTimeout(resumeT.current); resumeT.current = setTimeout(() => setPaused(false), 3500); };
  const swipe = (dir) => { setEntering(false); setTimeout(() => { setIdx((i) => (i + (dir > 0 ? 1 : n - 1)) % n); setEntering(true); }, 160); };
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; holdPause(); };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40 && n > 1) swipe(dx < 0 ? 1 : -1);
    touchX.current = null; resumeSoon();
  };

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onMouseDown={holdPause} onMouseUp={resumeSoon}
      style={{ background: "rgba(255,255,255,.86)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderRadius: 18, boxShadow: "0 8px 26px rgba(20,20,20,.16), 0 1px 0 rgba(255,255,255,.6) inset", border: "0.5px solid rgba(0,0,0,.05)", padding: "10px 12px" }}>
      {/* TOP ROW: progress dots + close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 12, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {n > 1 && <>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 10, color: "#9a9b8c" }}>{(idx % n) + 1}/{n}</span>
            <div style={{ display: "flex", gap: 3 }}>
              {campaigns.map((_, k) => <span key={k} onClick={() => { holdPause(); setIdx(k); resumeSoon(); }} style={{ width: k === idx % n ? 12 : 5, height: 5, borderRadius: 5, background: k === idx % n ? tn.dot : "#D6D7C8", transition: "all .3s", cursor: "pointer" }} />)}
            </div>
          </>}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" style={{ width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.06)", fontSize: 10, color: "#8a8b7f", cursor: "pointer", lineHeight: 1, display: "grid", placeItems: "center", flex: "0 0 auto" }}>✕</button>
      </div>

      {/* MIDDLE + BOTTOM (single aligned row: image | text stack | cta) */}
      <div key={idx} onClick={act} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", animation: entering ? "fayr-slidein .34s cubic-bezier(.2,.7,.3,1) both" : "none", opacity: entering ? 1 : 0, transition: "opacity .14s" }}>
        <ProductArt theme={c.theme} cid={c.id} radius={11} style={{ width: 44, height: 44, flex: "0 0 auto", background: c.heroBg }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 11.5, color: "#8a8b7f", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.short}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: tn.dot, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.status}</span>
            {sc.timer && <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 10.5, color: C.red, whiteSpace: "nowrap", flex: "0 0 auto" }}>⏰ {sc.timer} left</span>}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); act(); }} style={{ flex: "0 0 auto", background: tn.dot, color: "#fff", border: "none", borderRadius: 9, padding: "7px 12px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>{sc.cta}</button>
      </div>
    </div>
  );
}

function MyProducts({ go, enrolled, claimed, openProof, cardDismissed, dismissCard, continueStep, openTaskStatus }) {
  const [tab, setTab] = useState("progress");
  const inProgress = CAMPAIGNS.filter((c) => (claimed[c.id] || enrolled[c.id]) && !(enrolled[c.id] || {}).done);
  const refunded = [
    { ...CAMPAIGNS[1], settled: "23/4/2026", amount: 399 },
    { ...CAMPAIGNS[1], settled: "23/4/2026", amount: 399, dup: 1 },
  ];
  return (
    <Screen noPad bg="#FBFBEF">
      <div style={{ background: `linear-gradient(180deg, ${C.headYellow} 0%, ${C.headYellow2} 70%, #FBFBEF 100%)`, padding: "0 16px 14px", flex: "0 0 auto", position: "relative", overflow: "hidden" }}>
        <GridFloor style={{ position: "absolute", inset: "auto 0 0 0", width: "100%", height: 110, opacity: .45 }} />
        <StatusSpacer />
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, color: C.ink, margin: "6px 0 14px", position: "relative" }}>My Products</h1>
        <div style={{ display: "flex", background: "#fff", borderRadius: 22, padding: 3, position: "relative", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>
          {[["progress", "In Progress"], ["refunded", "Refund Claimed"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: tab === k ? C.ink : "transparent", color: tab === k ? "#fff" : C.sub, border: "none", borderRadius: 20, padding: "9px 12px", fontFamily: FONT_DISPLAY, fontWeight: tab === k ? 700 : 500, fontSize: 13.5, cursor: "pointer", transition: "all .2s" }}>{label}</button>
          ))}
        </div>
      </div>
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px 92px" }}>
        {/* taped handwritten note (screenshot) */}
        <div style={{ position: "relative", margin: "2px auto 18px", maxWidth: 300, background: "#F3F2E8", padding: "9px 16px", transform: "rotate(-1.5deg)", boxShadow: "0 2px 8px rgba(0,0,0,.07)", clipPath: "polygon(2% 0, 98% 3%, 100% 96%, 0 100%)" }}>
          <span style={{ position: "absolute", top: -7, left: 24, width: 42, height: 13, background: "rgba(228,222,170,.85)", transform: "rotate(-6deg)" }} />
          <span style={{ position: "absolute", top: -7, right: 24, width: 42, height: 13, background: "rgba(228,222,170,.85)", transform: "rotate(5deg)" }} />
          <p style={{ margin: 0, fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 500, fontSize: 12, color: "#6f7065", textAlign: "center" }}>
            {tab === "progress" ? "Claimed products awaiting proof submission will appear here." : "Claimed products with settled claims will appear here."}
          </p>
        </div>

        {tab === "progress" ? (
          inProgress.length ? inProgress.map((c, i) => <ProgressRow key={c.id} c={c} e={enrolled[c.id]} delay={i * 70} onOpen={() => openTaskStatus(c)} onAct={(sc) => { if (sc.to === "detail") continueStep(c); else if (sc.to === "proofprimer") openProof(c); else go(sc.to); }} />) : (
            <div style={{ textAlign: "center", padding: "44px 20px" }}>
              <div style={{ fontSize: 46 }}>🛍️</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 10 }}>Nothing in progress</div>
              <div style={{ ...hSub }}>Claim a product from Home to get started.</div>
            </div>
          )
        ) : (
          refunded.map((c, i) => <RefundedRow key={i} c={c} delay={i * 70} />)
        )}
        <p style={{ textAlign: "center", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 9.5, letterSpacing: "1.8px", color: "#b0b1a2", marginTop: 22 }}>SECURE FAYR TRACKING</p>
      </div>
      <BottomNav tab="myproducts" go={go} />
    </Screen>
  );
}
// Per-stage chip label + short CTA for each campaign row
function stageMeta(step) {
  switch (step) {
    case 1: return { label: "Purchase pending", tone: "amber", cta: "Buy now", to: "detail", timer: true };
    case 2: return { label: "Order proof pending", tone: "amber", cta: "Upload order proof", to: "proofprimer", timer: true };
    case 3: return { label: "Delivery proof pending", tone: "blue", cta: "Upload delivery proof", to: "proofprimer", timer: false };
    case 4: return { label: "Review pending", tone: "purple", cta: "Submit review", to: "honesty", timer: false };
    case 5: return { label: "Under verification", tone: "blue", cta: null, to: null, timer: false };
    case 6: return { label: "In return window", tone: "green", cta: null, to: null, timer: false };
    default: return { label: "Refund on the way", tone: "green", cta: null, to: null, timer: false };
  }
}
const STAGE_TONE = { amber: { bg: "#FFF8E1", line: "#FECA3A", dot: "#F5A623", fg: "rgba(0,0,0,.8)" }, blue: { bg: "#EAF2FF", line: "#9CC3FF", dot: "#2F6FD0", fg: "#2F6FD0" }, purple: { bg: "#F2E9FD", line: "#CDB4F0", dot: "#7926D9", fg: "#7926D9" }, green: { bg: "#EAF7E4", line: "#9FDB86", dot: "#30A90F", fg: "#30A90F" } };
function ProgressRow({ c, e, delay, onAct, onOpen }) {
  const step = (e && e.step) || 1;
  const m = stageMeta(step);
  const tn = STAGE_TONE[m.tone];
  const [t, setT] = useState(step === 1 ? 25 * 60 + 35 : 23 * 3600 + 59 * 60);
  useEffect(() => { const id = setInterval(() => setT((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(id); }, []);
  const timeLabel = step === 1
    ? `${Math.floor(t / 60)}m : ${String(t % 60).padStart(2, "0")}s`
    : `${Math.floor(t / 3600)}h : ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m`;
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 12, marginBottom: 12, boxShadow: "0 6px 14px rgba(0,0,0,.07)", animation: "fayr-rise .45s cubic-bezier(.22,.61,.36,1) both", animationDelay: delay + "ms" }}>
      <div onClick={onOpen} style={{ display: "flex", gap: 12, cursor: onOpen ? "pointer" : "default" }}>
        <div style={{ position: "relative", width: 88, height: 102, flex: "0 0 auto" }}>
          <ProductArt theme={c.theme} cid={c.id} radius={12} style={{ position: "absolute", inset: 0, background: c.heroBg }} />
          <BrandTab mid={c.marketplace} h={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.refundBg, borderRadius: 6, padding: "2px 8px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 11.5, color: C.refundInk }}>{c.pct}% Refund 💵</span>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, color: C.ink, marginTop: 6, lineHeight: 1.35 }}>{c.product}</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 9, background: tn.bg, border: `1px solid ${tn.line}`, borderRadius: 100, padding: "4px 12px", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: tn.fg }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tn.dot }} /> {m.label}
          </span>
          {/* mini step tracker: 1 buy → 2 order → 3 delivery → 4 review → 5 verify → 6 window → 7 paid */}
          <div style={{ display: "flex", gap: 3, marginTop: 9 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((k) => (
              <span key={k} style={{ flex: 1, height: 3, borderRadius: 3, background: k < step ? C.green : k === step ? tn.dot : "#E7E8D6" }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ height: 1, background: "linear-gradient(90deg,rgba(182,185,188,0),rgba(182,185,188,.55),rgba(182,185,188,0))", margin: "11px 0" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {m.timer ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "linear-gradient(90deg,#FFEAEA,rgba(255,234,234,.1))", borderRadius: 5, padding: "4px 10px" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontStyle: "italic", fontSize: 11.5, color: C.red }}>{timeLabel}</span>
            <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontSize: 10, color: "#726d73" }}>Remaining</span>
          </span>
        ) : (
          <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 500, fontSize: 11, color: "#8b8c80" }}>Step {step} of 7</span>
        )}
        {m.cta ? (
          <button onClick={() => onAct(m)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(to bottom,#218200,#1D7400)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontFamily: FONT_DISPLAY, fontWeight: 600, fontStyle: "italic", fontSize: 12.5, cursor: "pointer", boxShadow: "0 4px 10px rgba(33,130,0,.3)" }}>{m.cta} ›</button>
        ) : (
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontStyle: "italic", fontSize: 11.5, color: tn.fg }}>No action needed</span>
        )}
      </div>
    </div>
  );
}
function RefundedRow({ c, delay }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 12, marginBottom: 12, boxShadow: "0 6px 14px rgba(0,0,0,.07)", animation: "fayr-rise .45s cubic-bezier(.22,.61,.36,1) both", animationDelay: delay + "ms" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ position: "relative", width: 88, height: 96, flex: "0 0 auto" }}>
          <ProductArt theme={c.theme} cid={c.id} radius={12} style={{ position: "absolute", inset: 0, background: c.heroBg }} />
          <BrandTab mid={c.marketplace} h={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.refundBg, borderRadius: 6, padding: "2px 8px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontStyle: "italic", fontSize: 11.5, color: C.refundInk }}>{c.pct}% Refund 💵</span>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13.5, color: C.ink, marginTop: 6, lineHeight: 1.35 }}>{c.product}</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, background: "#D4FFE2", border: "1px solid #1FD75D", borderRadius: 100, padding: "4px 12px", fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: "rgba(0,0,0,.8)" }}>
            <span style={{ color: C.greenDeep, fontWeight: 900 }}>✓</span> Refunded
          </span>
        </div>
      </div>
      <div style={{ height: 1, background: "linear-gradient(90deg,rgba(182,185,188,0),rgba(182,185,188,.55),rgba(182,185,188,0))", margin: "11px 0 9px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontWeight: 500, fontSize: 10.5, color: C.sub }}>Claim settled on {c.settled}</span>
        <span style={{ fontFamily: FONT_BODY, fontStyle: "italic", fontSize: 10.5, color: C.sub }}>Amount: <b style={{ fontSize: 16, color: C.ink, fontStyle: "normal" }}>₹{c.amount}</b></span>
      </div>
    </div>
  );
}
// "My Profile" tab (the 4th nav slot — formerly "Insights"). Shows the user's
// profile at the top with REAL stats, and a Log out button at the very bottom.
// Stats use exactly the same real sources as the Earnings screen so the numbers
// match: total earned = withdrawable wallet + paid + pending withdrawals; products
// reviewed = tasks whose review has been submitted (REVIEWED / HOLDING / REFUNDED).
function Insights({ go, name, phone, gmail, emailVerified, wallet, onLogout, openEmailConnect }) {
  const [wds, setWds] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    backendApi.listWithdrawals().then((w) => setWds(w || [])).catch(() => setWds([]));
    backendApi.listTasks().then((t) => setTasks(t || [])).catch(() => setTasks([]));
  }, []);
  const sumR = (arr) => arr.reduce((s, w) => s + Number(w.amountPaise), 0) / 100;
  const withdrawable = (Number(wallet) || 0) / 100;
  const paid = sumR(wds.filter((w) => w.status === "PAID"));
  const pending = sumR(wds.filter((w) => w.status === "REQUESTED" || w.status === "APPROVED"));
  const totalEarned = withdrawable + paid + pending;
  const reviewedCount = tasks.filter((t) => ["REVIEWED", "HOLDING", "REFUNDED"].includes(t.state)).length;
  const inboxSub = gmail && gmail.connected ? "Gmail connected · auto-verifying orders"
    : emailVerified ? "Email verified · connect Gmail for auto-verification"
    : "Not connected · using screenshots";
  const doLogout = async () => { if (signingOut) return; setSigningOut(true); try { await (onLogout && onLogout()); } finally { setSigningOut(false); } };
  const stat = (v, l) => (
    <div key={l} style={{ flex: 1, background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 4px 12px rgba(0,0,0,.06)", textAlign: "center" }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 22, color: C.ink }}>{v}</div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginTop: 3 }}>{l}</div>
    </div>
  );
  return (
    <Screen noPad bg="#FBFBEF">
      <div style={{ padding: "0 16px", flex: "0 0 auto" }}>
        <StatusSpacer />
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, color: C.ink, margin: "6px 0 12px" }}>My Profile</h1>
      </div>
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 92px" }}>
        {/* profile info */}
        <div style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", borderRadius: 16, padding: "14px 15px", boxShadow: "0 4px 12px rgba(0,0,0,.06)" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.purpleBg, display: "grid", placeItems: "center", fontSize: 24, flex: "0 0 auto" }}>👤</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 19, color: C.ink2 }}>{name || "there"}</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.sub }}>{phone ? "+91 " + String(phone).replace(/(\d{5})(\d{5})/, "$1 $2") : "Phone verified"}</div>
          </div>
        </div>
        {/* real stats — same sources as the Earnings screen */}
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          {stat("₹" + totalEarned.toLocaleString(undefined, { maximumFractionDigits: 2 }), "Total earned")}
          {stat(String(reviewedCount), "Products reviewed")}
        </div>
        {/* quick links into the existing screens */}
        <div style={{ background: "#fff", borderRadius: 16, marginTop: 12, boxShadow: "0 4px 12px rgba(0,0,0,.06)", overflow: "hidden" }}>
          {[
            ["💰", "Earnings & withdrawals", "See withdrawable balance and payout history", () => go("earnings")],
            ["🛍️", "My Products", "Track every claim and refund", () => go("myproducts")],
            ["📧", gmail && gmail.connected ? "Connected inbox ✓" : "Connected inbox", inboxSub, openEmailConnect],
            ["⚙️", "Account & settings", "Privacy, security, notifications, help", () => go("profile")],
          ].map(([ic, t, s, fn], i, a) => (
            <div key={t} onClick={fn || undefined} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 15px", borderBottom: i < a.length - 1 ? `1px solid ${C.line}` : "none", cursor: fn ? "pointer" : "default" }}>
              <span style={{ fontSize: 19, width: 24, textAlign: "center" }}>{ic}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: C.ink }}>{t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: C.sub, marginTop: 1 }}>{s}</div>
              </div>
              <span style={{ color: "#b7b8aa", fontSize: 18 }}>›</span>
            </div>
          ))}
        </div>
        {/* log out — bottom of the scroll */}
        <button onClick={doLogout} disabled={signingOut}
          style={{ width: "100%", marginTop: 16, background: "#fff", border: `1.5px solid ${C.red}`, borderRadius: 14, padding: "14px 16px", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.red, cursor: signingOut ? "default" : "pointer", opacity: signingOut ? 0.6 : 1 }}>
          {signingOut ? "Logging out…" : "Log out"}
        </button>
      </div>
      <BottomNav tab="insights" go={go} />
    </Screen>
  );
}
function Earnings({ go, wallet }) {
  // Real figures: withdrawable = the refundable wallet balance; paid/pending come
  // from the user's real withdrawals (GET /withdrawals).
  const [wds, setWds] = useState([]);
  useEffect(() => { backendApi.listWithdrawals().then((w) => setWds(w || [])).catch(() => setWds([])); }, []);
  const sumR = (arr) => arr.reduce((s, w) => s + Number(w.amountPaise), 0) / 100;
  const withdrawable = (Number(wallet) || 0) / 100;
  const paid = sumR(wds.filter((w) => w.status === "PAID"));
  const pending = sumR(wds.filter((w) => w.status === "REQUESTED" || w.status === "APPROVED"));
  const allTime = withdrawable + paid + pending;
  return (
    <Screen noPad bg="#FBFBEF">
      {/* yellow header */}
      <div style={{ background: `linear-gradient(180deg, ${C.headYellow} 0%, ${C.headYellow2} 62%, #FBFBEF 100%)`, padding: "0 18px 6px", flex: "0 0 auto", position: "relative", overflow: "hidden" }}>
        <StatusSpacer />
        <div style={{ display: "flex", justifyContent: "flex-end", position: "relative" }}>
          <button onClick={() => go("notifcenter")} style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", border: "none", fontSize: 16, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.08)", position: "relative" }}>🔔<span style={{ position: "absolute", top: 7, right: 8, width: 8, height: 8, borderRadius: "50%", background: C.red, border: "1.5px solid #fff" }} /></button>
        </div>
        <div style={{ textAlign: "center", position: "relative", marginTop: 6, paddingBottom: 8 }}>
          <span style={{ position: "absolute", left: 6, top: 8, fontSize: 30, transform: "rotate(-12deg)" }}>💵</span>
          <span style={{ position: "absolute", right: 6, top: 4, fontSize: 30, transform: "rotate(10deg)" }}>💵</span>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 52, color: C.ink, letterSpacing: "-0.03em", lineHeight: 1 }}>₹{allTime.toLocaleString()}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontStyle: "italic", fontSize: 20, color: C.ink, marginTop: 4, textShadow: "0 2px 0 rgba(255,255,255,.6)" }}>Your All Time Earnings ✨</div>
        </div>
      </div>

      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px 92px" }}>
        {/* stat cards grid */}
        <div style={{ display: "flex", gap: 12 }}>
          {/* left column: Pending + Paid */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "15px 15px", boxShadow: "0 5px 14px rgba(20,20,20,.06)", position: "relative", minHeight: 78 }}>
              <div style={{ position: "absolute", top: 12, right: 12, width: 40, height: 40, borderRadius: 10, background: "#FDECEC", display: "grid", placeItems: "center", fontSize: 18 }}>🪙</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: C.ink }}>Pending <span style={{ color: "#c3c4b6" }}>ⓘ</span></div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 22, color: C.ink, marginTop: 4 }}>₹{pending.toFixed(1)}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 18, padding: "15px 15px", boxShadow: "0 5px 14px rgba(20,20,20,.06)", position: "relative", minHeight: 78 }}>
              <div style={{ position: "absolute", top: 12, right: 12, width: 40, height: 40, borderRadius: 10, background: "#FDF3E0", display: "grid", placeItems: "center", fontSize: 18 }}>👛</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: C.ink }}>Paid <span style={{ color: "#c3c4b6" }}>ⓘ</span></div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 22, color: C.ink, marginTop: 4 }}>₹{paid.toFixed(1)}</div>
            </div>
          </div>
          {/* right column: Withdrawable + Withdraw button */}
          <div style={{ flex: 1, background: "#fff", borderRadius: 18, padding: "15px 15px", boxShadow: "0 5px 14px rgba(20,20,20,.06)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, background: "#FDF3E0", display: "grid", placeItems: "center", fontSize: 24, alignSelf: "center" }}>🏧</div>
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: C.ink }}>Withdrawable</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24, color: C.ink, marginTop: 2 }}>₹{withdrawable.toFixed(1)}</div>
            </div>
            <button onClick={() => go("withdraw")} style={{ width: "100%", marginTop: 12, background: C.green, color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 14px rgba(48,169,15,.3)" }}>Withdraw</button>
          </div>
        </div>

        {/* menu */}
        <div style={{ background: "#fff", borderRadius: 18, marginTop: 14, boxShadow: "0 5px 14px rgba(20,20,20,.06)", overflow: "hidden" }}>
          {[["🛍", "My Products", () => go("myproducts")], ["📄", "Frequently Asked Questions", () => go("howfayr")], ["❓", "Get Help", () => go("profile")]].map(([ic, label, fn], i, a) => (
            <div key={label} onClick={fn} style={{ display: "flex", alignItems: "center", gap: 14, padding: "17px 16px", borderBottom: i < a.length - 1 ? `1px solid ${C.line}` : "none", cursor: "pointer" }}>
              <span style={{ fontSize: 19, width: 24, textAlign: "center" }}>{ic}</span>
              <span style={{ flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.ink }}>{label}</span>
              <span style={{ color: "#b7b8aa", fontSize: 18 }}>›</span>
            </div>
          ))}
        </div>
      </div>
      <BottomNav tab="earnings" go={go} />
    </Screen>
  );
}
// Real cash-out (Phase 3). Talks to the backend: add a payout method (UPI + PAN),
// then request a withdrawal — funds are RESERVED server-side (the wallet balance
// drops immediately) and the payout is disbursed by ops. The +10 completion
// tickets land when ops marks it paid (not faked here).
function Withdraw({ go, wallet, refreshWallet }) {
  const [methods, setMethods] = useState(null); // null = loading, [] = none yet
  const [upi, setUpi] = useState("");
  const [pan, setPan] = useState("");
  const [amount, setAmount] = useState(""); // whole rupees, as a string
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null); // the created withdrawal

  const balPaise = Number(wallet) || 0;
  useEffect(() => {
    backendApi.listPayoutMethods().then((m) => setMethods(m || [])).catch(() => setMethods([]));
  }, []);
  useEffect(() => { if (amount === "" && balPaise > 0) setAmount(String(Math.floor(balPaise / 100))); }, [balPaise]);

  const inputStyle = { width: "100%", boxSizing: "border-box", background: C.cream, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "12px 13px", fontFamily: "ui-monospace, monospace", fontSize: 13.5, color: C.ink2, outline: "none" };

  const addMethod = async () => {
    setErr("");
    if (!upi.trim() || !pan.trim()) { setErr("Enter both a UPI ID and your PAN."); return; }
    setBusy(true);
    try {
      const m = await backendApi.addPayoutMethod({ type: "UPI", upiId: upi.trim(), pan: pan.trim().toUpperCase() });
      setMethods((ms) => [m, ...(ms || [])]);
      setUpi(""); setPan("");
    } catch (e) { setErr(e.message || "Couldn't add that payout method."); }
    setBusy(false);
  };
  const submit = async () => {
    setErr("");
    const paise = Math.round(Number(amount) * 100);
    if (!(paise > 0)) { setErr("Enter an amount to withdraw."); return; }
    if (paise > balPaise) { setErr("That's more than your withdrawable balance."); return; }
    setBusy(true);
    try {
      const w = await backendApi.requestWithdrawal(paise, methods[0].id);
      setDone(w);
      await refreshWallet();
    } catch (e) { setErr(e.message || "Withdrawal failed."); }
    setBusy(false);
  };

  const hasMethod = Array.isArray(methods) && methods.length > 0;

  return (
    <Screen>
      <TopBar title="Withdraw" onBack={() => go("earnings")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        {done ? (
          <div style={{ paddingTop: 30 }}>
            <MilestoneCelebration tone="gold" icon="🏦" eyebrow="Withdrawal requested" title={"₹" + rupees(Number(done.amountPaise)) + " on its way"}
              chip="⏳ Pending payout"
              sub="Your cash-out is reserved and queued for payout. If a payout ever fails it returns to your wallet automatically. Your +10 completion tickets are credited once the payout is confirmed." />
          </div>
        ) : methods === null ? (
          <p style={{ ...hSub, marginTop: 20 }}>Loading…</p>
        ) : (
          <>
            <h1 style={{ ...hTitle, fontSize: 23 }}>Cash out your refunds</h1>
            <p style={hSub}>Withdrawable balance: <b style={{ color: C.ink2 }}>₹{rupees(balPaise)}</b>. Minimum withdrawal is ₹100.</p>

            {!hasMethod ? (
              <CardBox style={{ marginTop: 16 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 6 }}>UPI ID</div>
                <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" style={inputStyle} />
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.sub, margin: "12px 0 6px" }}>PAN (fraud anchor)</div>
                <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} style={inputStyle} />
              </CardBox>
            ) : (
              <CardBox style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink2 }}>Paying to {methods[0].label}</div>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 6 }}>Amount (₹)</div>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" style={inputStyle} />
              </CardBox>
            )}
            {err && <p style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: C.red, marginTop: 12 }}>{err}</p>}
          </>
        )}
      </div>
      <div style={{ padding: "10px 20px 20px" }}>
        {done ? (
          <Pill onClick={() => go("earnings")}>DONE</Pill>
        ) : methods === null ? null : !hasMethod ? (
          <Pill onClick={addMethod} disabled={busy} color={busy ? "#cfcfcf" : C.ink}>{busy ? "ADDING…" : "ADD PAYOUT METHOD"}</Pill>
        ) : (
          <Pill onClick={submit} disabled={busy || balPaise <= 0} color={busy || balPaise <= 0 ? "#cfcfcf" : C.ink}>{busy ? "REQUESTING…" : "WITHDRAW ₹" + (amount || "0")}</Pill>
        )}
      </div>
    </Screen>
  );
}
function Tickets({ go, tickets }) {
  return (
    <Screen>
      <TopBar title="Your tickets" onBack={() => go("home")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        <CardBox style={{ textAlign: "center", padding: 22 }}>
          <div style={{ fontSize: 40 }}>🎟</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 34, color: C.ink2, marginTop: 6 }}>{tickets.balance}</div>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.sub }}>available now</div>
        </CardBox>
        <CardBox style={{ marginTop: 12 }}>
          <Row a="Available" b={`${tickets.balance} tickets`} />
          <Row a="Held in active claims" b={`${Object.values(tickets.held||{}).reduce((s,n)=>s+n,0)} tickets`} last />
        </CardBox>
        {Object.keys(tickets.held||{}).length > 0 && (
          <div style={{ marginTop: 12, background: C.greenBg, border: "1px solid #1FD75D", borderRadius: 12, padding: "11px 13px", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: C.greenDeep }}>
            Held tickets return if a claim expires before purchase. Complete campaigns to earn more.
          </div>
        )}
        <CardBox style={{ marginTop: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.ink2, marginBottom: 8 }}>The loop</div>
          <p style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: C.sub, lineHeight: 1.6 }}>
            Start with 20 → joining locks a few → completing returns them <b style={{ color: C.ink2 }}>inside the refund celebration</b> — both currencies close their loop together.
          </p>
        </CardBox>
      </div>
    </Screen>
  );
}
function Profile({ go, name, phone, gmail, emailVerified, openEmailConnect, onLogout }) {
  const [signingOut, setSigningOut] = useState(false);
  const doLogout = async () => { if (signingOut) return; setSigningOut(true); try { await (onLogout && onLogout()); } finally { setSigningOut(false); } };
  const inboxSub = gmail.connected ? "Gmail connected · auto-verifying orders · disconnect anytime"
    : emailVerified ? "Email verified · connect Gmail for automatic order verification"
    : "Gmail order-email scanning · disconnect anytime";
  const rows = [
    ["✏️", "Edit preferences", "Same components as setup — your feed re-curates after save", null],
    ["🔐", "Account & security", "Phone change (OTP on both numbers) · device list with remote logout", null],
    ["🔔", "Notifications", "Deadline alerts default ON with friction to disable · marketing separable (TRAI DND)", null],
    ["📧", gmail.connected ? "Connected inbox ✓" : "Connected inbox", inboxSub, openEmailConnect],
    ["🆘", "Help & support", "Category picker with your campaign context auto-attached — zero re-explaining", null],
    ["🗑️", "Delete account", "Consequences first: balance, active campaigns, pending refunds", null],
  ];
  return (
    <Screen noPad>
      <div style={{ padding: "0 16px", flex: "0 0 auto" }}>
        <StatusSpacer />
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 14px" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.purpleBg, display: "grid", placeItems: "center", fontSize: 24 }}>👤</div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, color: C.ink2 }}>{name || "Prakash"}</div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: C.sub }}>+91 {(phone || "7980952792").replace(/(\d{5})(\d{5})/, "$1 $2")}</div>
          </div>
        </div>
      </div>
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 90px" }}>
        {/* privacy & permissions — at-a-glance control center (trust) */}
        <div style={{ background: "linear-gradient(135deg,#F0FBEA,#F7FCF3)", border: "1px solid #CBEBB8", borderRadius: 16, padding: "14px 15px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 4 }}>🛡️ Your privacy, your control</div>
          <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: C.sub, marginBottom: 12, lineHeight: 1.45 }}>Everything you've allowed — change any of it anytime.</div>
          {[
            ["📧", "Order email reading", gmail.connected ? "On · order emails only" : "Off · using screenshots", gmail.connected ? "green" : "grey", openEmailConnect],
            ["🛍️", "Marketplace account match", "Confirms it's you · no password, no order access", "green", null],
            ["🔔", "Deadline reminders", "On · never miss a claim window", "green", null],
          ].map(([ic, t, s, tone, onClick]) => (
            <div key={t} onClick={onClick || undefined} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid rgba(0,0,0,.05)", cursor: onClick ? "pointer" : "default" }}>
              <span style={{ fontSize: 17 }}>{ic}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: C.ink2 }}>{t}</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 10.5, color: C.sub, marginTop: 1 }}>{s}</div>
              </div>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone === "green" ? C.green : "#C7C8B9", flex: "0 0 auto" }} />
              {onClick && <span style={{ color: "#b7b8aa", fontSize: 15 }}>›</span>}
            </div>
          ))}
        </div>
        {rows.map(([i, t, s, onClick]) => (
          <div key={t} onClick={onClick || undefined} style={{ background: "#fff", borderRadius: 14, padding: "13px 14px", marginBottom: 10, boxShadow: "0 4px 12px rgba(20,20,20,.05)", display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 20 }}>{i}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: t === "Delete account" ? C.red : C.ink2 }}>{t}</div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: C.sub, marginTop: 2, lineHeight: 1.45 }}>{s}</div>
            </div>
            <span style={{ color: "#c2c3b3" }}>›</span>
          </div>
        ))}
        <button onClick={doLogout} disabled={signingOut}
          style={{ width: "100%", marginTop: 6, background: "#fff", border: `1.5px solid ${C.red}`, borderRadius: 14, padding: "14px 16px", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14, color: C.red, cursor: signingOut ? "default" : "pointer", opacity: signingOut ? 0.6 : 1 }}>
          {signingOut ? "Logging out…" : "Log out"}
        </button>
      </div>
      <BottomNav tab="profile" go={go} />
    </Screen>
  );
}

/* ============================================================================
   ROOT
   ========================================================================== */
// ── Live-logic harness ──────────────────────────────────────────────────────
// Drives the REAL taskflow state machine (via src/bridge.js) with real buttons,
// so the verification logic — hold window, visibility re-check, returned-blocks-
// refund, idempotent transitions — can be exercised in the browser. Evidence is
// simulated (the native WebView fetch can't run on web), but structurally
// identical to a real fetch, so the state machine can't tell the difference.
function VerifierDemo({ go }) {
  const c = CAMPAIGNS.find((x) => x.id === "c2"); // Amazon, 90% of ₹449
  const NOW = () => Date.now();
  const [task, setTask] = useState(() => bridge.taskForCampaign(c));
  const [log, setLog] = useState([]);
  const [returned, setReturned] = useState(false);
  const [reviewLive, setReviewLive] = useState(true);

  const v = bridge.view(task, c, NOW());
  const fire = (label, ev) => {
    const res = bridge.apply(task, ev);
    setTask(res.task);
    setLog((l) => [{ label, ok: !res.rejected && res.changed, reason: res.reason }, ...l].slice(0, 8));
  };
  const reset = () => { setTask(bridge.taskForCampaign(c)); setLog([]); setReturned(false); setReviewLive(true); };

  // Delivery is dated in the past so the return window is already closed — lets
  // the demo reach "eligible" without waiting real days.
  const past = { orderAt: NOW() - 12 * 864e5, deliveryAt: NOW() - 9 * 864e5 };

  const btn = (label, onClick, tone = "#2FA00E", disabled = false) => (
    <button onClick={onClick} disabled={disabled} style={{
      display: "block", width: "100%", marginBottom: 8, padding: "11px",
      border: "none", borderRadius: 12, cursor: disabled ? "default" : "pointer",
      background: disabled ? "#E4E4D6" : tone, color: disabled ? "#9a9b8c" : "#fff",
      fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5,
    }}>{label}</button>
  );
  const kv = (k, val, tone = C.ink) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: FONT_BODY, fontSize: 12.5 }}>
      <span style={{ color: "#8a8b7c" }}>{k}</span><span style={{ color: tone, fontWeight: 700 }}>{val}</span>
    </div>
  );

  return (
    <Screen bg="#F5F4EC">
      <TopBar title="Verifier · live logic" onBack={() => go("home")} />
      <div className="fayr-scroll" style={{ flex: 1, overflowY: "auto", padding: "6px 18px 22px" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: "#9a9b8c", marginBottom: 12, lineHeight: 1.5 }}>
          Real state machine, simulated evidence. {c.product} · {c.pct}% of ₹{c.examplePay}.
        </div>

        <CardBox style={{ marginBottom: 14 }}>
          {kv("State", v.state, "#2F6FD0")}
          {kv("Prototype step", v.step + " / 9")}
          {kv("Refund", v.refundPaise == null ? "—" : "₹" + v.refundDisplay, "#2E8B0F")}
          {kv("  in paise (ledger)", v.refundPaise == null ? "—" : v.refundPaise + " p")}
          {kv("  to rupee wallet", v.refundRupees == null ? "—" : "₹" + v.refundRupees + "  (drops ₹0." + String((v.refundPaise || 0) % 100).padStart(2, "0") + ")")}
          {kv("Delivered", v.delivery ? new Date(v.delivery.at).toDateString() : "—")}
          {kv("Review live", v.review ? (v.review.published ? "Yes" : "No") : "—")}
          {kv("Returned", v.returned == null ? "—" : v.returned ? "Yes" : "No", v.returned ? "#b3261e" : C.ink)}
          {kv("Window ends", v.windowEndsAt ? new Date(v.windowEndsAt).toDateString() : "—")}
          {kv("Eligible to refund", v.eligible ? "✓ yes" : "no", v.eligible ? "#22A80E" : "#b0772a")}
          {!v.eligible && v.blockedReasons.length ? (
            <div style={{ marginTop: 6, background: "#FFF8F0", borderRadius: 8, padding: 8 }}>
              {v.blockedReasons.map((r) => (
                <div key={r} style={{ fontFamily: FONT_BODY, fontSize: 11, color: "#8a6a3a", lineHeight: 1.5 }}>• {r}</div>
              ))}
            </div>
          ) : null}
        </CardBox>

        {/* scenario toggles — flip BEFORE fetching order evidence */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[["Order returned", returned, setReturned], ["Review live", reviewLive, setReviewLive]].map(([lbl, on, set]) => (
            <button key={lbl} onClick={() => set((x) => !x)} style={{
              flex: 1, padding: "7px", border: "1px solid " + (on ? "#9FD97F" : "#e0e0d4"), borderRadius: 10,
              background: on ? "#E7F6E0" : "#fff", color: on ? "#2E8B0F" : "#8a8b7c",
              fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11, cursor: "pointer",
            }}>{on ? "● " : "○ "}{lbl}</button>
          ))}
        </div>

        {btn("1 · Fetch order + delivery (simulated)", () => fire("order+delivery", bridge.events.simulated(c, { ...past, published: reviewLive, returned, orderId: "SIM-" + c.id })), "#2FA00E", v.step >= 4)}
        {btn("2 · Mark reviewed", () => fire("mark reviewed", bridge.events.markReviewed(NOW())), "#2FA00E", v.state !== bridge_STATE.DELIVERED)}
        {btn("3 · Start return-window hold", () => fire("start hold", bridge.events.startHold(NOW())), "#2FA00E", v.state !== bridge_STATE.REVIEWED)}
        {btn("Re-check visibility: review DELETED", () => fire("review deleted", bridge.events.visibility(false, NOW())), "#b3261e", v.state !== bridge_STATE.HOLDING)}
        {btn("Re-check visibility: still live", () => fire("still live", bridge.events.visibility(true, NOW())), "#7B61FF", v.state !== bridge_STATE.HOLDING)}
        {btn("4 · Release refund to wallet", () => fire("release", bridge.events.release(NOW())), "#0C831F", !v.eligible)}

        <button onClick={reset} style={{ display: "block", width: "100%", marginTop: 6, padding: 10, border: "none", background: "transparent", color: "#bbb", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Reset</button>

        {log.length ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: ".08em", color: "#8a8b7c", textTransform: "uppercase", marginBottom: 6 }}>Event log</div>
            {log.map((e, i) => (
              <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: e.ok ? "#2E8B0F" : "#b0772a", padding: "2px 0" }}>
                {e.ok ? "✓" : "•"} {e.label} — {e.reason}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Screen>
  );
}
// Local alias so the buttons above stay readable.
const bridge_STATE = { CLAIMED: "CLAIMED", PURCHASED: "PURCHASED", DELIVERED: "DELIVERED", REVIEWED: "REVIEWED", HOLDING: "HOLDING", REFUNDED: "REFUNDED" };

function FayrApp() {
  useGlobalStyle();
  const [screen, setScreen] = useState("splash");
  const [name, setName] = useState("Prakash");
  const [tcName, setTcName] = useState(""); // full verified name from Truecaller, for onboarding pre-fill
  const [phone, setPhone] = useState("");
  const [authVia, setAuthVia] = useState("phone");
  const [session, setSession] = useState(null); // real backend session from /auth/otp/verify: { accessToken, refreshToken, user }
  const [profile, setProfile] = useState({});
  // Ticket economy (your spec): start 15 · claim costs 5 (deducted immediately) ·
  // expired claim → 5 returned · purchase made → 5 consumed permanently ·
  // full completion + withdrawal → 10 returned.
  const TICKET_COST = 5;
  const [tickets, setTickets] = useState({ balance: 15, held: {} }); // held[id] = tickets locked by an active (pre-purchase) claim
  const [wallet, setWallet] = useState(124000); // INTEGER PAISE (₹1,240.00)
  // Demo seed: two active campaigns in different stages (c1 purchased-awaiting-order-proof, c3 claimed-not-bought)
  const [enrolled, setEnrolled] = useState({
    c1: { step: 2, stepLabel: "upload order proof" },
    c3: { step: 1, stepLabel: "buy the product" },
  });
  const [active, setActive] = useState(CAMPAIGNS[0]);
  const [netState, setNetState] = useState("ok"); // ok | offline | error (dev)
  const [gmail, setGmail] = useState({ connected: false });
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [notifAsked, setNotifAsked] = useState(false);
  const [emailReturnTo, setEmailReturnTo] = useState("proofprimer");
  const [proofSource, setProofSource] = useState("screenshot"); // 'email' | 'screenshot'
  const [linked, setLinked] = useState({}); // marketplace id -> { at } once account verified
  const [claimed, setClaimed] = useState({ c1: { at: Date.now() }, c3: { at: Date.now() } }); // campaign id -> { at } once slot reserved
  const [videoSeen, setVideoSeen] = useState(false); // "How it works" shows once, ever
  const [notifCardDismissed, setNotifCardDismissed] = useState(false);
  const [notifsRead, setNotifsRead] = useState(false);
  const [history] = useState([
    { t: "Mamaearth Face Wash", a: 180, s: "Paid", d: "UTR · 28 Jun" },
    { t: "Boat Airdopes 141", a: 320, s: "Paid", d: "UTR · 12 Jun" },
    { t: "Dove Sakura Body Wash", a: 280, s: "In return window", d: "ETA 9 Jul" },
  ]);
  const rewarded = useRef({});
  // reward ledger: id -> { amount, status: 'pending' | 'confirmed' }
  const [rewards, setRewards] = useState({});
  // Real taskflow tasks, one per claimed campaign: { campaignId: task }. This is
  // the source of truth behind TaskStatus; the legacy `enrolled[id].step` is now
  // DERIVED from it (bridge.stateToStep) for every screen that still reads a step.
  const [tasks, setTasks] = useState({});
  // Bumped after CAMPAIGNS is repopulated from GET /campaigns, to force a re-render
  // of every screen that reads the (now real) module-level campaign list.
  const [, setCampaignsVersion] = useState(0);
  const trackPending = (c) => setRewards((r) => r[c.id] ? r : { ...r, [c.id]: { amount: c.maxBack, status: "pending" } });
  const confirmReward = (c) => setRewards((r) => ({ ...r, [c.id]: { amount: (r[c.id] && r[c.id].amount) || c.maxBack, status: "confirmed" } }));

  // ── Real backend state (campaigns · tasks · balances) ──────────────────────
  // Pull the user's real ticket + wallet balances and reflect them in the two
  // legacy fields the screens already read (wallet = integer paise, tickets.balance).
  const refreshWallet = () => backendApi.wallet().then((w) => {
    if (!w) return;
    setWallet(Number(w.walletBalancePaise) || 0);
    setTickets((t) => ({ ...t, balance: w.ticketBalance }));
  }).catch(() => {});
  // Real tasks -> the per-campaign task map + the derived legacy `enrolled[id].step`
  // that the whole timeline UI reads.
  const hydrateTasks = (tks) => {
    const tmap = {}, emap = {}, cmap = {};
    for (const t of tks || []) {
      const cid = t.campaign && t.campaign.id;
      if (!cid) continue;
      tmap[cid] = t;
      emap[cid] = { step: backendStateToStep(t.state, t.refund && t.refund.eligible), stepLabel: "auto" };
      cmap[cid] = { at: Date.now() };
    }
    setTasks(tmap); setEnrolled(emap); setClaimed(cmap);
  };
  const loadBackendState = async () => {
    try {
      const camps = await backendApi.listCampaigns().catch(() => null);
      if (Array.isArray(camps) && camps.length) {
        // Swap the design-time mock array's CONTENTS for real campaigns in place
        // (keeps every closure/import reference valid), then force a re-render.
        CAMPAIGNS.length = 0;
        camps.forEach((cp, i) => CAMPAIGNS.push(mapCampaign(cp, i)));
        setActive(CAMPAIGNS[0]);
        // Drop the mock enrolment seeds now that the data is real.
        setEnrolled({}); setClaimed({}); setTasks({});
        setCampaignsVersion((v) => v + 1);
      }
      await refreshWallet();
      const tks = await backendApi.listTasks().catch(() => null);
      if (Array.isArray(tks) && tks.length) hydrateTasks(tks);
    } catch { /* keep the design-time mock as a graceful fallback */ }
  };
  // When a real session lands (OTP verified), publish the token and pull real data.
  useEffect(() => {
    setAuthToken(session && session.accessToken);
    if (session && session.accessToken) loadBackendState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session && session.accessToken]);

  // Demo: walk a claimed task to REFUNDED through the REAL endpoints, then refresh
  // the wallet so the balance visibly updates. Synthetic evidence, real state
  // machine — the same transition()s the device would run, with a back-dated
  // delivery so the return window is already closed.
  const simulateRefund = async (c) => {
    const t = tasks[c.id];
    if (!t || !isBackendTask(t) || t.state === "REFUNDED") return;
    const id = t.id;
    const past = Date.now() - 60 * 864e5;
    const itemPaise = String(c.pricePaise != null ? c.pricePaise : Math.round(Number(c.examplePay || 0) * 100));
    try {
      await backendApi.submitEvidence(id, { order: { id: "SIM-" + id, itemPaise, source: "order-details" }, returned: false }).catch(() => {});
      await backendApi.submitEvidence(id, { delivery: { at: past, source: "order-details" }, review: { published: true, product: c.product } }).catch(() => {});
      await backendApi.markReviewed(id).catch(() => {});
      await backendApi.startHold(id).catch(() => {});
      const refunded = await backendApi.releaseRefund(id);
      setTasks((prev) => ({ ...prev, [c.id]: refunded }));
      setEnrolled((e) => ({ ...e, [c.id]: { step: backendStateToStep(refunded.state, refunded.refund && refunded.refund.eligible), stepLabel: "auto" } }));
      await refreshWallet();
    } catch (err) { console.warn("[fayr] simulate failed:", err && err.message); }
  };

  const go = useCallback((s) => setScreen(s), []);
  // Sign out: revoke the refresh token server-side (best-effort — POST /auth/logout
  // is idempotent), drop the in-memory session + bearer token, and clear every
  // user-derived slice so nothing leaks into the next login, then return to the
  // phone-login screen.
  const logout = useCallback(async () => {
    const rt = session && session.refreshToken;
    try { if (rt) await authApi.logout(rt); } catch { /* local sign-out proceeds regardless */ }
    setAuthToken(null);
    setSession(null);
    setTasks({}); setEnrolled({}); setClaimed({});
    setTickets({ balance: 15, held: {} });
    setWallet(0);
    setProfile({}); setPhone(""); setName("Prakash");
    setGmail({ connected: false }); setEmail(""); setEmailVerified(false);
    go("phone");
  }, [session, go]);
  const openCampaign = (c) => {
    setActive(c);
    // A campaign with a real task → open its live Task Status timeline.
    if (tasks[c.id]) return go("taskstatus");
    // A claimed campaign already past purchase → open its Task Status timeline
    if (enrolled[c.id] && (enrolled[c.id].step || 1) >= 2) return go("taskstatus");
    // "How it works" video shows once — on the first campaign the user ever opens.
    if (!videoSeen) { setVideoSeen(true); go("howworks"); }
    else go("detail");
  };
  const openDetail = (c) => { setActive(c); go("detail"); };
  const openProof = (c) => { setActive(c); go("proofprimer"); };
  const openTaskStatus = (c) => { setActive(c); go("taskstatus"); };
  // Claim → the REAL backend claim: POST /tasks {campaignId}. The backend deducts
  // tickets and creates the task (the authoritative state machine); we then open
  // its live progress. Insufficient tickets come back as a 409.
  const claim = async (c) => {
    setActive(c);
    if (tasks[c.id] && isBackendTask(tasks[c.id])) return go("taskstatus"); // already claimed
    try {
      const task = await backendApi.claim(c.id);
      setTasks((t) => ({ ...t, [c.id]: task }));
      setClaimed((x) => ({ ...x, [c.id]: { at: Date.now() } }));
      setEnrolled((e) => ({ ...e, [c.id]: { step: backendStateToStep(task.state, task.refund && task.refund.eligible), stepLabel: "auto" } }));
      refreshWallet(); // tickets just went down
      go("taskstatus");
    } catch (err) {
      if (err && err.status === 409) go("insufficient");
      else { console.warn("[fayr] claim failed:", err && err.message); setNetState("error"); go("home"); }
    }
  };
  // Claim expired before purchase → return the 5 held tickets
  const expireClaim = (c) => {
    setTickets((t) => { if (!t.held[c.id]) return t; const h = { ...t.held }; delete h[c.id]; return { balance: t.balance + t.held[c.id], held: h }; });
    setClaimed((x) => { const y = { ...x }; delete y[c.id]; return y; });
    setEnrolled((e) => { const y = { ...e }; delete y[c.id]; return y; });
  };
  // Buy → link marketplace account first (moment-of-need, value-forward) → redirect out
  const buyNow = (c) => { setActive(c); go(linked[c.marketplace] ? "redirect" : "linkaccount"); };
  // Back from the marketplace: purchase made → held tickets are now CONSUMED (not returned)
  const afterRedirect = (c) => {
    setTickets((t) => { if (!t.held[c.id]) return t; const h = { ...t.held }; delete h[c.id]; return { balance: t.balance, held: h }; });
    advance(c.id, 2, "submit order proof");
    go("home");
  };
  const participate = (c) => { setActive(c); go(linked[c.marketplace] ? "confirm" : "linkaccount"); }; // legacy (dev menu)
  const commit = (c) => {
    // legacy dev path — mirror the claim ticket behaviour
    setEnrolled((e) => e[c.id] ? e : { ...e, [c.id]: { step: 1, stepLabel: "buy the product" } });
    setTickets((t) => t.held[c.id] ? t : { balance: t.balance - TICKET_COST, held: { ...t.held, [c.id]: TICKET_COST } });
    go("enrollsuccess");
  };
  // Apply one real event to a campaign's task. Used by TaskStatus for the hold
  // and the refund release.
  const taskDispatch = (id, event) => setTasks((prev) => {
    const cur = prev[id];
    if (!cur || isBackendTask(cur)) return prev; // real tasks advance via the backend, not the client bridge
    const res = bridge.apply(cur, event);
    return res.task === cur ? prev : { ...prev, [id]: res.task };
  });
  // Bring a campaign's task up to the prototype `step` the journey just reached.
  // Evidence is SIMULATED (no real fetch on web) but structurally identical to a
  // real one; delivery is back-dated so the return window is already closed and
  // the demo can reach a refund without waiting real days. Cumulative + idempotent
  // (event keys are fixed), so any entry path converges on the same task.
  const driveTaskToStep = (id, step) => setTasks((prev) => {
    if (prev[id] && isBackendTask(prev[id])) return prev; // real tasks are driven by the backend
    const cc = CAMPAIGNS.find((x) => x.id === id);
    if (!cc) return prev;
    let t = prev[id] || bridge.taskForCampaign(cc);
    const now = Date.now();
    const past = { orderAt: now - 12 * 864e5, deliveryAt: now - 9 * 864e5, published: true };
    const evs = [];
    if (step >= 3) evs.push({ type: "EVIDENCE", key: "ev:order:" + id, evidence: bridge.simulatedEvidence(cc, { orderAt: past.orderAt, published: true }), at: now });
    if (step >= 4) evs.push({ type: "EVIDENCE", key: "ev:deliv:" + id, evidence: bridge.simulatedEvidence(cc, past), at: now });
    if (step >= 5) evs.push(bridge.events.markReviewed(now));
    if (step >= 6) evs.push(bridge.events.startHold(now));
    if (step >= 7) evs.push(bridge.events.release(now));
    for (const ev of evs) t = bridge.apply(t, ev).task;
    return { ...prev, [id]: t };
  });
  // `advance` still updates the legacy `enrolled` step (many screens read it) AND
  // now drives the real task. The task is the truth; enrolled.step is a shadow.
  const advance = (id, step, stepLabel, extra = {}) => {
    setEnrolled((e) => ({ ...e, [id]: { ...e[id], step, stepLabel, ...extra } }));
    driveTaskToStep(id, step);
  };
  const creditReward = (c) => {
    if (rewarded.current[c.id]) return;
    rewarded.current[c.id] = true;
    // Credit the EXACT verified refund in integer paise (₹404.10 -> 40410), not
    // the rounded rupee maxBack. Nothing is dropped: the ledger reconciles to the
    // paise. Falls back to 0 rather than crediting a bad value.
    setWallet((w) => w + (bridge.refundPaise(c) || 0));
  };
  // Completing a campaign fully and withdrawing returns 2× the claim cost (10) as a reward.
  const rewardCompletionTickets = (c) => {
    if (rewarded.current["tkt_" + c.id]) return;
    rewarded.current["tkt_" + c.id] = true;
    setTickets((t) => ({ ...t, balance: t.balance + TICKET_COST * 2 }));
  };
  // Flow 16: Continue deep-jumps to the exact step screen
  const continueStep = (c) => {
    setActive(c);
    const e = enrolled[c.id];
    if (!e) return go("detail");
    go(["", "buyinterstitial", "proofprimer", "delivery", "honesty", "verifywait", "returnwindow", "reward"][e.step] || "detail");
  };

  const screens = {
    splash: <Splash go={go} />,
    forceupdate: <ForceUpdate />,
    maintenance: <Maintenance />,
    onboard: <Onboarding go={go} />,
    authlanding: <AuthLanding go={go} setAuthVia={setAuthVia} />,
    truecaller: <TruecallerSheet go={go} setName={setName} setPhone={setPhone} setTcName={setTcName} />,
    phone: <PhoneEntry go={go} phone={phone} setPhone={setPhone} />,
    otp: <Otp go={go} phone={phone} onVerified={(res) => setSession(res)} />,
    otplocked: <OtpLocked go={go} />,
    blocked: <Blocked go={go} />,
    newdevice: <NewDevice go={go} />,
    setupintro: <SetupFlow go={go} setName={setName} setProfile={setProfile} authVia={authVia} tcName={tcName} />,
    setupintrolegacy: <SetupIntro go={go} />,
    setup: <Setup go={go} profile={profile} setProfile={setProfile} authVia={authVia} />,
    namelast: <NameLast go={go} setName={setName} setProfile={setProfile} authVia={authVia} tcName={tcName} />,
    buildfeed: <BuildFeed go={go} profile={profile} />,
    howfayr: <HowFayr go={go} />,
    home: <Home go={go} name={name} wallet={wallet} enrolled={enrolled} claimed={claimed} openCampaign={openCampaign} netState={netState} continueStep={continueStep} hasUnread={Object.keys(enrolled).length > 0 && !notifsRead} openProof={openProof} reminderDismissed={notifCardDismissed} dismissReminder={() => setNotifCardDismissed(true)} />,
    howworks: <HowWorksVideo go={go} c={active} />,
    allcampaigns: <AllCampaigns go={go} openCampaign={openCampaign} />,
    detail: <Detail go={go} c={active} enrolled={enrolled} claimed={claimed} claim={claim} buyNow={buyNow} linked={linked} />,
    claimedsheet: <ClaimedSheet go={go} c={active} buyNow={buyNow} />,
    redirect: <RedirectScreen go={go} c={active} afterRedirect={afterRedirect} />,
    confirm: <ConfirmJoin go={go} c={active} tickets={tickets} commit={commit} />,
    insufficient: <InsufficientSheet go={go} c={active} tickets={tickets} onClose={() => go("home")} />,
    linkaccount: <LinkAccount go={go} c={active} linked={linked} linkAccount={(mid) => setLinked((l) => ({ ...l, [mid]: { at: Date.now() } }))} />,
    seatlost: <SeatLost go={go} />,
    enrollfailed: <EnrollFailed go={go} retry={() => go("confirm")} />,
    enrollsuccess: <EnrollSuccess go={go} c={active} notifAsked={notifAsked} />,
    notifprime: <NotifPrime go={go} c={active} setNotifAsked={setNotifAsked} dest="buyinterstitial" />,
    waitlisted: <Waitlisted go={go} />,
    buyinterstitial: <BuyInterstitial go={go} c={active} advance={advance} />,
    returncatch: <ReturnCatch go={go} c={active} />,
    proofprimer: <ProofPrimer go={(s) => { if (s === "emailconnect") setEmailReturnTo("ocrconfirm"); if (s === "ocrconfirm") setProofSource("email"); if (s === "proofupload") setProofSource("screenshot"); go(s); }} c={active} gmail={gmail} />,
    emailconnect: <EmailConnect go={(s) => { if (s === "ocrconfirm") setProofSource("email"); go(s); }} c={active} gmail={gmail} setGmail={setGmail} email={email} setEmail={setEmail} returnTo={emailReturnTo} />,
    emailcode: <EmailCode go={(s) => { if (s === "ocrconfirm") setProofSource("email"); go(s); }} email={email} setEmailVerified={setEmailVerified} returnTo={emailReturnTo} />,
    proofupload: <ProofUpload go={(s) => { if (s === "ocrconfirm") setProofSource("screenshot"); go(s); }} task={(active && tasks[active.id]) || null} kind="PURCHASE" kindLabel="order" />,
    ocrconfirm: <OcrConfirm go={go} c={active} advance={advance} trackPending={trackPending} source={proofSource} />,
    orderverified: <OrderVerified go={go} c={active} rewards={rewards} />,
    imagesuploaded: <ImagesUploaded go={go} c={active} />,
    taskstatus: <TaskStatus go={go} c={active} enrolled={enrolled} rewards={rewards} confirmReward={confirmReward}
      task={tasks[active.id]} taskDispatch={taskDispatch} simulate={simulateRefund}
      finalize={(cc, reach) => { const target = reach || 7; if (target >= 8) confirmReward(cc); advance(cc.id, target, "auto", target >= 9 ? { done: true, earned: cc.maxBack } : {}); }}
      onAction={(a, cc) => { setActive(cc); if (a === "order") go("proofprimer"); else if (a === "delivery") go(gmail.connected ? "deliverycheck" : "deliveryupload"); else if (a === "review") go("reviewguide"); }} />,
    deliverycheck: <DeliveryCheck go={go} c={active} gmail={gmail} advance={advance} />,
    deliveryupload: <DeliveryUpload go={go} c={active} advance={advance} />,
    underreview: <UnderReview go={go} next={() => go("delivery")} title="Proof under review" eta="ETA shown — usually a few hours" />,
    delivery: <DeliveryConfirm go={go} c={active} advance={advance} />,
    deliverydelayed: <DeliveryDelayed go={go} />,
    honesty: <Honesty go={go} />,
    reviewguide: <ReviewGuide go={go} c={active} />,
    reviewproof: <ReviewProof go={go} c={active} advance={advance} />,
    verifywait: <UnderReview go={go} next={() => { advance(active.id, 6, "return window"); confirmReward(active); go("returnwindow"); }} title="Review under verification" eta="~2 days — approve, fix, or appeal; every negative outcome has a path" />,
    returnwindow: <ReturnWindow go={go} c={active} advance={advance} />,
    reward: <Reward go={go} c={active} creditReward={creditReward} />,
    myproducts: <MyProducts go={go} enrolled={enrolled} claimed={claimed} openProof={openProof} cardDismissed={notifCardDismissed} dismissCard={() => setNotifCardDismissed(true)} continueStep={continueStep} openTaskStatus={openTaskStatus} />,
    notifcenter: <NotificationCenter go={go} campaigns={CAMPAIGNS} enrolled={enrolled} onClose={() => { setNotifsRead(true); go("home"); }} />,
    campaigns: <MyProducts go={go} enrolled={enrolled} claimed={claimed} openProof={openProof} cardDismissed={notifCardDismissed} dismissCard={() => setNotifCardDismissed(true)} continueStep={continueStep} openTaskStatus={openTaskStatus} />,
    insights: <Insights go={go} name={name} phone={phone} gmail={gmail} emailVerified={emailVerified} wallet={wallet} onLogout={logout} openEmailConnect={() => { setEmailReturnTo("profile"); go("emailconnect"); }} />,
    earnings: <Earnings go={go} wallet={wallet} />,
    withdraw: <Withdraw go={go} wallet={wallet} refreshWallet={refreshWallet} />,
    tickets: <Tickets go={go} tickets={tickets} />,
    profile: <Profile go={go} name={name} phone={phone} gmail={gmail} emailVerified={emailVerified} openEmailConnect={() => { setEmailReturnTo("profile"); go("emailconnect"); }} onLogout={logout} />,
    verifier: <VerifierDemo go={go} />,
  };

  const FLOW_GROUPS = [
    ["Launch & auth", ["splash", "onboard", "authlanding", "truecaller", "phone", "otp"]],
    ["Setup", ["setupintro", "setup", "namelast", "buildfeed", "howfayr"]],
    ["Claim flow", ["home", "allcampaigns", "howworks", "detail", "claimedsheet", "linkaccount", "redirect", "notifprime"]],
    ["Journey", ["buyinterstitial", "returncatch", "proofprimer", "emailconnect", "emailcode", "proofupload", "ocrconfirm", "orderverified", "taskstatus", "deliveryupload", "imagesuploaded", "delivery", "honesty", "reviewguide", "reviewproof", "verifywait", "returnwindow", "reward"]],
    ["Tabs", ["myproducts", "earnings", "withdraw", "insights", "profile", "notifcenter"]],
    ["Edge states", ["forceupdate", "maintenance", "otplocked", "blocked", "newdevice", "seatlost", "enrollfailed", "waitlisted", "deliverydelayed", "confirm", "enrollsuccess", "tickets"]],
    ["Verifier (live logic)", ["verifier"]],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#E9EBDD", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 12px", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
        <div style={{ position: "relative", flex: "0 0 auto" }}>
          {/* hardware: action + volume (left), power (right) */}
          <div style={{ position: "absolute", left: -2.5, top: 178, width: 3, height: 30, borderRadius: "3px 0 0 3px", background: "#3a3a3e" }} />
          <div style={{ position: "absolute", left: -2.5, top: 232, width: 3, height: 58, borderRadius: "3px 0 0 3px", background: "#3a3a3e" }} />
          <div style={{ position: "absolute", left: -2.5, top: 302, width: 3, height: 58, borderRadius: "3px 0 0 3px", background: "#3a3a3e" }} />
          <div style={{ position: "absolute", right: -2.5, top: 262, width: 3, height: 96, borderRadius: "0 3px 3px 0", background: "#3a3a3e" }} />
          <div style={{ boxSizing: "border-box", width: 403, height: 862, borderRadius: 55, background: "#050506", padding: 5, boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.09), 0 44px 88px rgba(0,0,0,.42), 0 10px 26px rgba(0,0,0,.28)" }}>
            <div style={{ position: "relative", width: 393, height: 852, borderRadius: 50, overflow: "hidden", background: C.cream }}>
              <DeviceStatusBar tone="dark" />
              {/* every screen change rides one gentle rise-and-fade — direction-
                  neutral, subtle enough for both forward and back navigation */}
              <div key={screen} style={{ position: "absolute", inset: 0, animation: "fayr-screen .34s cubic-bezier(.22,.61,.36,1) both" }}>
                {screens[screen]}
              </div>
            </div>
          </div>
        </div>
        <div style={{ width: 216, flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <LogoMark size={26} /><Wordmark size={20} />
          </div>
          <p style={{ fontSize: 11, color: "#6b6c5d", margin: "0 0 10px", lineHeight: 1.5 }}>
            Built from Flows 1–20 + Wireframes 1–7. Tap through, or jump anywhere.
          </p>
          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
            {["ok", "offline", "error"].map((n) => (
              <button key={n} onClick={() => { setNetState(n); go("home"); }} style={{ flex: 1, border: "none", borderRadius: 8, padding: "5px 0", fontSize: 10, fontWeight: 700, cursor: "pointer", background: netState === n ? C.ink : "#fff", color: netState === n ? "#fff" : "#54554a" }}>{n}</button>
            ))}
          </div>
          <div className="fayr-scroll" style={{ maxHeight: 740, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {FLOW_GROUPS.map(([g, list]) => (
              <div key={g}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: ".08em", color: "#8a8b7c", margin: "8px 0 4px", textTransform: "uppercase" }}>{g}</div>
                {list.map((s) => (
                  <button key={s} onClick={() => go(s)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 8, padding: "6px 10px", marginBottom: 3, background: screen === s ? C.ink : "#fff", color: screen === s ? "#fff" : "#54554a", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// esbuild bundles React and the logic modules statically (see the imports at the
// top of this file), so there's nothing to wait for — the getlayers "FayrGate"
// shim isn't needed. Export the app directly for web-preview/entry.jsx to mount.
// The card-deck presentation falls back to its built-in defaults via deckTweaks()
// ({ peek: 10, recede: 0.045, motion: 0.8 }) when window.__deckTweaks is unset.
export default FayrApp;
