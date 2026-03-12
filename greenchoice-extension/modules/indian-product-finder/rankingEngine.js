(() => {
  function parsePriceToNumber(price) {
    if (typeof price === "number" && isFinite(price)) return price;
    const cleaned = String(price || "").replace(/[^\d.]/g, "");
    return Number(cleaned) || 0;
  }

  function buildShortDescription(item) {
    const material = item.material ? `Material: ${item.material}` : "";
    const origin = item.countryOfOrigin ? `Origin: ${item.countryOfOrigin}` : "";
    const brand = item.brand ? `Brand: ${item.brand}` : "";
    const joined = [material, origin, brand].filter(Boolean).join(" | ");
    return joined || "Indian sustainable alternative";
  }

  function priceRulePass(candidatePrice, currentPrice, candidateScore, currentScore) {
    if (!candidatePrice) return false;
    if (!currentPrice) return true;
    if (candidatePrice <= currentPrice) return true;

    const scoreGap = Number(candidateScore || 0) - Number(currentScore || 0);
    const pricePremiumAllowed = currentPrice * 1.15;
    return candidatePrice <= pricePremiumAllowed && scoreGap >= 20;
  }

  function rankIndianSustainableAlternatives(input) {
    const current = input?.currentProduct || {};
    const currentPrice = parsePriceToNumber(current.price);
    const currentSustainability = Number(current.sustainabilityScore || 0);

    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const filtered = candidates.filter((item) => {
      if (!item.isIndian || !item.isSustainable) return false;
      const p = parsePriceToNumber(item.price);
      return priceRulePass(p, currentPrice, item.sustainabilityScore, currentSustainability);
    });

    filtered.sort((a, b) => {
      const priceA = parsePriceToNumber(a.price);
      const priceB = parsePriceToNumber(b.price);
      const scoreA = Number(a.sustainabilityScore || 0) + Number(a.originScore || 0);
      const scoreB = Number(b.sustainabilityScore || 0) + Number(b.originScore || 0);

      if (priceA !== priceB) return priceA - priceB;
      return scoreB - scoreA;
    });

    return filtered.map((item) => ({
      ...item,
      shortDescription: buildShortDescription(item),
      parsedPrice: parsePriceToNumber(item.price)
    }));
  }

  window.GreenChoiceRankingEngine = {
    rankIndianSustainableAlternatives,
    parsePriceToNumber
  };
})();
