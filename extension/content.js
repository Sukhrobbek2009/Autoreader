// Wrapped so injecting this file again (every Start click) is harmless.
(() => {
if (globalThis.__ltpLoaded) return;
globalThis.__ltpLoaded = true;

console.log("Listen to Page: content.js loaded");

const MIN_TEXT_LENGTH = 200;

// Matches class/id names like "nav", "main-nav", "site_footer", "sidebar",
// "menu", "ad", "ad-banner", "advert". Letter boundaries keep "header",
// "loaded" and "download" from matching "ad".
const NOISE_RE = /(?:^|[^a-z])(?:nav\w*|footer|side-?bar|menu|ads?|advert\w*)(?:[^a-z]|$)/i;

function textLength(el) {
  return (el.innerText || "").trim().length;
}

function looksLikeNoise(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const name = `${node.getAttribute("class") || ""} ${node.id || ""}`;
    if (NOISE_RE.test(name)) return true;
  }
  return false;
}

/**
 * Returns the element most likely to hold the page's readable content,
 * or null if the page has no usable text.
 */
function getReadableRoot() {
  // 1 & 2: semantic containers
  for (const selector of ["article", "main"]) {
    const el = document.querySelector(selector);
    if (el && textLength(el) > 0) return el;
  }

  // 3: first element in document order with more than 200 characters of text
  for (const el of document.body.querySelectorAll("*")) {
    if (textLength(el) > MIN_TEXT_LENGTH) return el;
  }

  // 4: fallback, the container with the most text that isn't navigation/ads
  let best = null;
  let bestLength = 0;
  for (const el of document.querySelectorAll("div, section, article, main")) {
    if (looksLikeNoise(el)) continue;
    const length = textLength(el);
    if (length > bestLength) {
      best = el;
      bestLength = length;
    }
  }
  return best;
}

const REMOVE_SELECTOR =
  "script, style, nav, header, footer, form, button, input, select, textarea";

const CHUNK_TARGET = 200;

/**
 * Returns the readable root's text with boilerplate removed and all
 * whitespace collapsed to single spaces. Returns "" if there is no root.
 */
function extractText() {
  const root = getReadableRoot();
  if (!root) return "";

  const clone = root.cloneNode(true);
  clone.querySelectorAll(REMOVE_SELECTOR).forEach((el) => el.remove());

  // innerText on a detached node ignores layout (no line breaks between
  // blocks), so render the clone off-screen first. It must stay "visible"
  // because innerText skips visibility:hidden content.
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText =
    "position:absolute;left:-99999px;top:0;width:800px;pointer-events:none;";
  holder.appendChild(clone);
  document.body.appendChild(holder);

  try {
    return clone.innerText.replace(/\s+/g, " ").trim();
  } finally {
    holder.remove();
  }
}

/**
 * Splits text into pieces of roughly 200 characters, breaking only after
 * sentence-ending punctuation (. ! ?). Pieces stay under the target where
 * possible; a single sentence longer than the target is kept whole.
 */
function chunkText(text) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Split on whitespace that follows . ! ? (optionally followed by closing
  // quotes/brackets). "3.14" has no whitespace after the dot, so it stays whole.
  const sentences = normalized.split(/(?<=[.!?]["'”’)\]]*)\s+/);

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > CHUNK_TARGET) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---- Messaging -------------------------------------------------------------
// Speech itself lives in background.js (chrome.tts); this script only extracts
// the page text and hands back the chunks.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // only our own extension
  if (!message || message.type !== "ltp-extract") return;

  // If the user has highlighted text, read only that; otherwise the whole article.
  const selected = (window.getSelection() || "").toString().replace(/\s+/g, " ").trim();
  if (selected) {
    sendResponse({ chunks: chunkText(selected), source: "selection" });
  } else {
    sendResponse({ chunks: chunkText(extractText()), source: "page" });
  }
});

// Speech is produced by chrome.tts in the background, so cancelling speechSynthesis
// here would do nothing. Instead tell the background this page is going away
// (navigation, reload, or entering the back/forward cache) so it stops at once.
window.addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ type: "ltp-page-hide" }).catch(() => {});
});
})();
