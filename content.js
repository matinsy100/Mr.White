// content.js - side panel icon
(function () {
    if (document.getElementById("kld-floating-icon")) return;
  
    let panelOpen = false;
  
    // Create the floating icon container
    const icon = document.createElement("div");
    icon.id = "kld-floating-icon";
    icon.title = "Toggle Keylogger Defender Panel";
  
    Object.assign(icon.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: "56px",
      height: "56px",
      backgroundColor: "#ffffff",
      borderRadius: "50%",
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      overflow: "hidden", // ensures image stays within the circle
      zIndex: 999999
    });
  
    // Create the image inside the circle
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/mrwhite48.png");
    img.alt = "KLD";
  
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      borderRadius: "50%",
      objectFit: "cover"
    });
  
    icon.appendChild(img);
    document.body.appendChild(icon);
  
    // Toggle panel on click
    icon.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "toggle_side_panel" });
      panelOpen = !panelOpen;
    });
  
    console.log("[KLD] 🧠 Floating icon injected.");
  })();
  
// ==========================
// Real-Time Phishing Detection – Content Script
// ==========================

// Avoid re-scanning on the same page
window.__phishScanDone = false;

/**
 * Basic phishing scan logic
 */
function phishingScan() {
  const issues = [];

  if (location.protocol !== "https:") {
    issues.push("⚠️ Page is using HTTP (not secure)");
  }

  return issues;
}

/**
 * Handle scan trigger from background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scanForPhishing" && !window.__phishScanDone) {
    window.__phishScanDone = true;

    console.log("[Content] scanForPhishing triggered");

    const issues = phishingScan();
    const linkCount = document.querySelectorAll('a[href]').length;

    // Send alert only for real phishing issues
    if (issues.length > 0) {
      alert("Website issues detected:\n" + issues.join("\n"));
    }

    // Include link count as informational, not part of the alert trigger
    const resultWithLinks = [...issues];
    resultWithLinks.push(`🔍 ${linkCount} links detected on this page.`);

    chrome.runtime.sendMessage({
      from: "content",
      type: "scan-result",
      result: resultWithLinks,
      linksDetected: linkCount
    });
  }
});

/**
 * Immediately request scan if RPD is enabled
 */
chrome.storage.local.get("rpdEnabled", (data) => {
  if (data.rpdEnabled && !window.__phishScanDone) {
    chrome.runtime.sendMessage({ action: "scanForPhishing" });
  }
});
