/**
 * content.js - data extraction for product pages, alternatives and search results
 */

console.log("GreenChoice content script loaded on:", location.href);

function getDomain() {
  const h = location.hostname.toLowerCase();
  if (h.includes("amazon.")) return "amazon";
  if (h.includes("flipkart.")) return "flipkart";
  if (h.includes("myntra.")) return "myntra";
  return "generic";
}


/* ---------- BEST PRODUCT HIGHLIGHTING ON PAGE ---------- */

const GC_HIGHLIGHT_CLASS = "gc-best-product-highlight";
const GC_HIGHLIGHT_STYLE_ID = "gc-best-product-highlight-style";

function ensureHighlightStyles() {
  if (document.getElementById(GC_HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = GC_HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${GC_HIGHLIGHT_CLASS} {
      outline: 3px solid #22c55e !important;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.5) !important;
      border-radius: 8px !important;
      position: relative;
      transition: box-shadow 0.25s ease, transform 0.25s ease;
      transform: translateY(-2px);
      background-color: rgba(22, 163, 74, 0.04) !important;
    }
    .${GC_HIGHLIGHT_CLASS}::before {
      content: "GreenChoice best";
      position: absolute;
      top: 4px;
      left: 4px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
      color: #ffffff;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border-radius: 9999px;
      z-index: 99999;
    }
  `;
  document.documentElement.appendChild(style);
}

function clearBestHighlight() {
  document
    .querySelectorAll("." + GC_HIGHLIGHT_CLASS)
    .forEach((el) => el.classList.remove(GC_HIGHLIGHT_CLASS));
}

function normalizeUrl(u) {
  if (!u) return "";
  try {
    const url = new URL(u, location.href);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (e) {
    return u.split("#")[0].split("?")[0];
  }
}

function findCardForBest(best) {
  const domain = getDomain();
  const bestUrl = normalizeUrl(best && best.url);
  const bestName = (best && (best.name || best.title)
    ? (best.name || best.title).trim()
    : "");

  // AMAZON search results
  if (domain === "amazon") {
    const cards = document.querySelectorAll(
      'div[data-component-type="s-search-result"]'
    );
    for (const card of cards) {
      const link = card.querySelector("h2 a");
      if (!link) continue;

      const href = normalizeUrl(link.href);
      const title = (link.innerText || "").trim();

      if (bestUrl && href && href === bestUrl) return card;
      if (bestName && title && title === bestName) return card;
    }
  }

  // FLIPKART search results
  if (domain === "flipkart") {
    const cards = document.querySelectorAll("._13oc-S, ._1AtVbE");
    for (const card of cards) {
      const link =
        card.querySelector('a._1fQZEK, a._2rpwqI, a[href*="/p/"]') ||
        card.querySelector("a");
      if (!link) continue;

      const href = normalizeUrl(link.href);
      const title =
        (link.getAttribute("title") || "").trim() ||
        card.querySelector("div._4rR01T")?.innerText?.trim() ||
        card.querySelector("a.s1Q9rs")?.innerText?.trim() ||
        "";

      if (bestUrl && href && href === bestUrl) return card;
      if (bestName && title && title === bestName) return card;
    }
  }

  // MYNTRA search results
  if (domain === "myntra") {
    const cards = document.querySelectorAll("li.product-base");
    for (const card of cards) {
      const link = card.querySelector("a");
      if (!link) continue;

      const href = normalizeUrl(link.href);
      const brand = card.querySelector(".product-brand")?.innerText?.trim() || "";
      const name = card.querySelector(".product-product")?.innerText?.trim() || "";
      const title = (brand && name) ? `${brand} ${name}` : (brand || name || "").trim();

      if (bestUrl && href && href === bestUrl) return card;
      if (bestName && title && title === bestName) return card;
    }
  }

  // Generic fallback: match exact URL anywhere
  if (bestUrl) {
    const anchors = document.querySelectorAll("a[href]");
    for (const a of anchors) {
      const href = normalizeUrl(a.href);
      if (href && href === bestUrl) {
        return a.closest("div, li, section, article") || a;
      }
    }
  }

  return null;
}

function highlightBestProductOnPage(best) {
  if (!best) return;
  ensureHighlightStyles();
  clearBestHighlight();

  const card = findCardForBest(best);
  if (!card) {
    console.log("[GreenChoice] No matching DOM card found for best product", best);
    return;
  }

  card.classList.add(GC_HIGHLIGHT_CLASS);

  try {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    // ignore
  }
}



/* -----------------------------------------
   UNIVERSAL IMAGE EXTRACTION
------------------------------------------*/
function extractImage() {
  const selectors = [
    // Amazon
    '#landingImage',
    '.imgTagWrapper img',
    '.a-dynamic-image',
    'img.s-image',
    // Flipkart
    '.CXW8mj img',
    '._2r_T1I',
    '.q6DClP',
    // Myntra
    '.image-grid-skeleton img',
    '.pdp-thumbnail-img',
    '.pdp-image',
    // generic
    'img[src*="media"]',
    'img[src*="product"]',
    'img[src*="amazon"]',
    'img[src*="flipkart"]',
    'img[src*="myntra"]'
  ];

  for (let sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.src && el.src.length > 10) return el.src;
  }

  // Fallback: largest image in the page
  let biggestImg = null;
  let biggestArea = 0;

  document.querySelectorAll("img").forEach(img => {
    if (!img.src) return;

    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    const area = w * h;

    if (area > biggestArea) {
      biggestArea = area;
      biggestImg = img.src;
    }
  });

  return biggestImg || "";
}

/* -----------------------------------------
   PRODUCT DATA EXTRACTION
------------------------------------------*/
function extractProductData() {
  const url = location.href;
  const domain = getDomain();

  let title = "";
  let description = "";
  let price = "";

  if (domain === "amazon") {
    // Title
    title =
      document.querySelector('#productTitle')?.innerText?.trim() ||
      document.querySelector('h1 span')?.innerText?.trim() ||
      document.title ||
      "";

    // Description / bullets
    description =
      document.querySelector('#productDescription')?.innerText?.trim() ||
      document.querySelector('#feature-bullets')?.innerText?.trim() ||
      document.querySelector('.a-expander-content')?.innerText?.trim() ||
      "";

    // Price
    price =
      document.querySelector('.a-price .a-price-whole')?.innerText?.replace(/[,\s]/g, "") ||
      document.querySelector('.a-price-whole')?.innerText?.replace(/[,\s]/g, "") ||
      "";
  } else if (domain === "flipkart") {
    // Title (Flipkart)
    title =
      document.querySelector('span.B_NuCI')?.innerText?.trim() || // new design
      document.querySelector('._35KyD6')?.innerText?.trim() ||    // old design
      document.title ||
      "";

    // Description / highlights
    description =
      document.querySelector('._1mXcCf')?.innerText?.trim() ||
      document.querySelector('._3YgSsQ')?.innerText?.trim() ||
      "";

    // Price
    price =
      document.querySelector('._30jeq3._16Jk6d')?.innerText?.replace(/[,\s₹]/g, "") ||
      document.querySelector('._30jeq3')?.innerText?.replace(/[,\s₹]/g, "") ||
      "";
  } else if (domain === "myntra") {
    // Title (brand + product name)
    const brand =
      document.querySelector('.pdp-title')?.innerText?.trim() ||
      document.querySelector('.pdp-name')?.innerText?.trim() ||
      "";
    const name =
      document.querySelector('.pdp-name')?.innerText?.trim() ||
      document.querySelector('.pdp-product-description-title')?.innerText?.trim() ||
      "";
    title = (brand && name) ? `${brand} ${name}` : (brand || name || document.title || "");

    // Description
    description =
      document.querySelector('.pdp-product-description-content')?.innerText?.trim() ||
      document.querySelector('.index-productDetails')?.innerText?.trim() ||
      "";

    // Price
    price =
      document.querySelector('.pdp-price')?.innerText?.replace(/[^\d.]/g, "") ||
      document.querySelector('.pdp-discountedPrice')?.innerText?.replace(/[^\d.]/g, "") ||
      "";
  } else {
    // Generic fallback
    title =
      document.querySelector('h1')?.innerText?.trim() ||
      document.title ||
      "";
    description =
      document.querySelector('meta[name="description"]')?.content?.trim() ||
      document.querySelector('meta[property="og:description"]')?.content?.trim() ||
      "";
    let m = document.body.innerText.match(/₹\s*\d[\d,.]*/);
    price = m ? m[0] : "";
  }

  const img = extractImage();
  return { url, title, description, price, img };
}

/* -----------------------------------------
   ALTERNATIVES EXTRACTION (returns objects with URLs)
------------------------------------------*/
function extractAlternatives() {
  const domain = getDomain();
  const results = [];
  const seen = new Set();

  const BAD_TEXT_PATTERNS = [
    /Compare with/i,
    /Delivering to/i,
    /Update location/i,
    /Your Prime Membership/i,
    /Manage Your Content/i,
    /Register for a free Business Account/i,
    /Product summary presents key product information/i,
    /Health, Household & Personal Care/i,
    /Customer Service/i,
    /Best Sellers/i,
    /Today's Deals/i,
    /Returns/i,
    /Cart/i,
    /FREE Delivery/i,
    /Sign up/i,
    /cashback/i,
    /offer/i,
    /discount/i,
    /coupon/i,
    /Delivery/i,
    /^\s*\(₹/i,
    /^\s*[₹0-9]/,
    /^[0-9]+\s*(months?|days?)\b/i
  ];

  function add(title, url, price) {
    if (!title) return;
    title = title.trim();
    if (!title || title.length < 20) return;
    if (BAD_TEXT_PATTERNS.some(re => re.test(title))) return;
    if (seen.has(title)) return;
    seen.add(title);
    results.push({ title, url: url || "", price: price || "" });
  }

  if (domain === "amazon") {
    const productLinks = document.querySelectorAll(
      'a[href*="/dp/"]:not([href*="product-reviews"]):not([href*="/help/"]):not([href*="/gp/help/"])'
    );

    productLinks.forEach(a => {
      const raw = (a.innerText || "").trim();
      if (!raw) return;
      const parts = raw.split("\n").map(t => t.trim()).filter(Boolean);
      if (!parts.length) return;
      const bestLine = parts.reduce(
        (longest, cur) => (cur.length > longest.length ? cur : longest),
        ""
      );

      const card =
        a.closest('[data-component-type="s-search-result"]') ||
        a.closest('.s-result-item') ||
        a.closest('.s-card-container') ||
        document;

      const priceWhole = card.querySelector('.a-price-whole')?.innerText || '';
      const priceFrac = card.querySelector('.a-price-fraction')?.innerText || '';
      let price = '';
      if (priceWhole) {
        const w = priceWhole.replace(/[^\d]/g, '');
        const f = priceFrac.replace(/[^\d]/g, '');
        price = '₹' + w + (f ? '.' + f : '');
      }

      add(bestLine, a.href, price);
    });

  } else if (domain === "flipkart") {
    const cards = document.querySelectorAll('a._1fQZEK, a._2rpwqI, a[href*="/p/"]:not([href*="login"])');

    cards.forEach(link => {
      const url = link.href;
      const cardRoot = link.closest('._2kHMtA') || link.closest('._13oc-S') || link;

      const title =
        link.getAttribute('title')?.trim() ||
        cardRoot.querySelector('div._4rR01T')?.innerText?.trim() ||
        cardRoot.querySelector('a.s1Q9rs')?.innerText?.trim() ||
        "";

      if (!title) return;

      const priceEl =
        cardRoot.querySelector('div._30jeq3._1_WHN1') ||
        cardRoot.querySelector('div._30jeq3');
      let price = '';
      if (priceEl && priceEl.innerText) {
        price = priceEl.innerText.trim();
      }

      add(title, url, price);
    });

  } else if (domain === "myntra") {
    const cards = document.querySelectorAll('li.product-base');

    cards.forEach(card => {
      const link = card.querySelector('a');
      if (!link) return;
      const url = link.href;

      const brand = card.querySelector('.product-brand')?.innerText?.trim() || "";
      const name = card.querySelector('.product-product')?.innerText?.trim() || "";
      const combined = (brand + " " + name).trim();

      const priceEl =
        card.querySelector('.product-discountedPrice') ||
        card.querySelector('.product-price');
      let price = '';
      if (priceEl && priceEl.innerText) {
        price = priceEl.innerText.trim();
      }

      add(combined, url, price);
    });

  } else {
    // Generic fallback
    document.querySelectorAll("a").forEach(a => {
      const text = (a.innerText || "").trim();
      if (text && text.length > 30) {
        add(text, a.href, "");
      }
    });
  }

  console.log("[GreenChoice] alternatives (objects):", domain, results);
  return results.slice(0, 8); // limit for speed
}

/* -----------------------------------------
   SEARCH RESULTS EXTRACTION (STRUCTURED)
------------------------------------------*/
function extractSearchProducts() {
  const domain = getDomain && getDomain();
  const results = [];
  const seen = new Set();

  if (domain === "amazon") {
    const cards = document.querySelectorAll(
      'div[data-component-type="s-search-result"]'
    );

    cards.forEach(card => {
      const link = card.querySelector('h2 a');
      if (!link) return;

      const title = (link.innerText || '').trim();
      if (!title || title.length < 10) return;
      if (seen.has(title)) return;
      seen.add(title);

      const url = link.href;

      const priceWhole = card.querySelector('.a-price-whole')?.innerText || '';
      const priceFrac = card.querySelector('.a-price-fraction')?.innerText || '';
      let price = '';
      if (priceWhole) {
        const w = priceWhole.replace(/[^\d]/g, '');
        const f = priceFrac.replace(/[^\d]/g, '');
        price = '₹' + w + (f ? '.' + f : '');
      }

      results.push({ title, url, price });
    });
  } else if (domain === "flipkart") {
    const cards = document.querySelectorAll('a._1fQZEK, a._2rpwqI, a[href*="/p/"]:not([href*="login"])');

    cards.forEach(link => {
      const url = link.href;
      const cardRoot = link.closest('._2kHMtA') || link.closest('._13oc-S') || link;

      const title =
        link.getAttribute('title')?.trim() ||
        cardRoot.querySelector('div._4rR01T')?.innerText?.trim() ||
        cardRoot.querySelector('a.s1Q9rs')?.innerText?.trim() ||
        "";
      if (!title || title.length < 10) return;
      if (seen.has(title)) return;
      seen.add(title);

      const priceEl =
        cardRoot.querySelector('div._30jeq3._1_WHN1') ||
        cardRoot.querySelector('div._30jeq3');
      let price = '';
      if (priceEl && priceEl.innerText) {
        price = priceEl.innerText.trim();
      }

      results.push({ title, url, price });
    });
  } else if (domain === "myntra") {
    const cards = document.querySelectorAll('li.product-base');

    cards.forEach(card => {
      const link = card.querySelector('a');
      if (!link) return;

      const brand = card.querySelector('.product-brand')?.innerText?.trim() || '';
      const name = card.querySelector('.product-product')?.innerText?.trim() || '';
      const title = (brand && name) ? `${brand} ${name}` : (brand || name || '').trim();
      if (!title || title.length < 10) return;
      if (seen.has(title)) return;
      seen.add(title);

      const url = link.href;

      const priceEl =
        card.querySelector('.product-discountedPrice') ||
        card.querySelector('.product-price');
      let price = '';
      if (priceEl && priceEl.innerText) {
        price = priceEl.innerText.trim();
      }

      results.push({ title, url, price });
    });
  } else {
    // Generic: try all <a> with long text
    document.querySelectorAll("a").forEach(a => {
      const text = a.innerText?.trim();
      if (text && text.length > 30 && results.length < 15) {
        const title = text;
        if (seen.has(title)) return;
        seen.add(title);
        results.push({ title, url: a.href, price: "" });
      }
    });
  }

  console.log('[GreenChoice] searchProducts results:', getDomain(), results);
  return results;
}

/* -----------------------------------------
   MESSAGE LISTENER
------------------------------------------*/
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getProductData") {
    sendResponse(extractProductData());
  } else if (req.action === "getAlternatives") {
    sendResponse(extractAlternatives());
  } else if (req.action === "searchProducts") {
    sendResponse(extractSearchProducts());
  } else if (req.action === "highlightBestProduct") {
    highlightBestProductOnPage(req.best);
    sendResponse({ ok: true });
  } else if (req.action === "getPrice") {
    const domain = getDomain();
    let price = "";

    if (domain === "amazon") {
      price =
        document.querySelector(".a-price .a-price-whole")?.innerText ||
        document.querySelector(".a-price-whole")?.innerText ||
        "";
    } else if (domain === "flipkart") {
      price =
        document.querySelector("._30jeq3._16Jk6d")?.innerText ||
        document.querySelector("._30jeq3")?.innerText ||
        "";
    } else if (domain === "myntra") {
      price =
        document.querySelector(".pdp-price")?.innerText ||
        document.querySelector(".pdp-discountedPrice")?.innerText ||
        "";
    }

    sendResponse({ price });
  }
});
