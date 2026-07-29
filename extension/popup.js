const statusEl = document.getElementById("status");
const setStatus = (text) => { statusEl.textContent = text; };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.getElementById("togglePanel").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No active tab");
    return;
  }

  const toggle = () => chrome.tabs.sendMessage(tab.id, { type: "togglePanel" });

  try {
    const resp = await toggle();
    setStatus(resp?.hidden ? "Panel hidden" : "Panel visible");
  } catch {
    // No content script on this page yet — e.g. a Kino mirror not listed in the
    // manifest. Inject on demand (activeTab grants access to the current tab),
    // then it runs as the Kino adapter for any non-Amazon site.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      const resp = await toggle();
      setStatus(resp?.hidden ? "Panel hidden" : "Panel visible");
    } catch (e) {
      setStatus("Can't run on this page");
    }
  }
});

document.getElementById("openVocabulary").addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "openVocabulary" });
  setStatus(resp?.ok ? "Vocabulary opened" : "Could not open");
});
