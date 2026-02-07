// popup.js
const API_BASE = "http://localhost:5000";
async function classifyAI(title, breadcrumb, description) {
  try {
    const resp = await fetch(API_BASE + "/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || "",
        breadcrumb: breadcrumb || "",
        description: description || ""
      })
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch (e) {
    console.warn("[popup] classifyAI failed, fallback used", e);
    return { category: "unknown", gender: "unisex" };
  }
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

// ---------------- SAFE CONTENT-SCRIPT MESSAGING ----------------
function isConnectionError(msg) {
  const m = String(msg || '');
  return (
    m.includes('Receiving end does not exist') ||
    m.includes('Could not establish connection') ||
    m.includes('The message port closed')
  );
}

function injectContentScript(tabId, cb) {
  try {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        if (chrome.runtime.lastError) return cb(chrome.runtime.lastError.message);
        cb(null);
      }
    );
  } catch (e) {
    cb(e?.message || String(e));
  }
}

function sendMessageSafe(tabId, message, cb, opts = {}) {
  const retries = typeof opts.retries === 'number' ? opts.retries : 1;
  const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 250;

  chrome.tabs.sendMessage(tabId, message, (res) => {
    const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
    if (!errMsg) return cb(res, null);

    // Only auto-inject when the content script isn't present
    if (!isConnectionError(errMsg) || retries <= 0) return cb(null, errMsg);

    injectContentScript(tabId, (injErr) => {
      if (injErr) return cb(null, injErr);
      setTimeout(() => {
        sendMessageSafe(tabId, message, cb, { retries: retries - 1, delayMs });
      }, delayMs);
    });
  });
}

function sendMessagePromise(tabId, message, opts = {}) {
  return new Promise((resolve) => {
    sendMessageSafe(tabId, message, (res, err) => {
      if (err) {
        console.warn('[popup] sendMessage failed:', err, message);
        return resolve(null);
      }
      resolve(res);
    }, opts);
  });
}

function sendHighlightToTab(tabId, best) {
  if (!best) return;

  sendMessageSafe(
    tabId,
    {
      action: 'highlightBestProduct',
      best: {
        name: best.name || best.title || '',
        title: best.title || best.name || '',
        url: best.url || '',
        price: best.price || ''
      }
    },
    () => { },
    { retries: 1 }
  );
}


// ---------- MAIN: ANALYZE CURRENT PRODUCT ----------

async function analyzeProduct() {
  console.log('[popup] analyzeProduct clicked');
  setStatus('Extracting product info...');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('alternativesBox').classList.add('hidden');
  document.getElementById('bestProduct').textContent = '';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log('[popup] sending getProductData to tab', tabs[0]?.id);

    sendMessageSafe(
      tabs[0].id,
      { action: 'getProductData' },
      async (productData, err) => {
        if (err) {
          console.warn('[popup] getProductData error:', err);
          setStatus('This page is not supported by GreenChoice.');
          return;
        }

        console.log('[popup] getProductData response:', productData);

        if (!productData) {
          setStatus('Could not extract product data.');
          return;
        }

        setStatus('Analyzing product (AI)...');

        // product image
        if (productData.img && productData.img.length > 5) {
          document.getElementById('productImg').src = productData.img;
        } else {
          // Inline fallback image to avoid net::ERR_FILE_NOT_FOUND
          document.getElementById('productImg').src =
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='100%25' height='100%25' fill='%23f2f2f2'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-family='Arial' font-size='22'>No Image</text></svg>";
        }

        try {
          const resp = await fetch(API_BASE + '/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: productData.url || '',
              title: productData.title || '',
              description: productData.description || ''
            })
          });
          console.log('[popup] /analyze status:', resp.status);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);

          const data = await resp.json();
          console.log('[popup] /analyze data:', data);
          displayResult(data, productData);
          setStatus('');
        } catch (err) {
          console.error('[popup] analyzeProduct fetch error:', err);
          setStatus('Analysis failed. Is backend running?');
        }
      }
    );
  });
}

function displayResult(data, productData) {
  document.getElementById('result').classList.remove('hidden');

  const scoreCircle = document.getElementById('scoreCircle');
  scoreCircle.className = 'score-circle';
  if (data.grade) scoreCircle.classList.add(data.grade);
  scoreCircle.textContent = data.grade || '-';

  document.getElementById('gradeText').textContent =
    'Grade: ' + (data.grade || '-');
  document.getElementById('numericText').textContent =
    'Score: ' + (data.numericScore != null ? data.numericScore : '-');
  document.getElementById('carbonText').textContent =
    'CO₂ est: ' + (data.carbonFootprintKg != null ? data.carbonFootprintKg + ' kg' : '-');
  document.getElementById('waterText').textContent =
    'Water est: ' + (data.waterUsageLiters != null ? data.waterUsageLiters + ' L' : '-');
  document.getElementById('explain').textContent = data.explanation || '';
  document.getElementById('materials').textContent =
    'Detected materials: ' +
    ((data.materials && data.materials.join) ? data.materials.join(', ') : 'None');



  // value ratio if price present
  const price = productData.price
    ? parseFloat(productData.price.replace(/[^0-9.]/g, ''))
    : null;
  if (price && data.numericScore != null) {
    const value = (data.numericScore / price) * 100;
    document.getElementById('valueRatio').textContent =
      'Value score: ' + value.toFixed(2) + ' per ₹100';
  } else {
    document.getElementById('valueRatio').textContent = '';
  }
}

// ALTERNATIVES (with links)
async function fetchAlternatives() {
  console.log('[popup] fetchAlternatives clicked');
  setStatus('Gathering alternatives on page...');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    sendMessageSafe(
      tabs[0].id,
      { action: 'getAlternatives' },
      async (products, err) => {
        if (err) {
          console.warn('[popup] getAlternatives error:', err);
          setStatus('This page is not supported by GreenChoice.');
          return;
        }

        console.log('[popup] getAlternatives response (objects):', products);

        if (!products || products.length === 0) {
          setStatus('No alternatives found on page.');
          return;
        }

        setStatus('Analyzing alternatives (AI)...');

        try {
          // send the full objects (title, url, price) to backend
          const resp = await fetch(API_BASE + '/alternatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products })
          });
          console.log('[popup] /alternatives status:', resp.status);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);

          const data = await resp.json();
          console.log('[popup] /alternatives data:', data);
          showAlternatives(data.alternatives);
          setStatus('');
        } catch (err) {
          console.error('[popup] fetchAlternatives error:', err);
          setStatus('Alternatives analysis failed.');
        }
      }
    );
  });
}

//BEST PRODUCT

// Product-page best: current product + alternatives
function showAlternatives(alts) {
  const list = document.getElementById('alternativesList');
  list.innerHTML = '';

  if (!alts || alts.length === 0) {
    document.getElementById('alternativesBox').classList.add('hidden');
    return;
  }

  const BAD_PATTERNS = [
    /Your Recommendations/i,
    /Recommended/i,
    /FREE Delivery/i,
    /Sign up/i,
    /returns policy/i,
    /cashback/i,
    /discount/i,
    /coupon/i,
    /^\s*00\b/,
    /^\s*\(₹/i,
    /^\s*[₹0-9]/,
    /^[0-9]+\s*(months?|days?)\b/i
  ];

  function looksLikeProduct(name) {
    if (!name) return false;
    name = name.trim();
    if (name.length < 20) return false;
    if (name.split(/\s+/).length < 3) return false;
    if (BAD_PATTERNS.some(re => re.test(name))) return false;
    return true;
  }

  const cleaned = alts.filter(a => looksLikeProduct(a.name));

  if (cleaned.length === 0) {
    document.getElementById('alternativesBox').classList.add('hidden');
    return;
  }

  document.getElementById('alternativesBox').classList.remove('hidden');

  cleaned.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML =
      `<strong>${a.grade || '-'}</strong> • ${a.numericScore} ⭐<br>
       <span style="font-size:13px">${a.name}</span>` +
      (a.price ? `<br><span style="font-size:12px">${a.price}</span>` : '') +
      (a.url ? `<br><a href="${a.url}" target="_blank">View product</a>` : '');
    list.appendChild(li);
  });
}

//  SHOW COST + SUSTAINABILITY COMPARISON
function showCompare(results) {
  const container = document.getElementById("comparisonBox");
  if (!container) return;

  container.classList.remove("hidden");

  container.innerHTML = `
    <table>
      <tr>
        <th>Product</th>
        <th>Price</th>
        <th>Sustainability</th>
        <th>Value Score</th>
      </tr>
      ${results
      .map(
        (r) => `
      <tr>
        <td>${r.name}</td>
        <td>${(r.rawPrice !== undefined && r.rawPrice !== null && String(r.rawPrice).trim() !== "") ? r.rawPrice : "-"}</td>
        <td>${r.numericScore ?? "-"}</td>
        <td>${(typeof r.valueScore === "number" ? (r.valueScore.toFixed(1) + "%") : (typeof r.valueIndex === "number" ? r.valueIndex.toFixed(4) : "-"))}</td>
      </tr>`
      )
      .join("")}
    </table>

    <canvas id="compareChart" width="280" height="200"></canvas>
  `;

  renderCompareChart(results);
}

//  BAR CHART: Value Index comparison

function renderCompareChart(results) {
  const canvas = document.getElementById("compareChart");
  if (!canvas) return;

  const labels = results.map((r) => r.name.slice(0, 18) + "…");
  const values = results.map((r) => (typeof r.valueScore === 'number' ? r.valueScore : r.valueIndex));

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Value Score (sustainability + price)",
          data: values,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: true },
      },
    },
  });
}

// Search-page best: uses searchResults; falls back to product-page
async function analyzeProductPageBest(tabId) {
  setStatus('Analyzing products on this page...');

  sendMessageSafe(
    tabId,
    { action: 'getProductData' },
    (productData, err) => {
      if (err || !productData) {
        console.warn('[popup] getProductData error (best on page):', err);
        setStatus('This page is not supported by GreenChoice.');
        return;
      }

      sendMessageSafe(
        tabId,
        { action: 'getAlternatives' },
        async (altProducts, err2) => {
          if (err2) {
            console.warn('[popup] getAlternatives error (best on page):', err2);
            setStatus('Could not read alternatives on this page.');
            return;
          }

          const alts = Array.isArray(altProducts) ? altProducts : [];

          // Build unified list: current product + alternatives
          const allProducts = [
            {
              title: productData.title || 'Current product',
              url: productData.url || '',
              price: productData.price || ''
            },
            ...alts
          ];

          try {
            const resp = await fetch(API_BASE + '/alternatives', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ products: allProducts })
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);

            const data = await resp.json();
            const scored = data.alternatives || [];

            if (!scored.length) {
              document.getElementById('bestProduct').textContent =
                'No best product found on this page.';
              setStatus('');
              return;
            }

            const best = scored[0];

            // Highlight best product card on the page
            sendHighlightToTab(tabId, best);


            // Determine if best is the current product by comparing title or URL
            const currentTitle = productData.title || 'Current product';
            const isCurrent =
              best.name === currentTitle ||
              (best.url && best.url === productData.url);

            let html = '';
            if (isCurrent) {
              html = `
                <strong>Best sustainable choice on this page:</strong><br>
                <span style="font-size:13px">${currentTitle}</span><br>
                Grade: <strong>${best.grade || '-'}</strong>,
                Score: ${best.numericScore ?? '-'}<br>
                ${productData.price ? `Price: ${productData.price}<br>` : ''}
                ${best.url ? `<a href="${best.url}" target="_blank">Open product</a><br>` : ''}
                This product is already the greenest option among the suggestions.
              `;
            } else {
              html = `
                <strong>Best sustainable choice among this and alternatives:</strong><br>
                <span style="font-size:13px">${best.name}</span><br>
                Grade: <strong>${best.grade || '-'}</strong>,
                Score: ${best.numericScore ?? '-'}<br>
                ${best.price ? `Price: ${best.price}<br>` : ''}
                ${best.url ? `<a href="${best.url}" target="_blank">Open product</a>` : ''}
              `;
            }

            document.getElementById('bestProduct').innerHTML = html;
            setStatus('');
          } catch (err) {
            console.error('[popup] analyzeProductPageBest error:', err);
            setStatus('Best-choice analysis failed.');
          }
        }
      );
    }
  );
}
// WIRE BUTTONS 
async function analyzeSearchResults() {
  console.log('[popup] analyzeSearchResults clicked');
  setStatus('Scanning search results on page...');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      console.warn('[popup] No active tab found.');
      setStatus('No active tab.');
      return;
    }

    sendMessageSafe(
      tabId,
      { action: 'searchProducts' },
      async (products, err) => {
        if (err) {
          console.warn('[popup] searchProducts error:', err);
          // fallback: analyze current product + alternatives
          return analyzeProductPageBest(tabId);
        }

        console.log('[popup] searchProducts response:', products);

        if (!products || products.length === 0) {
          // fallback: analyze current product + alternatives
          return analyzeProductPageBest(tabId);
        }

        setStatus('Analyzing search results (AI)...');

        try {
          // send full objects (title, url, price) to backend
          const resp = await fetch(API_BASE + '/alternatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);

          const data = await resp.json();
          console.log('[popup] /alternatives (search) data:', data);

          const scores = data.alternatives || [];

          // already sorted by backend, but we can trust that
          const best = scores[0];

          let bestHtml = '';
          if (best) {
            // tell the content script which product to highlight on the page
            sendHighlightToTab(tabId, best);

            bestHtml = `
              <strong>Best sustainable choice (from this page):</strong><br>
              <span style="font-size:13px">${best.name}</span><br>
              Grade: <strong>${best.grade || '-'}</strong>,
              Score: ${best.numericScore ?? '-'}<br>
              ${best.price ? `Price: ${best.price}<br>` : ''}
              ${best.url
                ? `<a href="${best.url}" target="_blank">Open product</a>`
                : ''}
            `;
          } else {
            bestHtml = 'No best product found.';
          }

          document.getElementById('bestProduct').innerHTML = bestHtml;
          setStatus('');
        } catch (err) {
          console.error('[popup] analyzeSearchResults error:', err);
          setStatus('Search analysis failed.');
        }
      }
    );
  });
}

async function compareProducts() {
  console.log("[popup] compareProducts clicked");

  setStatus("Extracting products for comparison...");

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return setStatus("No tab found.");

    const list = await sendMessagePromise(tabId, {
      action: "extractCompareProducts",
    }, { retries: 1 });

    let products = (list && list.products) || [];

    console.log("[popup] extracted for compare:", products);

    if (!products.length) return setStatus("No products detected.");

    // build safe structures for backend
    products = products.map(p => {
      // Prefer a numeric price if the content script already parsed it.
      const numericFromContent = (typeof p.price === "number" && isFinite(p.price) && p.price > 0)
        ? p.price
        : null;

      // Otherwise fall back to any visible string price.
      const raw = (p.priceRaw || p.rawPrice || p.priceText || p.price || "").toString().trim();
      const numericFromRaw = raw
        ? (Number(String(raw).replace(/[^\d.]/g, "")) || null)
        : null;

      const finalNum = numericFromContent || numericFromRaw;
      const finalRaw = raw || (finalNum ? `₹${Math.round(finalNum).toLocaleString("en-IN")}` : "");

      return {
        name: p.name,
        rawPrice: finalRaw,
        price: finalNum
      };
    });

    console.log("[popup] compare normalized payload:", products);

    setStatus("Comparing sustainability + price...");

    try {
      const resp = await fetch(API_BASE + "/compare_products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products }),
      });

      if (!resp.ok) throw new Error("HTTP " + resp.status);

      const data = await resp.json();
      console.log("[popup] compare result:", data);

      showCompare(data.ranked); // UI render

      const best = data.best;
      if (best) {
        sendMessageSafe(tabId, {
          action: "compareHighlight",
          bestName: best.name,
        }, () => { }, { retries: 1 });
      }

      setStatus("");

    } catch (err) {
      console.error("[popup] compareProducts error:", err);
      setStatus("Compare failed.");
    }
  });
}
async function scrapeSite(site, url, action) {
  const isMyntra = String(site || "").toLowerCase().includes("myntra");
  const hydrateDelayMs = isMyntra ? 4500 : 1800;
  const hardTimeoutMs = isMyntra ? 22000 : 15000;

  return new Promise((resolve) => {

    chrome.runtime.sendMessage({ action: "openHiddenTab", url }, (resp) => {

      const openedTabId =
        typeof resp === "number" ? resp : (resp && resp.tabId);

      if (!openedTabId) {
        console.warn("[popup] openHiddenTab failed for", site, resp);
        return resolve({ site, products: [] });
      }

      let done = false;

      // ---------- CLEANUP ALWAYS SAFE ----------
      function cleanup() {
        try { chrome.tabs.onUpdated.removeListener(listener); } catch { }
        try { chrome.runtime.sendMessage({ action: "closeTab", tabId: openedTabId }); } catch { }
        try { clearTimeout(timeout); } catch { }
      }

      // ---------- COMPLETE SAFELY ----------
      function finish(result) {
        if (done) return;
        done = true;
        cleanup();
        resolve(result);
      }

      // ---------- TIMEOUT ----------
      const timeout = setTimeout(() => {
        console.warn("[popup] scrapeSite timeout:", site, url);
        finish({ site, products: [] });
      }, hardTimeoutMs);

      // ---------- TAB UPDATE LISTENER ----------
      function listener(id, info) {
        if (id !== openedTabId) return;

        // Guard against multiple onUpdated fires
        if (done) return;

        if (info.status !== "complete") return;

        // stop further triggers immediately
        chrome.tabs.onUpdated.removeListener(listener);

        // give SPA sites time to hydrate DOM
        setTimeout(() => {

          // ---- MAIN SEND ----
          chrome.tabs.sendMessage(openedTabId, { action }, async (response) => {

            // --- first failure: content.js not ready / port closed ---
            if (chrome.runtime.lastError) {
              console.warn("[popup] sendMessage failed once:", chrome.runtime.lastError.message);

              try {
                await chrome.scripting.executeScript({
                  target: { tabId: openedTabId },
                  files: ["content.js"]
                });

                console.log("[popup] re-injected content.js, retrying…");

                // retry once after short wait
                return setTimeout(() => {
                  chrome.tabs.sendMessage(openedTabId, { action }, (response2) => {

                    if (chrome.runtime.lastError || !response2) {
                      console.warn("[popup] retry failed or empty result");
                      return finish({ site, products: [] });
                    }

                    // content.js returns an ARRAY (products), normalize to {site, products}
                    const normalized2 = Array.isArray(response2)
                      ? { site, products: response2 }
                      : (response2 && Array.isArray(response2.products))
                        ? { site, products: response2.products }
                        : { site, products: [] };

                    return finish(normalized2);
                  });
                }, 600);

              } catch (e) {
                console.warn("[popup] script inject failed", e);
                return finish({ site, products: [] });
              }
            }

            // --- success path ---
            if (!response) {
              console.warn("[popup] empty response");
              return finish({ site, products: [] });
            }

            // content.js returns an ARRAY (products), normalize to {site, products}
            const normalized = Array.isArray(response)
              ? { site, products: response }
              : (response && Array.isArray(response.products))
                ? { site, products: response.products }
                : { site, products: [] };

            // Myntra sometimes renders late even after status=complete; retry once if empty.
            if (isMyntra && (!normalized.products || normalized.products.length === 0)) {
              return setTimeout(() => {
                chrome.tabs.sendMessage(openedTabId, { action }, (resp2) => {
                  if (chrome.runtime.lastError || !resp2) {
                    return finish({ site, products: [] });
                  }
                  const normalized2 = Array.isArray(resp2)
                    ? { site, products: resp2 }
                    : (resp2 && Array.isArray(resp2.products))
                      ? { site, products: resp2.products }
                      : { site, products: [] };
                  return finish(normalized2);
                });
              }, 2500);
            }

            return finish(normalized);

          });

        }, hydrateDelayMs);
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}



// Build a short, robust query from a product title.
// Key goal: NEVER drop important category/gender words like "top" or "women".
function normalizeQuery(title) {
  const cleaned = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    // remove very noisy tokens, but keep gender words (men/women) because they matter
    .replace(/\b(nuc\d+|model|with|for|pack|combo|set|new|latest|assured)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned.split(" ").filter(Boolean);
  const out = [];
  const seen = new Set();

  // keep first ~8 meaningful unique tokens
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }

  // ensure common category keywords are present even if they appear later
  const mustKeep = [
    // apparel
    "top", "tops", "tshirt", "t-shirt", "tee", "shirt", "dress", "kurti", "saree", "jeans",
    "hoodie", "sweatshirt", "jacket", "blazer",

    // accessories
    "watch", "watches", "belt", "strap", "band", "handbag", "bag",

    // electronics
    "phone", "mobile", "smartphone", "laptop", "earbuds", "headphones", "earphone", "earphones"
  ];

  for (const kw of mustKeep) {
    if (tokens.includes(kw) && !out.includes(kw)) out.push(kw);
  }

  return out.slice(0, 12).join(" ").trim();
}

// Tokenize text for simple relevance matching (kept intentionally lightweight)
function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);
}

// ---------------- DEDUPE HELPERS ----------------
// Remove tracking params / hashes so the same product doesn't appear multiple times.
function normalizeUrlKey(u) {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return String(u).split("#")[0].split("?")[0];
  }
}

function dedupeScrapedProducts(list) {
  const out = [];
  const seen = new Set();
  for (const p of (Array.isArray(list) ? list : [])) {
    const urlKey = normalizeUrlKey(p?.url);
    const titleKey = (p?.title || p?.name || "").toLowerCase().trim();
    const key = urlKey || titleKey;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function dedupeScoredKeepBest(list) {
  const map = new Map();
  for (const p of (Array.isArray(list) ? list : [])) {
    const urlKey = normalizeUrlKey(p?.url);
    const titleKey = (p?.name || p?.title || "").toLowerCase().trim();
    const key = urlKey || (titleKey ? `${p?.site || ""}::${titleKey}` : "");
    if (!key) continue;

    const score = Number(p?.numericScore ?? p?.score ?? 0);
    const prev = map.get(key);
    const prevScore = Number(prev?.numericScore ?? prev?.score ?? -Infinity);

    if (!prev || score > prevScore) {
      map.set(key, p);
    }
  }
  return [...map.values()];
}
const SYNONYMS = {
  belt: ["strap", "band"],
  strap: ["belt", "band"],
  band: ["belt", "strap"],

  hoodie: ["sweatshirt"],
  sweatshirt: ["hoodie"],

  phone: ["mobile", "smartphone"],
  mobile: ["phone", "smartphone"],

  saree: ["sari"],
  sari: ["saree"],

  tshirt: ["tee", "t shirt", "t-shirt"],
  tee: ["tshirt", "t-shirt"],
};

function relevanceScore(queryTokens, title) {
  const titleTokens = new Set(tokenize(title));
  let hits = 0;

  for (const t of queryTokens) {
    if (t.length < 2) continue;

    // direct match
    if (titleTokens.has(t)) {
      hits++;
      continue;
    }

    // synonym match
    if (SYNONYMS[t]) {
      for (const syn of SYNONYMS[t]) {
        if (titleTokens.has(syn)) {
          hits++;
          break;
        }
      }
    }
  }

  return hits;
}

function filterRelevantProducts(products, baseTitle, opts = {}) {
  if (!Array.isArray(products) || products.length === 0) return [];

  const strict = !!opts.strict;

  // 1) Category-guard: if the base title clearly indicates a type (e.g., "top"),
  //    never accept results missing that type (prevents random shirts for watches, etc.)
  const baseTokens = tokenize(baseTitle);
  const mustHaveList = [
    // clothing tops
    "top", "tops", "tshirt", "tee", "shirt",
    "hoodie", "hoodies", "sweatshirt", "sweatshirts",
    "jacket", "jackets", "blazer", "coat",

    // ethnic
    "kurti", "kurtis", "kurta", "kurtas", "saree", "sari", "lehenga",

    // bottoms
    "jeans", "trouser", "trousers", "shorts", "skirt", "skirts", "palazzo", "leggings",

    // footwear
    "shoe", "shoes", "sneaker", "sneakers", "sandals", "heel", "heels", "flipflop", "flipflops",

    // accessories
    "watch", "watches", "bag", "bags", "belt", "belts", "wallet", "wallets",

    // electronics
    "phone", "mobile", "smartphone", "laptop", "earbuds", "headphones", "earphone", "earphones"
  ];
  // 1.b) Block obvious cross-category mismatches (hoodie vs shirt etc.)
  function isConflicting(baseTokens, titleTokens) {

    // hoodie vs shirt
    if ((baseTokens.includes("hoodie") || baseTokens.includes("sweatshirt")) &&
      titleTokens.includes("shirt"))
      return true;

    // kurti/kurta vs saree/lehenga
    if ((baseTokens.includes("kurti") || baseTokens.includes("kurta")) &&
      (titleTokens.includes("saree") || titleTokens.includes("lehenga")))
      return true;

    // footwear vs clothing
    if (baseTokens.includes("shoe") && titleTokens.includes("shirt"))
      return true;

    return false;
  }

  const mustHave = mustHaveList.find(w => baseTokens.includes(w)) || null;

  let pool = products;
  if (mustHave) {
    pool = products.filter(p => {
      const tks = tokenize(p?.title || p?.name || "");
      if (isConflicting(baseTokens, tks)) return false;
      return tks.includes(mustHave);
    });

    if (strict && pool.length === 0) return [];
    if (!strict && pool.length === 0) pool = products;
  }


  // 2) Token overlap ranking
  const q = normalizeQuery(baseTitle);
  const qTokens = tokenize(q);
  if (qTokens.length === 0) return strict ? [] : pool.slice(0, 12);

  let minHits = qTokens.length <= 3 ? 1 : 2;
  // clothing queries need a bit more overlap
  if (mustHave) {
    // require at least 2 overlaps for category-bound search
    if (minHits < 2) minHits = 2;
  }
  const ranked = pool
    .map(p => {
      const t = p?.title || p?.name || "";
      return { ...p, _rel: relevanceScore(qTokens, t) };
    })
    .sort((a, b) => (b._rel || 0) - (a._rel || 0));

  const filtered = ranked.filter(p => (p._rel || 0) >= minHits);

  // 3) IMPORTANT: If strict and nothing is relevant, return EMPTY (ignore that site)
  if (strict && filtered.length === 0) return [];

  const finalList = (filtered.length ? filtered : ranked)
    .slice(0, 12)
    .map(({ _rel, ...rest }) => rest);

  return finalList;
}
// Keywords used to keep cross-site suggestions on the same *type* of product.
// NOTE: backend /classify may return category names like "clothing_textiles" or "footwear".
// We include aliases here so filtering always works.
const CATEGORY_KEYWORDS = {
  watch: ["watch", "watches", "smartwatch", "wristwatch"],
  electronics: ["phone", "smartphone", "iphone", "android", "laptop", "notebook", "chromebook", "headphone", "earphone", "earbud", "headset", "smartwatch"],
  phone: ["phone", "smartphone", "iphone", "android"],
  laptop: ["laptop", "notebook", "chromebook"],
  headphones: ["headphone", "earphone", "earbud", "headset"],
  tv: ["television", "smart tv", "led tv"],
  refrigerator: ["fridge", "refrigerator"],
  ac: ["air conditioner", "ac"],
  washing_machine: ["washing machine", "washer"],

  // footwear aliases
  shoe: ["shoe", "shoes", "sneaker", "sneakers", "sports shoe", "slipper", "sandal", "sandals", "heels", "boot", "boots"],
  footwear: ["shoe", "shoes", "sneaker", "sneakers", "sports shoe", "slipper", "sandal", "sandals", "heels", "boot", "boots"],

  // general clothing aliases
  clothing: ["tshirt", "t-shirt", "tee", "shirt", "top", "tops", "kurti", "kurtis", "dress", "dresses", "jeans", "trouser", "trousers", "jacket", "hoodie", "sweater", "saree", "sari"],
  clothing_textiles: ["tshirt", "t-shirt", "tee", "shirt", "top", "tops", "kurti", "kurtis", "dress", "dresses", "jeans", "trouser", "trousers", "jacket", "hoodie", "sweater", "saree", "sari"],

  women_ethnic: [
    "saree", "sari", "lehenga", "ghagra", "chaniya", "salwar", "kameez",
    "anarkali", "dupatta", "kurti", "kurta set", "ethnic wear"
  ],

  accessories: ["bag", "backpack", "handbag", "purse", "wallet"],
  bag: ["bag", "backpack", "handbag", "purse", "wallet"],
  home_kitchen: ["towel", "bath towel", "bedsheet", "bed sheet", "duvet", "blanket", "bottle", "water bottle", "flask", "pan", "kadhai", "pressure cooker", "cookware"],
  beauty_personal_care: ["cream", "moisturizer", "serum", "lotion", "facewash", "face wash", "lipstick", "foundation", "eyeliner", "compact", "shampoo", "soap"],
  book: ["book", "novel", "paperback", "hardcover"],
  toy: ["toy", "doll", "lego", "puzzle", "game"]
};
function detectCategoryFromBreadcrumb(breadcrumbText) {
  breadcrumbText = (breadcrumbText || "").toLowerCase();

  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => breadcrumbText.includes(w))) {
      return cat;
    }
  }
  return "unknown";
}
function detectCategoryAndGender(title, breadcrumb) {

  title = (title || "").toLowerCase();
  breadcrumb = (breadcrumb || "").toLowerCase();

  // ⭐ Priority 1: women ethnic
  if (["saree", "sari", "lehenga", "kurti", "anarkali", "salwar", "ethnic"].some(w => title.includes(w) || breadcrumb.includes(w))) {
    return { category: "women_ethnic", gender: "female" };
  }

  // ⭐ Priority 2: other defined categories
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => title.includes(w) || breadcrumb.includes(w))) {
      return { category: cat, gender: guessGender(title + " " + breadcrumb) };
    }
  }

  return { category: "unknown", gender: "unisex" };
}
function guessGender(text) {
  text = text.toLowerCase();

  if (text.includes("women") || text.includes("womens") || text.includes("woman") || text.includes("lady") || text.includes("ladies") || text.includes("girl") || text.includes("girls") || text.includes("female"))
    return "female";

  if (text.includes("men") || text.includes("mens") || text.includes("man") || text.includes("boy") || text.includes("boys") || text.includes("male"))
    return "male";

  return "unisex";
}


function isGenderMatch(p, gender) {
  // IMPORTANT: be permissive.
  // Many listings don't explicitly say "women" / "men" in the *title*.
  // So we mainly *exclude the opposite gender* instead of requiring a positive match.
  if (!gender || gender === "unisex") return true;

  const title = (p?.title || p?.name || "").toLowerCase();
  const url = (p?.url || "").toLowerCase();
  const hay = `${title} ${url}`;

  const femaleSignals = ["women", "womens", "ladies", "lady", "girl", "girls", "female", "for women", "for ladies", "/women", "-women", "women-"];
  const maleSignals = ["men", "mens", "male", "boy", "boys", "for men", "/men", "-men", "men-"];

  const hasFemale = femaleSignals.some(s => hay.includes(s));
  const hasMale = maleSignals.some(s => hay.includes(s));

  if (gender === "female") {
    // reject explicit men listings, allow neutral listings
    if (hasMale && !hasFemale) return false;
    return true;
  }
  if (gender === "male") {
    // reject explicit women listings, allow neutral listings
    if (hasFemale && !hasMale) return false;
    return true;
  }
  return true;
}


function filterByCategoryAndGender(products, category, gender) {
  const catWords = CATEGORY_KEYWORDS[category] || [];
  const isApparelCategory = ["clothing", "clothing_textiles", "women_ethnic", "footwear", "shoe"].includes(category);

  let filtered = Array.isArray(products) ? products : [];

  // 1) If we know the category, keep only same-type products
  if (catWords.length) {
    filtered = filtered.filter(p => {
      const t = (p?.title || p?.name || "").toLowerCase();

      // must match category keywords
      const okCat = catWords.some(w => t.includes(w));
      if (!okCat) return false;

      // hard rule: women ethnic stays women ethnic
      if (category === "women_ethnic") {
        const okEthnic =
          (t.includes("saree") || t.includes("sari") || t.includes("kurti") || t.includes("anarkali") || t.includes("salwar") || t.includes("lehenga"));
        if (!okEthnic) return false;
      }

      return true;
    });
  }

  // 2) Apply gender filter even if category is unknown.
  // This prevents "female top" searches from silently accepting men's results when category detection fails.
  if (gender && gender !== "unisex" && (isApparelCategory || !catWords.length)) {
    filtered = filtered.filter(p => isGenderMatch(p, gender));

    // If gender filtering removes everything, it's safer to show nothing than wrong gender.
    if (filtered.length === 0) return [];
  }

  return filtered;
}

function filterMoreSustainable(products, baseScore) {
  return products.filter(p => {
    const s = Number(p.sustainabilityScore || p.score || 0);
    return s > baseScore;
  });
}
function makeSmartQuery(title, breadcrumb = "", category = "unknown", gender = "unisex") {
  const t = (title || "").toLowerCase();
  const b = (breadcrumb || "").toLowerCase();
  const text = `${t} ${b}`.trim();
  const tokens = tokenize(text);

  // Keep gender for clothing/footwear searches so results don't flip women→men (or vice-versa)
  const parts = [];
  if (gender === "female") parts.push("women");
  if (gender === "male") parts.push("men");

  // Prefer strong *phrases* first (helps home products like "key holder")
  const phrasePriority = [
    { re: /\bkey\s*(holder|hanger)\b/, q: "key holder" },
    { re: /\bshoe\s*rack\b/, q: "shoe rack" },
    { re: /\bwall\s*clock\b/, q: "wall clock" },
    { re: /\bwater\s*bottle\b/, q: "water bottle" },
    { re: /\bphone\s*(cover|case)\b|\bback\s*cover\b/, q: "phone case" },
    { re: /\bbedsheet\b|\bbed\s*sheet\b/, q: "bedsheet" },
    { re: /\bpillow\s*cover\b/, q: "pillow cover" }
  ];
  const phrase = phrasePriority.find(p => p.re.test(text));
  if (phrase) parts.push(phrase.q);

  // Choose a strong product-type keyword (prevents “similar pattern” but wrong product)
  const typePriority = [
    // apparel
    "top", "tops", "kurti", "kurtis", "dress", "dresses", "saree", "sari", "lehenga",
    "tshirt", "tee", "shirt", "jeans", "trouser", "trousers",
    // accessories
    "handbag", "bag", "backpack", "wallet",
    // electronics
    "watch", "watches", "smartwatch", "shoe", "shoes", "sneaker", "sneakers", "sandal", "sandals",
    "phone", "mobile", "laptop", "headphones", "earbuds",
    // home
    "holder", "hanger", "rack", "clock", "bottle", "bedsheet", "pillow", "curtain", "lamp", "vase"
  ];

  let typeWord = null;
  if (!phrase) {
    typeWord =
      typePriority.find(w => tokens.includes(w))
      || (category === "women_ethnic" ? "kurti" : null)
      || (category === "footwear" ? "shoes" : null)
      || (category === "home_kitchen" ? (tokens.includes("key") ? "key holder" : null) : null);
  }

  if (typeWord) parts.push(typeWord);

  // Add a few additional meaningful keywords from the title (material/style/brand) for relevance
  const stop = new Set([
    "for", "with", "pack", "combo", "set", "new", "latest", "assured", "solid", "printed", "regular", "fit",
    "casual", "formal", "fashion", "stylish", "women", "womens", "men", "mens", "girl", "girls", "boy", "boys",
    "premium", "original", "authentic", "inches", "inch", "cm", "mm", "pcs", "piece", "pieces", "design"
  ]);

  const extraCount = (category === "home_kitchen") ? 3 : 2;
  const extra = tokenize(t)
    .filter(w => w.length >= 4 && !stop.has(w) && !parts.includes(w))
    .slice(0, extraCount);

  parts.push(...extra);

  // Final guard: if query ends up too small, fall back to a compact normalized title
  const q = parts.filter(Boolean).join(" ").trim();
  return q.length >= 3 ? q : normalizeQuery(title);
}

function buildCleanQuery(title) {
  if (!title) return "";

  title = title.toLowerCase();

  // remove noisy marketing words
  const STOP = [
    "new", "latest", "combo", "set", "offer", "collection", "fashion",
    "printed", "stylish", "trendy", "with dupatta", "bottomwear", "for women", "for men"
  ];

  STOP.forEach(w => title = title.replaceAll(w, " "));

  // keep meaningful product category terms
  const KEEP = [
    "kurti", "kurta", "dress", "gown", "lehenga", "saree",
    "shirt", "tshirt", "top", "jeans", "blouse", "dupatta"
  ];

  let tokens = title.split(/\s+/).filter(t => KEEP.includes(t));

  // fallback: take first 3 words
  if (tokens.length === 0)
    tokens = title.split(/\s+/).slice(0, 3);

  return tokens.join(" ").trim();
}

async function fetchCrossSiteResults(queryTitle, breadcrumb, category, gender) {
  console.log("[popup] fetchCrossSiteResults for:", queryTitle);

  // build category-aware short query (includes gender for clothing)
  const smart = makeSmartQuery(queryTitle, breadcrumb || "", category || "unknown", gender || "unisex");
  const q = encodeURIComponent(smart);
  const myntraClean = encodeURIComponent(
    buildCleanQuery(queryTitle || smart))
  // URLs for search pages
  const SITES = [
    {
      name: "Amazon",
      url: `https://www.amazon.in/s?k=${q}`,
      action: "scrapeAmazonResults"
    },
    {
      name: "Flipkart",
      url: `https://www.flipkart.com/search?q=${q}`,
      action: "scrapeFlipkartResults"
    }
  ];

  // Always attempt Myntra. If it's irrelevant or empty, later filters will drop it.
  // build Myntra-specific query from smart (NOT full noisy title)
  const myntraQuery = encodeURIComponent(
    buildCleanQuery(smart)
  );

  SITES.push({
    name: "Myntra",
    url: `https://www.myntra.com/search?q=${myntraQuery}`,
    action: "scrapeMyntraResults"
  });

  SITES.push({
    name: "Meesho",
    url: `https://www.meesho.com/search?q=${q}`,
    action: "scrapeMeeshoResults"
  });

  // scrapeSite() already exists in your file — we reuse it
  const results = [];

  for (const site of SITES) {
    try {
      const data = await scrapeSite(site.name, site.url, site.action);
      results.push(data);
    } catch (e) {
      console.warn("[popup] fetchCrossSiteResults failed for", site.name, e);
      results.push({ site: site.name, products: [] });
    }
  }

  return results;
}


async function compareAcrossSites() {
  setStatus("Comparing across sites...");

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {

    const productData = await sendMessagePromise(
      tabs[0].id,
      { action: "getProductData" }
    );

    const title = productData?.title || "";
    const breadcrumb = productData?.breadcrumb || "";

    // 1) Detect category/gender
    const ai = await classifyAI(
      productData?.title,
      productData?.breadcrumb,
      productData?.description
    );

    let category = ai?.category || "unknown";
    let gender = ai?.gender || "unisex";

    // If backend returns a category name we don't recognize, fall back to local detection
    if (!CATEGORY_KEYWORDS[category]) {
      const local = detectCategoryAndGender(title, breadcrumb);
      if (CATEGORY_KEYWORDS[local.category]) category = local.category;
      if (gender === "unisex" && local.gender !== "unisex") gender = local.gender;
    }

    // last fallback: breadcrumb-only
    if (!CATEGORY_KEYWORDS[category]) {
      const fromBread = detectCategoryFromBreadcrumb(breadcrumb);
      if (CATEGORY_KEYWORDS[fromBread]) category = fromBread;
    }

    console.log("[popup] classify resolved:", category, gender);

    if (category === "unknown" || !CATEGORY_KEYWORDS[category]) {
      setStatus("Could not confidently detect product category.");
      return;
    }

    // 2) Scrape candidates across sites (query includes gender + type words)
    //    We'll also reuse this smart query for relevance filtering (more stable than a long product title).
    const smartBase = makeSmartQuery(title, breadcrumb || "", category || "unknown", gender || "unisex");
    const results = await fetchCrossSiteResults(title, breadcrumb, category, gender);

    // 3) Filter + score per-site using backend (so we get numericScore/grade)
    let scoredAll = [];

    for (const site of results) {
      const siteName = site.site || site.name || "Unknown";
      let prods = Array.isArray(site.products) ? site.products : [];

      // attach site for UI + remove duplicates (Flipkart often repeats the same card)
      prods = dedupeScrapedProducts(prods).map(p => ({ ...p, site: siteName }));

      prods = filterByCategoryAndGender(prods, category, gender);

      // Myntra is more sensitive; try strict first, then fall back to non-strict
      const isMyntra = siteName.toLowerCase().includes("myntra");
      let rel = filterRelevantProducts(prods, smartBase, { strict: isMyntra });
      if (isMyntra && rel.length === 0 && prods.length > 0) {
        rel = filterRelevantProducts(prods, smartBase, { strict: false });
      }
      prods = rel;

      if (!prods.length) continue;

      const scored = await scoreProductsWithBackend(prods.slice(0, 8));
      scoredAll.push(...scored.map(s => ({ ...s, site: siteName })));
    }

    if (!scoredAll.length) {
      setStatus("No relevant alternatives found across sites.");
      return;
    }

    // 4) Remove duplicates again (backend can echo duplicates), then pick best overall
    scoredAll = dedupeScoredKeepBest(scoredAll);
    scoredAll.sort((a, b) => Number(b.numericScore || 0) - Number(a.numericScore || 0));
    renderCrossSiteResults(scoredAll.slice(0, 5));
    setStatus("Comparison complete.");
  });
}
function buildSearchQuery(title) {
  if (!title) return "";

  title = title.toLowerCase();

  // remove junk marketing words
  const STOP_WORDS = [
    "new", "latest", "set", "combo", "offer", "no bottomwear",
    "printed", "stylish", "fashion", "trendy", "collection",
    "pure", "premium", "fabric", "for women", "for men"
  ];

  STOP_WORDS.forEach(w => {
    title = title.replaceAll(w, " ");
  });

  // keep important category words only
  const KEEP = [
    "kurti", "kurta", "saree", "lehenga", "shirt", "top",
    "dress", "jeans", "tshirt", "blouse", "dupattas"
  ];

  let tokens = title.split(/\s+/).filter(t => KEEP.includes(t));

  if (tokens.length === 0) tokens = title.split(/\s+/).slice(0, 3);

  return tokens.join(" ").trim();
}


// Score products using backend /alternatives (adds numericScore + grade)
async function scoreProductsWithBackend(products) {
  const payload = (products || []).map(p => ({
    title: p.title || p.name || "",
    url: p.url || "",
    price: p.price || ""
  })).filter(p => p.title);

  if (payload.length === 0) return [];

  try {
    const resp = await fetch(API_BASE + "/alternatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: payload })
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    return Array.isArray(data.alternatives) ? data.alternatives : [];
  } catch (err) {
    console.error("[popup] scoreProductsWithBackend failed", err);
    return [];
  }
}

async function findBestSustainable(siteName, products) {
  if (!Array.isArray(products) || products.length === 0) return null;

  // Normalize payload for backend
  const payload = products.map(p => ({
    name: p.title || p.name || "",
    url: p.url || "",
    price: p.price || ""
  })).filter(p => p.name);

  if (payload.length === 0) return null;

  try {
    const resp = await fetch(API_BASE + "/alternatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: payload })
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const scored = data.alternatives || [];

    if (!scored.length) return null;

    const best = scored[0]; // backend already sorts best-first

    return {
      site: siteName,
      name: best.name,
      grade: best.grade,
      numericScore: best.numericScore,
      price: best.price || "",
      url: best.url || ""
    };

  } catch (err) {
    console.error(`[popup] findBestSustainable failed for ${siteName}`, err);
    return null;
  }
}

function renderCrossSiteResults(results) {
  const box = document.getElementById("crossSiteResults");
  const cards = document.getElementById("crossSiteCards");

  if (!box || !cards) {
    console.warn("[popup] cross-site UI containers missing");
    return;
  }

  // Clear old results
  cards.innerHTML = "";

  if (!Array.isArray(results) || results.length === 0) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  results.forEach((r) => {
    const div = document.createElement("div");
    div.className = "site-card";

    div.innerHTML = `
      <strong>${r.site}</strong><br>
      <span style="font-size:13px">${r.name || r.title || "Unknown product"}</span><br>
      Grade: <strong>${r.grade || "-"}</strong>,
      Score: ${r.numericScore ?? "-"}<br>
      ${r.price ? `Price: ${r.price}<br>` : ""}
      ${r.url ? `<a href="${r.url}" target="_blank">View product</a>` : ""}
    `;

    cards.appendChild(div);
  });
}

// ---------------- BUTTON VISIBILITY (single vs multi product page) ----------------
function setElHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.classList.add('hidden');
  else el.classList.remove('hidden');
}

function applyActionButtonMode(ctx) {
  const checkBtn = document.getElementById('checkBtn');
  const altsBtn = document.getElementById('altsBtn');
  const searchBestBtn = document.getElementById('searchBestBtn');
  const compareBtn = document.getElementById('compareBtn');
  const compareAcrossSitesBtn = document.getElementById('compareAcrossSitesBtn');

  const mode = ctx && ctx.mode ? String(ctx.mode) : '';
  const isMulti = mode === 'multi';
  const isSingle = mode === 'single';

  // Multi-product listing page => highlight + cost/sustainability
  if (isMulti) {
    setElHidden(searchBestBtn, false);
    setElHidden(compareBtn, false);

    setElHidden(checkBtn, true);
    setElHidden(altsBtn, true);
    setElHidden(compareAcrossSitesBtn, true);
    return;
  }

  // Single product detail page => analyze + alternatives + compare across sites
  if (isSingle) {
    setElHidden(checkBtn, false);
    setElHidden(altsBtn, false);
    setElHidden(compareAcrossSitesBtn, false);

    setElHidden(searchBestBtn, true);
    setElHidden(compareBtn, true);
    return;
  }

  // Fallback: show everything
  setElHidden(checkBtn, false);
  setElHidden(altsBtn, false);
  setElHidden(searchBestBtn, false);
  setElHidden(compareBtn, false);
  setElHidden(compareAcrossSitesBtn, false);
}

async function initActionButtonsVisibility() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (!tabId) return;

      // default to single while loading
      applyActionButtonMode({ mode: 'single' });

      const ctx = await sendMessagePromise(tabId, { action: 'getPageContext' }, { retries: 1 });
      applyActionButtonMode(ctx);
    });
  } catch (e) {
    console.warn('[popup] initActionButtonsVisibility failed', e);
  }
}





/* -----------------------------------------
   STREAK & USER IDENTITY
------------------------------------------*/
async function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get("greenchoice_user_id", (items) => {
      let uid = items.greenchoice_user_id;
      if (!uid) {
        uid = "user_" + Math.random().toString(36).substr(2, 9);
        chrome.storage.local.set({ greenchoice_user_id: uid });
      }
      resolve(uid);
    });
  });
}

async function fetchStreak() {
  const userId = await getUserId();
  try {
    const resp = await fetch(API_BASE + "/user_streak?user_id=" + userId);
    if (resp.ok) {
      const data = await resp.json();
      const countEl = document.getElementById("streakCount");
      const credsEl = document.getElementById("carbonCredits");
      if (countEl) countEl.textContent = data.current_streak || 0;
      if (credsEl) credsEl.textContent = (data.total_credits || 0).toFixed(1);
    }
  } catch (e) {
    console.warn("Failed to fetch streak", e);
  }
}

// Listen for updates from background while popup is open
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "streakUpdated" && req.data) {
    const d = req.data;
    const countEl = document.getElementById("streakCount");
    const credsEl = document.getElementById("carbonCredits");
    if (countEl) countEl.textContent = d.current_streak || 0;
    if (credsEl) credsEl.textContent = (d.total_credits || 0).toFixed(1);

    // Animate/highlight if updated
    const sec = document.getElementById("streakSection");
    if (sec) {
      sec.style.transition = "background-color 0.5s ease";
      sec.style.backgroundColor = "#dcfce7"; // flash green
      setTimeout(() => sec.style.backgroundColor = "#f0fdf4", 500);
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup] DOMContentLoaded, wiring buttons');

  // Decide which buttons to show based on the current page
  initActionButtonsVisibility();
  fetchStreak();

  const checkBtn = document.getElementById('checkBtn');
  const altsBtn = document.getElementById('altsBtn');
  const searchBestBtn = document.getElementById('searchBestBtn');

  if (checkBtn) checkBtn.addEventListener('click', analyzeProduct);
  if (altsBtn) altsBtn.addEventListener('click', fetchAlternatives);
  if (searchBestBtn) searchBestBtn.addEventListener('click', analyzeSearchResults);
  const compareBtn = document.getElementById("compareBtn");
  if (compareBtn) compareBtn.addEventListener("click", compareProducts);
  const compareAcrossSitesBtn =
    document.getElementById("compareAcrossSitesBtn");

  if (compareAcrossSitesBtn) {
    compareAcrossSitesBtn.addEventListener("click", compareAcrossSites);
  }



});
