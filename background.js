// background.js

let ws = null;
const WS_URL = "ws://10.0.0.1:8000/chatbot"; 

// Handle connection
function connectWebSocket() {
  if (ws && ws.readyState <= 1) return; // Already connecting or open

  console.log("[KLD] 🌐 Connecting to WebSocket:", WS_URL);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[KLD] ✅ WebSocket connected.");
  };

  ws.onmessage = (event) => {
    console.log("[KLD] 📩 Message from server:", event.data);
    // Optional: handle messages or forward to content/panel
  };

  ws.onclose = () => {
    console.warn("[KLD] 🔌 WebSocket closed. Retrying in 5s...");
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (err) => {
    console.error("[KLD] ❌ WebSocket error:", err);
    ws.close();
  };
}

connectWebSocket(); // Call at startup

// Listen for messages from content.js
const openPanels = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "toggle_side_panel") {
    const tabId = sender.tab.id;

    if (openPanels.has(tabId)) {
      chrome.sidePanel.setOptions({ tabId, enabled: false });
      openPanels.delete(tabId);
      console.log("[KLD] ❌ Closed panel on tab:", tabId);
    } else {
      chrome.sidePanel.setOptions({ tabId, path: "panel.html", enabled: true });
      chrome.sidePanel.open({ tabId });
      openPanels.add(tabId);
      console.log("[KLD] ✅ Opened panel on tab:", tabId);
    }
  }
});

// ==========================
// Real-Time Phishing Detection Background Script
// ==========================

let rpdEnabled = false;

/**
 * Load RPD state from local storage
 */
function loadRPDState() {
  chrome.storage.local.get("rpdEnabled", (data) => {
    rpdEnabled = !!data.rpdEnabled;
    console.log("[Background] RPD state loaded:", rpdEnabled);
  });
}

// Initial load
loadRPDState();

// On startup
chrome.runtime.onStartup.addListener(() => {
  console.log("[Background] onStartup triggered.");
  loadRPDState();
});

// On install - default OFF
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ rpdEnabled: false }, () => {
    console.log("[Background] RPD default set to false on install.");
  });
});

/**
 * Toggle RPD on user click
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "toggleRPD") {
    rpdEnabled = !!msg.enabled;

    chrome.storage.local.set({ rpdEnabled }, () => {
      const status = rpdEnabled ? "ENABLED ✅" : "DISABLED ⛔";
      console.log(`[Background] RPD toggled via panel: ${status}`);

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/mrwhite48.png",
        title: "RPD Status Updated",
        message: `Real-Time Phishing Detection is now ${status}`,
      });

      sendResponse({ status: "ok", enabled: rpdEnabled });
    });

    return true; // Indicates async response
  }

  // Receive scan results from content.js
  if (msg.type === "scan-result" && msg.from === "content") {
    console.log("[Background] Phishing scan result received:", msg.result);

    chrome.runtime.sendMessage({
      from: "background",
      type: "scan-report",
      result: msg.result
    });
  }
});

/**
 * Auto-scan on page load if RPD is enabled
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.startsWith("http")) {
    chrome.storage.local.get("rpdEnabled", (data) => {
      if (!data.rpdEnabled) return;

      chrome.tabs.sendMessage(tabId, { action: "scanForPhishing" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[Background] Could not send scanForPhishing:", chrome.runtime.lastError.message);
        } else {
          console.log("[Background] scanForPhishing message sent to", tab.url);
        }
      });
    });
  }
});
