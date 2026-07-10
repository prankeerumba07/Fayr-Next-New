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
      function getJson(url){
        return fetch(url, { credentials:"include", headers:H })
          .then(function(r){ return r.text().then(function(t){ var j=null; try{ j=JSON.parse(t); }catch(e){} return j; }); })
          .catch(function(){ return null; });
      }
      function fixImg(u){
        if (!u) { return null; }
        return u.replace(/\\{@width\\}/g, "200").replace(/\\{@height\\}/g, "200").replace(/\\{@quality\\}/g, "90");
      }
      return Promise.all([
        getJson("https://1.rome.api.flipkart.com/api/3/reviews/completed/product?start=1&count=20"),
        getJson("https://1.rome.api.flipkart.com/api/5/self-serve/orders/?page=1")
      ]).then(function(res){
        var revJson = res[0], ordJson = res[1];

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
            reviewstatus: p.status || null,
            pid: p.pid || null,
            reviewid: p.id || null,
            imageurl: fixImg(p.dynamicImageUrl)
          };
        });

        return { reviews: reviews };
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
                  .then(function(res){ if (i === 0) { dbg.status = res.status; dbg.finalUrl = res.url; } return res.text(); })
                  .then(function(html){
                    var pdoc = new DOMParser().parseFromString(html, "text/html");
                    var plink = pdoc.querySelector('a[data-hook="product-link"]') ||
                                pdoc.querySelector('a[href*="/dp/"]') ||
                                pdoc.querySelector('a[href*="/product-reviews/"]');
                    if (plink) {
                      r.name = plink.textContent.trim();
                      var am = (plink.getAttribute("href") || "").match(/\\/(?:dp|product-reviews)\\/([A-Z0-9]{10})/);
                      if (am) { r.asin = am[1]; }
                    }
                    r.verified = /Verified Purchase/i.test(html) || !!pdoc.querySelector('[data-hook="avp-badge"]');
                    var dn = pdoc.querySelector('[data-hook="review-date"]');
                    if (dn) { r.reviewdate = dn.textContent.trim(); }
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
                  .catch(function(e){ if (i === 0) { dbg.error = String((e && e.message) || e); } return r; });
              })).then(function(){
                // DISCOVERY: fetch order history (HTML) to map order/delivery/return.
                return fetch("https://www.amazon.in/your-orders/orders?_encoding=UTF8", { credentials:"include", headers:{ "accept":"*/*" } })
                  .then(function(r){ return r.text().then(function(html){
                    var odoc = new DOMParser().parseFromString(html, "text/html");
                    var cards = odoc.querySelectorAll('.order-card, .js-order-card, [class*="order-card"]');
                    var asinMatches = html.match(/\\/(?:dp|product|gp\\/product)\\/[A-Z0-9]{10}/g) || [];
                    var asins = [], seenA = {};
                    asinMatches.forEach(function(a){ var m = a.match(/[A-Z0-9]{10}$/); if (m && !seenA[m[0]]) { seenA[m[0]] = 1; asins.push(m[0]); } });
                    var sample = {
                      status: r.status, finalUrl: r.url, cardCount: cards.length,
                      asins: asins.slice(0, 15),
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
                    return Object.assign({}, o, {
                      reviewid: rm.reviewId,
                      reviewtext: (det && det.review) || rm.reviewText || null,
                      rating: (det && det.userRating) || rm.communityRating || null,
                      reviewstatus: (det && det.statusMessage) || (det && det.status) || "ACTIVE",
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

export const PLATFORMS = { flipkart, amazon, myntra };
export const PLATFORM_LIST = [flipkart, amazon, myntra];
