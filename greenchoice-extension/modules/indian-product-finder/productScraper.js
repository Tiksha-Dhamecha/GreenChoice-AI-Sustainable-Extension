(() => {
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toAbsoluteUrl(url, base) {
    try {
      return new URL(url, base).toString();
    } catch (_) {
      return url || "";
    }
  }

  function pickFirst(obj, keys) {
    for (const key of keys) {
      const v = obj[key];
      if (v) return v;
    }
    return "";
  }

  function collectKeyValueMap(doc) {
    const map = {};

    const tableRows = doc.querySelectorAll("tr");
    tableRows.forEach((row) => {
      const cells = row.querySelectorAll("th, td");
      if (cells.length < 2) return;
      const key = normalizeText(cells[0].textContent).toLowerCase();
      const val = normalizeText(cells[1].textContent);
      if (key && val && !map[key]) map[key] = val;
    });

    const dtNodes = doc.querySelectorAll("dt");
    dtNodes.forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (!dd || dd.tagName.toLowerCase() !== "dd") return;
      const key = normalizeText(dt.textContent).toLowerCase();
      const val = normalizeText(dd.textContent);
      if (key && val && !map[key]) map[key] = val;
    });

    const lines = normalizeText(doc.body?.innerText || "").split(/[\n\r]+/);
    lines.forEach((line) => {
      const parts = line.split(":");
      if (parts.length < 2) return;
      const key = normalizeText(parts[0]).toLowerCase();
      const val = normalizeText(parts.slice(1).join(":"));
      if (key.length < 3 || val.length < 2 || key.length > 120) return;
      if (!map[key]) map[key] = val;
    });

    return map;
  }

  function collectSectionText(doc, selectors) {
    return selectors
      .map((sel) => normalizeText(doc.querySelector(sel)?.textContent || ""))
      .filter(Boolean)
      .join("\n");
  }

  function parseProductDocument(doc, url) {
    const kv = collectKeyValueMap(doc);
    const detailsText = collectSectionText(doc, [
      "#detailBullets_feature_div",
      "#productDetails_techSpec_section_1",
      "#prodDetails",
      ".x1xHJI",
      "._1M57hN",
      ".pdp-product-description-content",
      ".index-productDetails",
      ".product-specification",
      ".product-details",
      ".technical-details",
      ".additional-information"
    ]);

    const productName = normalizeText(
      doc.querySelector("#productTitle")?.textContent ||
      doc.querySelector("span.B_NuCI")?.textContent ||
      doc.querySelector(".pdp-title")?.textContent ||
      doc.querySelector("h1")?.textContent ||
      doc.title
    );

    const price = normalizeText(
      doc.querySelector(".a-price .a-offscreen")?.textContent ||
      doc.querySelector("._30jeq3")?.textContent ||
      doc.querySelector(".pdp-price strong, .pdp-price")?.textContent ||
      doc.querySelector('[data-testid="product-price"]')?.textContent ||
      ""
    );

    const image = toAbsoluteUrl(
      doc.querySelector("#landingImage")?.getAttribute("src") ||
      doc.querySelector("img._396cs4")?.getAttribute("src") ||
      doc.querySelector(".image-grid-image img, .pdp-image img, .pdp-image")?.getAttribute("src") ||
      doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      "",
      url
    );

    const description = normalizeText(
      doc.querySelector("#feature-bullets")?.textContent ||
      doc.querySelector('[data-testid="product-description"]')?.textContent ||
      doc.querySelector(".pdp-product-description-content")?.textContent ||
      doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
      ""
    );

    return {
      productName,
      price,
      brand: pickFirst(kv, ["brand", "brand name"]),
      manufacturer: pickFirst(kv, ["manufacturer", "manufactured by"]),
      manufacturerAddress: pickFirst(kv, ["manufacturer address", "address", "manufacturing address"]),
      countryOfOrigin: pickFirst(kv, ["country of origin", "origin"]),
      material: pickFirst(kv, ["material", "material type", "fabric", "primary material"]),
      packaging: pickFirst(kv, ["packaging", "packaging type", "packaging details"]),
      marketedBy: pickFirst(kv, ["marketed by"]),
      importedBy: pickFirst(kv, ["imported by"]),
      sellerLocation: pickFirst(kv, ["seller location", "sold by"]),
      description,
      image,
      link: url,
      productDetailsText: detailsText,
      technicalDetails: detailsText,
      additionalInformation: detailsText
    };
  }

  async function fetchAndParseProduct(url) {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error("Failed to fetch product page");
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseProductDocument(doc, url);
  }

  function createScraper(sendMessageFn) {
    const memoryCache = new Map();

    async function getCachedOrFetch(url) {
      const now = Date.now();
      const existing = memoryCache.get(url);
      if (existing && now - existing.ts < CACHE_TTL_MS) {
        return existing.data;
      }

      const data = await fetchAndParseProduct(url);
      memoryCache.set(url, { ts: now, data });
      return data;
    }

    async function scrapeCurrentProduct(tabId) {
      return new Promise((resolve) => {
        sendMessageFn(tabId, { action: "getIndianFinderProductDetails" }, (res, err) => {
          if (err || !res) return resolve(null);
          resolve(res);
        });
      });
    }

    async function scrapeAlternatives(alternatives, currentUrl) {
      const unique = [];
      const seen = new Set();
      (alternatives || []).forEach((item) => {
        const url = toAbsoluteUrl(item?.url || "", currentUrl);
        if (!url || seen.has(url) || url === currentUrl) return;
        seen.add(url);
        unique.push({
          productName: normalizeText(item.title || item.name || ""),
          price: normalizeText(item.price || ""),
          link: url
        });
      });

      const top = unique.slice(0, 8);
      const out = [];
      for (const item of top) {
        try {
          const details = await getCachedOrFetch(item.link);
          out.push({
            ...details,
            productName: details.productName || item.productName,
            price: details.price || item.price,
            link: item.link
          });
        } catch (_) {
          out.push(item);
        }
      }
      return out;
    }

    return {
      scrapeCurrentProduct,
      scrapeAlternatives
    };
  }

  window.GreenChoiceIndianProductScraper = {
    createScraper
  };
})();
