(() => {
  const KEYWORD_WEIGHTS = [
    { term: "bamboo", score: 40 },
    { term: "organic", score: 35 },
    { term: "biodegradable", score: 20 },
    { term: "eco-friendly", score: 20 },
    { term: "recycled", score: 20 },
    { term: "plastic-free", score: 20 },
    { term: "natural fibers", score: 25 },
    { term: "natural fibre", score: 25 },
    { term: "compostable", score: 20 },
    { term: "recyclable packaging", score: 20 },
    { term: "low plastic", score: 20 }
  ];

  function normalize(v) {
    return String(v || "").toLowerCase();
  }

  function classifySustainability(details) {
    const source = details || {};
    const haystack = normalize([
      source.material,
      source.packaging,
      source.description,
      source.productDetailsText,
      source.additionalInformation,
      source.technicalDetails
    ].join(" "));

    let score = 0;
    const matched = [];
    for (const item of KEYWORD_WEIGHTS) {
      if (haystack.includes(item.term)) {
        score += item.score;
        matched.push(item.term);
      }
    }

    score = Math.min(score, 100);
    const isSustainable = score >= 50;

    return {
      sustainabilityScore: score,
      isSustainable,
      sustainabilityLabel: isSustainable ? "Sustainable Product 🌱" : "Sustainability Unclear",
      matchedKeywords: matched
    };
  }

  window.GreenChoiceSustainabilityClassifier = {
    classifySustainability
  };
})();
