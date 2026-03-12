(() => {
  const PAGE_SIZE = 3;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cardTemplate(item) {
    return `
      <div class="gc-indian-card">
        <div class="gc-indian-card-head">
          ${item.image ? `<img class="gc-indian-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.productName)}" />` : ""}
          <div class="gc-indian-meta">
            <div class="gc-indian-name">${escapeHtml(item.productName || "Unknown Product")}</div>
            <div class="gc-indian-price">${escapeHtml(item.price || "-")}</div>
            <div class="gc-indian-badges">
              <span class="gc-indian-badge">🇮🇳 Indian</span>
              <span class="gc-indian-badge">🌱 ${Number(item.sustainabilityScore || 0)}</span>
            </div>
          </div>
        </div>
        <div class="gc-indian-desc">${escapeHtml(item.shortDescription || item.description || "")}</div>
        <div class="gc-indian-info">
          <span>Manufacturer: ${escapeHtml(item.manufacturer || "N/A")}</span>
          <span>Country: ${escapeHtml(item.countryOfOrigin || "N/A")}</span>
        </div>
        <a class="gc-indian-link" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">View Product</a>
      </div>
    `;
  }

  function renderIndianResults(container, items, titleText) {
    if (!container) return;
    container.classList.remove("hidden");

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="gc-indian-empty">${escapeHtml(titleText || "No Indian sustainable alternatives found.")}</div>`;
      return;
    }

    let visibleCount = Math.min(PAGE_SIZE, items.length);
    const title = escapeHtml(titleText || "Recommended Indian Sustainable Products");

    function render() {
      const slice = items.slice(0, visibleCount);
      const cards = slice.map(cardTemplate).join("");
      const canLoadMore = visibleCount < items.length;
      container.innerHTML = `
        <h4 class="gc-indian-title">${title}</h4>
        <div class="gc-indian-grid">${cards}</div>
        ${canLoadMore ? '<button class="gc-btn gc-btn-tertiary gc-indian-loadmore" type="button">Load more</button>' : ""}
      `;
      const loadMoreBtn = container.querySelector(".gc-indian-loadmore");
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
          visibleCount = Math.min(visibleCount + PAGE_SIZE, items.length);
          render();
        });
      }
    }

    render();
  }

  window.GreenChoiceIndianResults = {
    renderIndianResults
  };
})();
