(() => {
  const LABEL = "🌱 Find Indian Sustainable Products 🇮🇳";

  function setupIndianButtons() {
    const ids = ["indianSustBtnAnalyze", "indianSustBtnHighlight"];
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.textContent = LABEL;
      btn.classList.add("gc-btn-indian");
      btn.setAttribute("type", "button");
    });
  }

  window.GreenChoiceIndianButton = {
    setupIndianButtons
  };
})();
