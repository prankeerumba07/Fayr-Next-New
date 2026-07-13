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
  startUrl: 'https://www.swiggy.com/instamart',
  // Keep the interceptor: Swiggy's /mapi/order/* endpoints are session + CSRF
  // guarded and computed by the SPA, so we parse the real authenticated
  // responses the hook captured while you browsed Orders rather than re-fetch.
  beforeLoadScript: discoveryHook(),
  hint: 'Log in (allow location if asked), open your profile → Orders and scroll the list, then tap "Fetch my reviews".',
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
          // Only delivered orders can carry a rating.
          var delivered = /deliver/i.test(String(status));

          var v2 = o.order_data_v2 || {};
          var shipments = v2.shipments || [];
          var names = [];
          var rated = false;
          shipments.forEach(function(sh){
            (sh.items || []).forEach(function(it){ if (it && typeof it.name === "string" && it.name.trim()) names.push(it.name.trim()); });
            var ri = sh.rating_info || null;
            if (ri) {
              if (ri.is_rated === true) rated = true;
              // Fallback when is_rated is absent: infer from the CTA label.
              var btn = ri.button && ri.button.text;
              if (ri.is_rated == null && typeof btn === "string" && /edit/i.test(btn)) rated = true;
            }
          });

          // "Order delivered on 3 Mar 2026, 02:25 PM by <agent>"
          var deliveryEpoch = null;
          var line1 = (o.details_text && o.details_text.line1) || "";
          var dm = line1.match(/on\\s+(.+?)(?:\\s+by\\s+|$)/i);
          if (dm) deliveryEpoch = parseDate(dm[1]);

          var refund = o.refund_details || {};
          var returned = String(refund.refund_initiated || "0") !== "0"
            || String(refund.refund_processed || "0") !== "0"
            || (v2.refund_status && /refund|return/i.test(String(v2.refund_status)) && !/no_refund/i.test(String(v2.refund_status)));

          reviews.push({
            productname: names.join(", ") || (v2.title || null),
            // Swiggy web never returns the star count, only whether it was rated.
            rating: null,
            reviewtext: null,
            reviewdate: null,
            orderdate: typeof o.created_at === "number" ? o.created_at : null,
            deliverydate: deliveryEpoch,
            orderid: orderId,
            returned: returned,
            returnstatus: returned ? "REFUNDED" : (delivered ? "DELIVERED" : status),
            statuscode: status,
            // From the user's own authenticated Swiggy order history.
            verified: true,
            approved: rated ? true : null,
            published: rated ? true : null,
            reviewstatus: rated ? "RATED_STAR_NOT_EXPOSED_ON_WEB"
              : (delivered ? "NOT_RATED" : String(status || "")),
            productid: orderId,
            imageurl: null,
            producturl: null
          });
        });
      });

      var ratedOnly = reviews.filter(function(r){ return r.reviewstatus === "RATED_STAR_NOT_EXPOSED_ON_WEB"; });
      return Promise.resolve({
        source: "captured-mapi",
        note: "Instamart (Swiggy DASH) web exposes whether an order was rated (is_rated) but not the star count, so 'rating' is null; reviewstatus RATED_STAR_NOT_EXPOSED_ON_WEB means the user did submit a rating. Parsed from /mapi/order/dash the page loaded while you browsed Orders.",
        orderListCallsSeen: calls.filter(function(c){ return c && c.url && c.url.indexOf("/mapi/order/dash") >= 0 && c.url.indexOf("details") < 0; }).length,
        parsedCount: reviews.length,
        ratedCount: ratedOnly.length,
        reviews: reviews
      });
    })()
  `
  ),
};

const blinkit = {
  key: 'blinkit',
  name: 'Blinkit',
  color: '#0C831F',
  startUrl: 'https://blinkit.com/',
  // Keep the interceptor: Blinkit's order data comes back as server-driven
  // "layout" widget trees (v1/layout/order_history + order_details). Those
  // endpoints need exact app headers/params the SPA computes, so instead of
  // re-fetching them blind we parse the real authenticated responses the hook
  // already captured while you browsed Account -> Orders.
  beforeLoadScript: discoveryHook(),
  hint: 'Log in (allow location if asked), open Account → Your Orders and scroll the list, then tap "Fetch my reviews".',
  // IMPORTANT: Blinkit's WEB order layouts expose full order facts (id, date,
  // amount, products, delivered/returned status) but NOT the star rating the
  // user left - there is no rating value anywhere in order_history OR
  // order_details (the ORDER_RATING subscriber is only a refresh hook). So this
  // verifies the PURCHASE + return-window side; the rating stays null and is
  // flagged web-unavailable rather than faked.
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

      var reviews = [];
      var seen = {};
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

          var returned = texts.some(function(t){ return /return|refund/i.test(t); });
          var delivered = texts.some(function(t){ return /arrived|delivered/i.test(t); });
          var amount = null, dateEpoch = null, dateText = null;
          var products = [];
          texts.forEach(function(t){
            if (/^₹/.test(t)) { if (!amount) amount = t; return; }
            if (/return|refund|reorder|arrived in|delivered/i.test(t)) return;
            var e = parseDate(t);
            if (e && !dateEpoch) { dateEpoch = e; dateText = t; return; }
            // whatever's left that isn't the date/amount/status is a product name
            if (t !== dateText) products.push(t);
          });

          reviews.push({
            productname: products.join(", ") || null,
            rating: (orderId && detailRating[orderId] != null) ? detailRating[orderId] : null,
            reviewtext: null,
            reviewdate: null,
            orderdate: dateEpoch,
            deliverydate: delivered ? dateEpoch : null,
            orderid: orderId,
            returned: returned,
            returnstatus: returned ? "RETURNED" : (delivered ? "DELIVERED" : null),
            statuscode: returned ? "RETURNED" : (delivered ? "DELIVERED" : null),
            // From the user's own authenticated order history -> genuine purchase.
            verified: true,
            approved: null,
            published: null,
            // Blinkit web never returns the star rating, so the review half is
            // unverifiable from this surface - say so explicitly.
            reviewstatus: "RATING_NOT_EXPOSED_ON_WEB",
            productid: cartId,
            imageurl: imgs[0] || null,
            producturl: null,
            amount: amount
          });
        });
      });

      return Promise.resolve({
        source: "captured-layout",
        note: "Blinkit web exposes order history (purchase + delivery/return status) but not the star rating, so 'rating' is null and reviewstatus is RATING_NOT_EXPOSED_ON_WEB. Parsed from the order_history layout the page loaded while you browsed.",
        orderHistoryCallsSeen: calls.filter(function(c){ return c && c.url && c.url.indexOf("/v1/layout/order_history") >= 0; }).length,
        parsedCount: reviews.length,
        reviews: reviews
      });
    })()
  `
  ),
};

const zepto = {
  key: 'zepto',
  name: 'Zepto',
  color: '#8025C8',
  startUrl: 'https://www.zepto.com/',
  hint: 'Log in (allow location if asked), open Account → Orders so they load, then tap "Fetch my reviews".',
  // Zepto ratings are per-ORDER (rate your delivery 1-5), served by the
  // "samiksha" (= review) service - there are no per-product text reviews here
  // like Flipkart/Amazon/Myntra. Two-step: fetch the order list
  // (bff-gateway /api/v2/order), then for each DELIVERED order ask
  // samiksha-service/order-rating for the star the user left (the list's own
  // `rating` field is often null until that call is made). Join placedTime /
  // arrivedTime + refund status for the return-window timeline. All requests
  // run same-site inside the WebView with credentials:include so the .zepto.com
  // session cookie authenticates them.
  fetchScript: wrap(
    'zepto',
    `
    (function(){
      var GW = "https://bff-gateway.zepto.com";
      var CDN = "https://cdn.zeptonow.com/production/";
      // Returns { status, ok, json, error, textSample } instead of swallowing
      // failures, so a 401 / shape-change is visible in "Show raw JSON".
      function getJson(url, opts){
        opts = opts || {};
        return fetch(url, {
          method: opts.method || "GET",
          credentials: "include",
          headers: Object.assign({ "accept": "application/json, text/plain, */*" }, opts.headers || {}),
          body: opts.body || undefined
        }).then(function(r){
          return r.text().then(function(t){
            var j=null; try{ j=JSON.parse(t); }catch(e){}
            return { status:r.status, ok:r.ok, json:j, error:null, textSample:(t||"").slice(0,600) };
          });
        }).catch(function(e){
          return { status:null, ok:false, json:null, error:String((e&&e.message)||e), textSample:null };
        });
      }
      function imgUrl(pv){
        var im = pv && pv.image;
        var path = im && (im.path || im.relativePath);
        return path ? (CDN + path) : null;
      }
      // The samiksha rated-order payload shape isn't pinned down (the capture
      // only had the empty-order_id config response), so pull the 1-5 star and
      // any review text out defensively wherever they sit.
      function findRating(node, depth){
        if (node == null || depth > 8) return null;
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
      function findReviewText(node, depth){
        if (node == null || depth > 8) return null;
        if (Array.isArray(node)){
          for (var i=0;i<node.length;i++){ var r=findReviewText(node[i], depth+1); if(r) return r; }
          return null;
        }
        if (typeof node !== "object") return null;
        var keys = Object.keys(node);
        for (var k=0;k<keys.length;k++){
          var key = keys[k].toLowerCase();
          var v = node[keys[k]];
          if ((key === "reviewtext" || key === "review" || key === "comment" ||
               key === "feedbacktext" || key === "userreview") &&
              typeof v === "string" && v.trim().length > 1) return v.trim();
        }
        for (var k2=0;k2<keys.length;k2++){ var r2=findReviewText(node[keys[k2]], depth+1); if(r2) return r2; }
        return null;
      }

      return getJson(GW + "/api/v2/order/?page_number=1").then(function(ordRes){
        var orders = (ordRes.json && ordRes.json.orders) || [];
        var diag = {
          ordersCall: { status: ordRes.status, ok: ordRes.ok, error: ordRes.error, sample: ordRes.json ? null : ordRes.textSample },
          orderCount: orders.length
        };

        // Only DELIVERED orders can be rated - cap the per-order fan-out.
        var toRate = orders
          .filter(function(o){ return /deliver/i.test(String(o.status || o.formattedStatus || "")); })
          .slice(0, 12);

        return Promise.all(toRate.map(function(o, i){
          return getJson(GW + "/samiksha-service/api/v1/order-rating", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ order_id: o.id })
          }).then(function(res){
            if (i === 0) { diag.ratingCall = { status: res.status, ok: res.ok, error: res.error, sample: res.json ? null : res.textSample }; }
            return { id: o.id, samiksha: res.json };
          }).catch(function(){ return { id: o.id, samiksha: null }; });
        })).then(function(ratedResults){
          var samikshaByOrder = {};
          ratedResults.forEach(function(x){ samikshaByOrder[x.id] = x.samiksha; });

          var reviews = orders.map(function(o){
            var samiksha = samikshaByOrder[o.id] || null;
            // List's own o.rating wins; fall back to whatever the samiksha
            // detail carries for this order.
            var star = (typeof o.rating === "number" && o.rating >= 1 && o.rating <= 5)
              ? o.rating : findRating(samiksha, 0);
            var products = o.productsNamesAndCounts || [];
            var first = products[0] || {};
            var refunded = (Number(o.totalRefundAmount) > 0) || !!o.refundStatus;
            var isRated = star != null;
            return {
              productname: products.map(function(p){ return p.name; }).filter(Boolean).join(", ") || null,
              rating: star,
              reviewtext: findReviewText(samiksha, 0),
              // These endpoints don't expose the rating timestamp; the timeline
              // anchors on delivery (arrivedTime) instead.
              reviewdate: null,
              orderdate: o.placedTime || null,
              deliverydate: o.arrivedTime || null,
              orderid: o.code || o.id || null,
              returned: refunded,
              returnstatus: refunded ? (o.refundStatus || "REFUNDED") : (o.status || null),
              statuscode: o.status || o.formattedStatus || null,
              // Sourced from the user's own authenticated order history -> a
              // genuine purchase by definition.
              verified: true,
              approved: isRated,
              published: isRated,
              reviewstatus: isRated ? "SUBMITTED" : (o.ratingSkipped ? "SKIPPED" : "NOT_RATED"),
              eligibleforrating: o.isEligibleForRating === true,
              productid: first.productVariantId || first.id || null,
              imageurl: imgUrl(first),
              producturl: null
            };
          });

          // A Fayr campaign only cares about orders the user actually rated;
          // if none are rated yet, return all orders so there's something to
          // inspect / debug in "Show raw JSON".
          var ratedOnly = reviews.filter(function(r){ return r.rating != null; });
          return {
            totalOrders: orders.length,
            ratedCount: ratedOnly.length,
            reviews: ratedOnly.length ? ratedOnly : reviews,
            __diagnostic: diag
          };
        });
      });
    })()
  `
  ),
};

export const PLATFORMS = { flipkart, amazon, myntra, meesho, instamart, blinkit, zepto };
export const PLATFORM_LIST = [flipkart, amazon, myntra, meesho, instamart, blinkit, zepto];
