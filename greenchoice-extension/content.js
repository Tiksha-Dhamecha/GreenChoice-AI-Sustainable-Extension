/**
 * content.js - data extraction for product pages, alternatives and search results
 */


(function () {

// Prevent content.js from running twice on the same page
if (window.__GREENCHOICE_CONTENT_LOADED__) {
  console.log("GreenChoice content.js already loaded – skipping re-execution");
  return;
}

window.__GREENCHOICE_CONTENT_LOADED__ = true;
console.log("GreenChoice content script loaded on:", location.href);
console.log("GreenChoice content script loaded on:", location.href);
function getDomain() {
  const h = location.hostname.toLowerCase();
  if (h.includes("amazon.")) return "amazon";
  if (h.includes("flipkart.")) return "flipkart";
  if (h.includes("myntra.")) return "myntra";
  if (h.includes("meesho.")) return "meesho";
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
    return url.toString();
  } catch (e) {
    return u.split("#")[0];
  }
}


function normalizeText(t) {
  return (t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
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
      //if (bestName && title && title === bestName) return card;
      if (bestName && title) {
        const a = normalizeText(title);
        const b = normalizeText(bestName);

        // partial fuzzy match (works for truncation & variants)
        if (a.includes(b) || b.includes(a)) {
        return card;
        }
      }
    }
  }

  // FLIPKART search results
  if (domain === "flipkart") {
    const cards = document.querySelectorAll("div._2kHMtA, div.slAVV4, ._13oc-S, ._1AtVbE");
    for (const card of cards) {
      const link =
        card.querySelector('a._1fQZEK, a._2rpwqI, a[href*="/p/"]') ||
        card.querySelector("a");
      if (!link) continue;

      const href = normalizeUrl(link.href);
      
const title =
  (link.getAttribute("title") || "").trim() ||
  card.querySelector("div.KzDlHZ")?.innerText?.trim() ||
  card.querySelector("div._4rR01T")?.innerText?.trim() ||
  card.querySelector("a.WKTcLC")?.innerText?.trim() ||
  card.querySelector("a.IRpwTa")?.innerText?.trim() ||
  card.querySelector("a.s1Q9rs")?.innerText?.trim() ||
  "";

      if (bestUrl && href && href === bestUrl) return card;
      //if (bestName && title && title === bestName) return card;
      if (bestName && title) {
        const a = normalizeText(title);
        const b = normalizeText(bestName);

        // partial fuzzy match (works for truncation & variants)
        if (a.includes(b) || b.includes(a)) {
          return card;
        }
      }
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
      //if (bestName && title && title === bestName) return card;
      if (bestName && title) {
        const a = normalizeText(title);
        const b = normalizeText(bestName);

        // partial fuzzy match (works for truncation & variants)
        if (a.includes(b) || b.includes(a)) {
          return card;
        }
      }
    }
  }
    // MEESHO search results
  if (domain === "meesho") {
    // product cards on search result page
    const cards = document.querySelectorAll('a[href*="/product/"], a[href*="/products/"]');

    for (const card of cards) {
      const link = card; // card itself is anchor

      const href = normalizeUrl(link.href);

      const title =
        (link.innerText || "").trim() ||
        card.querySelector("p")?.innerText?.trim() ||
        "";

      // URL match (strongest)
      if (bestUrl && href && href === bestUrl) return card;

      // Name fuzzy match
      if (bestName && title) {
        const a = normalizeText(title);
        const b = normalizeText(bestName);

        if (a.includes(b) || b.includes(a)) {
          return card;
        }
      }
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
      // document.querySelector('.a-price .a-price-whole')?.innerText?.replace(/[,\s]/g, "")
      document.querySelector('.a-price .a-offscreen')?.innerText||
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
  } 
 else if (domain === "myntra") {
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
  } else if (domain === "meesho") {

  title =
    document.querySelector('h1')?.innerText?.trim() ||
    document.querySelector('[data-testid="pdp-product-name"]')?.innerText?.trim() ||
    document.querySelector('[class*="Title"], [class*="title"]')?.innerText?.trim() ||
    document.querySelector('meta[property="og:title"]')?.content?.trim() ||
    document.title ||
    "";

  const priceText =
    document.querySelector('[data-testid="product-price"]')?.innerText ||
    document.querySelector('h2, h3, h4, span')?.innerText ||
    "";

  price = (priceText || "").replace(/[^\d.]/g, "");
}
else {
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

  }  else if (domain === "myntra") {
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

  } else if (domain === "meesho") {
    // Meesho: scrape product-like cards/links on the page
    const links = document.querySelectorAll('a[href*="/p/"]');
    links.forEach(link => {
      const url = normalizeUrl(link.href);
      const card = link.closest('div') || link.parentElement || document;
      // title: try aria-label, then longest text line from card
      let t =
        link.getAttribute('aria-label')?.trim() ||
        link.getAttribute('title')?.trim() ||
        "";
      if (!t) {
        const text = (card.innerText || "").split("\n").map(s => s.trim()).filter(Boolean);
        // remove obvious non-title lines
        const cleaned = text.filter(s => !/^₹\s*\d/.test(s) && s.length > 6 && s.length < 140);
        t = cleaned.sort((a,b)=>b.length-a.length)[0] || "";
      }
      if (!t || t.length < 10) return;

      // price: regex in card text
      const m = (card.innerText || "").match(/₹\s*([0-9][0-9,]*)/);
      const price = m ? ("₹" + m[1]) : "";

      add(t, url, price);
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
  const domain = getDomain();
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
    // Flipkart layouts change frequently. Use the same robust collector as
    // cross-site scraping so "compare" and "best on page" work reliably.
    return collectFlipkartProducts({ limit: 15 }).map(p => ({
      title: p.title,
      url: p.url,
      price: p.price
    }));

  }else if (domain === "meesho") {
     

  // Title
  title =
    document.querySelector('h1')?.innerText?.trim() ||
    document.querySelector('[data-testid="pdp-product-name"]')?.innerText?.trim() ||
    document.querySelector('[class*="ProductTitle"], [class*="product-title"]')?.innerText?.trim() ||
    document.title ||
    "";

  // Description
  description =
    document.querySelector('[data-testid="product-description"]')?.innerText?.trim() ||
    document.querySelector('[class*="Description"], [class*="description"]')?.innerText?.trim() ||
    "";

  // Price
  const priceText =
    document.querySelector('[data-testid="product-price"]')?.innerText ||
    document.querySelector('span[class*="Price"], h4[class*="Price"], h5[class*="Price"]')?.innerText ||
    document.querySelector('h4, h5')?.innerText ||
    "";

  price = (priceText || "").replace(/[^\d.]/g, "");

} else if (domain === "myntra") {

  // Reuse card scrapers across multiple Myntra layouts
  const cardSelectors = [
    "li.product-base",
    "ul.results-base li",
    "div.search-searchProducts ul li",
    "li.results-base",
  ];

  const cards = document.querySelectorAll(cardSelectors.join(","));

  cards.forEach(card => {
    const link =
      card.querySelector("a[href*='/buy/']") ||
      card.querySelector("a[href*='/']");

    if (!link) return;

    const url = link.href.split("?")[0];

    // brand
    const brand =
      card.querySelector(".product-brand")?.innerText?.trim() ||
      card.querySelector("[class*='Brand']")?.innerText?.trim() ||
      "";

    // name
    const name =
      card.querySelector(".product-product")?.innerText?.trim() ||
      card.querySelector("[class*='ProductName']")?.innerText?.trim() ||
      "";

    const title = `${brand} ${name}`.trim();

    if (!title || title.length < 5) return;
    if (seen.has(url)) return;
    seen.add(url);

    // price
    let price =
      card.querySelector(".product-discountedPrice")?.innerText?.trim() ||
      card.querySelector(".product-price")?.innerText?.trim() ||
      "";

    // regex fallback
    if (!price) {
      const m = (card.innerText || "").match(/₹\s?[0-9,]+/);
      price = m ? m[0] : "";
    }

    results.push({
      title,
      url,
      price
    });
  });
}
 else {
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
function scrapeMeeshoProducts() {
  const products = [];

  const cards = document.querySelectorAll('div[class*="SearchList__GridCol"]');

  cards.forEach(card => {
    try {
      const linkElem = card.querySelector('a[href*="product"]');
      const titleElem = card.querySelector('p, h5');
      const priceElem = card.querySelector('h5, span');

      const imgElem = card.querySelector('img');

      const title = titleElem ? titleElem.innerText.trim() : null;

      // Extract price number safely
      let price = null;
      if (priceElem) {
        const match = priceElem.innerText.replace(/[,₹]/g, '').match(/\d+/);
        price = match ? parseInt(match[0], 10) : null;
      }

      const url = linkElem
        ? ("https://www.meesho.com" + linkElem.getAttribute('href'))
        : null;

      if (!title || !url) return;

      products.push({
        title,
        price,
        url,
        image: imgElem ? imgElem.src : null,
        platform: "meesho"
      });
    } catch (err) {
      console.warn("meesho parse error", err);
    }
  });

  console.log("[content] Meesho scraped:", products);
  return products;
}

/* -----------------------------------------
   UNIVERSAL PRICE EXTRACTOR (new helper)
------------------------------------------*/
function extractCardPrice(card) {
  const selectors = [
    ".a-price-whole",            // amazon
    "._30jeq3._1_WHN1",          // flipkart
    "._30jeq3",
    ".product-price",            // myntra
    ".product-discountedPrice",
    '[data-testid="product-price"]',
    '[class*="Price"]'
  ];

  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el && el.innerText) {
      return Number(
        el.innerText.replace(/[^\d.]/g, "")
      );
    }
  }
  return null;
}
// function extractCompareProducts() {
//   console.log("[content] extractCompareProducts fallback mode");

//   // try search results first
//   const search = extractSearchProducts();
//   if (Array.isArray(search) && search.length > 0) {
//     return search.map(p => ({
//       name: p.title || p.name || "",
//       price: Number(String(p.price).replace(/[^\d]/g, "")),
//       url: p.url || ""
//     }));
//   }

//   // fallback to alternatives
//   const alts = extractAlternatives();
//   if (Array.isArray(alts) && alts.length > 0) {
//     return alts.map(p => ({
//       name: p.title || p.name || "",
//       price: Number(String(p.price).replace(/[^\d]/g, "")),
//       url: p.url || ""
//     }));
//   }

//   return [];
// }
// function extractCompareProducts() {
//   const domain = getDomain();

//   if (domain === "amazon") {
//     return scrapeAmazon().map(p => ({
//       name: p.title,
//       price: Number(p.price),
//       url: p.url
//     }));
//   }

//   if (domain === "flipkart") {
//     return scrapeFlipkart().map(p => ({
//       name: p.title,
//       price: Number(p.price),
//       url: p.url
//     }));
//   }

//   if (domain === "myntra") {
//     return scrapeMyntra().map(p => ({
//       name: p.title,
//       price: Number(p.price),
//       url: p.url
//     }));
//   }

//   // fallback: nothing to compare
//   return [];
// }
function parsePrice(p) {
   if (!p) return 0;
  return Number(String(p).replace(/[^\d.]/g, "")) || 0;
}
function getProductData() {
  return {
    title: getTitle(),
    price: getPrice(),
    image: getImage(),
    url: window.location.href,
    breadcrumb: getBreadcrumbText()   // ← ADD THIS LINE HERE
  };
}


function extractCompareProducts() {
  console.log("[content] extractCompareProducts called");

  // 1) Try search result pages
  const search = extractSearchProducts();
  if (Array.isArray(search) && search.length > 0) {
    return search.map(p => ({
      name: p.title || p.name || "",
      priceRaw: p.price || "",
      price: parsePrice(p.price),
      url: p.url || ""
    }));
  }

  // 2) Try alternatives on product page
  const alts = extractAlternatives();
  if (Array.isArray(alts) && alts.length > 0) {
    return alts.map(p => ({
      name: p.title || p.name || "",
      priceRaw: p.price || "",
      price: parsePrice(p.price),
      url: p.url || ""
    }));
  }

  // 3) Fallback – current product only
  const pd = extractProductData();
  if (pd && pd.title) {
    return [{
      name: pd.title,
      priceRaw: pd.price || "",
      price: parsePrice(pd.price),
      url: location.href
    }];
  }

  console.warn("[content] nothing found to compare");
  return [];
}


function extractCurrentTitle() {
  return (
    document.querySelector("#productTitle")?.innerText ||
    document.querySelector("h1")?.innerText ||
    document.title
  )?.trim();
}

function getBreadcrumbText() {
  let selectors = [
  "#wayfinding-breadcrumbs_container",      // Amazon
  ".a-breadcrumb",                          // Amazon alt
  ".breadcrumbs",                           // Generic
  ".breadcrumb",                            // Generic alt
  "._2whKao",                               // Flipkart
  ".flex .breadcrumbs",                     // Generic
  ".desktop-breadcrumb",                    // ⭐ Myntra main
  ".breadcrumbs-base",                      // ⭐ Myntra alt
  "nav[aria-label='breadcrumb']"            // modern sites
];


  for (let s of selectors) {
    const el = document.querySelector(s);
    if (el) return el.innerText || el.textContent;
  }
  return "";
}

/* -----------------------------------------
   PAGE CONTEXT (single PDP vs multi listing)
------------------------------------------*/
function isProductDetailPage() {
  const domain = getDomain();
  const url = (location.href || "").toLowerCase();

  // URL + DOM heuristics (more reliable than counting anchors because PDP pages
  // often contain many recommended-product links).
  if (domain === "amazon") {
    if (url.includes("/dp/") || url.includes("/gp/product/")) return true;
    if (document.querySelector("#productTitle")) return true;
    return false;
  }

  if (domain === "flipkart") {
    if (url.includes("/p/") || url.includes("pid=")) {
      if (document.querySelector("span.B_NuCI") || document.querySelector("._35KyD6")) return true;
    }
    return false;
  }

  if (domain === "myntra") {
    // Myntra PDP typically has pdp-* selectors
    if (
      document.querySelector(".pdp-title") ||
      document.querySelector(".pdp-name") ||
      document.querySelector(".pdp-price") ||
      document.querySelector(".pdp-discountedPrice")
    ) {
      return true;
    }
    // URL fallback
    if (url.includes("/buy") || /\/\d+\/buy/.test(url)) return true;
    return false;
  }

  if (domain === "meesho") {
    if (
      document.querySelector('[data-testid="pdp-product-name"]') ||
      document.querySelector('[data-testid="product-price"]')
    ) {
      return true;
    }
    // URL fallback (kept conservative to avoid treating listing pages as PDP)
    // Many Meesho listing links contain /p/, but PDP pages should also have a visible h1.
    if (url.includes("/p/") && document.querySelector("h1")) return true;
    return false;
  }

  // Generic guess: presence of a clear h1 without lots of repeated cards
  return false;
}

function countListingProducts() {
  const domain = getDomain();

  if (domain === "amazon") {
    return document.querySelectorAll('div[data-component-type="s-search-result"]').length;
  }

  if (domain === "flipkart") {
    return document.querySelectorAll('div._2kHMtA, div.slAVV4, div._13oc-S, div._1AtVbE, div[data-id]').length;
  }

  if (domain === "myntra") {
    return document.querySelectorAll('li.product-base').length;
  }

  if (domain === "meesho") {
    // Search/listing pages render product cards as anchors pointing to /p/
    // (PDP pages are handled by isProductDetailPage, so counting here is safe.)
    return document.querySelectorAll('a[href*="/p/"], a[href*="/product/"], a[href*="/products/"]').length;
  }

  return 0;
}

function getPageContext() {
  const domain = getDomain();
  const isProductDetail = isProductDetailPage();
  const productCount = isProductDetail ? 1 : countListingProducts();
  const mode = !isProductDetail && productCount > 1 ? "multi" : "single";
  return { mode, productCount, isProductDetail, domain };
}

/* -----------------------------------------
   MESSAGE LISTENER
------------------------------------------*/
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

  // Popup uses this to decide which buttons should be shown
  // - "single": product detail page (Analyze / Alternatives / Compare Across Sites)
  // - "multi": listing/search page with multiple product cards (Highlight Best / Cost+Sustainability)
  if (req.action === "getPageContext") {
    try {
      sendResponse(getPageContext());
    } catch (e) {
      console.warn("[content] getPageContext failed:", e);
      sendResponse({ mode: "single", productCount: 1, isProductDetail: true, domain: getDomain() });
    }
    return true;
  }

  // Lightweight ping so popup can verify the content script is ready
  if (req.action === "__gc_ping") {
    sendResponse({ ok: true });
    return true;
  }


  /* =========================
     EXISTING WORKING FEATURES
     ========================= */
if (req.action === "getProductData") {
  try {
    const data = extractProductData();
    sendResponse(data);
  } catch (e) {
    console.error("[content] extractProductData crashed:", e);
    sendResponse(null);
  }
  return true;
}


  if (req.action === "getAlternatives") {
    sendResponse(extractAlternatives());
    return true;
  }

  if (req.action === "searchProducts") {
    sendResponse(extractSearchProducts());
    return true;
  }

  if (req.action === "highlightBestProduct") {
    highlightBestProductOnPage(req.best);
    sendResponse({ ok: true });
    return true;
  }

  if (req.action === "getPrice") {
    sendResponse({ price: extractPrice() });
    return true;
  }

  if (req.action === "extractCompareProducts") {
    sendResponse({ products: extractCompareProducts() });
    return true;
  }

  if (req.action === "compareHighlight") {
    highlightBestProductOnPage({
      name: req.bestName,
      url: req.bestUrl || ""
    });
    sendResponse({ ok: true });
    return true;
  }

  /* =========================
     NEW: CROSS-SITE SCRAPING
     ========================= */

  if (req.action === "scrapeAmazonResults") {
    sendResponse(scrapeAmazon());
    return true;
  }

  if (req.action === "scrapeFlipkartResults") {
    sendResponse(scrapeFlipkart());
    return true;
  }

  if (req.action === "scrapeMyntraResults") {
    // Myntra is a SPA; results often render AFTER the tab status becomes "complete".
    // Wait a bit for product cards to appear.
    waitForSelector("li.product-base, ul.results-base li", 9000)
      .then(() => sendResponse(scrapeMyntra()))
      .catch(() => sendResponse([]));
    return true;
  }
  if (req.action === "scrapeMeeshoResults") {
    // Meesho search is dynamic; wait a bit for /p/ links to appear.
    waitForSelector('a[href*="/p/"]', 9000)
      .then(() => sendResponse(scrapeMeesho()))
      .catch(() => sendResponse([]));
    return true;
  }


});
function waitForSelector(selector, timeoutMs = 8000, intervalMs = 250) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function tick() {
      try {
        if (document.querySelector(selector)) return resolve(true);
      } catch (_) {}

      if (Date.now() - start >= timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, intervalMs);
    }

    tick();
  });
}

function extractPrice() {
  const domain = location.hostname;

  if (domain.includes("amazon")) {
    return document.querySelector(".a-price .a-offscreen")?.innerText || "";
  }

  if (domain.includes("flipkart")) {
    const el = document.querySelector("div.Nx9bqj, div._30jeq3, span.Nx9bqj, span._30jeq3, .CxhGGd, [data-testid=\"price\"]");
    return el?.innerText || "";
  }

  if (domain.includes("myntra")) {
    return (
      document.querySelector(".pdp-discountedPrice")?.innerText ||
      document.querySelector(".pdp-price")?.innerText ||
      ""
    );
  }

  return "";
}

/* -----------------------------------------
   FLIPKART: ROBUST SEARCH/CARD COLLECTOR
   (used by searchProducts + cross-site scraping)
------------------------------------------*/
function collectFlipkartProducts({ limit = 10 } = {}) {
  const products = [];
  const seen = new Set();

  // Most common card containers across Flipkart layouts
  const cardSelectors = [
    'div._2kHMtA',
    'div.slAVV4',
    'div._13oc-S',
    'div._1AtVbE',
    'div[data-id]'
  ];

  const titleSelectors = [
    'div.KzDlHZ',
    'div._4rR01T',
    'a.IRpwTa',
    'a.WKTcLC',
    'a.s1Q9rs',
    'div._2WkVRV',
    'a[title]'
  ];

  const priceSelectors = [
    'div.Nx9bqj',
    'div._30jeq3._1_WHN1',
    'div._30jeq3',
    'div._25b18c div.Nx9bqj',
    'div._25b18c div._30jeq3'
  ];

  const cards = Array.from(document.querySelectorAll(cardSelectors.join(',')));

  function getAbsUrl(href) {
    if (!href) return '';
    try {
      return new URL(href, location.href).toString();
    } catch {
      return href;
    }
  }

  for (const card of cards) {
    if (products.length >= limit) break;

    const link =
      card.querySelector('a._1fQZEK') ||
      card.querySelector('a._2rpwqI') ||
      card.querySelector('a[href*="/p/"]') ||
      card.querySelector('a[href*="pid="]');

    const url = getAbsUrl(link?.href || '');
    if (!url) continue;
    if (url.includes('login') || url.includes('accounts')) continue;

    const urlKey = url.split('#')[0].split('?')[0];
    if (seen.has(urlKey)) continue;

    // title
    let title = '';
    for (const sel of titleSelectors) {
      const el = card.querySelector(sel);
      if (!el) continue;
      title = (el.getAttribute('title') || el.textContent || '').trim();
      if (title) break;
    }
    if (!title) title = (link?.getAttribute('title') || link?.textContent || '').trim();

    // price
    let priceText = '';
    for (const sel of priceSelectors) {
      const el = card.querySelector(sel);
      if (!el) continue;
      priceText = (el.textContent || '').trim();
      if (priceText) break;
    }

    // Extra fallback: Flipkart frequently changes price containers.
    // If no element matched, try to regex a ₹ price from the visible text.
    if (!priceText) {
      const txt = (card.innerText || '').replace(/\s+/g, ' ').trim();
      // Match "₹1,299" or "₹ 1,299" (ignore optional decimals)
      const m = txt.match(/₹\s?[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?/);
      if (m && m[0]) priceText = m[0].trim();
    }

    if (!title) continue;
    // Keep visible formatting for UI; backend can handle plain strings.
    const price = priceText || '';

    seen.add(urlKey);
    products.push({ title, price, url });
  }

  // Fallback for pages where cards are not detected: scan product anchors
  if (products.length === 0) {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="pid="]'));
    for (const a of anchors) {
      if (products.length >= limit) break;
      const url = getAbsUrl(a.href);
      if (!url) continue;
      if (url.includes('login') || url.includes('accounts')) continue;
      const urlKey = url.split('#')[0].split('?')[0];
      if (seen.has(urlKey)) continue;

      const card = a.closest('div._2kHMtA, div.slAVV4, div._13oc-S, div._1AtVbE, div') || a;
      const title = (a.getAttribute('title') || card.querySelector('div.KzDlHZ, div._4rR01T, a.s1Q9rs, a.IRpwTa, a.WKTcLC')?.textContent || a.textContent || '').trim();
      const price = (card.querySelector('div.Nx9bqj, div._30jeq3')?.textContent || '').trim();
      if (!title) continue;

      seen.add(urlKey);
      products.push({ title, price, url });
    }
  }

  return products.slice(0, limit);
}

function scrapeAmazon() {
  const products = [];
  const seen = new Set();

  document
    .querySelectorAll('[data-component-type="s-search-result"]')
    .forEach(card => {
      const link = card.querySelector("h2 a");
      const title = link?.querySelector("span")?.innerText?.trim() || link?.innerText?.trim();
      const url = link?.href;
      const price = card.querySelector(".a-price .a-offscreen")?.innerText?.trim() || "";

      if (!title || !url) return;
      const key = (url || "").split("#")[0].split("?")[0];
      if (seen.has(key)) return;
      seen.add(key);

      products.push({ title, price, url });
    });

  return products.slice(0, 10);
}
function scrapeFlipkart() {
  console.log("[GreenChoice] Running Flipkart scraper…");
  const products = collectFlipkartProducts({ limit: 10 });
  console.log("[GreenChoice] Flipkart scraped:", products);
  return products;
}
function scrapeMyntra() {
  console.log("[GreenChoice] Running Myntra scraper…");
  const products = [];
  const seen = new Set();

  // Common Myntra search result containers
  const cardSelectors = [
    "li.product-base",
    "li.results-base",
    "div.search-searchProducts > section > ul > li",
    "ul.results-base li"
  ];

  const cards = document.querySelectorAll(cardSelectors.join(","));

  cards.forEach(card => {
    try {
      const link = card.querySelector("a[href*='/buy/'], a[href*='/']");

      if (!link) return;

      const url = link.href.split("?")[0];

      if (seen.has(url)) return;

      // brand
      const brand =
        card.querySelector(".product-brand")?.innerText?.trim() ||
        card.querySelector("[class*='Brand']")?.innerText?.trim() ||
        "";

      // product title
      const name =
        card.querySelector(".product-product")?.innerText?.trim() ||
        card.querySelector("[class*='ProductName']")?.innerText?.trim() ||
        "";

      const title = `${brand} ${name}`.trim();

      if (!title || title.length < 5) return;

      // price
      let price =
        card.querySelector(".product-discountedPrice")?.innerText?.trim() ||
        card.querySelector(".product-price")?.innerText?.trim() ||
        "";

      if (!price) {
        // Regex fallback
        const m = (card.innerText || "").match(/₹\s?[0-9,]+/);
        price = m ? m[0] : "";
      }

      // image
      const img =
        card.querySelector("img")?.src ||
        card.querySelector("source")?.srcset?.split(" ")[0] ||
        "";

      seen.add(url);

      products.push({
        title,
        price,
        url,
        image: img,
        platform: "myntra"
      });
    } catch (err) {
      console.warn("Myntra parse error:", err);
    }
  });

  console.log("[GreenChoice] Myntra scraped:", products);
  return products.slice(0, 20);
}

window.scrapeFlipkart = scrapeFlipkart;

function scrapeMeesho() {
  const products = [];
  const seen = new Set();

  // Grab product links
  const links = document.querySelectorAll('a[href*="/p/"]');
  for (const link of links) {
    const url = normalizeUrl(link.href);
    const card = link.closest('div') || link.parentElement || document;

    // title
    let title =
      link.getAttribute('aria-label')?.trim() ||
      link.getAttribute('title')?.trim() ||
      '';
    if (!title) {
      const txt = (card.innerText || '').split("\n").map(s=>s.trim()).filter(Boolean);
      const cleaned = txt.filter(s => !/^₹\s*\d/.test(s) && s.length > 6 && s.length < 140);
      title = cleaned.sort((a,b)=>b.length-a.length)[0] || '';
    }
    if (!title || title.length < 10) continue;

    // price
    let price = '';
    const m = (card.innerText || '').match(/₹\s*([0-9][0-9,]*)/);
    if (m) price = m[1].replace(/,/g, '');

    const key = (title + "|" + url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    products.push({ title, price, url });
    if (products.length >= 10) break;
  }

  return products;
}
window.scrapeMeesho = scrapeMeesho;

window.scrapeAmazon = scrapeAmazon;
window.scrapeMyntra = scrapeMyntra;
window.scrapeMeesho = scrapeMeesho;
})();   // <--- required
