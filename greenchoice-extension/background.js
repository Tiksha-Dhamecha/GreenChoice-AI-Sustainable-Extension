chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

  if (req.action === "openHiddenTab") {
    chrome.tabs.create(
      { url: req.url, active: false },
      (tab) => sendResponse(tab.id)
    );
    return true;
  }

  if (req.action === "closeTab") {
    chrome.tabs.remove(req.tabId);
  }

});
