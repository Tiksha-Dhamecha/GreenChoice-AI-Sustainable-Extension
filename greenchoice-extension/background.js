// chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

//   if (req.action === "openHiddenTab") {
//     chrome.tabs.create(
//       { url: req.url, active: false },
//       (tab) => sendResponse(tab.id)
//     );
//     return true;
//   }

//   if (req.action === "closeTab") {
//     chrome.tabs.remove(req.tabId);
//   }

// });

// background.js
console.log("GreenChoice background loaded");

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

  // ---------------- OPEN HIDDEN TAB ----------------
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

    return true; // keep port alive
  }

  // ---------------- CLOSE TAB ----------------
  if (req.action === "closeTab") {
    if (req.tabId) {
      chrome.tabs.remove(req.tabId);
    }
    sendResponse({ ok: true });
  }
});
