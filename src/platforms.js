// Per-platform configuration for the Fayr review-validation POC.
//
// Design note: every network call runs INSIDE the WebView (injected JS),
// so the platform session cookie never leaves the device and the request
// originates from the real logged-in browser context (same-origin / same-site,
// no CORS, far less bot-detection friction). The injected script always ends by
// posting a JSON string back to RN via window.ReactNativeWebView.postMessage.

const FK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 FKUA/website/42/website/Desktop';

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
  color: '#2874F0',
  startUrl: 'https://www.flipkart.com/',
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
            var pid = meta.fsn || null;
            if (pid) {
              byPid[pid] = {
                orderDate: md.orderDate || null,
                orderId: md.orderId || null,
                deliveryDate: promise.actualDeliveredDate || null,
                statusKey: statusKey || null,
                returned: returned,
                returnStatus: returned ? (st.fkCancelled ? "CANCELLED" : "RETURNED") : (statusKey || null)
              };
            }
          });
        });

        var products = (revJson && revJson.RESPONSE && revJson.RESPONSE.product) || [];
        var reviews = products.map(function(p){
          var om = (p.pid && byPid[p.pid]) || null;
          // Flipkart's own moderation status string for this review (exact
          // values unknown until seen live — check "Show raw JSON" -> reviewstatus
          // to calibrate this regex against your account's real data).
          var statusRaw = p.status || null;
          var approvedGuess = statusRaw ? /publish|approve|active|live/i.test(String(statusRaw)) : null;
          return {
            productname: p.productTitle || null,
            reviewtitle: p.title || null,
            reviewtext: p.text || null,
            rating: p.rating || null,
            reviewdate: p.date || null,
            orderdate: om ? om.orderDate : null,
            deliverydate: om ? om.deliveryDate : null,
            orderid: om ? om.orderId : null,
            returned: om ? om.returned : null,
            returnstatus: om ? om.returnStatus : null,
            statuscode: om ? om.statusKey : null,
            verified: p.certifiedBuyer === true,
            reviewstatus: statusRaw,
            approved: approvedGuess,
            published: approvedGuess,
            pid: p.pid || null,
            reviewid: p.id || null,
            imageurl: fixImg(p.dynamicImageUrl),
            // Best-effort minimal Flipkart product link from pid alone (no slug) -
            // unverified pattern, confirm it resolves once tested on-device.
            producturl: p.pid ? ("https://www.flipkart.com/p/itm" + p.pid) : null
          };
        });

        return { reviews: reviews, __diagnostic: diag };
      });
    })()
  `
  ),
};

const amazon = {
  key: 'amazon',
  name: 'Amazon',
  color: '#FF9900',
  startUrl: 'https://www.amazon.in/',
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
                    var dn = pdoc.querySelector('[data-hook="review-date"]');
                    if (dn) { r.reviewdate = dn.textContent.trim(); }
                    // Amazon exposes no separate "approved" state from "public" -
                    // if the permalink serves the review, it has cleared moderation.
                    r.approved = r.published;
                    if (i === 0) {
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

                    // Best-effort per-ASIN delivery/return join: Amazon's order
                    // cards render human text like "Delivered <date>" and
                    // "Return/Refund" inline, so scan each card's own text/links
                    // rather than relying on exact class names (unverified until
                    // seen live - refine the regexes below once real HTML is seen
                    // via __amazonOrdersSample.firstCardHtml).
                    var byAsin = {};
                    Array.prototype.forEach.call(cards, function(card){
                      var linkEls = card.querySelectorAll('a[href*="/dp/"], a[href*="/product/"], a[href*="/gp/product/"]');
                      var cardAsins = [], seenCA = {};
                      Array.prototype.forEach.call(linkEls, function(a){
                        var m = (a.getAttribute('href') || '').match(/[A-Z0-9]{10}/);
                        if (m && !seenCA[m[0]]) { seenCA[m[0]] = 1; cardAsins.push(m[0]); }
                      });
                      var txt = card.textContent || "";
                      var delivMatch = txt.match(/Delivered\\s*(?:on)?\\s*([A-Za-z]+\\s+\\d{1,2}(?:,?\\s*\\d{4})?)/i);
                      var returned = /return(ed)?|refund(ed)?|cancel(led)?/i.test(txt);
                      cardAsins.forEach(function(asin){
                        byAsin[asin] = {
                          deliverydate: delivMatch ? delivMatch[1] : null,
                          returned: returned,
                          returnstatus: returned ? "RETURNED_OR_CANCELLED" : null
                        };
                      });
                    });
                    reviews.forEach(function(r){
                      var od = r.asin && byAsin[r.asin];
                      if (od) {
                        r.deliverydate = od.deliverydate;
                        r.returned = od.returned;
                        r.returnstatus = od.returnstatus;
                      }
                    });

                    var sample = {
                      status: r.status, finalUrl: r.url, cardCount: cards.length,
                      asins: asins.slice(0, 15),
                      matchedAsins: Object.keys(byAsin),
                      firstCardHtml: cards[0] ? cards[0].outerHTML.slice(0, 2500) : html.slice(0, 1500)
                    };
                    return { accountId: id, count: reviews.length, reviews: reviews, __amazonOrdersSample: sample };
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
  color: '#FF3F6C',
  startUrl: 'https://www.myntra.com/my/orders',
  beforeLoadScript: MYNTRA_HOOK,
  hint: 'Log in, wait for My Orders to load (ratings appear), then tap "Fetch my reviews".',
  // Two-step: fetch orders (product name + order date), then best-effort fetch
  // review content for up to 5 UUID ids discovered in the orders payload.
  fetchScript: wrap(
    'myntra',
    `
    (function(){
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

                return {
                  totalOrders: orders && orders.totalOrders,
                  reviewedCount: reviewed.length,
                  orders: reviewed
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
  color: '#620E62',
  startUrl: 'https://www.meesho.com/',
  beforeLoadScript: discoveryHook(),
  hint: 'Log in, open "My Orders" then a product’s "Rate & Review", then tap "Fetch my reviews".',
  fetchScript: discoveryFetchScript('meesho', 'Meesho'),
};

const instamart = {
  key: 'instamart',
  name: 'Instamart',
  color: '#FC8019',
  // Open on the Swiggy account page - the capture shows the DASH order list
  // (/mapi/order/dash) loads here - so it's captured without the user navigating.
  startUrl: 'https://www.swiggy.com/my-account',
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
  color: '#0C831F',
  startUrl: 'https://blinkit.com/account/orders',
  // Keep the interceptor: Blinkit's order data comes back as server-driven
  // "layout" widget trees (v1/layout/order_history + order_details). Those
  // endpoints need exact app headers/params the SPA computes, so instead of
  // re-fetching them blind we parse the real authenticated responses the hook
  // already captured while you browsed Account -> Orders.
  beforeLoadScript: discoveryHook(),
  hint: 'Log in if asked and let your Orders list load, then tap "Fetch my reviews". (No need to open individual orders.)',
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
  color: '#8025C8',
  // Open straight on Order History so the list (with per-order star ratings)
  // loads and is captured - the user shouldn't have to navigate or open orders.
  startUrl: 'https://www.zepto.com/account/orders',
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
        // Show rated orders only when we have any; else everything for debugging.
        reviews: rated.length ? rated : reviews
      });
    })()
  `
  ),
};

export const PLATFORMS = { flipkart, amazon, myntra, meesho, instamart, blinkit, zepto };
export const PLATFORM_LIST = [flipkart, amazon, myntra, meesho, instamart, blinkit, zepto];
