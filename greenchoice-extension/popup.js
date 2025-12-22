const API_BASE = "http://localhost:5000";

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

function sendHighlightToTab(tabId, best) {
  if (!best) return;

  chrome.tabs.sendMessage(
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
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[popup] highlightBestProduct send error:',
          chrome.runtime.lastError.message
        );
      }
    }
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

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: 'getProductData' },
      async (productData) => {
        if (chrome.runtime.lastError) {
          console.warn('[popup] getProductData error:', chrome.runtime.lastError.message);
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
          document.getElementById('productImg').src = 'placeholder.png';
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

// ---------- ALTERNATIVES (with links) ----------

// async function fetchAlternatives() {
//   console.log('[popup] fetchAlternatives clicked');
//   setStatus('Gathering alternatives on page...');

//   chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//     chrome.tabs.sendMessage(
//       tabs[0].id,
//       { action: 'getAlternatives' },
//       async (products) => {
//         if (chrome.runtime.lastError) {
//           console.warn('[popup] getAlternatives error:', chrome.runtime.lastError.message);
//           setStatus('This page is not supported by GreenChoice.');
//           return;
//         }

//         console.log('[popup] getAlternatives response (objects):', products);

//         if (!products || products.length === 0) {
//           setStatus('No alternatives found on page.');
//           return;
//         }

//         setStatus('Analyzing alternatives (AI)...');

//         // keep original list for URL mapping
//         const originalProducts = Array.isArray(products) ? products : [];

//         // send only titles to backend for speed
//         const names = originalProducts
//           .map(p => p.title || p.name || '')
//           .filter(Boolean);

//         try {
//           const resp = await fetch(API_BASE + '/alternatives', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ products: names })
//           });
//           console.log('[popup] /alternatives status:', resp.status);
//           if (!resp.ok) throw new Error('HTTP ' + resp.status);

//           const data = await resp.json();
//           console.log('[popup] /alternatives data:', data);
//           showAlternatives(data.alternatives, originalProducts);
//           setStatus('');
//         } catch (err) {
//           console.error('[popup] fetchAlternatives error:', err);
//           setStatus('Alternatives analysis failed.');
//         }
//       }
//     );
//   });
// }
async function fetchAlternatives() {
  console.log('[popup] fetchAlternatives clicked');
  setStatus('Gathering alternatives on page...');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: 'getAlternatives' },
      async (products) => {
        if (chrome.runtime.lastError) {
          console.warn('[popup] getAlternatives error:', chrome.runtime.lastError.message);
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


// function showAlternatives(alts, originalProducts) {
//   const list = document.getElementById('alternativesList');
//   list.innerHTML = '';

//   if (!alts || alts.length === 0) {
//     document.getElementById('alternativesBox').classList.add('hidden');
//     return;
//   }

//   // build name -> url map from originalProducts
//   const urlMap = new Map();
//   if (Array.isArray(originalProducts)) {
//     originalProducts.forEach(p => {
//       const key = (p.title || p.name || '').trim();
//       if (key) urlMap.set(key, p.url || '');
//     });
//   }

//   const BAD_PATTERNS = [
//     /Your Recommendations/i,
//     /Recommended/i,
//     /FREE Delivery/i,
//     /Sign up/i,
//     /returns policy/i,
//     /Read full returns policy/i,
//     /cashback/i,
//     /offer/i,
//     /discount/i,
//     /coupon/i,
//     /Delivery/i,
//     /^\s*00\b/,
//     /^\s*\(₹/i,
//     /^\s*[₹0-9]/,
//     /^[0-9]+\s*(months?|days?)\b/i
//   ];

//   function looksLikeProduct(name) {
//     if (!name) return false;
//     name = name.trim();
//     if (name.length < 25) return false;
//     if (name.split(/\s+/).length < 3) return false;
//     if (BAD_PATTERNS.some(re => re.test(name))) return false;
//     return true;
//   }

//   const cleaned = alts.filter(a => looksLikeProduct(a.name));

//   if (cleaned.length === 0) {
//     document.getElementById('alternativesBox').classList.add('hidden');
//     return;
//   }

//   document.getElementById('alternativesBox').classList.remove('hidden');

//   cleaned.forEach(a => {
//     const url = urlMap.get(a.name) || '';
//     const li = document.createElement('li');
//     li.innerHTML =
//       `<strong>${a.grade || '-'}</strong> • ${a.numericScore} ⭐<br>
//        <span style="font-size:13px">${a.name}</span>` +
//       (url ? `<br><a href="${url}" target="_blank">View product</a>` : '');
//     list.appendChild(li);
//   });
// }

// ---------- BEST PRODUCT (search + product page) ----------

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
/* -----------------------------------------
   SHOW COST + SUSTAINABILITY COMPARISON
------------------------------------------*/
// function showCompare(results) {
//   const container = document.getElementById("comparisonBox");
//   if (!container) return;

//   container.classList.remove("hidden");

//   container.innerHTML = `
//     <table>
//       <tr>
//         <th>Product</th>
//         <th>Price</th>
//         <th>Score</th>
//         <th>Value Index</th>
//       </tr>
//       ${results
//         .map(
//           (r) => `
//       <tr>
//         <td>${r.name}</td>
//         <td>${r.price ?? "-"}</td>
//         <td>${r.rawPrice || "-"}</td>
//         <td>${r.numericScore ?? "-"}</td>
//         <td>${r.valueIndex ? r.valueIndex.toFixed(4) : "-"}</td>
//       </tr>`
//         )
//         .join("")}
//     </table>

//     <canvas id="compareChart" width="280" height="200"></canvas>
//   `;

//   renderCompareChart(results);
// }
function showCompare(results) {
  const container = document.getElementById("comparisonBox");
  if (!container) return;

  container.classList.remove("hidden");

  container.innerHTML = `
    <table>
      <tr>
        <th>Product</th>
        <th>Price</th>
        <th>Score</th>
        <th>Value Index</th>
      </tr>
      ${results
        .map(
          (r) => `
      <tr>
        <td>${r.name}</td>
        <td>${r.rawPrice || "-"}</td>
        <td>${r.numericScore ?? "-"}</td>
        <td>${typeof r.valueIndex === "number" ? r.valueIndex.toFixed(4) : "-"}</td>
      </tr>`
        )
        .join("")}
    </table>

    <canvas id="compareChart" width="280" height="200"></canvas>
  `;

  renderCompareChart(results);
}

/* -----------------------------------------
   BAR CHART: Value Index comparison
------------------------------------------*/
function renderCompareChart(results) {
  const canvas = document.getElementById("compareChart");
  if (!canvas) return;

  const labels = results.map((r) => r.name.slice(0, 18) + "…");
  const values = results.map((r) => r.valueIndex);

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Value Index (score ÷ price)",
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

  chrome.tabs.sendMessage(
    tabId,
    { action: 'getProductData' },
    (productData) => {
      if (chrome.runtime.lastError || !productData) {
        console.warn('[popup] getProductData error (best on page):',
          chrome.runtime.lastError?.message);
        setStatus('This page is not supported by GreenChoice.');
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        { action: 'getAlternatives' },
        async (altProducts) => {
          if (chrome.runtime.lastError) {
            console.warn('[popup] getAlternatives error (best on page):',
              chrome.runtime.lastError.message);
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
// ---------- WIRE UP BUTTONS ----------
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

    chrome.tabs.sendMessage(
      tabId,
      { action: 'searchProducts' },
      async (products) => {
        if (chrome.runtime.lastError) {
          console.warn('[popup] searchProducts error:',
            chrome.runtime.lastError.message);
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
// async function compareProducts() {
//   console.log("[popup] compareProducts clicked");

//   setStatus("Extracting products for comparison...");

//   chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
//     const tabId = tabs[0]?.id;
//     if (!tabId) return setStatus("No tab found.");

//     const list = await chrome.tabs.sendMessage(tabId, {
//       action: "extractCompareProducts",
//     });

//     const products = (list && list.products) || [];

//     console.log("[popup] compare list:", products);

//     if (!products.length) return setStatus("No products detected.");

//     setStatus("Comparing sustainability + price...");

//     try {
//       const resp = await fetch(API_BASE + "/compare_products", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ products }),
//       });

//       if (!resp.ok) throw new Error("HTTP " + resp.status);

//       const data = await resp.json();
//       console.log("[popup] compare result:", data);

//       showCompare(data.ranked);

//       // send highlight message
//       const best = data.best;
//       if (best) {
//         chrome.tabs.sendMessage(tabId, {
//           action: "compareHighlight",
//           bestName: best.name,
//         });
//       }

//       setStatus("");

//     } catch (err) {
//       console.error("[popup] compareProducts error:", err);
//       setStatus("Compare failed.");
//     }
//   });
// }
async function compareProducts() {
  console.log("[popup] compareProducts clicked");

  setStatus("Extracting products for comparison...");

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return setStatus("No tab found.");

    const list = await chrome.tabs.sendMessage(tabId, {
      action: "extractCompareProducts",
    });

    let products = (list && list.products) || [];

    console.log("[popup] extracted for compare:", products);

    if (!products.length) return setStatus("No products detected.");

    // build safe structures for backend
    products = products.map(p => {
      const raw = p.priceRaw || p.price || "";   // original visible price
      const num = raw
        ? Number(String(raw).replace(/[^\d.]/g, "")) || null
        : null;

      return {
        name: p.name,
        rawPrice: raw,
        price: num    // numeric for calculations
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
        chrome.tabs.sendMessage(tabId, {
          action: "compareHighlight",
          bestName: best.name,
        });
      }

      setStatus("");

    } catch (err) {
      console.error("[popup] compareProducts error:", err);
      setStatus("Compare failed.");
    }
  });
}


document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup] DOMContentLoaded, wiring buttons');

  const checkBtn = document.getElementById('checkBtn');
  const altsBtn = document.getElementById('altsBtn');
  const searchBestBtn = document.getElementById('searchBestBtn');

  if (checkBtn) checkBtn.addEventListener('click', analyzeProduct);
  if (altsBtn) altsBtn.addEventListener('click', fetchAlternatives);
  if (searchBestBtn) searchBestBtn.addEventListener('click', analyzeSearchResults);
  const compareBtn = document.getElementById("compareBtn");
  if (compareBtn) compareBtn.addEventListener("click", compareProducts);

});
