(() => {
  const INDIA_TERMS = [
    "india", "bharat", "in", "new delhi", "delhi", "mumbai", "pune", "bengaluru",
    "bangalore", "hyderabad", "chennai", "kolkata", "ahmedabad", "surat", "jaipur",
    "lucknow", "coimbatore", "indore", "kochi", "kerala", "karnataka", "maharashtra",
    "tamil nadu", "gujarat", "uttar pradesh", "telangana", "west bengal", "rajasthan"
  ];

  function normalize(value) {
    return String(value || "").toLowerCase().trim();
  }

  function hasIndiaSignal(value) {
    const v = normalize(value);
    if (!v) return false;
    return INDIA_TERMS.some((term) => v.includes(term));
  }

  function classifyOrigin(details) {
    const source = details || {};
    let score = 0;
    const reasons = [];

    if (hasIndiaSignal(source.countryOfOrigin)) {
      score += 50;
      reasons.push("Country of Origin: India");
    }

    if (hasIndiaSignal(source.manufacturerAddress)) {
      score += 25;
      reasons.push("Manufacturer address appears in India");
    }

    if (hasIndiaSignal(source.brandRegistration) || hasIndiaSignal(source.brand)) {
      score += 15;
      reasons.push("Brand appears India-linked");
    }

    if (hasIndiaSignal(source.sellerLocation) || hasIndiaSignal(source.marketedBy) || hasIndiaSignal(source.importedBy)) {
      score += 10;
      reasons.push("Seller/marketed location appears in India");
    }

    const isIndian = score >= 50;
    return {
      originScore: score,
      isIndian,
      originLabel: isIndian ? "Indian Product 🇮🇳" : "Origin Uncertain",
      originReasons: reasons
    };
  }

  window.GreenChoiceOriginClassifier = {
    classifyOrigin
  };
})();
