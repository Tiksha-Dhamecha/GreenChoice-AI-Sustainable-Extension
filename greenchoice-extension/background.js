// background.js
console.log("GreenChoice background loaded");

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "openHiddenTab") {

    chrome.tabs.create(
      {
        url: req.url,
        active: false
      },
      (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.error("Failed to open hidden tab:", chrome.runtime.lastError);
          sendResponse({ ok: false });
          return;
        }

        console.log("Hidden tab opened:", tab.id);
        sendResponse({ ok: true, tabId: tab.id });
      }
    );

    return true;
  }

  if (req.action === "closeTab") {
    if (req.tabId) {
      chrome.tabs.remove(req.tabId);
    }
    sendResponse({ ok: true });
  }

  if (req.action === "updateOrder") {
    const API_URL = "http://localhost:5000/update_order";
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.data)
    })
      .then(r => r.json())
      .then(d => {
        // Broadcast update to popup if open
        if (d && (d.streak_awarded || d.current_streak !== undefined)) {
          chrome.runtime.sendMessage({ action: "streakUpdated", data: d }).catch(() => {
            // Ignore if no popup is listening
          });
        }
        sendResponse({ success: true, data: d });
      })
      .catch(e => {
        console.error("Background fetch error:", e);
        sendResponse({ success: false, error: e.toString() });
      });
    return true; // async response
  }
});
