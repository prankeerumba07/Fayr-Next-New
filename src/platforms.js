// Per-platform configuration for the Fayr review-validation POC.
//
// Design note: every network call runs INSIDE the WebView (injected JS),
// so the platform session cookie never leaves the device and the request
// originates from the real logged-in browser context (same-origin / same-site,
// no CORS, far less bot-detection friction). The injected script always ends by
// posting a JSON string back to RN via window.ReactNativeWebView.postMessage.

const FK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 FKUA/website/42/website/Desktop';

// Opt-in, PER-PLATFORM WebView user agent (see the `userAgent` field below).
// Deliberately not global: the other platforms' scripts were calibrated against
// whatever their mobile pages return, so forcing a desktop UA everywhere could
// silently change those payloads. Only set it where a real capture proves the
// mobile page is the problem.
//
// Amazon needs it: with the default iPhone UA, amazon.in serves the MOBILE
// orders page (`<html class="a-no-js a-touch a-mobile">`), whose DOM has none of
// the `.order-card` / `.js-order-card` classes the orders parser looks for -
// verified 2026-07-15, cardCount was 0 while the same HTML plainly contained
// "Ordered on Friday, 5 June 2026" and "Delivered 5 June".
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// Wraps a fetch-chain expression (must resolve to the payload we want to keep)
// into a self-contained script that reports back to RN exactly once.
function wrap(platform, chainExpr) {
  return `
(function(){
  function send(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  try {
    (${chainExpr})
      .then(function(payload){ send({ ok:true, platform:'${platform}', raw:payload }); })
      .catch(function(e){ send({ ok:false, platform:'${platform}', error:String((e&&e.message)||e) }); });
  } catch(e){ send({ ok:false, platform:'${platform}', error:String((e&&e.message)||e) }); }
})();
true;`;
}

const flipkart = {
  key: 'flipkart',
  name: 'Flipkart',
  // Cookie names that prove a logged-in session (see the auth-storage map).
  // restoreSession uses these to tell "logged out, restore it" from "a DIFFERENT
  // account is live, leave it alone" - it never blocks a legitimate restore.
  authCookies: ['at', 'rt'],
  color: '#2874F0',
  startUrl: 'https://www.flipkart.com/',
  // NOT ESTABLISHED. Asked for from this machine and refused with a 403 by
  // Flipkart's own front door, which tells us nothing either way. Not guessed.
  signInUrl: null,
  hint: 'Log in to Flipkart (OTP), then tap "Fetch my reviews".',
  // Fetch submitted reviews (RESPONSE.product[]: pid, certifiedBuyer, date,
  // rating, text, title, status) and order history, then join by pid (unit.fsn)
  // to attach order date, delivery date, and returned/cancelled status.
  fetchScript: wrap(
    'flipkart',
    `
    (function(){
      var H = { "accept": "*/*", "content-type": "application/json", "x-user-agent": ${JSON.stringify(FK_UA)} };
      // Returns { status, ok, json, error, textSample } instead of swallowing
      // failures, so a CORS block / 401 / shape-change shows up in "Show raw
      // JSON" instead of silently producing an empty review list.
      function getJson(url){
        return fetch(url, { credentials:"include", headers:H })
          .then(function(r){
            return r.text().then(function(t){
              var j=null; try{ j=JSON.parse(t); }catch(e){}
              return { status:r.status, ok:r.ok, json:j, error:null, textSample:(t||"").slice(0,600) };
            });
          })
          .catch(function(e){
            return { status:null, ok:false, json:null, error:String((e&&e.message)||e), textSample:null };
          });
      }
      function fixImg(u){
        if (!u) { return null; }
        return u.replace(/\\{@width\\}/g, "200").replace(/\\{@height\\}/g, "200").replace(/\\{@quality\\}/g, "90");
      }
      return Promise.all([
        getJson("https://1.rome.api.flipkart.com/api/3/reviews/completed/product?start=1&count=20"),
        getJson("https://1.rome.api.flipkart.com/api/5/self-serve/orders/?page=1")
      ]).then(function(res){
        var revRes = res[0], ordRes = res[1];
        var revJson = revRes.json, ordJson = ordRes.json;
        var diag = {
          reviewsCall: { status: revRes.status, ok: revRes.ok, error: revRes.error, sample: revJson ? null : revRes.textSample },
          ordersCall: { status: ordRes.status, ok: ordRes.ok, error: ordRes.error, sample: ordJson ? null : ordRes.textSample }
        };

        // Build pid -> order/unit facts from the order history units.
        var orders = (ordJson && ordJson.RESPONSE && ordJson.RESPONSE.multipleOrderDetailsView && ordJson.RESPONSE.multipleOrderDetailsView.orders) || [];
        var byPid = {};
        // HOW MANY UNITS. Keyed by (order, product) and never by product alone:
        // the same product bought in two different orders is two separate counts
        // and adding them would invent a quantity nobody bought.
        var unitTally = {};
        function tallyKey(oid, pid){ return String(oid) + "|" + String(pid); }
        orders.forEach(function(o){
          var md = o.orderMetaData || {};
          var units = o.units || {};
          Object.keys(units).forEach(function(uid){
            var u = units[uid] || {};
            var meta = u.metaData || {};
            var promise = (u.deliveryDataBag && u.deliveryDataBag.promiseDataBag) || {};
            var st = meta.status || {};
            var reverse = u.reverseLegDataBag || {};
            var statusKey = st.key || "";
            var returned = !!st.fkCancelled
              || /return|cancel/i.test(statusKey)
              || !!(reverse.latestReturnIdString && reverse.latestReturnIdString !== "")
              || !!promise.returnStatus;
            var money = u.moneyDataBag || {};
            var orderMoney = o.orderMoneyDataBag || {};
            var pid = meta.fsn || null;
            // Flipkart states its orders as UNIT RECORDS. A record that states its
            // own count is evidence. The NUMBER OF RECORDS is NOT: one record could
            // itself represent three units, and reading the count as 1 would refund
            // a third of what was charged. Both are collected; the combiner below
            // only answers when every record stated a count.
            //
            // Which field carries it is UNVERIFIED — no multi-unit Flipkart order
            // has been captured yet. These are the plausible names, and
            // rawSample.quantityLikePaths in the same payload names the real one
            // exactly on the first real fetch. Until then this simply reads null,
            // which holds the refund for a human rather than guessing.
            var statedQty = null;
            var qtyFields = [
              meta.quantity, u.quantity, meta.unitCount, u.unitCount,
              meta.qty, u.qty, meta.itemCount, meta.unitsCount
            ];
            for (var qi = 0; qi < qtyFields.length; qi++) {
              var qv = qtyFields[qi];
              if (typeof qv === "number" && qv === Math.floor(qv) && qv >= 1 && qv <= 99) { statedQty = qv; break; }
              if (typeof qv === "string" && /^\d{1,3}$/.test(qv)) {
                var qn = Number(qv);
                if (qn >= 1 && qn <= 99) { statedQty = qn; break; }
              }
            }
            if (pid) {
              var tk = tallyKey(md.orderId, pid);
              if (!unitTally[tk]) { unitTally[tk] = []; }
              unitTally[tk].push(statedQty);
            }
            // Product NAME from the order unit - needed to match the campaign
            // (which carries a name, not a pid). Field name is unverified for the
            // order unit, so try the likely spots; orderProbe.nameAvailable
            // reports whether any order actually yielded one (if not, a capture
            // round is needed to find the right field).
            var pName = meta.title || meta.productTitle || meta.name
              || u.title || (u.productInfo && u.productInfo.title) || null;
            if (pid) {
              byPid[pid] = {
                pid: pid,
                productName: pName,
                orderDate: md.orderDate || null,
                orderId: md.orderId || null,
                deliveryDate: promise.actualDeliveredDate || null,
                statusKey: statusKey || null,
                returned: returned,
                returnStatus: returned ? (st.fkCancelled ? "CANCELLED" : "RETURNED") : (statusKey || null),
                // Money fields verified against a real capture (2026-07-15):
                // the reviewed item's own price is moneyDataBag.itemSellingPrice
                // and the order total is orderMoneyDataBag.amount. Do NOT use
                // totalPayable / promisedPrice / revisedPrice - all three are 0
                // in real data. Values are whole rupees, not paise.
                itemAmount: money.itemSellingPrice != null ? money.itemSellingPrice : null,
                itemListPrice: money.itemListingPrice != null ? money.itemListingPrice : null,
                orderAmount: orderMoney.amount != null ? orderMoney.amount : null
              };
            }
          });
        });

        // Turn the tallied unit records into a quantity, or an honest null. Same
        // rule as combineUnitQuantities in src/quantity.js, whose tests guard it.
        function combineUnits(stated){
          var out = { quantity: null, source: null, reason: "not-stated", records: stated.length };
          if (!stated.length) { return out; }
          var known = stated.filter(function(v){ return v != null; });
          if (!known.length) { return out; }
          // Some records state a count and some do not. Adding the known ones would
          // undercount; treating the silent ones as 1 is the assumption this whole
          // path exists to refuse.
          if (known.length !== stated.length) { out.reason = "partial"; return out; }
          var sum = 0, allOk = true;
          known.forEach(function(v){
            if (!(v === Math.floor(v) && v >= 1 && v <= 99)) { allOk = false; }
            sum += v;
          });
          if (!allOk || sum > 99) { out.reason = "implausible"; return out; }
          out.quantity = sum;
          out.source = stated.length > 1 ? "unit-records-stated" : "unit-record-stated";
          out.reason = null;
          return out;
        }
        Object.keys(byPid).forEach(function(pid){
          var e = byPid[pid];
          var q = combineUnits(unitTally[tallyKey(e.orderId, pid)] || []);
          e.quantity = q.quantity;
          e.quantitySource = q.source;
          e.quantityReason = q.reason;
          // How many unit records this product had in that order. When it is more
          // than one, the money fields above came from whichever record was read
          // LAST — which is arbitrary — so the AMOUNT itself is doubtful, not just
          // the count. Surfaced so a human is told that rather than left to
          // discover it.
          e.unitRecords = q.records;
        });

        var products = (revJson && revJson.RESPONSE && revJson.RESPONSE.product) || [];
        var reviews = products.map(function(p){
          var om = (p.pid && byPid[p.pid]) || null;
          // Flipkart's moderation status, calibrated against a real capture
          // (2026-07-15): the live value is exactly "approved" (lowercase).
          // Compare EXACTLY - a /approve/ substring regex would also match
          // "pending_approval" / "not_approved" and report a review nobody can
          // see as publicly live, which under a public-visibility model pays out
          // a refund for an unpublished review. Unknown values must fail CLOSED.
          // Only "approved" has been observed live; if a review ever shows a
          // different status, add it here deliberately rather than by pattern.
          var statusRaw = p.status || null;
          var isApproved = statusRaw ? String(statusRaw).trim().toLowerCase() === "approved" : null;
          return {
            productname: p.productTitle || null,
            reviewtitle: p.title || null,
            reviewtext: p.text || null,
            rating: p.rating || null,
            reviewdate: p.date || null,
            orderdate: om ? om.orderDate : null,
            deliverydate: om ? om.deliveryDate : null,
            orderid: om ? om.orderId : null,
            orderamount: om ? om.orderAmount : null,
            itemamount: om ? om.itemAmount : null,
            itemlistprice: om ? om.itemListPrice : null,
            quantity: om ? om.quantity : null,
            quantitysource: om ? om.quantitySource : null,
            quantityreason: om ? om.quantityReason : null,
            unitrecords: om ? om.unitRecords : null,
            returned: om ? om.returned : null,
            returnstatus: om ? om.returnStatus : null,
            statuscode: om ? om.statusKey : null,
            verified: p.certifiedBuyer === true,
            reviewstatus: statusRaw,
            approved: isApproved,
            published: isApproved,
            pid: p.pid || null,
            reviewid: p.id || null,
            imageurl: fixImg(p.dynamicImageUrl),
            // Best-effort minimal Flipkart product link from pid alone (no slug) -
            // unverified pattern, confirm it resolves once tested on-device.
            producturl: p.pid ? ("https://www.flipkart.com/p/itm" + p.pid) : null
          };
        });

        // RAW SAMPLES (diagnostic only). Everything above is a LOSSY mapping:
        // a field we don't map is invisible in the export, so "absent from the
        // capture" can't be told apart from "not exposed by Flipkart". Ship a
        // bounded slice of the real payloads instead, so order amount and the
        // review status vocabulary can be read off actual data rather than
        // guessed. Bounded so the export stays small.
        function slice(o, n){ try { var s = JSON.stringify(o); return s ? s.slice(0, n) : null; } catch(e){ return null; } }
        var firstOrder = orders[0] || null;
        var firstUnit = null;
        if (firstOrder && firstOrder.units) {
          var uk = Object.keys(firstOrder.units);
          if (uk.length) { firstUnit = firstOrder.units[uk[0]]; }
        }
        // Every price/amount-looking leaf in the first order, with its path, so
        // the order-total field can be located exactly.
        var priceLike = [];
        (function scanPrice(o, path, d){
          if (o == null || d > 9 || priceLike.length >= 50) { return; }
          if (typeof o !== "object") { return; }
          for (var k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) { continue; }
            var v = o[k];
            if (/price|amount|total|payable|mrp|paid|value/i.test(k) && (typeof v === "number" || typeof v === "string")) {
              if (priceLike.length < 50) { priceLike.push(path + "." + k + " = " + String(v).slice(0, 24)); }
            }
            scanPrice(v, path + "." + k, d + 1);
          }
        })(firstOrder, "order", 0);
        // The same scan for quantity-shaped leaves. This is the single cheapest
        // thing in the payload: no extra request, and one real multi-unit order
        // names the field exactly instead of it staying a guess.
        var qtyLike = [];
        (function scanQty(o, path, d){
          if (o == null || d > 9 || qtyLike.length >= 40) { return; }
          if (typeof o !== "object") { return; }
          for (var k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) { continue; }
            var v = o[k];
            if (/qty|quantity|unitcount|itemcount|count|units/i.test(k) && (typeof v === "number" || typeof v === "string")) {
              if (qtyLike.length < 40) { qtyLike.push(path + "." + k + " = " + String(v).slice(0, 24)); }
            }
            scanQty(v, path + "." + k, d + 1);
          }
        })(firstOrder, "order", 0);

        diag.rawSample = {
          firstOrder: slice(firstOrder, 4000),
          firstUnit: slice(firstUnit, 4000),
          firstReviewProduct: slice(products[0], 2000),
          orderKeys: firstOrder ? Object.keys(firstOrder) : null,
          orderMetaDataKeys: (firstOrder && firstOrder.orderMetaData) ? Object.keys(firstOrder.orderMetaData) : null,
          unitKeys: firstUnit ? Object.keys(firstUnit) : null,
          unitMetaDataKeys: (firstUnit && firstUnit.metaData) ? Object.keys(firstUnit.metaData) : null,
          reviewProductKeys: products[0] ? Object.keys(products[0]) : null,
          // Distinct review status strings across every fetched review. Under a
          // public-visibility model this vocabulary IS the verification signal,
          // so it must come from real data, not the /publish|approve/ guess.
          reviewStatusValues: products
            .map(function(p){ return p.status; })
            .filter(function(v, i, a){ return v != null && a.indexOf(v) === i; }),
          orderCount: orders.length,
          priceLikePaths: priceLike,
          quantityLikePaths: qtyLike,
          // How many unit records each (order, product) had. A pid with more than
          // one is the case that proves how Flipkart represents multiple units.
          unitRecordCounts: (function(){
            var m = {};
            Object.keys(unitTally).forEach(function(k){ m[k] = unitTally[k].length; });
            return m;
          })()
        };

        // ORDER-FIRST surfacing (privacy-filtered). The campaign product's own
        // order, matched by NAME + AMOUNT (a Fayr campaign has no marketplace
        // product id - the user searches and buys it themselves), so the PURCHASE
        // is detectable before any review exists. This is what auto-advances the
        // task and removes the "upload a screenshot of your order/delivery" step.
        // Matching runs HERE, in the page, so only the matched order leaves; the
        // account's other purchases never do. If a pid was already discovered on a
        // prior fetch it's used as a fast exact pin. The matcher is a port of
        // matchOrderByNameAmount in src/verify.js - keep them in sync.
        var targetName = (typeof window !== "undefined" && window.__fayrTargetName) || null;
        var targetAmount = (typeof window !== "undefined" && window.__fayrTargetAmount) || null;
        var targetPid = (typeof window !== "undefined" && window.__fayrTargetPid) || null;
        var cands = Object.keys(byPid).map(function(k){ return byPid[k]; });
        var nameAvailable = cands.some(function(c){ return c.productName; });

        function fkNrm(s){ return String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
        function fkScore(exp, cand){
          var e=fkNrm(exp), c=fkNrm(cand);
          if(!e||!c) return 0;
          if(c.indexOf(e)>=0||e.indexOf(c)>=0) return 1;
          var toks=e.split(" ").filter(function(w){return w.length>2;});
          if(!toks.length) return 0;
          var h=0; toks.forEach(function(w){ if(c.indexOf(w)>=0) h++; });
          return h/toks.length;
        }
        var match = { order:null, matchScore:0, amountOk:null, ambiguous:false, candidateCount:0 };
        if (targetPid && byPid[targetPid]) {
          match = { order: byPid[targetPid], matchScore: 1, amountOk: null, ambiguous: false, candidateCount: 1 };
        } else if (targetName) {
          var wantAmt = (targetAmount!=null) ? Number(targetAmount) : null;
          var kept = [];
          cands.forEach(function(c){
            var s = fkScore(targetName, c.productName);
            if (s < 0.6) return;
            var amt = (c.itemAmount!=null) ? Number(c.itemAmount) : null;
            var amountOk = null;
            if (wantAmt!=null && amt!=null) { amountOk = Math.abs(wantAmt-amt) <= Math.max(2, wantAmt*0.05); }
            kept.push({ order:c, score:s, amountOk:amountOk });
          });
          kept.sort(function(a,b){
            var aa=a.amountOk===true?1:0, ba=b.amountOk===true?1:0;
            if(aa!==ba) return ba-aa;
            return b.score-a.score;
          });
          if (kept.length) {
            var best = kept[0];
            var near = kept.filter(function(k){ return k.score>=best.score-0.15 && k.amountOk!==false; });
            match = { order: best.order, matchScore: best.score, amountOk: best.amountOk, ambiguous: near.length>=2, candidateCount: kept.length };
          }
        }
        var m = match.order;
        var order = m ? {
          pid: m.pid, productName: m.productName,
          orderId: m.orderId, orderDate: m.orderDate, deliveryDate: m.deliveryDate,
          itemAmount: m.itemAmount, orderAmount: m.orderAmount,
          quantity: m.quantity, quantitySource: m.quantitySource,
          quantityReason: m.quantityReason, unitRecords: m.unitRecords,
          returned: m.returned, returnStatus: m.returnStatus, statusKey: m.statusKey
        } : null;
        // The matched product's review, if one exists yet (later payout phase).
        var targetReview = (m && m.pid) ? (reviews.filter(function(r){ return r.pid === m.pid; })[0] || null) : null;
        var orderProbe = {
          ordersFetched: ordRes.ok === true,
          authFailed: ordRes.status === 401 || ordRes.status === 403,
          ordersCount: orders.length,
          nameAvailable: nameAvailable,
          targetFound: !!m,
          matchScore: match.matchScore,
          amountOk: match.amountOk,
          ambiguous: match.ambiguous,
          candidateCount: match.candidateCount
        };

        return { order: order, review: targetReview, orderProbe: orderProbe, reviews: reviews, __diagnostic: diag };
      });
    })()
  `
  ),
};

const amazon = {
  key: 'amazon',
  name: 'Amazon',
  authCookies: ['at-acbin'],
  color: '#FF9900',
  startUrl: 'https://www.amazon.in/',
  // WHERE SOMEBODY SIGNS IN, added 2 September 2026 on the owner's instruction.
  //
  // His words: "when I click on 'Connect My Amazon' it takes me to the homepage.
  // Why is it not taking me to the login/signup page?"
  //
  // THIS IS A CHANGE FROM THE DESIGN, and the design says the opposite in as many
  // words: fayr-design.browser.jsx:424 defines marketplaceHome with the comment
  // "homepage only — no search/UTM/deep link", and its connect screen (:2283)
  // opens exactly that. The owner has overruled it for this one thing.
  //
  // IT MUST BE ON THE SAME HOST AS startUrl, and that is not a style rule. The
  // frozen connect screen uses one address for three jobs: the page it opens, and
  // the origin it saves and restores this shop's sign in for (see
  // src/session.js persistSession, which asks the phone for that address's own
  // cookies). An address on another host would quietly save the sign in against
  // the wrong place. src/signin.js refuses one and says so.
  //
  // null means WE HAVE NOT ESTABLISHED THIS SHOP'S OWN SIGN IN ADDRESS. It is not
  // a guess and never will be: the shop keeps the behaviour it has, which is its
  // own site, where the person taps the shop's own sign in themselves.
  // ESTABLISHED. Asked for from this machine on 2 September 2026: it answered 200
  // and landed on Amazon's own sign in flow. And this file's own Amazon reader
  // already treats a bounce to /ap/signin as "this page wanted a sign in", which
  // is the same door seen from the other side.
  signInUrl: 'https://www.amazon.in/gp/sign-in.html',
  // Force the desktop orders page so the order-card selectors below can match
  // (see DESKTOP_UA). Amazon-only: no other platform sets this.
  userAgent: DESKTOP_UA,
  hint: 'Log in to Amazon, then tap "Fetch my reviews".',
  // Two-step: resolve the logged-in account id (from the profile redirect URL,
  // falling back to scanning the HTML), then call getReviews. That endpoint
  // returns an HTML *fragment* (not JSON), so we parse it with DOMParser inside
  // the WebView and pull product / rating / title / body / date from the DOM
  // (Amazon uses stable data-hook attributes). A small HTML sample is returned
  // so selectors can be refined if the DOM shape shifts.
  fetchScript: wrap(
    'amazon',
    `
    (function(){
      var diag = { stage: "start" };
      return fetch("https://www.amazon.in/gp/profile/", { credentials: "include" })
        .then(function(r){
          diag.profileStatus = r.status; diag.profileUrl = r.url;
          var m = (r.url || "").match(/amzn1\\.account\\.[A-Za-z0-9]+/);
          if (m) { return m[0]; }
          return r.text().then(function(html){
            var mm = html.match(/amzn1\\.account\\.[A-Za-z0-9]+/);
            if (!mm) { diag.stage = "account-id-not-found"; diag.htmlSnippet = html.slice(0, 400); throw diag; }
            return mm[0];
          });
        })
        .then(function(id){
          diag.accountId = id; diag.stage = "fetch-reviews";
          var url = "https://www.amazon.in/shop/profile/" + id +
            "/getReviews?pageSize=20&pageToken=null&isInitialReviewsLoad=true&isOwnerPublicView=true";
          return fetch(url, {
            credentials: "include",
            headers: { "accept": "*/*", "x-requested-with": "XMLHttpRequest" }
          }).then(function(r){ diag.reviewsStatus = r.status; return r.text(); })
            .then(function(t){
              var doc = new DOMParser().parseFromString(t, "text/html");
              var root = doc.getElementById("contentAjax") || doc.body;
              var cards = root.querySelectorAll('.review-card-container, [content-type="Review"]');
              var reviews = [];
              Array.prototype.forEach.call(cards, function(card){
                function txt(sel){ var e = card.querySelector(sel); return e ? e.textContent.trim() : null; }
                var star = card.querySelector('[class*="a-star-"]');
                var rating = null;
                if (star) { var cm = star.className.match(/a-star-(\\d+)/); if (cm) { rating = parseInt(cm[1], 10); } }
                var link = card.querySelector('a[href*="customer-reviews/"]');
                var href = link ? link.getAttribute('href') : null;
                var reviewId = null;
                if (href) { var hm = href.match(/customer-reviews\\/([A-Z0-9]+)/); if (hm) { reviewId = hm[1]; } }
                var img = card.querySelector('img.review-product-thumbnail, img');
                reviews.push({
                  reviewtitle: txt('.review-title'),
                  reviewtext: txt('.review-description'),
                  rating: rating,
                  reviewid: reviewId,
                  reviewurl: href,
                  imageurl: img ? img.getAttribute('src') : null
                });
              });

              // The list view has no ASIN / date / Verified-Purchase flag. Follow
              // each review's permalink to resolve product + ASIN + verified + date,
              // which is what a Fayr campaign matches against. Cap the fan-out.
              var toResolve = reviews.slice(0, 10).filter(function(r){ return r.reviewid; });
              var dbg = {};
              return Promise.all(toResolve.map(function(r, i){
                // Build the permalink on the SAME origin (www.amazon.in). The list
                // gives apex-host (amazon.in) urls, which are cross-origin -> "Load failed".
                var purl = "https://www.amazon.in/gp/customer-reviews/" + r.reviewid;
                return fetch(purl, { credentials:"include", headers:{ "accept":"*/*" } })
                  .then(function(res){
                    if (i === 0) { dbg.status = res.status; dbg.finalUrl = res.url; }
                    // The permalink IS the public product-page review URL: if it
                    // 404s (or redirects away), the review isn't live for other
                    // shoppers to see yet (still pending moderation, or removed).
                    r.published = res.status === 200;
                    return res.text();
                  })
                  .then(function(html){
                    var pdoc = new DOMParser().parseFromString(html, "text/html");
                    var plink = pdoc.querySelector('a[data-hook="product-link"]') ||
                                pdoc.querySelector('a[href*="/dp/"]') ||
                                pdoc.querySelector('a[href*="/product-reviews/"]');
                    if (plink) {
                      r.name = plink.textContent.trim();
                      var am = (plink.getAttribute("href") || "").match(/\\/(?:dp|product-reviews)\\/([A-Z0-9]{10})/);
                      if (am) { r.asin = am[1]; r.producturl = "https://www.amazon.in/dp/" + am[1]; }
                    }
                    r.verified = /Verified Purchase/i.test(html) || !!pdoc.querySelector('[data-hook="avp-badge"]');
                    // Review date. ANTI-REPLAY control: it proves the review
                    // post-dates the order, which is what stops a user claiming a
                    // campaign for something they reviewed years ago.
                    // The [data-hook="review-date"] element's own text came back
                    // TRUNCATED to "Reviewed in India " (date missing) in a real
                    // capture, so read the raw HTML instead - that is where the
                    // date actually is - and keep the element only as a fallback.
                    // Match on TEXT, not raw HTML. The element's text came back as
                    // "Reviewed in India " with the date missing, which means the
                    // date lives in a sibling node - and a regex over HTML cannot
                    // cross "</span><span>". textContent concatenates across tags,
                    // so it sees "Reviewed in India on 5 June 2026" either way.
                    var dn = pdoc.querySelector('[data-hook="review-date"]');
                    var dnText = dn ? (dn.textContent || "").replace(/\\s+/g, " ").trim() : null;
                    var ptext = (pdoc.body ? (pdoc.body.textContent || "") : "").replace(/\\s+/g, " ");
                    var dm = ptext.match(/Reviewed in .{0,40}?\\bon\\s+(\\d{1,2}\\s+[A-Za-z]{3,}\\s+\\d{4})/i)
                          || ptext.match(/Reviewed in .{0,40}?\\bon\\s+([A-Za-z]{3,}\\s+\\d{1,2},?\\s*\\d{4})/i);
                    // Only accept a value that actually contains a date; never pass
                    // on a bare "Reviewed in India " as if it were one.
                    r.reviewdate = dm ? dm[1] : (dnText && /\\d{4}/.test(dnText) ? dnText : null);
                    r.reviewdatesource = dm ? "html-regex" : (r.reviewdate ? "element-text" : null);
                    // Amazon exposes no separate "approved" state from "public" -
                    // if the permalink serves the review, it has cleared moderation.
                    r.approved = r.published;
                    if (i === 0) {
                      // PROOF for the reviewdate fix: the element that failed, its
                      // parent, and every "Reviewed in ..." string on the page - so
                      // if the regex above still misses, it can be corrected from
                      // THIS capture without another round.
                      dbg.reviewDateElHtml = dn ? (dn.outerHTML || "").slice(0, 300) : null;
                      dbg.reviewDateElParentHtml = (dn && dn.parentElement) ? (dn.parentElement.outerHTML || "").slice(0, 700) : null;
                      dbg.reviewDateElText = dnText;
                      // From TEXT, so a date split across sibling tags is visible.
                      dbg.reviewedInMatches = (ptext.match(/Reviewed in .{0,50}/gi) || []).slice(0, 4);
                      dbg.reviewDateParsed = r.reviewdate;
                      dbg.reviewDateSource = r.reviewdatesource;
                      dbg.htmlLen = html.length;
                      dbg.foundProductLink = plink ? plink.getAttribute("href") : null;
                      // grab any ASIN-looking token from the page as a fallback probe
                      var anyAsin = html.match(/\\/(?:dp|product-reviews)\\/([A-Z0-9]{10})/);
                      dbg.anyAsinInHtml = anyAsin ? anyAsin[1] : null;
                      dbg.htmlHead = html.slice(0, 1200);
                    }
                    return r;
                  })
                  .catch(function(e){
                    r.published = false; r.approved = false;
                    if (i === 0) { dbg.error = String((e && e.message) || e); }
                    return r;
                  });
              })).then(function(){
                // DISCOVERY: fetch order history (HTML) to map order/delivery/return.
                return fetch("https://www.amazon.in/your-orders/orders?_encoding=UTF8", { credentials:"include", headers:{ "accept":"*/*" } })
                  .then(function(r){ return r.text().then(function(html){
                    var odoc = new DOMParser().parseFromString(html, "text/html");
                    var cards = odoc.querySelectorAll('.order-card, .js-order-card, [class*="order-card"]');
                    var asinMatches = html.match(/\\/(?:dp|product|gp\\/product)\\/[A-Z0-9]{10}/g) || [];
                    var asins = [], seenA = {};
                    asinMatches.forEach(function(a){ var m = a.match(/[A-Z0-9]{10}$/); if (m && !seenA[m[0]]) { seenA[m[0]] = 1; asins.push(m[0]); } });

                    // Per-ASIN order facts. Every regex below is calibrated against
                    // a real desktop capture (2026-07-15) - see the notes on each.
                    //
                    // Amazon's order cards embed inline <script> tags, so reading
                    // card.textContent raw pulls in MINIFIED JS. That is why the old
                    // /return(ed)?/ test reported returned=true on every single
                    // review: it was matching the JavaScript keyword "return".
                    // Strip script/style/noscript from a clone before reading text.
                    function cleanText(el){
                      if (!el) { return ""; }
                      var c = el.cloneNode(true);
                      // Strip scripts (their minified JS was matching the "return"
                      // KEYWORD and reporting every order as returned), and strip
                      // site chrome - nav/header/footer carry "Returns & Orders" and
                      // a wall of accessibility text that both pollutes the return
                      // check and buries the real order text past any sane sample.
                      var junk = c.querySelectorAll(
                        'script, style, noscript, nav, header, footer, ' +
                        '#navbar, #nav-main, #navFooter, #skiplink, .skip-link, ' +
                        '#a-page > .a-hidden, [aria-hidden="true"]'
                      );
                      Array.prototype.forEach.call(junk, function(n){
                        if (n.parentNode) { n.parentNode.removeChild(n); }
                      });
                      return (c.textContent || "").replace(/\\s+/g, " ").trim();
                    }
                    // Evidence collectors: rather than inferring whether "returned"
                    // is real from a truncated text dump, show the EXACT phrases that
                    // did (and could have) triggered it, with surrounding context.
                    // "returned" gates a refund, so it has to be proven, not guessed.
                    function matchesWithContext(txt, re, cap){
                      var out = [], m, guard = 0;
                      while ((m = re.exec(txt)) !== null && out.length < cap && guard++ < 400) {
                        var start = Math.max(0, m.index - 60);
                        out.push(txt.slice(start, m.index + m[0].length + 60).trim());
                        if (m.index === re.lastIndex) { re.lastIndex++; }
                      }
                      return out;
                    }
                    // What actually fired readReturned (the -ed / completed forms).
                    function returnEvidence(txt){
                      return matchesWithContext(txt, /\\b(returned|refunded|cancelled|canceled)\\b|\\brefund\\s+issued\\b|\\breturn\\s+complete[d]?\\b/gi, 6);
                    }
                    // EVERY return/refund/cancel mention incl. chrome ("Return window
                    // closed", "Return items: Eligible through"), so we can see what
                    // the check is correctly ignoring as well as what it caught.
                    function returnMentions(txt){
                      return matchesWithContext(txt, /\\b(return|refund|cancel)[a-z]*\\b/gi, 12);
                    }
                    // Shared field readers, used for BOTH the order-list cards and
                    // the per-order detail pages so the two can't drift apart.
                    function readDates(txt){
                      // Amazon India renders dates DAY-first ("Delivered 5 June");
                      // try that, then month-first.
                      var dv = txt.match(/Delivered\\s*(?:on)?\\s*(\\d{1,2}\\s+[A-Za-z]{3,}(?:,?\\s*\\d{4})?)/i)
                            || txt.match(/Delivered\\s*(?:on)?\\s*([A-Za-z]{3,}\\s+\\d{1,2}(?:,?\\s*\\d{4})?)/i);
                      var od = txt.match(/Order(?:ed)?\\s*(?:placed|on)?\\s*(?:[A-Za-z]+,\\s*)?(\\d{1,2}\\s+[A-Za-z]{3,}(?:,?\\s*\\d{4})?)/i)
                            || txt.match(/Order(?:ed)?\\s*(?:placed|on)?\\s*(?:[A-Za-z]+,\\s*)?([A-Za-z]{3,}\\s+\\d{1,2}(?:,?\\s*\\d{4})?)/i);
                      return { deliverydate: dv ? dv[1] : null, orderdate: od ? od[1] : null };
                    }
                    function readReturned(txt){
                      // Only the COMPLETED forms - every page carries chrome like
                      // "Return window closed" / "Return items: Eligible through",
                      // which contain "Return" but never "Returned".
                      return /\\b(returned|refunded|cancelled|canceled)\\b/i.test(txt)
                        || /\\brefund\\s+issued\\b/i.test(txt)
                        || /\\breturn\\s+complete[d]?\\b/i.test(txt);
                    }
                    // ONE canonical amount shape for everything this script emits:
                    // a plain decimal string, no rupee symbol, no thousands commas
                    // ("388.00", "1326.00"). Previously itemamount carried the symbol
                    // and orderamount did not - two shapes for one concept, which is
                    // exactly what goes wrong when a paise ledger reads it. src/money.js
                    // is the only thing that converts this to paise.
                    function normAmount(v){
                      if (v == null) { return null; }
                      var s = String(v).replace(/[\\u20b9,\\s]/g, "");
                      var m = s.match(/^\\d+(?:\\.\\d{1,2})?$/);
                      return m ? m[0] : null;
                    }
                    function readAmount(txt){
                      // Detail pages label it "Order Total" / "Grand Total"; the list
                      // card header just says "Total". Try the labelled forms first,
                      // then fall back to the first rupee token. amountsource records
                      // which fired so a wrong number is traceable.
                      var tot = txt.match(/(?:Order\\s+Total|Grand\\s+Total|Total)\\s*:?\\s*\\u20b9\\s?([\\d,]+(?:\\.\\d{2})?)/i);
                      var anyRs = txt.match(/\\u20b9\\s?([\\d,]+(?:\\.\\d{2})?)/);
                      return {
                        orderamount: normAmount(tot ? tot[1] : (anyRs ? anyRs[1] : null)),
                        amountsource: tot ? "total-label" : (anyRs ? "first-rupee-token" : null)
                      };
                    }
                    function asinsIn(root){
                      var out = [], seen = {};
                      var els = root.querySelectorAll('a[href*="/dp/"], a[href*="/product/"], a[href*="/gp/product/"]');
                      Array.prototype.forEach.call(els, function(a){
                        var m = (a.getAttribute('href') || '').match(/[A-Z0-9]{10}/);
                        if (m && !seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); }
                      });
                      return out;
                    }

                    // PER-ITEM PRICE, keyed by ASIN.
                    //
                    // The order TOTAL is unusable for a percentage refund: it folds
                    // in shipping, fees and discounts, and Amazon merges carts, so
                    // one order can bundle a campaign product with unrelated items.
                    // A refund of "90% of the item" needs the item's own price line.
                    //
                    // The item-row DOM is not known, so rather than guess a class
                    // name, walk UP from each product link to the nearest ancestor
                    // whose text contains a rupee amount. Record the level it was
                    // found at and every token in that container: a high level means
                    // the walk escaped the row and probably hit the order summary,
                    // which is exactly the failure this needs to make visible rather
                    // than silently pay out on.
                    // HOW MANY UNITS DID THEY BUY?
                    //
                    // The same rule as src/quantity.js, inlined because this is an
                    // injected page script and cannot import. quantity.test.mjs
                    // reads THIS FILE as text and fails if the two ever drift.
                    //
                    // Only a number the page LABELS is read. Refused on purpose:
                    // a bare number beside the item (that is layout, and layout
                    // changes without notice), a count inside the product title
                    // ("Set of 2 Pieces" is one unit), and the option list of a
                    // return form's quantity picker, which cleanText flattens to
                    // the text "Quantity: 1 2 3" and would otherwise be read as 1
                    // on an order of three.
                    function statedQuantityIn(txt){
                      var out = { quantity: null, source: null, reason: "not-stated", candidates: [] };
                      if (!txt) { return out; }
                      var labels = [
                        { label: "qty", re: /\\bqty\\b\\s*[:.\\-]?\\s*(\\d{1,3})(?![\\d.])/gi },
                        { label: "quantity", re: /\\bquantity\\b\\s*[:.\\-]?\\s*(\\d{1,3})(?![\\d.])/gi }
                      ];
                      labels.forEach(function(L){
                        var m;
                        while ((m = L.re.exec(txt)) !== null) {
                          var value = Number(m[1]);
                          var rest = txt.slice(m.index + m[0].length);
                          var next = rest.match(/^\\s*(\\d{1,3})(?![\\d.])/);
                          if (next && Number(next[1]) === value + 1) {
                            out.candidates.push({ label: L.label, value: value, rejected: "picker" });
                          } else {
                            out.candidates.push({ label: L.label, value: value });
                          }
                        }
                      });
                      var accepted = out.candidates.filter(function(c){ return !c.rejected; });
                      if (!accepted.length) {
                        if (out.candidates.length) { out.reason = "picker"; }
                        return out;
                      }
                      var distinct = [];
                      accepted.forEach(function(c){ if (distinct.indexOf(c.value) < 0) { distinct.push(c.value); } });
                      // Two different labelled numbers in ONE item's container means
                      // the walk escaped the row. Not an answer about this item.
                      if (distinct.length > 1) { out.reason = "conflicting"; return out; }
                      var v = distinct[0];
                      if (!(v === Math.floor(v) && v >= 1 && v <= 99)) { out.reason = "implausible"; return out; }
                      out.quantity = v;
                      out.source = accepted[0].label === "qty" ? "label-qty" : "label-quantity";
                      out.reason = null;
                      return out;
                    }
                    // DIAGNOSTIC ONLY, and it must stay that way: Amazon's own
                    // "return or replace" and "buy it again" forms carry a quantity
                    // field whose value is the FORM'S DEFAULT, not the purchase. The
                    // point of collecting them is that one real capture then tells us
                    // whether a trustworthy stated quantity exists on this page at
                    // all - without adding a single request to find out.
                    function markupQtyHits(html){
                      if (!html) { return []; }
                      var res = [
                        /([a-z-]*(?:qty|quantity)[a-z-]*)\\s*=\\s*"(\\d{1,3})"/gi,
                        /name\\s*=\\s*"([a-z-]*(?:qty|quantity)[a-z-]*)"[^>]*?value\\s*=\\s*"(\\d{1,3})"/gi
                      ];
                      var seen = [];
                      res.forEach(function(re){
                        var m;
                        while ((m = re.exec(html)) !== null && seen.length < 8) {
                          var hit = m[1] + '="' + m[2] + '"';
                          if (seen.indexOf(hit) < 0) { seen.push(hit); }
                        }
                      });
                      return seen;
                    }
                    function itemPricesIn(root){
                      var prices = {}, dbg = [];
                      var els = root.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]');
                      Array.prototype.forEach.call(els, function(a){
                        var m = (a.getAttribute('href') || '').match(/(?:dp|gp\\/product)\\/([A-Z0-9]{10})/);
                        if (!m) { return; }
                        var asin = m[1];
                        if (prices[asin]) { return; } // first (topmost) occurrence wins
                        var node = a, level = 0, tokens = [], containerText = "", containerHtml = null;
                        while (node && level < 7) {
                          node = node.parentElement;
                          if (!node) { break; }
                          level++;
                          var txt = cleanText(node);
                          var all = txt.match(/\\u20b9\\s?[\\d,]+(?:\\.\\d{2})?/g) || [];
                          if (all.length) {
                            tokens = all; containerText = txt;
                            containerHtml = (node.outerHTML || "").slice(0, 1200);
                            break;
                          }
                        }
                        // The quantity is read from the SAME container the price
                        // came from, never the page: a number belonging to another
                        // item must not be able to divide this item's price.
                        var q = statedQuantityIn(containerText);
                        if (tokens.length) {
                          prices[asin] = {
                            price: normAmount(tokens[0]), level: level, tokenCount: tokens.length,
                            quantity: q.quantity, quantitySource: q.source, quantityReason: q.reason
                          };
                        }
                        if (dbg.length < 4) {
                          dbg.push({
                            asin: asin, foundAtLevel: level, chosen: tokens[0] || null,
                            tokensInContainer: tokens.slice(0, 8),
                            ambiguous: tokens.length > 1,
                            // PROOF for the quantity, to the same standard as the
                            // price: what was chosen, why nothing was, every
                            // labelled number seen, and the quantity-shaped markup
                            // in the container. A null here has to be explainable
                            // from the capture alone, or the next step is guessing.
                            quantityChosen: q.quantity,
                            quantitySource: q.source,
                            quantityReason: q.reason,
                            quantityCandidates: q.candidates.slice(0, 6),
                            quantityMarkupHits: markupQtyHits(containerHtml),
                            containerTextHead: containerText.slice(0, 240),
                            // Raw structure, so a wrong pick can be turned into a
                            // real selector offline from this same capture.
                            containerHtml: containerHtml
                          });
                        }
                      });
                      return { prices: prices, dbg: dbg };
                    }

                    var byAsin = {};
                    var cardDbg = [];
                    var orderIds = [];
                    Array.prototype.forEach.call(cards, function(card){
                      var cardAsins = asinsIn(card);
                      var txt = cleanText(card);
                      var dts = readDates(txt);
                      var amt = readAmount(txt);
                      var returned = readReturned(txt);

                      // The order id is on the card ELEMENT, not in its text:
                      // data-csa-c-slot-id="amzn1.yourorders.order-card.408-3245318-0807503"
                      // Reading an attribute is why this survives when the card's
                      // text does not (the list page often ships script-only cards
                      // hydrated client-side - see the caveat in commit 66dea7d).
                      var slot = card.getAttribute('data-csa-c-slot-id') || "";
                      var oid = slot.match(/(\\d{3}-\\d{7}-\\d{7})/) || txt.match(/\\b(\\d{3}-\\d{7}-\\d{7})\\b/);
                      var orderid = oid ? oid[1] : null;
                      if (orderid && orderIds.indexOf(orderid) < 0) { orderIds.push(orderid); }

                      var facts = {
                        orderid: orderid,
                        orderdate: dts.orderdate,
                        orderamount: amt.orderamount,
                        amountsource: amt.amountsource,
                        deliverydate: dts.deliverydate,
                        returned: returned,
                        returnstatus: returned ? "RETURNED_OR_CANCELLED" : null,
                        source: "order-list"
                      };
                      if (cardDbg.length < 3) {
                        cardDbg.push({ asins: cardAsins, facts: facts, textHead: txt.slice(0, 260) });
                      }
                      cardAsins.forEach(function(asin){ byAsin[asin] = facts; });
                    });

                    // PROBE: per-order detail pages. The order LIST is unreliable -
                    // its cards are often script-only shells hydrated client-side, so
                    // DOMParser (which does not execute scripts) sees no text and the
                    // ASIN join yields nothing. But the order IDs above come from an
                    // attribute and ARE reliable, so try each order's own detail page,
                    // which may be server-rendered. Anything found here OVERWRITES the
                    // list-derived facts, and records source:"order-details".
                    var detailDbg = [];
                    // Bound the fan-out, but not so tightly that a real purchase
                    // falls outside it. Raised 6 -> 10 on 2026-08-12 after a
                    // CONFIRMED miss, not a guess: Nike shoes order
                    // 408-5614193-1514764 sat outside the 6 most recent orders, so
                    // its detail page was never fetched and the task reported
                    // order_unreadable while the review itself matched fine. The
                    // list surfaced 7 order ids and only 6 were probed.
                    //
                    // 10 is a deliberate ceiling, not an opening: these run through
                    // Promise.all, so the number IS the concurrent request count
                    // against Amazon, and pushing it higher risks the bot-detection
                    // and re-auth wall that already makes this page unreliable
                    // (~2 of every 6 detail pages come back empty). Anything past
                    // 10 should move to sequential or paginated fetching instead of
                    // widening this.
                    var probeIds = orderIds.slice(0, 10);
                    return Promise.all(probeIds.map(function(oid){
                      var durl = "https://www.amazon.in/gp/your-account/order-details?orderID=" + oid;
                      return fetch(durl, { credentials:"include", headers:{ "accept":"*/*" } })
                        .then(function(res){
                          return res.text().then(function(dhtml){
                            var ddoc = new DOMParser().parseFromString(dhtml, "text/html");
                            var dtxt = cleanText(ddoc.body);
                            var dAsins = asinsIn(ddoc);
                            var dts = readDates(dtxt);
                            var amt = readAmount(dtxt);   // ORDER total - NOT refundable
                            var ret = readReturned(dtxt);
                            var items = itemPricesIn(ddoc); // per-ASIN item price
                            // A page that redirected to sign-in, or whose text is
                            // near-empty after stripping scripts, is NOT usable -
                            // record why rather than silently mapping nulls.
                            var signin = /ap\\/signin/i.test(res.url || "");
                            var rendered = !signin && dtxt.length > 400;
                            if (detailDbg.length < 6) {
                              detailDbg.push({
                                orderid: oid, status: res.status, finalUrl: (res.url || "").slice(0, 120),
                                signinRedirect: signin, cleanTextLen: dtxt.length,
                                rupeeCount: (dtxt.match(/\\u20b9/g) || []).length,
                                serverRendered: rendered, asins: dAsins.slice(0, 8),
                                parsed: { orderdate: dts.orderdate, orderamount: amt.orderamount, amountsource: amt.amountsource, deliverydate: dts.deliverydate, returned: ret },
                                // PROOF for "returned", the field that gates a refund:
                                // returnEvidence = the phrases that actually fired it;
                                // returnMentions = every return/refund/cancel mention
                                // including chrome, so a false positive is visible as
                                // such instead of having to be inferred.
                                returnEvidence: returnEvidence(dtxt),
                                returnMentions: returnMentions(dtxt),
                                // PROOF for the per-item price: what was picked for
                                // each ASIN, how far up the walk had to go, whether
                                // the container held more than one amount, and the
                                // raw container HTML. An order total leaking in as an
                                // item price is a real overpayment, so it has to be
                                // checkable rather than trusted.
                                itemPrices: items.prices,
                                itemPriceSamples: items.dbg,
                                orderTotalForContrast: amt.orderamount,
                                // Nav/header/footer are stripped now, so this starts
                                // at the real order content instead of a wall of
                                // accessibility shortcuts.
                                textHead: dtxt.slice(0, 700)
                              });
                            }
                            if (!rendered) { return; }
                            dAsins.forEach(function(asin){
                              var ip = items.prices[asin] || null;
                              // Per-ASIN facts. itemamount is the ONLY refundable
                              // figure; orderamount is retained for contrast/audit
                              // but must never be paid out against - it includes
                              // shipping/fees/discounts and may bundle unrelated
                              // items from a merged cart.
                              byAsin[asin] = {
                                orderid: oid,
                                orderdate: dts.orderdate,
                                itemamount: ip ? ip.price : null,
                                itemamountlevel: ip ? ip.level : null,
                                itemamountambiguous: ip ? ip.tokenCount > 1 : null,
                                // The unit count, ONLY when the item's own container
                                // states one. Null means unknown, and the refund
                                // refuses rather than assuming one unit.
                                quantity: ip ? ip.quantity : null,
                                quantitysource: ip ? ip.quantitySource : null,
                                quantityreason: ip ? ip.quantityReason : "no-item-container",
                                orderamount: amt.orderamount,
                                amountsource: amt.amountsource,
                                deliverydate: dts.deliverydate,
                                returned: ret,
                                returnstatus: ret ? "RETURNED_OR_CANCELLED" : null,
                                source: "order-details"
                              };
                            });
                          });
                        })
                        .catch(function(e){
                          if (detailDbg.length < 3) { detailDbg.push({ orderid: oid, error: String((e && e.message) || e) }); }
                        });
                    })).then(function(){
                    reviews.forEach(function(r){
                      var of = r.asin && byAsin[r.asin];
                      if (of) {
                        r.orderid = of.orderid;
                        r.orderdate = of.orderdate;
                        // itemamount is the campaign-refundable figure; orderamount
                        // is audit-only. Keep them separately named so no caller can
                        // reach for the wrong one by accident.
                        r.itemamount = of.itemamount;
                        r.itemamountlevel = of.itemamountlevel;
                        r.itemamountambiguous = of.itemamountambiguous;
                        r.quantity = of.quantity;
                        r.quantitysource = of.quantitysource;
                        r.quantityreason = of.quantityreason;
                        r.orderamount = of.orderamount;
                        r.amountsource = of.amountsource;
                        r.deliverydate = of.deliverydate;
                        r.returned = of.returned;
                        r.returnstatus = of.returnstatus;
                        r.ordersource = of.source;
                      }
                    });

                    // CAMPAIGN FILTER — a PRIVACY boundary, not a convenience.
                    //
                    // A task is about ONE product. A user who buys our air dopes and
                    // a mixer grinder must not have the grinder leave the device: not
                    // in reviews, not in diagnostics, not as a stray order id.
                    //
                    // We must fetch other orders to FIND the campaign one (the ASIN
                    // is only knowable after fetching each order's detail page), but
                    // nothing about them may be emitted. Both values are injected by
                    // ConnectScreen from the campaign; neither defaults open.
                    var targetAsin = (typeof window !== "undefined" && window.__fayrTargetAsin) || null;
                    var targetName = (typeof window !== "undefined" && window.__fayrTargetName) || null;
                    var debug = (typeof window !== "undefined" && window.__fayrDebugCapture === true);

                    // FAIL CLOSED. No campaign target and no explicit debug opt-in
                    // means we do not know what we are allowed to surface - so we
                    // surface NOTHING rather than defaulting to everything.
                    if (!targetAsin && !debug) {
                      return {
                        error: "no_campaign_target",
                        note: "No campaign ASIN was set, so nothing was returned. Production fetches must set window.__fayrTargetAsin. Set DEBUG_CAPTURE in src/config.js for an unfiltered diagnostic capture.",
                        reviews: [], count: 0
                      };
                    }

                    // Filter to the campaign product ONLY when we are not in
                    // debug/unfiltered mode. debug (the dev "Show all" toggle or
                    // DEBUG_CAPTURE) must win even when a campaign targetAsin is
                    // also set - otherwise the toggle silently does nothing,
                    // because a campaign always sets targetAsin. This was the bug.
                    var surfaced = (targetAsin && !debug)
                      ? reviews.filter(function(r){ return r.asin === targetAsin; })
                      : reviews;

                    // NAME FALLBACK — added 2026-08-12 after a live failure.
                    //
                    // Amazon issues a SEPARATE ASIN per size/colour variant, so the
                    // ASIN on a campaign (taken from the listing) need not equal the
                    // ASIN a review resolves to. Proven live: a Nike shoes task with
                    // targetAsin B0F16FQFZY surfaced 0 of the account's reviews,
                    // while a single-variant garment rack on the same account matched
                    // first time. r.asin is also simply ABSENT when the permalink
                    // fetch failed to yield a product link, which fails the exact
                    // test just as silently.
                    //
                    // This stays a FILTER TO THE CAMPAIGN PRODUCT. It never widens to
                    // "surface everything" - the privacy boundary above is that a
                    // user's unrelated purchases must not leave the device, and a
                    // name match honours that exactly as an ASIN match does. Scoring
                    // is fkScore's proven method (same normalisation, same 0.6 bar
                    // already used for Flipkart and quick-commerce), duplicated here
                    // rather than shared because this script is a standalone string.
                    var asinOnlyCount = surfaced.length;
                    if (targetAsin && !debug && surfaced.length === 0 && targetName) {
                      var azNrm = function(s){ return String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); };
                      var azScore = function(exp, cand){
                        var e = azNrm(exp), c = azNrm(cand);
                        if (!e || !c) return 0;
                        if (c.indexOf(e) >= 0 || e.indexOf(c) >= 0) return 1;
                        var toks = e.split(" ").filter(function(w){ return w.length > 2; });
                        if (!toks.length) return 0;
                        var h = 0;
                        toks.forEach(function(w){ if (c.indexOf(w) >= 0) h++; });
                        return h / toks.length;
                      };
                      surfaced = reviews.filter(function(r){ return azScore(targetName, r.name) >= 0.6; });
                    }

                    // RAW SAMPLES (diagnostic only). The mapped review fields are
                    // a LOSSY view - notably no order amount is mapped at all, so
                    // its absence from the export says nothing about whether
                    // Amazon exposes it. Amazon's orders are HTML, so ship the
                    // card's readable TEXT (far easier to locate amount/date in
                    // than markup) plus every price-looking token, bounded.
                    var firstCardText = cards[0]
                      ? (cards[0].textContent || "").replace(/\\s+/g, " ").trim().slice(0, 1500)
                      : null;
                    var priceTokens = (html.match(/\\u20b9\\s?[\\d,]+(?:\\.\\d{2})?/g) || []);
                    var uniqPrices = priceTokens.filter(function(v, i, a){ return a.indexOf(v) === i; }).slice(0, 25);
                    var dateTokens = (html.match(/(?:Order placed|Ordered on|Delivered)\\s*[^<]{0,28}/gi) || []).slice(0, 10);
                    var sample = {
                      status: r.status, finalUrl: r.url, cardCount: cards.length,
                      asins: asins.slice(0, 15),
                      matchedAsins: Object.keys(byAsin),
                      firstCardHtml: cards[0] ? cards[0].outerHTML.slice(0, 2500) : html.slice(0, 1500),
                      firstCardText: firstCardText,
                      priceTokens: uniqPrices,
                      dateTokens: dateTokens,
                      // Per-card parsed facts + the script-stripped text they came
                      // from, so a wrong order amount / return flag can be traced to
                      // the exact text it was read out of instead of re-guessing.
                      cardSamples: cardDbg,
                      // Order ids are read from a card attribute, so they survive
                      // even when the list ships script-only cards.
                      orderIds: orderIds,
                      // The order-details probe: per order, whether that page was
                      // actually server-rendered (serverRendered/cleanTextLen), what
                      // it parsed to, and the text it parsed from. This is what tells
                      // us whether the detail page is a usable source at all.
                      orderDetailProbe: detailDbg,
                      // filteredOut proves the filter SELECTED rather than merely
                      // returned nothing - an empty result and a working filter look
                      // identical otherwise. DEBUG ONLY: it names other ASINs.
                      targetAsin: targetAsin,
                      filterApplied: !!(targetAsin && !debug),
                      candidateAsins: reviews.map(function(r){ return r.asin; }),
                      filteredOut: (targetAsin && !debug) ? reviews.filter(function(r){ return r.asin !== targetAsin; }).map(function(r){ return r.asin; }) : []
                    };

                    // EVERY diagnostic above is derived from the user's OTHER orders
                    // - order ids, ASINs, prices, page text. None of it may ship in
                    // production, so the whole sample is attached only under the
                    // debug flag. Omitting the key entirely (rather than emptying it)
                    // means there is no shape to accidentally leak through later.
                    // reviewsFound / asinOnlyCount are PRE-FILTER counts, and they are
                    // the difference between two failures that used to look identical:
                    // "no reviews on this account at all" (reviewsFound 0) versus
                    // "reviews were read and the ASIN filter discarded every one"
                    // (reviewsFound > 0, asinOnlyCount 0). Counts only - no titles, no
                    // ids, nothing about products other than the campaign's.
                    var out = {
                      accountId: id,
                      targetAsin: targetAsin,
                      reviewsFound: reviews.length,
                      asinOnlyCount: asinOnlyCount,
                      nameFallbackUsed: asinOnlyCount === 0 && surfaced.length > 0,
                      count: surfaced.length,
                      reviews: surfaced
                    };
                    if (debug) { out.__amazonOrdersSample = sample; }

                    // PRIVACY-SAFE DIAGNOSTICS - always on, including production.
                    // Gating ALL diagnostics behind the debug flag made a
                    // production failure undiagnosable: "order_unreadable" with no
                    // way to tell whether the probe never ran, hit the re-auth
                    // wall, or simply didn't contain the campaign product.
                    // These are COUNTS AND BOOLEANS ONLY - no order ids, no other
                    // ASINs, no page text - so they say what happened without
                    // describing anything the user bought.
                    out.__probe = {
                      listCardCount: cards.length,
                      orderIdsFound: orderIds.length,
                      ordersProbed: probeIds.length,
                      pagesServerRendered: detailDbg.filter(function(p){ return p && p.serverRendered === true; }).length,
                      pagesSigninRedirect: detailDbg.filter(function(p){ return p && p.signinRedirect === true; }).length,
                      pagesEmpty: detailDbg.filter(function(p){ return p && !p.error && p.serverRendered === false; }).length,
                      pagesErrored: detailDbg.filter(function(p){ return p && p.error; }).length,
                      // Did ANY probed order contain the campaign product? This is
                      // the single fact that separates "we couldn't read your
                      // orders" from "this order isn't in your recent orders".
                      targetAsinInAnyOrder: targetAsin ? Object.keys(byAsin).indexOf(targetAsin) >= 0 : null,
                      targetReviewFound: targetAsin ? reviews.some(function(r){ return r.asin === targetAsin; }) : null,
                      ordersListSignin: /ap\\/signin/i.test(r.url || "")
                    };
                    return out;
                    });
                  }); })
                  .catch(function(e){ return { accountId: id, reviews: reviews, __amazonOrdersError: String((e && e.message) || e) }; });
              });
            });
        })
        .catch(function(e){
          if (e && e.stage) { return { __diagnostic: e }; }
          return { __diagnostic: { stage: "error", message: String((e && e.message) || e), partial: diag } };
        });
    })()
  `
  ),
};

// Installed BEFORE the Myntra page loads: wraps fetch + XHR to record every
// request whose URL mentions review/rating (url, method, body, response head)
// into window.__fayrCalls. Lets us discover the styleId -> reviewId endpoint
// that the orders page lazy-loads, without manual DevTools work.
const MYNTRA_HOOK = `
(function(){
  if (window.__fayrHooked) { return; }
  window.__fayrHooked = true;
  window.__fayrCalls = [];
  function match(u){ return typeof u === "string" && /review|rating/i.test(u); }
  function push(rec){ try { if (window.__fayrCalls.length < 30) { window.__fayrCalls.push(rec); } } catch(e){} }

  var of = window.fetch;
  if (of) {
    window.fetch = function(input, init){
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      var body = (init && init.body) || null;
      var p = of.apply(this, arguments);
      if (match(url)) {
        p.then(function(res){
          try { res.clone().text().then(function(t){
            push({ via:"fetch", url:url, method:method, reqBody: body ? String(body) : null, resp: (t||"").slice(0, 3000) });
          }); } catch(e){}
        }).catch(function(){});
      }
      return p;
    };
  }

  var oOpen = XMLHttpRequest.prototype.open;
  var oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__fayr = { method:m, url:u }; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){
    var self = this;
    if (self.__fayr && match(self.__fayr.url)) {
      self.addEventListener("load", function(){
        try { push({ via:"xhr", url:self.__fayr.url, method:self.__fayr.method, reqBody: b ? String(b) : null, resp: (self.responseText||"").slice(0, 3000) }); } catch(e){}
      });
    }
    return oSend.apply(this, arguments);
  };
})();
true;`;

const myntra = {
  key: 'myntra',
  name: 'Myntra',
  authCookies: ['at', 'rt'],
  color: '#FF3F6C',
  startUrl: 'https://www.myntra.com/my/orders',
  // ESTABLISHED. Asked for from this machine on 2 September 2026: it answered 200
  // with a real sign in page on it. Myntra is a dormant shop and its reader is
  // deliberately left alone; this is a written down address and nothing else.
  signInUrl: 'https://www.myntra.com/login',
  beforeLoadScript: MYNTRA_HOOK,
  hint: 'Log in, wait for My Orders to load (ratings appear), then tap "Fetch my reviews".',
  // Two-step: fetch orders (product name + order date), then best-effort fetch
  // review content for up to 5 UUID ids discovered in the orders payload.
  fetchScript: wrap(
    'myntra',
    `
    (function(){
      // Diagnostic-only raw sample (locates the per-item PAID price field, which
      // is not the same as mrp). Gated on the dev "Show all" flag so it never
      // ships in a normal fetch - same discipline as the Amazon script.
      var debug = (typeof window !== "undefined" && window.__fayrDebugCapture === true);
      var H = {
        "accept": "application/json",
        "authorization": "Basic bW9iaWxlfm1vYmlsZTptb2JpbGU=",
        "content-type": "application/json",
        "x-myntra-client-id": "selfserve-ui"
      };
      var body = {
        page:1, size:20, searchString:null, status:"ALL", filter:"DEFAULT",
        from:null, to:null, newSearchFG:true, newAggregatorResponse:true,
        getStyle:"true", getPayments:"true", getTracking:"true", getGiftCard:"false",
        getCart:"true", getCartV2:"true", getUsp:true, getReturn:"true",
        getReturnFromAggregator:false
      };
      return fetch("https://www.myntra.com/my/ss-api/fetchOrdersApi/getOrders", {
        method:"POST", credentials:"include", headers:H, body: JSON.stringify(body)
      }).then(function(r){ return r.json(); })
        .then(function(orders){
          var items = (orders && orders.items) || [];
          var norm = items.map(function(it){
            var p = it.product || {};
            var img = (p.images && p.images[0] && (p.images[0].secureSrc || p.images[0].src)) || null;
            // Delivery date: scan tracking states for a delivered event.
            var deliv = null;
            var states = (it.tracking && it.tracking.states) || [];
            states.forEach(function(s){
              var sig = ((s.eventType || "") + " " + (s.comment || ""));
              if (/deliver/i.test(sig)) { deliv = s.actualEventTime || s.createdOn || deliv; }
            });
            // Returned / cancelled detection.
            var returned = !!it.return || !!(it.cancellationStatus && it.cancellationStatus !== "");
            var returnstatus = (it.cancellationStatus && it.cancellationStatus !== "") ? "CANCELLED"
              : (it.return ? "RETURN_INITIATED" : "");
            return {
              name: p.name || null,
              brandname: (p.brand && p.brand.name) || null,
              createdon: it.createdOn || null,
              deliverydate: deliv,
              styleid: p.id || null,
              skuid: p.skuId || null,
              mrp: (p.price && p.price.mrp) || null,
              orderid: it.orderId || null,
              storeorderid: it.storeOrderId || null,
              imageurl: img,
              returnable: !!(it.flags && it.flags.returnable && it.flags.returnable.isReturnable),
              returnperiod: it.itemReturnPeriod || null,
              returned: returned,
              returnstatus: returnstatus,
              statuscode: (it.status && it.status.code) || null
            };
          });
          // Reviews aren't in orders. Ask the bulk ratings endpoint which of
          // these styleIds the user has reviewed (status ACTIVE), then fetch each
          // review's full detail for the true user star rating. Keep reviewed only.
          var styleIds = [], seenS = {};
          norm.forEach(function(o){ if (o.styleid && !seenS[o.styleid]) { seenS[o.styleid] = 1; styleIds.push(o.styleid); } });

          var bulkUrl = "https://www.myntra.com/gateway/v1/ratings/userrnr/bulk?styleIds=" + styleIds.join(",");
          return fetch(bulkUrl, { credentials:"include", headers: { "accept":"application/json" } })
            .then(function(r){ return r.json(); })
            .then(function(bulk){
              var reviewedMap = {};
              var arr = (bulk && bulk.styleToRatingAndReviewsMap) || [];
              arr.forEach(function(e){
                var v = e && e.value, rv = v && v.review;
                if (rv && rv.status === "ACTIVE" && rv.id) {
                  reviewedMap[String(e.key)] = { reviewId: rv.id, reviewText: rv.review, communityRating: v.rating };
                }
              });
              var reviewedIds = Object.keys(reviewedMap);

              return Promise.all(reviewedIds.map(function(sid){
                return fetch("https://www.myntra.com/my/ss-api/reviewApi/fetchReview", {
                  method:"POST", credentials:"include", headers:H, body: JSON.stringify({ id: reviewedMap[sid].reviewId })
                }).then(function(r){ return r.json(); })
                  .then(function(d){ return { sid: sid, detail: d }; })
                  .catch(function(){ return { sid: sid, detail: null }; });
              })).then(function(details){
                var detailMap = {};
                details.forEach(function(d){ detailMap[d.sid] = d.detail; });

                var reviewed = norm
                  .filter(function(o){ return reviewedMap[String(o.styleid)]; })
                  .map(function(o){
                    var rm = reviewedMap[String(o.styleid)];
                    var det = detailMap[String(o.styleid)] || {};
                    // The bulk endpoint already filtered to status === "ACTIVE",
                    // so absent a contradicting detail status, treat as approved
                    // and live on the product page.
                    var isActive = det && det.status ? det.status === "ACTIVE" : true;
                    return Object.assign({}, o, {
                      reviewid: rm.reviewId,
                      reviewtext: (det && det.review) || rm.reviewText || null,
                      rating: (det && det.userRating) || rm.communityRating || null,
                      reviewstatus: (det && det.statusMessage) || (det && det.status) || "ACTIVE",
                      approved: isActive,
                      published: isActive,
                      reviewedon: (det && det.updatedAt) || null
                    });
                  });

                // Locate the per-item PAID price. norm maps p.price.mrp only,
                // which is the LIST price - the actual paid figure lives on a
                // differently-named leaf. Scan the first raw item for every
                // price-like leaf WITH ITS PATH so the paid field can be picked
                // out exactly, the way Flipkart's itemSellingPrice was.
                var sample = null;
                if (debug) {
                  var firstItem = items[0] || null;
                  var priceLike = [];
                  (function scan(o, path, d){
                    if (o == null || d > 9 || priceLike.length >= 60) { return; }
                    if (typeof o !== "object") { return; }
                    for (var k in o) {
                      if (!Object.prototype.hasOwnProperty.call(o, k)) { continue; }
                      var v = o[k];
                      if (/price|amount|total|payable|mrp|paid|value|sell|discount/i.test(k) && (typeof v === "number" || typeof v === "string")) {
                        priceLike.push(path + "." + k + " = " + v);
                      }
                      if (v && typeof v === "object") { scan(v, path + "." + k, d + 1); }
                    }
                  })(firstItem, "item", 0);
                  var slice = null;
                  try { slice = firstItem ? JSON.stringify(firstItem).slice(0, 3500) : null; } catch (e) { slice = null; }
                  sample = {
                    priceLike: priceLike,
                    itemKeys: firstItem ? Object.keys(firstItem) : [],
                    productKeys: (firstItem && firstItem.product) ? Object.keys(firstItem.product) : [],
                    productPriceKeys: (firstItem && firstItem.product && firstItem.product.price) ? Object.keys(firstItem.product.price) : [],
                    firstItemSlice: slice
                  };
                }

                // ORDER-FIRST surfacing (privacy-filtered). The campaign
                // product's order, matched by NAME (a Fayr campaign has no
                // styleId - the user searches and buys it themselves), so the
                // PURCHASE is detectable before any review exists. Myntra orders
                // DO carry the product name (p.name), so name-matching is solid;
                // AMOUNT is skipped here because the per-item PAID price isn't
                // located yet (getOrders exposes mrp = list price only - see the
                // __sample probe). norm holds every order; only the matched one
                // leaves. If a styleId was discovered on a prior fetch it pins
                // the match exactly. Port of matchOrderByNameAmount (verify.js).
                var targetStyleId = (typeof window !== "undefined" && window.__fayrTargetStyleId) || null;
                var targetName = (typeof window !== "undefined" && window.__fayrTargetName) || null;
                function myNrm(s){ return String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
                function myScore(exp, cand){
                  var e=myNrm(exp), c=myNrm(cand);
                  if(!e||!c) return 0;
                  if(c.indexOf(e)>=0||e.indexOf(c)>=0) return 1;
                  var toks=e.split(" ").filter(function(w){return w.length>2;});
                  if(!toks.length) return 0;
                  var h=0; toks.forEach(function(w){ if(c.indexOf(w)>=0) h++; });
                  return h/toks.length;
                }
                var matched = null, matchScore = 0, ambiguous = false, candidateCount = 0;
                if (targetStyleId) {
                  matched = norm.filter(function(o){ return String(o.styleid) === String(targetStyleId); })[0] || null;
                  if (matched) { matchScore = 1; candidateCount = 1; }
                } else if (targetName) {
                  var kept = norm.map(function(o){ return { order:o, score: myScore(targetName, o.name) }; })
                                 .filter(function(k){ return k.score >= 0.6; })
                                 .sort(function(a,b){ return b.score - a.score; });
                  candidateCount = kept.length;
                  if (kept.length) {
                    matched = kept[0].order; matchScore = kept[0].score;
                    ambiguous = kept.filter(function(k){ return k.score >= kept[0].score - 0.15; }).length >= 2;
                  }
                }
                var mReview = matched
                  ? (reviewed.filter(function(o){ return String(o.styleid) === String(matched.styleid); })[0] || null)
                  : null;
                var orderProbe = {
                  ordersFetched: true, authFailed: false, ordersCount: items.length,
                  nameAvailable: norm.some(function(o){ return o.name; }),
                  targetFound: !!matched,
                  matchScore: matchScore,
                  amountOk: null,
                  ambiguous: ambiguous,
                  candidateCount: candidateCount
                };

                return {
                  order: matched,
                  review: mReview,
                  orderProbe: orderProbe,
                  totalOrders: orders && orders.totalOrders,
                  reviewedCount: reviewed.length,
                  orders: reviewed,
                  ordersReturnedFromApi: items.length,
                  __sample: sample
                };
              });
            })
            .catch(function(e){
              return { __bulkError: String((e && e.message) || e), orders: [] };
            });
        });
    })()
  `
  ),
};

// ---------------------------------------------------------------------------
// Discovery-mode platforms: Meesho, Instamart, Blinkit, Zepto have no
// reverse-engineered endpoint baked in yet (unlike Flipkart/Amazon/Myntra
// above). Rather than guess API shapes with no way to verify them, these
// install a fetch/XHR interceptor before the page loads that records every
// network call whose URL looks review/rating/order-shaped. "Fetch my
// reviews" just dumps whatever got captured while you browsed Orders /
// Ratings & Reviews in the WebView - inspect it with "Show raw JSON" and
// share it back so a real scrape+verify script (matching the other three)
// can be hard-coded next.
function discoveryHook() {
  return `
(function(){
  if (window.__fayrHooked) { return; }
  window.__fayrHooked = true;
  window.__fayrCalls = [];    // full detail for calls that look review/rating/order-shaped
  window.__fayrAllUrls = [];  // every single fetch/XHR seen (method+url only) - proves the
                               // hook is running even when nothing matches the keyword filter
  // Match against URL OR body OR response text, not just the URL - many SPAs
  // (React + GraphQL, generic REST gateways) route everything through one
  // generic endpoint and put the meaningful part in the POST body or the
  // response, not the path.
  function kw(s){ return typeof s === "string" && /review|rating|feedback|order/i.test(s); }
  function tryParse(t){ try { return JSON.parse(t); } catch(e){ return null; } }
  function pushMatch(rec){ try { if (window.__fayrCalls.length < 60) { window.__fayrCalls.push(rec); } } catch(e){} }
  function pushSeen(u, m){ try { if (window.__fayrAllUrls.length < 250) { window.__fayrAllUrls.push(m + " " + u); } } catch(e){} }

  // Accumulate server-hydrated JSON (Next.js/Nuxt/Redux state) across the WHOLE
  // browsing session, not just whatever page is open when "Fetch" is tapped.
  // These are single-page apps: navigating Home -> Orders -> Order A -> Order B
  // does NOT reload the WebView (no re-injection), so a plain snapshot-at-tap
  // only ever sees the last page you happened to be on. Polling periodically and
  // deduping by (source + URL + payload length) lets browsing through multiple
  // orders/reviews actually build up a fuller picture over one session.
  window.__fayrEmbeddedHistory = [];
  window.__fayrEmbeddedSeen = {};
  function snapshotEmbedded(){
    try {
      if (window.__fayrEmbeddedHistory.length >= 40) { return; }
      var found = [];
      var nextDataEl = document.getElementById("__NEXT_DATA__");
      if (nextDataEl && nextDataEl.textContent) {
        var nd = tryParse(nextDataEl.textContent);
        if (nd) { found.push({ source: "__NEXT_DATA__", url: location.href, json: nd }); }
      }
      ["__NUXT__", "__INITIAL_STATE__", "__APOLLO_STATE__", "__PRELOADED_STATE__"].forEach(function(key){
        try {
          if (window[key] != null) {
            var v = window[key];
            found.push({ source: "window." + key, url: location.href, json: (typeof v === "string") ? tryParse(v) : v });
          }
        } catch(e){}
      });
      found.forEach(function(f){
        var sig = f.source + "|" + f.url + "|" + (JSON.stringify(f.json) || "").length;
        if (!window.__fayrEmbeddedSeen[sig]) {
          window.__fayrEmbeddedSeen[sig] = true;
          window.__fayrEmbeddedHistory.push(f);
        }
      });
    } catch(e){}
  }
  snapshotEmbedded();
  setInterval(snapshotEmbedded, 1500);

  // Blinkit's WEB order list doesn't visibly badge rated orders (only a faint
  // "edit rating" icon), unlike its native app. So we overlay our own "Rated"
  // badge directly on the order cards BEFORE the user taps Fetch. We know which
  // orders are rated from the captured order_history (type === "edit_rating"),
  // and anchor the badge on each rated order's unique product image filename,
  // which appears both in that data and in the rendered page.
  function fayrAnnotateBlinkit(){
    try {
      if (!/blinkit\\.com/.test(location.host)) return;
      var calls = window.__fayrCalls || [];
      var ratedFiles = {};
      calls.forEach(function(c){
        if (!c || !c.url || c.url.indexOf("/v1/layout/order_history") < 0 || !c.respJson) return;
        var snippets = (c.respJson.response && c.respJson.response.snippets) || [];
        snippets.forEach(function(sn){
          if (!sn || sn.widget_type !== "order_history_container_vr" || !sn.data) return;
          var rated = false;
          (function scan(o,d){ if(o==null||d>16)return; if(Array.isArray(o)){for(var i=0;i<o.length;i++)scan(o[i],d+1);return;} if(typeof o==="object"){ if(o.type==="edit_rating")rated=true; for(var k in o){ if(Object.prototype.hasOwnProperty.call(o,k))scan(o[k],d+1);}}})(sn.data,0);
          if (!rated) return;
          (function scan(o,d){ if(o==null||d>16)return; if(Array.isArray(o)){for(var i=0;i<o.length;i++)scan(o[i],d+1);return;} if(typeof o==="object"){ if(typeof o.url==="string"){ var m=o.url.match(/product\\/([^\\/.?]+)/); if(m)ratedFiles[m[1]]=true; } for(var k in o){ if(Object.prototype.hasOwnProperty.call(o,k))scan(o[k],d+1);}}})(sn.data,0);
        });
      });
      if (!Object.keys(ratedFiles).length) return;
      var imgs = document.getElementsByTagName("img");
      for (var i=0;i<imgs.length;i++){
        var src = imgs[i].src || "";
        var mm = src.match(/product\\/([^\\/.?]+)/);
        if (mm && ratedFiles[mm[1]] && !imgs[i].__fayrBadged){
          imgs[i].__fayrBadged = true;
          var p = imgs[i].parentNode;
          if (p) {
            try { var cs = window.getComputedStyle(p); if (cs && cs.position === "static") p.style.position = "relative"; } catch(e){}
            var b = document.createElement("div");
            b.textContent = "\\u2605 Rated";
            b.style.cssText = "position:absolute;top:2px;left:2px;background:#0C831F;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;z-index:99999;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none;";
            p.appendChild(b);
          }
        }
      }
    } catch(e){}
  }
  setInterval(fayrAnnotateBlinkit, 1500);

  // Blinkit: reach Order History with ZERO manual navigation.
  //
  // Zepto and Instamart deep-link straight to their orders route; Blinkit can't
  // (see its startUrl comment - a cold /account/orders load renders a dead shell
  // with no login and no way out). So we land on the homepage where login and
  // navigation exist, and then walk Blinkit's own UI for the user - exactly what
  // fayrOpenInstamartTab already does for Swiggy's Instamart tab.
  //
  // Why this cannot bring back that dead end:
  //  - it never assigns location.href; it CLICKS a real in-page control, and
  //    Blinkit is a Next.js SPA, so its router changes route with no document
  //    load at all - there is no cold render to land in. The dead shell needed a
  //    cold load of the orders URL; a client-side route inside an already
  //    hydrated page cannot produce one,
  //  - it is bounded (a few attempts), stops for good once the order list is
  //    captured, and is silent: if no selector matches, the user taps through by
  //    hand exactly as they do today. Worst case is the current behaviour.
  //
  // There is deliberately NO login check. The first version gated every click on
  // a detectable auth token and, on a real device on 2026-08-10, never fired at
  // all: the user was genuinely logged in the whole time, but Blinkit keeps its
  // access token in an httpOnly cookie that document.cookie can never read, so
  // the gate had no proof to find and correctly stayed silent rather than guess.
  // An unobservable precondition is not a safeguard - it is an off switch. From
  // the homepage the worst a click can do is open the account menu or land on
  // Blinkit's own login screen, and both are recoverable in-page.
  function fayrBlinkitOrdersLink(){
    // 1. A real anchor to the orders route (what a Next.js <Link> renders).
    var as = document.getElementsByTagName("a");
    for (var i=0;i<as.length;i++){
      var h = as[i].getAttribute("href") || "";
      if (/\\/account\\/orders|\\/orders(\\?|$)/.test(h)) return as[i];
    }
    // 2. An SPA control whose whole label IS the orders entry.
    var wanted = ["my orders", "orders", "order history", "your orders"];
    var els = document.querySelectorAll("a,button,li,div,span,[role=button],[role=menuitem]");
    for (var w=0; w<wanted.length; w++){
      for (var j=0;j<els.length;j++){
        var el = els[j];
        if ((el.textContent || "").trim().toLowerCase() === wanted[w] && el.children.length <= 1) return el;
      }
    }
    // 3. An accessibility/test label, for an icon-only entry. Anchored on both
    //    ends so "reorder" and "reorder-history" can never match.
    var lab = document.querySelectorAll("[aria-label],[data-testid]");
    for (var m=0;m<lab.length;m++){
      var al = (lab[m].getAttribute("aria-label") || "").trim().toLowerCase();
      var dt = (lab[m].getAttribute("data-testid") || "").trim().toLowerCase();
      if (/^(my |your )?orders?$/.test(al) || /^order[-_ ]?history$/.test(al)) return lab[m];
      if (/^(my[-_]?)?orders?$/.test(dt) || /^order[-_]?history$/.test(dt)) return lab[m];
    }
    return null;
  }
  function fayrBlinkitAccountTrigger(){
    // Orders normally sits behind the account drawer, so open that first.
    var els = document.querySelectorAll("a,button,div,span,[role=button]");
    for (var i=0;i<els.length;i++){
      var el = els[i];
      var t = (el.textContent || "").trim().toLowerCase();
      if ((t === "account" || t === "my account" || t === "profile") && el.children.length <= 1) return el;
      var a = ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("data-testid") || "")).toLowerCase();
      if (/\\baccount\\b|\\bprofile\\b/.test(a)) return el;
    }
    return null;
  }
  var fayrBlinkitDone = false;
  var fayrBlinkitLinkTries = 0;
  var fayrBlinkitMenuTries = 0;
  function fayrOpenBlinkitOrders(){
    try {
      if (fayrBlinkitDone) return;
      if (!/blinkit\\.com/.test(location.host)) return;
      // The authenticated order list is in hand - stop for good, rather than
      // clicking over whatever the user chooses to do next.
      var calls = window.__fayrCalls || [];
      for (var i=0;i<calls.length;i++){
        if (calls[i] && calls[i].url && calls[i].url.indexOf("/v1/layout/order_history") >= 0) { fayrBlinkitDone = true; return; }
      }
      if (fayrBlinkitLinkTries >= 3) return;
      // Don't interrupt a flow that must not be interrupted. Everything else is
      // fair game - reaching Order History is the entire purpose of this WebView.
      //
      // Deliberately a blocklist, not an allowlist of "/" + /account. Blinkit
      // may well rewrite the homepage path once a delivery location is set, and
      // an allowlist built on a path shape I have not actually observed would
      // silently disable this whole function instead of failing loudly.
      var p = location.pathname || "/";
      if (/^\\/(checkout|cart|payment|pay)\\b/.test(p)) return;
      if (/^\\/account\\/orders/.test(p)) return; // already there; the SPA fetches itself
      var link = fayrBlinkitOrdersLink();
      if (link) { fayrBlinkitLinkTries++; link.click(); return; }
      if (fayrBlinkitMenuTries < 2) {
        var acct = fayrBlinkitAccountTrigger();
        if (acct) { fayrBlinkitMenuTries++; acct.click(); }
      }
    } catch(e){}
  }
  setInterval(fayrOpenBlinkitOrders, 1500);

  // Same idea for Instamart (Swiggy DASH): its web order list doesn't clearly
  // badge rated orders in the WebView. The DASH data has no product images to
  // anchor on, so we mark the order by finding a DOM element that shows the
  // rated order's product NAME (rating_info.is_rated) and appending a badge.
  function fayrAnnotateInstamart(){
    try {
      if (!/swiggy\\.com/.test(location.host)) return;
      var calls = window.__fayrCalls || [];
      // Per-order facts from the DASH list: delivered?, rated?, and product
      // "keys" (name prefixes) that identify the order's items.
      var orders = [];
      calls.forEach(function(c){
        if (!c || !c.url || c.url.indexOf("/mapi/order/dash") < 0 || c.url.indexOf("details") >= 0 || !c.respJson) return;
        ((c.respJson.data && c.respJson.data.orders) || []).forEach(function(o){
          var delivered = /deliver/i.test(String(o.history_status || ""));
          var v2 = o.order_data_v2 || {};
          var rated = false, keys = [];
          (v2.shipments || []).forEach(function(sh){
            var ri = sh.rating_info;
            if (ri && (ri.is_rated === true || (ri.button && /edit/i.test(ri.button.text || "")))) rated = true;
            (sh.items || []).forEach(function(it){ if (it && typeof it.name === "string" && it.name.trim().length >= 4) keys.push(it.name.trim().toLowerCase().slice(0, 16)); });
          });
          orders.push({ delivered: delivered, rated: rated, keys: keys });
        });
      });
      // Walk the ACTUAL order cards. Swiggy renders no rating text, so:
      //  - the card's own status ("delivered") excludes failed/cancelled, and
      //  - matching the card's product set to a dash order tells us if it's
      //    rated (unique per delivered order, even when products are shared
      //    with a failed order - that one is filtered out by status).
      var cards = document.querySelectorAll('[data-testid="dash-order-card"]');
      for (var i=0;i<cards.length;i++){
        var card = cards[i];
        if (card.__fayrRated) continue;
        var st = card.querySelector('[data-testid="order-status"]');
        var stText = (st ? st.textContent : "") || "";
        if (!/deliver/i.test(stText)) continue; // never badge failed/cancelled
        var det = card.querySelector('[data-testid="dash-order-card-details"]') || card;
        var cardText = (det.textContent || "").toLowerCase();
        var match = null;
        for (var j=0;j<orders.length;j++){
          var od = orders[j];
          if (!od.delivered || !od.keys.length) continue;
          var all = true;
          for (var k=0;k<od.keys.length;k++){ if (cardText.indexOf(od.keys[k]) < 0){ all = false; break; } }
          if (all){ match = od; break; }
        }
        if (match && match.rated){
          card.__fayrRated = true;
          var badge = document.createElement("span");
          badge.textContent = " \\u2605 Rated";
          badge.style.cssText = "display:inline-block;background:#FC8019;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle;";
          (st || card).appendChild(badge);
        }
      }
    } catch(e){}
  }
  setInterval(fayrAnnotateInstamart, 1500);

  // Swiggy's "Past Orders" opens on the Restaurants tab; the Instamart order
  // cards only render once the "Instamart" (a.k.a. "Instamart & more") tab is
  // selected - so without this the Instamart orders aren't even in the DOM to
  // badge. Auto-click that tab (a few attempts, in case it isn't interactive
  // yet). Tabs render before the order cards, so the first exact-text match is
  // the tab, not a card's merchant label.
  var fayrTabTries = 0;
  function fayrOpenInstamartTab(){
    try {
      if (!/swiggy\\.com/.test(location.host)) return;
      if (fayrTabTries >= 4) return;
      var wanted = ["instamart & more", "instamart"];
      var els = document.querySelectorAll("button,li,a,div,span,[role=tab]");
      for (var w=0; w<wanted.length; w++){
        for (var i=0;i<els.length;i++){
          var el = els[i];
          if ((el.textContent || "").trim().toLowerCase() === wanted[w] && el.children.length <= 1){
            el.click();
            fayrTabTries++;
            return;
          }
        }
      }
    } catch(e){}
  }
  setInterval(fayrOpenInstamartTab, 1500);

  // Meesho: the orders page is a Next.js app whose data endpoint
  // /_next/data/<buildId>/orders.json returns every sub-order with a
  // review.current_rating - >=1 means the user rated it, -1 (title "Rate your
  // experience") means NOT rated. That's the exact signal the native app uses
  // to show "We're happy you liked it". We fetch it once (session cookies
  // authenticate it; it works from any Meesho page), cache it, and badge ONLY
  // the rated products by their product-image id (same anchor idea as Blinkit).
  window.__fayrMeeshoOrders = undefined; // undefined=untried, null=failed, obj=ok
  function fayrMeeshoBuildId(){
    try { var nd = document.getElementById("__NEXT_DATA__"); if (nd && nd.textContent) return (JSON.parse(nd.textContent) || {}).buildId || null; } catch(e){}
    return null;
  }
  function fayrMeeshoGetOrders(cb){
    if (window.__fayrMeeshoOrders !== undefined) { cb(window.__fayrMeeshoOrders); return; }
    var bid = fayrMeeshoBuildId();
    if (!bid) { cb(undefined); return; } // page not hydrated yet - retry next tick
    window.__fayrMeeshoOrders = null; // mark attempted so we don't refetch in a loop
    try {
      fetch("/_next/data/" + bid + "/orders.json", { credentials:"include", headers:{ accept:"application/json" } })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ window.__fayrMeeshoOrders = (j && j.pageProps) ? j : null; cb(window.__fayrMeeshoOrders); })
        .catch(function(){ window.__fayrMeeshoOrders = null; cb(null); });
    } catch(e){ window.__fayrMeeshoOrders = null; cb(null); }
  }
  function fayrMeeshoSubs(j){
    var out = [];
    try { (((j.pageProps||{}).data||{}).ordersGroupedByDate||[]).forEach(function(g){ (g.orders||[]).forEach(function(o){ (o.sub_order_details||[]).forEach(function(s){ out.push(s); }); }); }); } catch(e){}
    return out;
  }
  function fayrMeeshoRated(s){ return !!(s && s.review && typeof s.review.current_rating === "number" && s.review.current_rating >= 1); }
  function fayrMeeshoImgKey(u){ var m = (u||"").match(/products\\/(\\d+)\\/([a-z0-9]+)/i); return m ? (m[1] + "/" + m[2]) : null; }
  function fayrAnnotateMeesho(){
    try {
      if (!/meesho\\.com/.test(location.host)) return;
      if (!/order/i.test(location.pathname)) return; // only badge on the orders page
      fayrMeeshoGetOrders(function(j){
        if (!j) return;
        var rated = {};
        fayrMeeshoSubs(j).forEach(function(s){ if (fayrMeeshoRated(s)){ var k = fayrMeeshoImgKey(s.first_image_url); if (k) rated[k] = true; } });
        if (!Object.keys(rated).length) return;
        var imgs = document.getElementsByTagName("img");
        for (var i=0;i<imgs.length;i++){
          var k = fayrMeeshoImgKey(imgs[i].src || imgs[i].getAttribute("src") || "");
          if (k && rated[k] && !imgs[i].__fayrBadged){
            imgs[i].__fayrBadged = true;
            var p = imgs[i].parentNode;
            if (p){
              try { var cs = window.getComputedStyle(p); if (cs && cs.position === "static") p.style.position = "relative"; } catch(e){}
              var b = document.createElement("div");
              b.textContent = "\\u2605 Rated";
              b.style.cssText = "position:absolute;top:2px;left:2px;background:#620E62;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;z-index:99999;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none;";
              p.appendChild(b);
            }
          }
        }
      });
    } catch(e){}
  }
  setInterval(fayrAnnotateMeesho, 1500);

  var of = window.fetch;
  if (of) {
    window.fetch = function(input, init){
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      var body = (init && init.body) || null;
      pushSeen(url, method);
      var p = of.apply(this, arguments);
      p.then(function(res){
        try { res.clone().text().then(function(t){
          if (kw(url) || kw(body) || kw(t)) {
            // respJson (not just the raw text) lets the app's generic review/order
            // deep-scanner actually walk into the payload instead of only being
            // visible via "Show raw JSON".
            pushMatch({ via:"fetch", url:url, method:method, reqBody: body ? String(body).slice(0,1000) : null, status: res.status, resp: (t||"").slice(0, 3000), respJson: tryParse(t) });
          }
        }); } catch(e){}
      }).catch(function(){});
      return p;
    };
  }

  var oOpen = XMLHttpRequest.prototype.open;
  var oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__fayr = { method:m, url:u }; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){
    var self = this;
    if (self.__fayr) {
      pushSeen(self.__fayr.url, self.__fayr.method);
      self.addEventListener("load", function(){
        try {
          if (kw(self.__fayr.url) || kw(b) || kw(self.responseText)) {
            pushMatch({ via:"xhr", url:self.__fayr.url, method:self.__fayr.method, reqBody: b ? String(b).slice(0,1000) : null, status: self.status, resp: (self.responseText||"").slice(0, 3000), respJson: tryParse(self.responseText) });
          }
        } catch(e){}
      });
    }
    return oSend.apply(this, arguments);
  };
})();
true;`;
}

function discoveryFetchScript(platformKey, displayName) {
  return wrap(
    platformKey,
    `
    Promise.resolve().then(function(){
      function tryParse(t){ try { return JSON.parse(t); } catch(e){ return null; } }

      // One last snapshot of whatever page is open right now, in case Fetch was
      // tapped before the 1.5s poll (installed in beforeLoadScript) caught it.
      // The bulk of the data comes from window.__fayrEmbeddedHistory, which has
      // been accumulating snapshots across every page you've visited this
      // session (see discoveryHook) - not just this one.
      try {
        var nextDataEl = document.getElementById("__NEXT_DATA__");
        if (nextDataEl && nextDataEl.textContent && window.__fayrEmbeddedHistory) {
          var nd = tryParse(nextDataEl.textContent);
          if (nd) {
            var sig = "__NEXT_DATA__|" + location.href + "|" + (JSON.stringify(nd) || "").length;
            if (!window.__fayrEmbeddedSeen[sig]) {
              window.__fayrEmbeddedSeen[sig] = true;
              window.__fayrEmbeddedHistory.push({ source: "__NEXT_DATA__", url: location.href, json: nd });
            }
          }
        }
      } catch(e){}

      var calls = window.__fayrCalls || [];
      var allUrls = window.__fayrAllUrls || [];
      var embedded = window.__fayrEmbeddedHistory || [];
      return {
        discoveryMode: true,
        note: ${JSON.stringify(
          `${displayName}'s review/order API isn't reverse-engineered yet. Checked three places: (1) matchedCallCount/calls - network calls mentioning review/rating/order, (2) allUrlsSeenCount/allUrlsSeen - every network call this session (0 means you haven't reached a page that loads this data yet), (3) embeddedSnapshotCount/embedded - server-hydrated JSON accumulated from EVERY page you visited this session (not just the current one). If your rating still doesn't show up in any of the three after browsing several rated orders, the web version doesn't expose it at all for this screen. Use "Download Raw JSON" to get the full file.`
        )},
        matchedCallCount: calls.length,
        calls: calls,
        allUrlsSeenCount: allUrls.length,
        allUrlsSeen: allUrls,
        embeddedSnapshotCount: embedded.length,
        embedded: embedded
      };
    })
  `
  );
}

const meesho = {
  key: 'meesho',
  name: 'Meesho',
  // Auth cookie not confirmed (web login is blocked by an order_block
  // experiment). Empty -> restore always runs (persistence guaranteed); the
  // different-account guard just can't engage until a name is confirmed.
  authCookies: [],
  color: '#620E62',
  // Open straight on the orders page so a single "Fetch my reviews" tap works
  // with no navigation: the fetch reads the authenticated orders.json + each
  // rated order's detail endpoint itself.
  startUrl: 'https://www.meesho.com/orders',
  // MEESHO'S OWN SIGN IN PAGE, SEEN ON 2 SEPTEMBER 2026. The first attempt at
  // this said "not established, refused with a 403 from this machine", and the
  // 403 was a bot wall, not an answer. Opened again in a real WebKit browser with
  // a real iPhone user agent, https://www.meesho.com/login answers 200 and Meesho
  // itself sends it to https://www.meesho.com/auth, which is Meesho's own sign in:
  // "Sign Up", a country picker, "+91", one telephone field, "Continue", and
  // Meesho's own terms line under it. So the address stored is the one Meesho
  // settles on. Same host as the shop's own site, which the same host rule needs.
  signInUrl: 'https://www.meesho.com/auth',
  beforeLoadScript: discoveryHook(),
  hint: 'Log in if asked, then just tap "Fetch my reviews" — no need to open anything.',
  // Meesho's orders live in the Next.js data endpoint
  // /_next/data/<buildId>/orders.json. Each sub_order carries
  // review.current_rating: >=1 => the user rated it (the star they gave),
  // -1 (title "Rate your experience") => NOT rated. We fetch that authenticated
  // endpoint and emit ONLY the rated sub-orders - so a purchase that was never
  // reviewed is never shown as reviewed.
  fetchScript: wrap(
    'meesho',
    `
    Promise.resolve().then(function(){
      function tryParse(t){ try { return JSON.parse(t); } catch(e){ return null; } }
      function subs(j){
        var out = [];
        try { (((j.pageProps||{}).data||{}).ordersGroupedByDate||[]).forEach(function(g){ (g.orders||[]).forEach(function(o){ (o.sub_order_details||[]).forEach(function(s){ out.push({ g:g, o:o, s:s }); }); }); }); } catch(e){}
        return out;
      }
      function rated(s){ return !!(s && s.review && typeof s.review.current_rating === "number" && s.review.current_rating >= 1); }

      // orders.json carries the STAR but not the review TEXT. The text lives in a
      // separate rating/review call that fires when you open a rated order's
      // review screen. Deep-scan whatever the hook captured for a node that has
      // BOTH a sub_order_id and a free-text comment, and key the text by
      // sub_order_id so it attaches to the right product no matter the exact
      // response shape (works the moment that call is present - no guessing).
      function currentBuildId(){ try { var nd = document.getElementById("__NEXT_DATA__"); if (nd && nd.textContent) return (JSON.parse(nd.textContent) || {}).buildId || null; } catch(e){} return null; }

      function reviewTextOf(o){
        var keys = ["comment","comments","review_text","reviewtext","review_comment","reviewcomment","rating_comment","customer_comment","description","review","text","feedback","message"];
        for (var i=0;i<keys.length;i++){ var v = o[keys[i]]; if (typeof v === "string" && v.trim().length > 1 && !/^(rate your experience|rate & review|rate and review|type comment|add feedback)$/i.test(v.trim())) return v.trim(); }
        return null;
      }
      function subOrderIdOf(o){
        var v = (o.sub_order_id != null) ? o.sub_order_id : (o.suborder_id != null ? o.suborder_id : (o.subOrderId != null ? o.subOrderId : null));
        return v != null ? String(v) : null;
      }
      // Count review photos/videos on a node (Meesho gates public visibility on
      // media). Only counted alongside real rating context so product-image
      // arrays elsewhere aren't mistaken for review media.
      function mediaCountOf(o){
        var n = 0; var keys = ["image_urls","images","media","photos","videos","media_urls","review_images","rating_images","image_url_list"];
        for (var i=0;i<keys.length;i++){ var v = o[keys[i]]; if (Array.isArray(v)) { for (var j=0;j<v.length;j++){ var it = v[j]; if (typeof it === "string" || (it && (it.url || it.image_url || it.video_url))) n++; } } }
        return n;
      }
      // Deep-scan any JSON for a node carrying a sub_order_id + review text
      // and/or media, keyed by sub_order_id, so it attaches to the right product
      // regardless of the response's exact shape.
      function collectInto(o, map, d){
        if (o == null || d > 14) return;
        if (Array.isArray(o)) { for (var i=0;i<o.length;i++) collectInto(o[i], map, d+1); return; }
        if (typeof o !== "object") return;
        var sid = subOrderIdOf(o);
        if (sid) {
          var t = reviewTextOf(o);
          var hasRatingCtx = t || o.current_rating != null || o.rating != null || o.comment != null;
          var m = hasRatingCtx ? mediaCountOf(o) : 0;
          if (t || m) {
            var e = map[sid] || { text: null, media: 0 };
            if (t && !e.text) e.text = t;
            if (m > e.media) e.media = m;
            map[sid] = e;
          }
        }
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) collectInto(o[k], map, d+1); }
      }
      function collectRich(){
        var map = {};
        var calls = window.__fayrCalls || [];
        for (var i=0;i<calls.length;i++){ var c = calls[i]; if (c && c.respJson) collectInto(c.respJson, map, 0); }
        return map;
      }
      // Internal detail/rating/feedback links read from the REAL page (not
      // guessed), with the numeric ids they carry, so we can pull the SSR data
      // endpoint that holds the submitted review text.
      function internalLinks(){
        var out = [];
        try {
          var as = document.querySelectorAll("a[href]");
          for (var i=0;i<as.length;i++){
            var h = as[i].getAttribute("href") || "";
            if (h.charAt(0) !== "/") continue;
            if (!/order|rating|review|feedback|detail/i.test(h)) continue;
            out.push({ path: h.split("?")[0].split("#")[0], ids: (h.match(/\\d{7,}/g) || []) });
          }
        } catch(e){}
        return out;
      }
      function reviewProbe(extra){
        var out = [];
        var calls = window.__fayrCalls || [];
        for (var i=0;i<calls.length && out.length < 12;i++){
          var c = calls[i];
          if (!c || !c.url) continue;
          if (!/rating|review|feedback|order.*detail|order\\/[0-9]/i.test(c.url) && !/rating|review|comment/i.test(c.resp || "")) continue;
          out.push({ url: c.url, method: c.method, status: c.status, respSample: (c.resp || "").slice(0, 1500) });
        }
        return extra && extra.length ? out.concat(extra) : out;
      }

      function makeReviews(all, rich){
        var reviews = [];
        all.forEach(function(row){
          var s = row.s;
          if (!rated(s)) return; // only genuinely-rated products
          var sid = s.sub_order_id != null ? String(s.sub_order_id) : null;
          var e = (sid && rich[sid]) || null;
          reviews.push({
            productname: s.product_name || null,
            rating: s.review.current_rating,
            reviewtext: e && e.text ? e.text : null,
            mediacount: e && e.media ? e.media : null,
            reviewstatus: "RATED",
            approved: true,
            orderid: s.order_num != null ? String(s.order_num) : null,
            suborderid: sid,
            orderdate: (row.g && row.g.date) || ((row.o.order_date && row.o.order_date.date_string) || null),
            statusmessage: s.status_message || null,
            imageurl: s.first_image_url || null,
            productid: s.product_id != null ? String(s.product_id) : null,
            verified: true
          });
        });
        return reviews;
      }
      function finish(all, reviews, extraProbe){
        var withText = reviews.filter(function(r){ return r.reviewtext; }).length;
        var withMedia = reviews.filter(function(r){ return r.mediacount; }).length;
        var sample = all.map(function(row){ var s = row.s; return { product: (s.product_name||"").slice(0,44), status: s.status_message, current_rating: (s.review && s.review.current_rating), rated: rated(s) }; });
        return {
          platform: "meesho",
          source: "orders.json",
          reviews: reviews,
          ratedCount: reviews.length,
          reviewsWithText: withText,
          reviewsWithMedia: withMedia,
          totalSubOrders: all.length,
          __ordersSample: sample,
          __reviewProbe: reviewProbe(extraProbe),
          note: "Meesho: " + reviews.length + " rated of " + all.length + " sub-order(s); star + purchase captured from web. Review COMMENT is app-only (Meesho's website has no review-view/edit flow), so text is not fetchable on web" + (withText ? " - but " + withText + " came through this session." : ".")
        };
      }

      function build(j){
        var all = subs(j);
        var rich = collectRich();
        var reviews = makeReviews(all, rich);
        var missing = reviews.filter(function(r){ return !r.reviewtext; });
        var bid = currentBuildId();
        var links = internalLinks();
        // Auto-enrich: for each order still missing text, pull the SSR data
        // endpoint of any detail/rating/feedback link on the page that carries
        // one of that order's ids, and scan it for the review text + media.
        if (!bid || !missing.length || !links.length) return finish(all, reviews, null);
        var wanted = {};
        missing.forEach(function(r){
          var toks = [r.orderid, r.suborderid, r.productid].filter(function(x){ return !!x; });
          links.forEach(function(l){
            if (l.path.charAt(0) !== "/") return;
            var hit = false;
            for (var i=0;i<l.ids.length;i++){ if (toks.indexOf(l.ids[i]) >= 0) { hit = true; break; } }
            if (hit) wanted["/_next/data/" + bid + l.path + ".json"] = true;
          });
        });
        var urls = Object.keys(wanted).slice(0, 10);
        if (!urls.length) return finish(all, reviews, null);
        var rich2 = {};
        var extraProbe = [];
        var jobs = urls.map(function(url){
          return fetch(url, { credentials:"include", headers:{ accept:"application/json" } })
            .then(function(res){ return res.ok ? res.text() : null; })
            .then(function(t){ if (!t) return; var jj = tryParse(t); if (jj) collectInto(jj, rich2, 0); if (extraProbe.length < 8) extraProbe.push({ url: url, status: "ok", respSample: (t || "").slice(0, 1500) }); })
            .catch(function(){});
        });
        return Promise.all(jobs).then(function(){
          reviews.forEach(function(r){
            var e = (r.suborderid && (rich2[r.suborderid] || rich[r.suborderid])) || null;
            if (e) { if (!r.reviewtext && e.text) r.reviewtext = e.text; if (!r.mediacount && e.media) r.mediacount = e.media; }
          });
          return finish(all, reviews, extraProbe);
        });
      }

      function fromCaptured(){
        var calls = window.__fayrCalls || [];
        for (var i=0;i<calls.length;i++){
          var c = calls[i];
          if (!c || !c.url || c.url.indexOf("orders.json") < 0) continue;
          var j = c.respJson || tryParse(c.resp);
          if (j && j.pageProps && j.pageProps.data && j.pageProps.data.ordersGroupedByDate) return j;
        }
        return null;
      }

      // 1) Cached copy the badge-annotator already fetched this session.
      if (window.__fayrMeeshoOrders && window.__fayrMeeshoOrders.pageProps) return build(window.__fayrMeeshoOrders);

      // 2) Fetch the authenticated data endpoint directly (works from any page).
      var bid = null;
      try { var nd = document.getElementById("__NEXT_DATA__"); if (nd && nd.textContent) bid = (JSON.parse(nd.textContent) || {}).buildId; } catch(e){}
      if (bid) {
        return fetch("/_next/data/" + bid + "/orders.json", { credentials:"include", headers:{ accept:"application/json" } })
          .then(function(r){ return r.ok ? r.json() : null; })
          .then(function(j){
            if (j && j.pageProps) return build(j);
            var cap = fromCaptured(); if (cap) return build(cap);
            return { platform:"meesho", reviews:[], note:"Could not load orders.json (bad status) and no captured orders call yet. Open My Orders, let it load, then retry." };
          })
          .catch(function(e){ var cap = fromCaptured(); if (cap) return build(cap); return { platform:"meesho", reviews:[], note:"orders.json fetch failed: " + String((e&&e.message)||e) }; });
      }

      // 3) Fall back to a captured orders.json call.
      var cap = fromCaptured();
      if (cap) return build(cap);
      return { platform:"meesho", reviews:[], note:"Meesho buildId not found - open My Orders and retry." };
    })
  `
  ),
};

const instamart = {
  key: 'instamart',
  name: 'Instamart',
  authCookies: ['_session_tid', 'tid'],
  color: '#FC8019',
  // Open on the Swiggy account page - the capture shows the DASH order list
  // (/mapi/order/dash) loads here - so it's captured without the user navigating.
  startUrl: 'https://www.swiggy.com/my-account',
  // SWIGGY'S OWN SIGN IN PAGE, SEEN ON 2 SEPTEMBER 2026. The first attempt at
  // this guessed it was a panel with no address. It is not. Opened in a real
  // WebKit browser with a real iPhone user agent, https://www.swiggy.com/auth
  // answers 200, does not redirect anywhere, and is Swiggy's own sign in:
  // "LOGIN", "Enter your phone number to continue", a country code field, a
  // number field, "CONTINUE", and Swiggy's own terms line under it. Instamart is
  // inside Swiggy and shares that one account, so this is Instamart's sign in.
  // Same host as the shop's own site, which the same host rule needs.
  signInUrl: 'https://www.swiggy.com/auth',
  // Keep the interceptor: Swiggy's /mapi/order/* endpoints are session + CSRF
  // guarded and computed by the SPA, so we parse the real authenticated
  // responses the hook captured while you browsed Orders rather than re-fetch.
  beforeLoadScript: discoveryHook(),
  hint: 'Log in if asked and let your Orders list load, then tap "Fetch my reviews". (No need to open individual orders.)',
  // IMPORTANT: Instamart (Swiggy DASH) web exposes whether an order was rated
  // (rating_info.is_rated) but NOT the numeric star value - it lives nowhere in
  // the order list OR order details. So this verifies the PURCHASE + whether a
  // rating was submitted; the star count stays null and is flagged
  // web-unavailable rather than faked.
  fetchScript: wrap(
    'instamart',
    `
    (function(){
      var calls = window.__fayrCalls || [];

      // "3 Mar 2026, 02:25 PM" -> epoch ms.
      function parseDate(t){
        if (!t) return null;
        var d = new Date(String(t).replace(/,/g, " ").replace(/\\s+/g, " ").trim());
        return isNaN(d.getTime()) ? null : d.getTime();
      }

      var reviews = [];
      var seen = {};
      calls.forEach(function(c){
        // The DASH order LIST endpoint (not .../details); has data.orders[].
        if (!c || !c.url || c.url.indexOf("/mapi/order/dash") < 0 || c.url.indexOf("details") >= 0) return;
        var orders = (c.respJson && c.respJson.data && c.respJson.data.orders) || [];
        orders.forEach(function(o){
          var orderId = o.order_id != null ? String(o.order_id) : null;
          if (orderId && seen[orderId]) return;
          if (orderId) seen[orderId] = true;

          var status = o.history_status || null;
          var delivered = /deliver/i.test(String(status));

          var v2 = o.order_data_v2 || {};
          var shipments = v2.shipments || [];
          // Instamart rates the ORDER, not each product ("You've already rated
          // this order"), so is_rated applies to every item in the order.
          var names = [];
          var rated = false;
          shipments.forEach(function(sh){
            (sh.items || []).forEach(function(it){ if (it && typeof it.name === "string" && it.name.trim()) names.push(it.name.trim()); });
            var ri = sh.rating_info || null;
            if (ri) {
              if (ri.is_rated === true) rated = true;
              var btn = ri.button && ri.button.text;
              if (ri.is_rated == null && typeof btn === "string" && /edit/i.test(btn)) rated = true;
            }
          });
          if (!names.length && v2.title) names.push(String(v2.title));

          var deliveryEpoch = null;
          var line1 = (o.details_text && o.details_text.line1) || "";
          var dm = line1.match(/on\\s+(.+?)(?:\\s+by\\s+|$)/i);
          if (dm) deliveryEpoch = parseDate(dm[1]);

          var refund = o.refund_details || {};
          var returned = String(refund.refund_initiated || "0") !== "0"
            || String(refund.refund_processed || "0") !== "0"
            || (v2.refund_status && /refund|return/i.test(String(v2.refund_status)) && !/no_refund/i.test(String(v2.refund_status)));

          // Emit ONE entry per product so a task's target product can be
          // isolated instead of a whole order's product list.
          names.forEach(function(pname, idx){
            reviews.push({
              productname: pname,
              rating: null, // Swiggy web exposes is_rated but never the star count
              reviewtext: null,
              reviewdate: null,
              orderdate: typeof o.created_at === "number" ? o.created_at : null,
              deliverydate: deliveryEpoch,
              orderid: orderId,
              returned: returned,
              returnstatus: returned ? "REFUNDED" : (delivered ? "DELIVERED" : status),
              statuscode: status,
              verified: true,
              approved: rated ? true : null,
              published: rated ? true : null,
              // Order-level rating: mark every item of a rated order as rated.
              reviewstatus: rated ? "RATED_STAR_NOT_EXPOSED_ON_WEB"
                : (delivered ? "NOT_RATED" : String(status || "")),
              orderrated: rated,
              productid: orderId + "#" + idx,
              imageurl: null,
              producturl: null
            });
          });
        });
      });

      // Show ALL orders/products with their rated status (mirrors the app's
      // order history); the Target product box isolates a task's product.
      var ratedOnly = reviews.filter(function(r){ return r.orderrated === true; });

      // Slim diagnostic: one line per rendered order card - its status and
      // whether our annotator badged it - so mis-badging can be spotted at a
      // glance without dumping the whole DOM.
      var domSample = [];
      try {
        var cardEls = document.querySelectorAll('[data-testid="dash-order-card"]');
        for (var q=0; q<cardEls.length && domSample.length<20; q++){
          var stEl = cardEls[q].querySelector('[data-testid="order-status"]');
          var dEl = cardEls[q].querySelector('[data-testid="dash-order-card-details"]');
          domSample.push({
            status: (stEl ? stEl.textContent : "").replace(/\\s+/g, " ").trim().slice(0, 20),
            badged: cardEls[q].__fayrRated === true,
            products: (dEl ? dEl.textContent : "").replace(/\\s+/g, " ").trim().slice(0, 80)
          });
        }
      } catch(e){}

      return Promise.resolve({
        source: "captured-mapi",
        note: "Instamart rates the ORDER, not individual products ('You've already rated this order'), and web never exposes the star count. Every order's products are listed with a rated/not-rated marker; use the Target product box to isolate the one your task is for.",
        orderListCallsSeen: calls.filter(function(c){ return c && c.url && c.url.indexOf("/mapi/order/dash") >= 0 && c.url.indexOf("details") < 0; }).length,
        parsedCount: reviews.length,
        ratedCount: ratedOnly.length,
        reviews: reviews,
        // Stringified so extractItems doesn't walk it; readable in the download.
        __domSample: JSON.stringify(domSample)
      });
    })()
  `
  ),
};

const blinkit = {
  key: 'blinkit',
  name: 'Blinkit',
  authCookies: ['gr_1_accessToken'],
  color: '#0C831F',
  // Land on the HOMEPAGE, not Order History.
  //
  // This used to deep-link straight to /account/orders (like Zepto/Instamart),
  // with a caveat here saying a blank page meant the saved delivery location had
  // been cleared, and to fix it by setting the address on blinkit.com home once.
  // A screen recording on 2026-08-09 disproved that remedy: the deep link renders
  // an account shell with NO login option and NO navigation at all - no menu, no
  // home link - and the location popup it offers reopens on the SAME page every
  // time (the dimmed header behind it never changes, so the URL never changes).
  // From that page, blinkit.com home is unreachable, which makes the documented
  // fix impossible to perform and leaves the user with no way forward.
  //
  // So: land where login and navigation actually exist. The user sets their
  // location, logs in, and walks to Account -> Orders through Blinkit's own UI.
  // The interceptor below is unaffected - Blinkit is an SPA, so an in-app
  // navigation reuses the same document and the hook (injected before content
  // loads) keeps capturing into window.__fayrCalls the whole way.
  startUrl: 'https://blinkit.com/',
  // NOT ESTABLISHED. Refused with a 403, and its sign in is a panel on its own
  // site rather than a page of its own. Not guessed.
  signInUrl: null,
  // Keep the interceptor: Blinkit's order data comes back as server-driven
  // "layout" widget trees (v1/layout/order_history + order_details). Those
  // endpoints need exact app headers/params the SPA computes, so instead of
  // re-fetching them blind we parse the real authenticated responses the hook
  // already captured while you browsed Account -> Orders.
  beforeLoadScript: discoveryHook(),
  hint: 'Set your delivery location and log in, then open Account → Orders and let the list load before tapping "Fetch my reviews".',
  // Blinkit's WEB order_history layout gives full order facts (id, date, amount,
  // products, delivered/returned) but in our sample carried no star rating. A
  // rating, if the web surfaces one, appears on the order_DETAILS page - so we
  // parse both the history list AND every order_details the hook captured while
  // you opened orders, deep-scanning for a numeric star or a "Rated" marker.
  fetchScript: wrap(
    'blinkit',
    `
    (function(){
      var calls = window.__fayrCalls || [];
      var refYear = new Date().getFullYear();

      function walkTexts(o, acc, depth){
        if (o == null || depth > 16) return;
        if (Array.isArray(o)) { for (var i=0;i<o.length;i++) walkTexts(o[i], acc, depth+1); return; }
        if (typeof o === "object") {
          if (typeof o.text === "string" && o.text.trim()) acc.push(o.text.trim());
          for (var k in o) { if (Object.prototype.hasOwnProperty.call(o,k)) walkTexts(o[k], acc, depth+1); }
        }
      }
      function walkProductImgs(o, acc, depth){
        if (o == null || depth > 16) return;
        if (Array.isArray(o)) { for (var i=0;i<o.length;i++) walkProductImgs(o[i], acc, depth+1); return; }
        if (typeof o === "object") {
          if (typeof o.url === "string" && /cdn\\.grofers|cdn\\.blinkit/i.test(o.url) && /product|cms/i.test(o.url)) acc.push(o.url);
          for (var k in o) { if (Object.prototype.hasOwnProperty.call(o,k)) walkProductImgs(o[k], acc, depth+1); }
        }
      }
      // Defensive: a genuine 1-5 star rating if Blinkit ever surfaces one.
      function findRating(o, depth){
        if (o == null || depth > 14) return null;
        if (Array.isArray(o)) { for (var i=0;i<o.length;i++){ var r=findRating(o[i], depth+1); if(r) return r; } return null; }
        if (typeof o !== "object") return null;
        for (var k in o) {
          if (!Object.prototype.hasOwnProperty.call(o,k)) continue;
          var kl = k.toLowerCase(), v = o[k];
          if ((kl === "rating" || kl === "user_rating" || kl === "star_rating" || kl === "order_rating") &&
              typeof v === "number" && v >= 1 && v <= 5) return v;
        }
        for (var k2 in o) { if (Object.prototype.hasOwnProperty.call(o,k2)) { var r2=findRating(o[k2], depth+1); if(r2) return r2; } }
        return null;
      }
      // The ONLY reliable rated marker on Blinkit's order history: the order
      // header carries tracking.common_attributes.type === "edit_rating" once
      // rated (unrated orders have type null). The visible "Rating submitted /
      // Edit Rating" text is client-rendered from this, not present as data.
      function findActionType(o, depth){
        if (o == null || depth > 16) return null;
        if (Array.isArray(o)) { for (var i=0;i<o.length;i++){ var r=findActionType(o[i], depth+1); if(r) return r; } return null; }
        if (typeof o !== "object") return null;
        if (o.type === "edit_rating" || o.type === "rate_order") return o.type;
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(o,k)) { var r2=findActionType(o[k], depth+1); if(r2) return r2; } }
        return null;
      }
      // "01 Jun, 2:50 pm" (no year) | "12 Oct 2025" | "11 May 2024" -> epoch ms.
      function parseDate(t){
        if (!t) return null;
        var s = t.replace(",", " ").replace(/\\s+/g, " ").trim();
        if (!/\\d{4}/.test(s)) { s = s.replace(/^(\\d{1,2}\\s+[A-Za-z]{3,})/, "$1 " + refYear); }
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d.getTime();
      }

      // Merge any rating found in captured order_details, keyed by order_id.
      var detailRating = {};
      calls.forEach(function(c){
        if (c && c.url && /\\/v1\\/layout\\/order_details\\/(\\d+)/.test(c.url) && c.respJson) {
          var oid = c.url.match(/order_details\\/(\\d+)/)[1];
          var r = findRating(c.respJson, 0);
          if (r != null) detailRating[oid] = r;
        }
      });

      // Texts that are status/CTA/rating chrome, never product names.
      var SKIP = /^₹|return|refund|reorder|arrived in|delivered|rate order|rate this order|rate now|rating submitted|thank you|thanks for rating|^edit$|edit rating|you rated|your rating|already rated/i;

      var reviews = [];
      var seen = {};
      var debugCards = [];
      calls.forEach(function(c){
        if (!c || !c.url || c.url.indexOf("/v1/layout/order_history") < 0 || !c.respJson) return;
        var snippets = (c.respJson.response && c.respJson.response.snippets) || [];
        snippets.forEach(function(sn){
          if (!sn || sn.widget_type !== "order_history_container_vr" || !sn.data) return;
          var idRaw = (sn.data.identity && sn.data.identity.id) || "";
          var idm = idRaw.match(/order_(\\d+)_(\\d+)/);
          var orderId = idm ? idm[1] : null;
          var cartId = idm ? idm[2] : null;
          if (orderId && seen[orderId]) return;
          if (orderId) seen[orderId] = true;

          var texts = []; walkTexts(sn.data, texts, 0);
          var imgs = []; walkProductImgs(sn.data, imgs, 0);
          var joined = texts.join(" | ");

          var returned = /return|refund/i.test(joined);
          var delivered = /arrived|delivered/i.test(joined);
          var amount = null, dateEpoch = null, dateText = null;
          var products = [];
          texts.forEach(function(t){
            // Amount as a clean NUMBER (rupees). Handles "₹604", "Rs 604",
            // "1,234.50" and the mojibaked "â¹604" that shows up in exports.
            var am = t.match(/^\\s*(?:₹|â.?|rs\\.?)\\s*([\\d,]+(?:\\.\\d+)?)\\s*$/i);
            if (am) { if (amount == null) amount = parseFloat(am[1].replace(/,/g, "")); return; }
            if (SKIP.test(t)) return;
            var e = parseDate(t);
            if (e && !dateEpoch) { dateEpoch = e; dateText = t; return; }
            if (t !== dateText) products.push(t);
          });

          // Rating is ORDER-level on Blinkit. The authoritative marker is the
          // header action type "edit_rating" (rated) vs "rate_order"/null. Keep
          // an order_details star as a bonus if one was ever captured.
          var actionType = findActionType(sn.data, 0);
          var star = (orderId && detailRating[orderId] != null) ? detailRating[orderId] : findRating(sn.data, 0);
          var rated = star != null || actionType === "edit_rating";

          // Slim debug (marker now calibrated): status per order, no raw tree.
          if (debugCards.length < 40) {
            debugCards.push({ orderId: orderId, actionType: actionType, rated: rated });
          }

          if (!products.length) products = [null];
          var reviewstatus = star != null ? "RATED"
            : (rated ? "RATED_STAR_NOT_EXPOSED_ON_WEB"
              : (delivered ? "NOT_RATED" : "RATING_NOT_FOUND"));

          // One entry per product so a task's target product can be isolated.
          products.forEach(function(pname, idx){
            reviews.push({
              productname: pname,
              rating: star,
              reviewtext: null,
              reviewdate: null,
              orderdate: dateEpoch,
              deliverydate: delivered ? dateEpoch : null,
              orderid: orderId,
              returned: returned,
              returnstatus: returned ? "RETURNED" : (delivered ? "DELIVERED" : null),
              statuscode: returned ? "RETURNED" : (delivered ? "DELIVERED" : null),
              verified: true,
              approved: rated ? true : null,
              published: rated ? true : null,
              reviewstatus: reviewstatus,
              orderrated: rated,
              productid: (cartId || orderId) + "#" + idx,
              imageurl: imgs[idx] || imgs[0] || null,
              producturl: null,
              amount: amount
            });
          });
        });
      });

      var ratedOnly = reviews.filter(function(r){ return r.orderrated === true; });
      return Promise.resolve({
        source: "captured-layout",
        note: "Every order's products are listed with a rated/not-rated marker. If a clearly-rated order still shows as not rated, send this downloaded JSON - __debug has the raw order card so the exact rating marker (and whether it's per-product) can be located.",
        orderHistoryCallsSeen: calls.filter(function(c){ return c && c.url && c.url.indexOf("/v1/layout/order_history") >= 0; }).length,
        orderDetailsCallsSeen: calls.filter(function(c){ return c && c.url && /\\/v1\\/layout\\/order_details\\//.test(c.url); }).length,
        ratedCount: ratedOnly.length,
        parsedCount: reviews.length,
        reviews: reviews,
        // Stringified so extractItems (which deep-scans objects) doesn't turn
        // the raw card widgets into junk cards - still readable in the download.
        __debug: JSON.stringify(debugCards)
      });
    })()
  `
  ),
};

const zepto = {
  key: 'zepto',
  name: 'Zepto',
  // ~20 cookies; primary auth name not yet pinned down. Empty -> restore always
  // runs (persistence guaranteed) until the auth cookie is confirmed.
  authCookies: [],
  color: '#8025C8',
  // Open straight on Order History so the list (with per-order star ratings)
  // loads and is captured - the user shouldn't have to navigate or open orders.
  startUrl: 'https://www.zepto.com/account/orders',
  // NOT ESTABLISHED. Answered 202 with an empty page from this machine, and its
  // sign in is a panel on its own site rather than a page of its own. Not guessed.
  signInUrl: null,
  // Parse, don't re-fetch: Zepto's bff-gateway rejects a blind re-fetch (it
  // needs auth headers the SPA computes). We keep the interceptor and read the
  // order LIST the page itself loads (order.rating = the star shown on the
  // list); a captured ORDER_DETAILS page is only a fallback.
  beforeLoadScript: discoveryHook(),
  hint: 'Log in if asked and let your Orders list load, then tap "Fetch my reviews". (No need to open individual orders.)',
  // NOTE: Zepto's rating is per-ORDER (one star for the whole delivery), not
  // per-product - it has no per-product text reviews. So one rated order = one
  // rating covering all its items.
  fetchScript: wrap(
    'zepto',
    `
    (function(){
      var calls = window.__fayrCalls || [];
      var CDN = "https://cdn.zeptonow.com/production/";
      function imgUrl(pv){
        var im = pv && pv.image;
        var path = im && (im.path || im.relativePath);
        return path ? (CDN + path) : null;
      }
      function findRating(node, depth){
        if (node == null || depth > 10) return null;
        if (Array.isArray(node)){
          for (var i=0;i<node.length;i++){ var r=findRating(node[i], depth+1); if(r) return r; }
          return null;
        }
        if (typeof node !== "object") return null;
        var keys = Object.keys(node);
        for (var k=0;k<keys.length;k++){
          var key = keys[k].toLowerCase();
          var v = node[keys[k]];
          if ((key === "rating" || key === "starrating" || key === "userrating" ||
               key === "selectedrating" || key === "ratingvalue" || key === "orderrating") &&
              typeof v === "number" && v >= 1 && v <= 5) return v;
        }
        for (var k2=0;k2<keys.length;k2++){ var r2=findRating(node[keys[k2]], depth+1); if(r2) return r2; }
        return null;
      }
      // ORDER_RATING widget: pageLayout.widgets[].widgetType==="ORDER_RATING"
      // -> data.items[].rating ("You rated:").
      function ratingFromDetail(detail){
        if (!detail) return null;
        var widgets = (detail.pageLayout && detail.pageLayout.widgets) || [];
        for (var i=0;i<widgets.length;i++){
          var w = widgets[i];
          if (w && w.widgetType === "ORDER_RATING") {
            var items = (w.data && w.data.items) || [];
            for (var j=0;j<items.length;j++){
              var rv = items[j] && items[j].rating;
              if (typeof rv === "number" && rv >= 1 && rv <= 5) return rv;
            }
          }
        }
        return findRating(detail, 0);
      }

      // Rating per orderId, from every ORDER_DETAILS page the hook captured
      // (the request body carries the orderId).
      var ratingByOrder = {};
      var detailsSeen = 0;
      calls.forEach(function(c){
        if (!c || !c.url || c.url.indexOf("ORDER_DETAILS") < 0 || !c.respJson) return;
        detailsSeen++;
        var oid = null;
        try { oid = c.reqBody ? JSON.parse(c.reqBody).orderId : null; } catch(e){}
        var r = ratingFromDetail(c.respJson);
        if (oid && r != null) ratingByOrder[oid] = r;
      });

      // Order facts from every captured order LIST call.
      var orderMap = {};
      calls.forEach(function(c){
        if (!c || !c.url || c.url.indexOf("/api/v2/order/") < 0 || !c.respJson) return;
        var orders = c.respJson.orders || [];
        orders.forEach(function(o){ if (o && o.id && !orderMap[o.id]) orderMap[o.id] = o; });
      });

      function toReview(o, star){
        var products = (o && o.productsNamesAndCounts) || [];
        var first = products[0] || {};
        var refunded = (Number(o && o.totalRefundAmount) > 0) || !!(o && o.refundStatus);
        return {
          productname: products.map(function(p){ return p.name; }).filter(Boolean).join(", ") || null,
          rating: star,
          reviewtext: null,
          reviewdate: null,
          orderdate: (o && o.placedTime) || null,
          deliverydate: (o && o.arrivedTime) || null,
          orderid: (o && (o.code || o.id)) || null,
          returned: refunded,
          returnstatus: refunded ? ((o && o.refundStatus) || "REFUNDED") : ((o && o.status) || null),
          statuscode: (o && (o.status || o.formattedStatus)) || null,
          // grandTotalAmount is paise; store rupees so it compares directly
          // against a screenshot/task amount.
          amount: (o && typeof o.grandTotalAmount === "number") ? o.grandTotalAmount / 100 : null,
          verified: true,
          approved: star != null ? true : null,
          published: star != null ? true : null,
          reviewstatus: star != null ? "RATED" : "NOT_RATED",
          eligibleforrating: (o && o.isEligibleForRating) === true,
          productid: first.productVariantId || first.id || null,
          imageurl: imgUrl(first),
          producturl: null
        };
      }

      var reviews = [];
      var emitted = {};
      // 1) Every order from the list - the star is on the list itself
      //    (order.rating), so NO need to open individual orders. Fall back to a
      //    captured detail page's rating if the list somehow omitted it.
      Object.keys(orderMap).forEach(function(id){
        var o = orderMap[id];
        var listStar = (typeof o.rating === "number" && o.rating >= 1 && o.rating <= 5) ? o.rating : null;
        var star = listStar != null ? listStar : (ratingByOrder[id] != null ? ratingByOrder[id] : null);
        emitted[id] = true;
        reviews.push(toReview(o, star));
      });
      // 2) Any order we only saw via an opened detail page (not in the list).
      Object.keys(ratingByOrder).forEach(function(id){
        if (!emitted[id]) reviews.push(toReview({ id: id }, ratingByOrder[id]));
      });

      var rated = reviews.filter(function(r){ return r.rating != null; });
      return Promise.resolve({
        source: "captured",
        note: "Zepto rating is per-ORDER (one star for the whole delivery), read straight from the Order History list (order.rating) - no need to open each order. If the list shows stars but nothing is parsed here, the list call wasn't captured: make sure you're on the Orders page, then Fetch.",
        orderListCallsSeen: calls.filter(function(c){ return c && c.url && c.url.indexOf("/api/v2/order/") >= 0; }).length,
        orderDetailsCallsSeen: detailsSeen,
        ratedCount: rated.length,
        parsedCount: reviews.length,
        // ALWAYS every order, rated or not - rating is a FLAG on each entry
        // (rating/published/reviewstatus), never a filter over the list.
        //
        // This used to be "rated.length ? rated : reviews", which silently
        // dropped every unrated order the moment ANY order in the history had a
        // star. That broke the core rule the other five platforms already
        // follow: a PURCHASE is confirmed independently of whether it has been
        // reviewed. Proven live on 2026-08-10 - a real, delivered, not-yet-rated
        // Boldfit headband order was invisible to the matcher, and the task
        // reported "This product isn't in your Zepto orders yet" while the
        // orders had in fact been read.
        //
        // ratedCount above still reports how many carried a star, so the
        // debugging signal the old filter was reaching for is not lost.
        reviews: reviews
      });
    })()
  `
  ),
};

export const PLATFORMS = { flipkart, amazon, myntra, meesho, instamart, blinkit, zepto };
export const PLATFORM_LIST = [flipkart, amazon, myntra, meesho, instamart, blinkit, zepto];
