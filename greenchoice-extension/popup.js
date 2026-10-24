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

function statusKind(msg) {
  const text = String(msg || '').trim();
  if (/(\.\.\.|…)$/.test(text)) return 'loading';
  if (/^no\b|not found|could not be highlighted|not listed/i.test(text)) return 'warning';
  if (/fail|error|not supported|could not|cannot|timed out|unavailable|invalid|no tab|no active/i.test(text)) return 'error';
  if (/complete|done/i.test(text)) return 'success';
  return 'info';
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  const kind = msg ? statusKind(msg) : '';
  el.className = 'gc-status' + (kind ? ' gc-status--' + kind : '');
  document.body.dataset.state = kind;
}

// ---------------- RENDER HELPERS ----------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function safeUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
  } catch (e) {
    return '';
  }
}

function icon(name, size = 'xs') {
  return `<svg class="gc-icon gc-icon--${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function scoreNumber(score) {
  const n = Number(score);
  return (score === null || score === undefined || score === '' || !Number.isFinite(n)) ? null : n;
}

function formatScore(score) {
  const n = scoreNumber(score);
  if (n === null) return '–';
  return String(Math.round(Math.max(0, Math.min(10, n)) * 10) / 10);
}

// Display bands only. The backend score is shown unchanged.
function scoreTier(score) {
  const n = scoreNumber(score);
  if (n === null) return { cls: 'none', label: 'Not scored' };
  if (n < 4) return { cls: 'low', label: 'Low sustainability' };
  if (n < 7) return { cls: 'mid', label: 'Moderate sustainability' };
  return { cls: 'high', label: 'High sustainability' };
}

function primaryMaterial(materials) {
  const list = Array.isArray(materials) ? materials : (materials ? [materials] : []);
  const first = list.map(m => String(m || '').trim()).find(m => m && !/^not stated$/i.test(m));
  return first || '';
}

function gradeClass(grade) {
  const g = String(grade || '').trim().toUpperCase().charAt(0);
  if (g === 'A' || g === 'B') return 'high';
  if (g === 'C') return 'mid';
  if (g === 'D' || g === 'E' || g === 'F') return 'low';
  return 'none';
}

// One card for every recommendation list. `product` uses the fields the backend
// already returns (name/title, url, price/rawPrice, numericScore, grade, materials).
function renderCompactProductCard(product, options = {}) {
  const p = product || {};
  const name = String(p.name || p.title || '').trim() || 'Unknown product';
  const priceText = String(p.rawPrice || p.price || '').trim();
  const score = scoreNumber(p.numericScore);
  const tier = scoreTier(score);
  const grade = String(p.grade || '').trim();
  const material = primaryMaterial(p.materials || p.material);
  const href = safeUrl(p.url);
  const image = safeUrl(p.image || p.img || '');
  const accent = options.accent || 'teal';
  const badges = [
    options.badge || '',
    p.site ? `<span class="gc-chip gc-chip--site">${icon('cart')}${escapeHtml(p.site)}</span>` : '',
    options.extraBadge || ''
  ].join('');

  return `
    <article class="gc-pcard gc-pcard--${escapeHtml(accent)}${options.highlight ? ' gc-pcard--featured' : ''}">
      ${badges.trim() ? `<div class="gc-pcard-badges">${badges}</div>` : ''}
      <div class="gc-pcard-main">
        <div class="gc-pcard-media">
          <img class="gc-pcard-img${image ? '' : ' is-placeholder'}" alt="" loading="lazy" referrerpolicy="no-referrer"
            src="${escapeHtml(image || PRODUCT_IMAGE_FALLBACK)}"
            ${href ? `data-product-url="${escapeHtml(href)}"` : ''} />
        </div>
        <div class="gc-pcard-info">
          <p class="gc-pcard-name" title="${escapeHtml(name)}">${escapeHtml(name)}</p>
          <div class="gc-pcard-figures">
            <span class="gc-pcard-price${priceText ? '' : ' is-missing'}">${escapeHtml(priceText || 'Price unavailable')}</span>
            <span class="gc-pcard-score gc-tier-${tier.cls}" title="${escapeHtml(tier.label)}">
              ${score === null ? 'Not rated' : `${icon('leaf')}${formatScore(score)}<small>/10</small>`}
            </span>
          </div>
          <div class="gc-pcard-tags">
            <span class="gc-grade gc-grade--${gradeClass(grade)}">Grade ${escapeHtml(grade || 'N/A')}</span>
            ${options.valueText ? `<span class="gc-pcard-value">${escapeHtml(options.valueText)}</span>` : ''}
          </div>
          <p class="gc-pcard-material${material ? '' : ' is-missing'}">
            ${icon('layers')}<span>${material ? 'Material: ' + escapeHtml(material) : 'Material unavailable'}</span>
          </p>
        </div>
      </div>
      ${options.note ? `<p class="gc-pcard-note">${escapeHtml(options.note)}</p>` : ''}
      ${href
        ? `<a class="gc-pcard-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(options.linkLabel || 'View product')}${icon('external')}</a>`
        : '<span class="gc-pcard-link is-disabled" title="The store did not provide a product link">Link unavailable</span>'}
    </article>`;
}

// Fills card images from the product cards already visible on the shopping page.
function fillCardImages(container) {
  if (!container || typeof chrome === 'undefined' || !chrome.tabs) return;
  const imgs = Array.from(container.querySelectorAll('img.is-placeholder[data-product-url]'));
  if (!imgs.length) return;
  const urls = [...new Set(imgs.map(img => img.dataset.productUrl))];
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs && tabs[0] && tabs[0].id;
    if (!tabId) return;
    const found = (await sendMessagePromise(tabId, { action: 'getProductImages', urls }, { retries: 0 })) || {};
    imgs.forEach((img) => {
      const src = safeUrl(found[img.dataset.productUrl]);
      if (!src || !img.isConnected) return;
      img.onerror = () => {
        img.onerror = null;
        img.src = PRODUCT_IMAGE_FALLBACK;
        img.classList.add('is-placeholder');
      };
      img.src = src;
      img.classList.remove('is-placeholder');
    });
  });
}

function bestTag(label, variant = '') {
  return `<span class="gc-best-tag${variant ? ' gc-best-tag--' + variant : ''}">${icon('award')}${escapeHtml(label)}</span>`;
}

function setBestProduct(html, title) {
  const box = document.getElementById('bestProduct');
  const section = document.getElementById('bestBox');
  const heading = document.getElementById('bestTitle');
  if (!box) return;
  box.innerHTML = html;
  if (heading && title) heading.textContent = title;
  if (section) section.classList.remove('hidden');
  fillCardImages(box);
}

function revealBestBox() {
  const section = document.getElementById('bestBox');
  if (!section) return;
  try {
    section.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  } catch (e) { }
}

function bestEmpty(message, detail) {
  return `<div class="gc-empty"><span class="gc-empty-icon" aria-hidden="true">${icon('trophy', 'sm')}</span><div><p>${escapeHtml(message)}</p>${detail ? `<p class="gc-empty-detail">${escapeHtml(detail)}</p>` : ''}</div></div>`;
}

const PRODUCT_IMAGE_FALLBACK =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='14' fill='%23F1F5F9'/><g fill='none' stroke='%2394A3B8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M30 38h36l-3 30H33l-3-30Z'/><path d='M39 38v-3a9 9 0 0 1 18 0v3'/></g></svg>";

function showProductImage(src) {
  const imgEl = document.getElementById('productImg');
  if (!imgEl) return;
  imgEl.style.visibility = 'visible';
  imgEl.referrerPolicy = 'no-referrer';
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = PRODUCT_IMAGE_FALLBACK;
  };
  imgEl.src = (src && String(src).length > 5) ? src : PRODUCT_IMAGE_FALLBACK;
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

function highlightPayload(best) {
  return {
    name: best?.name || best?.title || '',
    title: best?.title || best?.name || '',
    url: best?.url || '',
    price: best?.price || ''
  };
}

// Runs in the shopping page itself, so a stale or iframe content script cannot block it.
function highlightProductInPage(best) {
  const CLASS = 'gc-best-product-highlight';
  const STYLE_ID = 'gc-best-product-highlight-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CLASS} {
        outline: 3px solid #22c55e !important;
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.5) !important;
        border-radius: 8px !important;
        position: relative;
        background-color: rgba(22, 163, 74, 0.04) !important;
      }
      .${CLASS}::before {
        content: "GreenChoice best";
        position: absolute;
        top: 4px;
        left: 4px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 600;
        color: #ffffff;
        background: #16a34a;
        border-radius: 9999px;
        z-index: 2147483647;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  document.querySelectorAll('.' + CLASS).forEach((el) => el.classList.remove(CLASS));

  function asinOf(raw) {
    const text = String(raw || '');
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch (e) { }
    const match = decoded.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|[?&]asin=)([A-Z0-9]{10})/i);
    return match ? match[1].toUpperCase() : '';
  }
  function norm(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const wanted = asinOf(best && best.url);
  const bestName = norm(best && (best.name || best.title));
  let card = null;

  if (wanted) {
    const exact = document.querySelector('[data-asin="' + wanted + '"]');
    if (exact) card = exact.closest('[data-component-type="s-search-result"], .s-result-item') || exact;
  }

  if (!card && bestName) {
    const nodes = document.querySelectorAll(
      '[data-component-type="s-search-result"], .s-result-item[data-asin], li.product-base, a[href*="/dp/"], a[href*="/p/"]'
    );
    for (const node of nodes) {
      const title = norm((node.innerText || node.getAttribute('title') || '').slice(0, 500));
      if (!title) continue;
      if (title === bestName || title.includes(bestName) || bestName.includes(title)) {
        card = node.closest('[data-component-type="s-search-result"], .s-result-item, li.product-base, li, article') || node;
        break;
      }
    }
  }

  if (!card) return { ok: false, reason: 'matching card not found' };
  card.classList.add(CLASS);
  try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
  const img = card.querySelector && card.querySelector('img');
  const image = img && (img.currentSrc || img.src);
  return { ok: true, image: image && /^https?:/i.test(image) ? image : '' };
}

function highlightBestOnTab(tabId, best) {
  const payload = highlightPayload(best);
  return new Promise((resolve) => {
    const finish = (result) => resolve(result || { ok: false, reason: 'matching card not found' });
    const runInPage = (previous) => {
      try {
        chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: highlightProductInPage,
          args: [payload]
        }, (results) => {
          if (chrome.runtime.lastError) return finish(previous);
          finish((results && results[0] && results[0].result) || previous);
        });
      } catch (e) {
        finish(previous);
      }
    };

    sendMessageSafe(tabId, { action: 'highlightBestProduct', best: payload }, (res) => {
      if (res && res.ok) return finish(res);
      runInPage(res);
    }, { retries: 1 });
  });
}

function sendHighlightToTab(tabId, best) {
  if (!best || !tabId) return;
  highlightBestOnTab(tabId, best);
}


// ---------- MAIN: ANALYZE CURRENT PRODUCT ----------

async function analyzeProduct() {
  console.log('[popup] analyzeProduct clicked');
  setStatus('Extracting product info...');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('alternativesBox').classList.add('hidden');

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

        showProductImage(productData.img);

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
          showOrigin(tabs[0].id);
          setStatus('');
        } catch (err) {
          console.error('[popup] analyzeProduct fetch error:', err);
          setStatus('Analysis failed. Is backend running?');
        }
      }
    );
  });
}
async function showOrigin(tabId) {
  const el = document.getElementById('originBadge');
  if (!el) return;
  el.className = 'unknown';
  el.textContent = 'Made in India: checking...';
  const r = (await sendMessagePromise(tabId, { action: 'getOriginHere' })) || { status: 'unknown' };
  if (r.status === 'india') {
    el.className = 'yes';
    el.textContent = 'Made in India: Yes';
  } else if (r.status === 'other') {
    el.className = 'no';
    el.textContent = `Made in India: No (${r.country})`;
  } else {
    el.className = 'unknown';
    el.textContent = 'Made in India: Not listed';
  }
  el.title = 'Country of origin as listed by the seller; not verified.';
}
function fillFactorList(boxId, listId, items) {
  const box = document.getElementById(boxId);
  const list = document.getElementById(listId);
  if (!box || !list) return;
  const clean = (Array.isArray(items) ? items : []).map(item => String(item || '').trim()).filter(Boolean);
  list.innerHTML = clean.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  box.classList.toggle('hidden', clean.length === 0);
}

function displayResult(data, productData) {
  const resultEl = document.getElementById('result');
  resultEl.classList.remove('hidden');
  resultEl.style.animation = 'none';
  void resultEl.offsetWidth;
  resultEl.style.animation = '';

  document.getElementById('productTitle').textContent = productData.title || 'Current product';
  const priceEl = document.getElementById('productPrice');
  const priceText = String(productData.price || '').trim();
  priceEl.textContent = priceText || 'Price not shown';
  priceEl.classList.toggle('gc-price--muted', !priceText);

  const score = scoreNumber(data.numericScore);
  const tier = scoreTier(score);
  const ring = document.getElementById('scoreCircle');
  ring.className = 'gc-ring gc-tier-' + tier.cls;
  ring.setAttribute('aria-label', `Sustainability score ${formatScore(score)} out of 10, ${tier.label}`);
  ring.style.setProperty('--progress', '0');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.setProperty('--progress', score === null ? '0' : String(Math.max(0, Math.min(10, score)) / 10));
    });
  });
  document.getElementById('scoreValue').textContent = formatScore(score);

  const labelEl = document.getElementById('scoreLabel');
  labelEl.textContent = tier.label;
  labelEl.className = 'gc-score-label gc-tier-' + tier.cls;

  document.getElementById('gradeText').textContent = 'Grade ' + (data.grade || '–');
  const confidenceEl = document.getElementById('confidenceText');
  if (data.confidence) {
    confidenceEl.textContent = 'Confidence: ' + data.confidence;
    confidenceEl.classList.remove('hidden');
  } else {
    confidenceEl.classList.add('hidden');
  }
  document.getElementById('numericText').textContent =
    score === null ? 'Score unavailable' : `${formatScore(score)}/10 on the GreenChoice scale`;

  document.getElementById('carbonText').textContent =
    data.carbonFootprintKg != null ? data.carbonFootprintKg + ' kg' : 'N/A';
  document.getElementById('waterText').textContent =
    data.waterUsageLiters != null ? data.waterUsageLiters + ' L' : 'N/A';
  document.getElementById('explain').textContent =
    data.explanation || 'No explanation was returned for this product.';
  fillFactorList('positiveBox', 'positiveList', data.positiveFactors);
  fillFactorList('negativeBox', 'negativeList', data.negativeFactors);

  const materials = (data.materials && data.materials.join) ? data.materials.filter(Boolean) : [];
  document.getElementById('materials').innerHTML = materials.length
    ? materials.map(m => `<span class="gc-chip">${escapeHtml(m)}</span>`).join('')
    : 'None detected';

  // value ratio if price present
  const price = productData.price
    ? parseFloat(String(productData.price).replace(/[^0-9.]/g, ''))
    : null;
  if (price && data.numericScore != null) {
    const value = (data.numericScore / price) * 100;
    document.getElementById('valueRatio').textContent = value.toFixed(2) + ' per ₹100';
  } else {
    document.getElementById('valueRatio').textContent = 'N/A';
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

  list.innerHTML = cleaned.map((a, index) => `<li>${renderCompactProductCard(a, {
    accent: 'teal',
    badge: index === 0 ? bestTag('Most sustainable') : '',
    highlight: index === 0
  })}</li>`).join('');
  fillCardImages(list);
}

function valueText(r) {
  if (typeof r.valueScore === "number") return r.valueScore.toFixed(1);
  if (typeof r.valueIndex === "number") return (r.valueIndex * 100).toFixed(1);
  return "–";
}

//  SHOW COST + SUSTAINABILITY COMPARISON
function showCompare(results, best) {
  const container = document.getElementById("comparisonBox");
  const tableBox = document.getElementById("comparisonTable");
  if (!container || !tableBox) return;

  container.classList.remove("hidden");
  const rows = Array.isArray(results) ? results : [];

  if (!rows.length) {
    tableBox.innerHTML = bestEmpty("No comparable products were found.");
    renderCompareChart([]);
    return;
  }

  // Tags reuse the backend result as-is: `best` is the top value pick, and the
  // greenest row is the highest numericScore already returned.
  const bestRow = best
    ? rows.find(r => r === best || (r.name === best.name && (r.url || "") === (best.url || "")))
    : rows[0];
  const topScore = Math.max(...rows.map(r => scoreNumber(r.numericScore) ?? -1));
  const greenest = rows.find(r => scoreNumber(r.numericScore) === topScore && topScore >= 0);

  tableBox.innerHTML = `
    <div class="gc-compare-list">
      ${rows.map((r, i) => renderCompactProductCard(
        { ...r, price: r.rawPrice },
        {
          accent: "amber",
          badge: [
            r === bestRow ? bestTag("Best value", "value") : "",
            r === greenest ? bestTag("Best sustainable choice") : ""
          ].join(""),
          valueText: `#${i + 1} · Value ${valueText(r)}/100`,
          highlight: r === bestRow
        }
      )).join("")}
    </div>`;
  fillCardImages(tableBox);

  renderCompareChart(rows, bestRow);
}

//  VALUE SCORE BAR CHART (0–100 value index from the backend)
function renderCompareChart(results, bestRow) {
  const box = document.getElementById("compareBars");
  if (!box) return;
  box.innerHTML = "";
  if (!Array.isArray(results) || !results.length) return;

  const bars = results.map((r, i) => {
    const raw = typeof r.valueScore === "number"
      ? r.valueScore
      : (typeof r.valueIndex === "number" ? r.valueIndex * 100 : 0);
    const value = Math.max(0, Math.min(100, raw));
    const label = `#${i + 1} ${r.name || "Unknown product"}: value ${valueText(r)} out of 100`;
    return `
      <div class="gc-col${r === bestRow ? " is-best" : ""}" role="listitem" data-value="${value}"
        title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <span class="gc-col-track">
          <span class="gc-col-fill"></span>
          <span class="gc-col-num">${valueText(r)}</span>
        </span>
        <span class="gc-col-rank">${i + 1}</span>
      </div>`;
  }).join("");

  box.innerHTML = `
    <span class="gc-eyebrow">${icon("scale")}Value score out of 100</span>
    <div class="gc-chart">
      <div class="gc-chart-axis" aria-hidden="true">
        <span>100</span><span>75</span><span>50</span><span>25</span><span>0</span>
      </div>
      <div class="gc-chart-plot">
        <div class="gc-chart-cols" role="list" aria-label="Value score per product">${bars}</div>
      </div>
    </div>
    <p class="gc-chart-note">Numbers under each bar match the product cards above. Hover a bar for the product name.</p>`;

  const cols = box.querySelectorAll(".gc-col");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cols.forEach(col => col.style.setProperty("--value", col.dataset.value));
  }));
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
              setBestProduct(bestEmpty('No eligible product found.'), 'Best choice on page');
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

            const html = renderCompactProductCard(
              isCurrent
                ? { ...best, name: currentTitle, price: productData.price || best.price, image: productData.img }
                : best,
              {
                accent: 'best',
                badge: bestTag('Best sustainable choice'),
                highlight: true,
                note: isCurrent
                  ? 'This product is already the greenest option.'
                  : 'Greenest option among this product and its alternatives.'
              }
            );

            setBestProduct(html, 'Best choice on page');
            revealBestBox();
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
          setStatus('Cannot read products on this tab. Reload the shopping page and try again.');
          return;
        }

        console.log('[popup] searchProducts response:', products);

        if (!products || products.length === 0) {
          setStatus('No products found. Wait for search results to load, then try again.');
          return;
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

          const scores = Array.isArray(data.alternatives) ? data.alternatives : [];
          const ranked = scores.filter(p =>
            p && p.url && Number.isFinite(Number(p.numericScore))
          ).sort((a, b) => Number(b.numericScore) - Number(a.numericScore));
          const withMaterials = ranked.filter(p =>
            Array.isArray(p.materials) && p.materials.length > 0
          );
          const best = withMaterials[0] || null;
          console.log('[GreenChoice] Scored:', ranked.length,
            'material-identified:', withMaterials.length, 'best:', best);

          let bestHtml = '';
          let highlighted = false;
          if (best) {
            // tell the content script which product to highlight on the page
            const highlightResponse = await highlightBestOnTab(tabId, best);
            highlighted = !!highlightResponse?.ok;
            if (!highlighted) {
              setStatus('Product scored, but matching card could not be highlighted.');
              console.info('[GreenChoice] Highlight not applied: ' +
                ((highlightResponse && highlightResponse.reason) || 'no response from the page'));
            }
            bestHtml = renderCompactProductCard(
              { ...best, image: highlightResponse && highlightResponse.image },
              {
                accent: 'best',
                badge: bestTag('Best sustainable choice'),
                highlight: true,
                note: highlighted ? 'Highlighted on the page.' : 'Could not highlight this product on the page.'
              }
            );
          } else {
            bestHtml = bestEmpty('No eligible product found.', 'No product on this page had identifiable materials.');
            setStatus('No product with identifiable materials was found.');
          }

          setBestProduct(bestHtml, 'Best choice on page');
          revealBestBox();
          if (highlighted) setStatus('');
        } catch (err) {
          console.error('[popup] analyzeSearchResults error:', err);
          setStatus('Search analysis failed.');
        }
      }
    );
  });
}
function getOriginViaTab(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'openHiddenTab', url }, (resp) => {
      const tabId = typeof resp === 'number' ? resp : resp && resp.tabId;
      if (!tabId) return resolve({ country: '', status: 'unknown', note: 'tab open failed' });
      let done = false;
      const timer = setTimeout(() => finish({ country: '', status: 'unknown', note: 'tab timeout' }), 20000);
      function finish(r) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) { }
        try { chrome.runtime.sendMessage({ action: 'closeTab', tabId }); } catch (e) { }
        resolve(r);
      }
      function listener(id, info) {
        if (id !== tabId || info.status !== 'complete' || done) return;
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(async () => {
          const r = await sendMessagePromise(tabId, { action: 'getOriginHere' }, { retries: 1 });
          finish(r || { country: '', status: 'unknown', note: 'no response' });
        }, 4500); // let the single-page app finish rendering
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
async function analyzeIndianBest() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab && tab.id;
  if (!tabId) return setStatus('No active tab.');

  setStatus('Scanning products on this page...');
  const products = await sendMessagePromise(tabId, { action: 'searchProducts' });
  if (!Array.isArray(products) || !products.length) {
    return setStatus('No products found. Wait for results to load, then try again.');
  }

  setStatus('Scoring sustainability (AI)...');
  let scored = [];
  try {
    const resp = await fetch(API_BASE + '/alternatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    scored = (await resp.json()).alternatives || [];
  } catch (e) {
    console.error('[popup] analyzeIndianBest scoring failed:', e);
    return setStatus('Scoring failed. Is the backend running?');
  }

  // already sorted best-first by the backend
  const candidates = scored.filter(p => p.url && Number.isFinite(Number(p.numericScore)));
  const counts = { india: 0, other: 0, unknown: 0 };
  let best = null, bestOrigin = null, checked = 0;

  for (let i = 0; i < Math.min(candidates.length, 24) && !best; i += 8) {
    const chunk = candidates.slice(i, i + 8);
    setStatus(`Checking country of origin (${checked + chunk.length} of ${Math.min(candidates.length, 24)})...`);
    const origins = (await sendMessagePromise(tabId, { action: 'getOrigins', urls: chunk.map(p => p.url) }, { retries: 1 })) || {};
    console.log('[GreenChoice] origins:', origins);

    // Myntra/Meesho build pages in the browser, so the fetched HTML often lacks the origin.
    // Only if the whole batch came back unknown, read the top 3 from a rendered background tab.
    const host = (() => { try { return new URL(tab.url).hostname; } catch (e) { return ''; } })();
    if (/myntra|meesho|flipkart/.test(host) && chunk.every(p => !origins[p.url] || origins[p.url].status === 'unknown')) {
      for (const p of chunk.slice(0, 3)) {
        setStatus('Reading origin from product page...');
        const r = await getOriginViaTab(p.url);
        origins[p.url] = r;
        if (r.status !== 'unknown') {
          const u = new URL(p.url);
          chrome.storage.local.set({ ['gc_origin2:' + u.origin + u.pathname.replace(/\/$/, '')]: r });
        }
      }
      console.log('[GreenChoice] origins after tab fallback:', origins);
    }
    chunk.forEach(p => { counts[(origins[p.url] && origins[p.url].status) || 'unknown']++; });
    checked += chunk.length;
    best = chunk.find(p => origins[p.url] && origins[p.url].status === 'india') || null;
    if (best) bestOrigin = origins[best.url];
  }

  if (!best) {
    setBestProduct(bestEmpty('No eligible Indian product found.',
      `Checked the ${checked} most sustainable products: ${counts.other} made elsewhere, ${counts.unknown} with no origin listed.`),
      'Best Indian product');
    revealBestBox();
    return setStatus('');
  }

  const indianHighlight = await highlightBestOnTab(tabId, best);

  setBestProduct(renderCompactProductCard(
    { ...best, image: indianHighlight && indianHighlight.image },
    {
      accent: 'indian',
      badge: bestTag('Best Indian choice', 'indian'),
      highlight: true,
      note: `Origin: ${bestOrigin.country} (as listed by the seller)` +
        (indianHighlight && indianHighlight.ok ? '' : '. Could not highlight it on the page.')
    }
  ), 'Best Indian product');
  revealBestBox();
  setStatus('');
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
        url: p.url || "",
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

      showCompare(data.ranked, data.best); // UI render

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


// async function compareAcrossSites() {
//   setStatus("Comparing across sites...");

//   chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {

//     const productData = await sendMessagePromise(
//       tabs[0].id,
//       { action: "getProductData" }
//     );

//     const title = productData?.title || "";
//     const breadcrumb = productData?.breadcrumb || "";

//     // 1) Detect category/gender
//     const ai = await classifyAI(
//       productData?.title,
//       productData?.breadcrumb,
//       productData?.description
//     );

//     let category = ai?.category || "unknown";
//     let gender = ai?.gender || "unisex";

//     // If backend returns a category name we don't recognize, fall back to local detection
//     if (!CATEGORY_KEYWORDS[category]) {
//       const local = detectCategoryAndGender(title, breadcrumb);
//       if (CATEGORY_KEYWORDS[local.category]) category = local.category;
//       if (gender === "unisex" && local.gender !== "unisex") gender = local.gender;
//     }

//     // last fallback: breadcrumb-only
//     if (!CATEGORY_KEYWORDS[category]) {
//       const fromBread = detectCategoryFromBreadcrumb(breadcrumb);
//       if (CATEGORY_KEYWORDS[fromBread]) category = fromBread;
//     }

//     console.log("[popup] classify resolved:", category, gender);

//     if (category === "unknown" || !CATEGORY_KEYWORDS[category]) {
//       setStatus("Could not confidently detect product category.");
//       return;
//     }

//     // 2) Scrape candidates across sites (query includes gender + type words)
//     //    We'll also reuse this smart query for relevance filtering (more stable than a long product title).
//     const smartBase = makeSmartQuery(title, breadcrumb || "", category || "unknown", gender || "unisex");
//     const results = await fetchCrossSiteResults(title, breadcrumb, category, gender);

//     // 3) Filter + score per-site using backend (so we get numericScore/grade)
//     let scoredAll = [];

//     for (const site of results) {
//       const siteName = site.site || site.name || "Unknown";
//       let prods = Array.isArray(site.products) ? site.products : [];

//       // attach site for UI + remove duplicates (Flipkart often repeats the same card)
//       prods = dedupeScrapedProducts(prods).map(p => ({ ...p, site: siteName }));

//       prods = filterByCategoryAndGender(prods, category, gender);

//       // Myntra is more sensitive; try strict first, then fall back to non-strict
//       const isMyntra = siteName.toLowerCase().includes("myntra");
//       let rel = filterRelevantProducts(prods, smartBase, { strict: isMyntra });
//       if (isMyntra && rel.length === 0 && prods.length > 0) {
//         rel = filterRelevantProducts(prods, smartBase, { strict: false });
//       }
//       prods = rel;

//       if (!prods.length) continue;

//       const scored = await scoreProductsWithBackend(prods.slice(0, 8));
//       scoredAll.push(...scored.map(s => ({ ...s, site: siteName })));
//     }

//     if (!scoredAll.length) {
//       setStatus("No relevant alternatives found across sites.");
//       return;
//     }

//     // 4) Remove duplicates again (backend can echo duplicates), then pick best overall
//     scoredAll = dedupeScoredKeepBest(scoredAll);
//     scoredAll.sort((a, b) => Number(b.numericScore || 0) - Number(a.numericScore || 0));
//     renderCrossSiteResults(scoredAll.slice(0, 5));
//     setStatus("Comparison complete.");
//   });
// }
async function scrapeAllSites(query) {
  const q = encodeURIComponent(query);
  const SITES = [
    { name: "Amazon", url: `https://www.amazon.in/s?k=${q}`, action: "scrapeAmazonResults" },
    { name: "Flipkart", url: `https://www.flipkart.com/search?q=${q}`, action: "scrapeFlipkartResults" },
    { name: "Myntra", url: `https://www.myntra.com/search?q=${q}`, action: "scrapeMyntraResults" },
    { name: "Meesho", url: `https://www.meesho.com/search?q=${q}`, action: "scrapeMeeshoResults" }
  ];
  const results = [];
  for (const s of SITES) { // sequential: the hidden-tab scrapers were built for this
    try { results.push(await scrapeSite(s.name, s.url, s.action)); }
    catch (e) { results.push({ site: s.name, products: [] }); }
  }
  return results;
}

async function compareAcrossSites() {
  setStatus("Comparing across sites...");
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const pd = await sendMessagePromise(tabs[0].id, { action: "getProductData" });
    if (!pd || !pd.title) return setStatus("Could not read this product.");

    const info = await classifyAI(pd.title, pd.breadcrumb, pd.description);
    const query = info.query || pd.title.split(/\s+/).slice(0, 6).join(" ");

    setStatus("Searching other sites...");
    const sites = await scrapeAllSites(query);

    setStatus("Matching and scoring (AI)...");
    try {
      const resp = await fetch(API_BASE + "/cross_site_compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base: {
            title: pd.title,
            productType: info.productType || "",
            gender: info.gender || "unisex"
          },
          sites
        })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (!data.ranked || !data.ranked.length) {
        return setStatus("No comparable products found across sites.");
      }
      renderCrossSiteResults(data.ranked.slice(0, 5));
      setStatus("Comparison complete.");
    } catch (e) {
      console.error("[popup] compareAcrossSites error:", e);
      setStatus("Cross-site comparison failed.");
    }
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

  cards.innerHTML = results.map((r, index) => renderCompactProductCard(
    { ...r, site: r.site || "Store" },
    {
      accent: "violet",
      badge: index === 0 ? bestTag("Best sustainable choice") : "",
      extraBadge: r.matchKind ? `<span class="gc-chip gc-chip--match">${escapeHtml(r.matchKind)}</span>` : "",
      highlight: index === 0
    }
  )).join("");
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
  const indianBestBtn = document.getElementById('indianBestBtn');

  const mode = ctx && ctx.mode ? String(ctx.mode) : '';
  const isMulti = mode === 'multi';
  const isSingle = mode === 'single';
  setElHidden(indianBestBtn, !(isMulti && ctx && ['amazon', 'flipkart', 'myntra', 'meesho'].includes(ctx.domain)));

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
      const scoreEl = document.getElementById("creditScore");
      const rewardEl = document.getElementById("carbonRewards");

      if (countEl) countEl.textContent = data.current_streak || 0;
      if (scoreEl) scoreEl.textContent = (data.total_credits || 0).toFixed(1);
      if (rewardEl) rewardEl.textContent = data.carbon_rewards || 0;
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
    const scoreEl = document.getElementById("creditScore");
    const rewardEl = document.getElementById("carbonRewards");

    if (countEl) countEl.textContent = d.current_streak || 0;
    if (scoreEl) scoreEl.textContent = (d.total_credits || 0).toFixed(1);
    if (rewardEl) rewardEl.textContent = d.carbon_rewards || 0;

    // Animate/highlight if updated
    const sec = document.getElementById("streakSection");
    if (sec) {
      sec.classList.add("is-updated");
      setTimeout(() => sec.classList.remove("is-updated"), 500);
    }
  }
});

/* -----------------------------------------
   SCROLL INDICATORS (UI only)
------------------------------------------*/
function scrollBehavior() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

function hasMoreBelow(el) {
  return el.scrollHeight - el.clientHeight - el.scrollTop > 4;
}

// Each container keeps its own listeners for the popup's lifetime; the containers
// are static and only their children are replaced, so nothing needs tearing down.
function watchScroll(el, update) {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  el.addEventListener('scroll', schedule, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(el);
  new MutationObserver(schedule).observe(el, { childList: true, subtree: true });
  schedule();
  return schedule;
}

function initModuleScrollHints() {
  document.querySelectorAll('.gc-scroll-hint[data-scroll-target]').forEach((button) => {
    const scroller = document.getElementById(button.dataset.scrollTarget);
    const area = button.closest('.gc-scroll-area');
    if (!scroller || !area) return;

    const update = () => area.classList.toggle('has-more', hasMoreBelow(scroller));
    const schedule = watchScroll(scroller, update);

    // Hidden sections report zero height; recheck when they are shown.
    const section = area.closest('section');
    if (section) new MutationObserver(schedule).observe(section, { attributes: true, attributeFilter: ['class'] });

    button.addEventListener('click', () => {
      scroller.scrollBy({ top: Math.max(120, scroller.clientHeight * 0.8), behavior: scrollBehavior() });
    });
  });
}

function initPageScrollButton() {
  const button = document.getElementById('pageScrollBtn');
  const app = document.getElementById('app');
  const page = document.scrollingElement || document.documentElement;
  if (!button || !app) return;

  const update = () => {
    const overflow = page.scrollHeight - page.clientHeight > 8;
    const more = hasMoreBelow(page);
    const up = overflow && !more && page.scrollTop > 40;
    button.classList.toggle('is-visible', overflow && (more || up));
    button.classList.toggle('is-up', up);
    button.setAttribute('aria-label', up ? 'Scroll to top' : 'Scroll down');
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(app);
  new MutationObserver(schedule).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  schedule();

  button.addEventListener('click', () => {
    if (button.classList.contains('is-up')) {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } else {
      window.scrollBy({ top: Math.max(160, page.clientHeight * 0.75), behavior: scrollBehavior() });
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initModuleScrollHints();
  initPageScrollButton();
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
  const indianBestBtn = document.getElementById('indianBestBtn');
  if (indianBestBtn) indianBestBtn.addEventListener('click', analyzeIndianBest);
  const compareBtn = document.getElementById("compareBtn");
  if (compareBtn) compareBtn.addEventListener("click", compareProducts);
  const compareAcrossSitesBtn =    document.getElementById("compareAcrossSitesBtn");

  if (compareAcrossSitesBtn) {
    compareAcrossSitesBtn.addEventListener("click", compareAcrossSites);
  }
});
