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
  "script, style, nav, header, footer, form, button, input, select, textarea, " +
  "figure, aside, [aria-hidden=\"true\"]";

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

// ---- Messaging and in-page speech ----------------------------------------------
// Chrome speaks through chrome.tts in background.js. Safari has no chrome.tts, so
// there the queue below speaks with speechSynthesis in the page and reports its
// status to the background. In Chrome the "ltp-cs-*" messages are never sent.

function collectChunks() {
  // If the user has highlighted text, read only that; otherwise the whole article.
  const selected = (window.getSelection() || "").toString().replace(/\s+/g, " ").trim();
  if (selected) return { chunks: chunkText(selected), source: "selection" };
  return { chunks: chunkText(extractText()), source: "page" };
}

let pageQueue = [];
let pageIndex = 0;
let pageActive = false;   // true between start and the last chunk / stop
let pagePaused = false;   // tracked here: speechSynthesis.paused lags behind pause()
let pageSession = 0;      // bumped on every start/stop so stale callbacks are ignored
let pageSource = null;
let pageOptions = {};
let pageUtterance = null; // held so the engine doesn't garbage-collect it mid-speech
let tapButton = null;     // shown when the browser blocks speech until the user clicks

function pageStatus() {
  const paused = pageActive && pagePaused;
  return {
    playing: pageActive && !paused,
    paused,
    chunksLeft: pageActive ? pageQueue.length - pageIndex : 0,
    source: pageActive ? pageSource : null,
  };
}

function pushStatus() {
  chrome.runtime.sendMessage({ type: "ltp-cs-status", status: pageStatus() }).catch(() => {});
}

/** Speaks the current chunk; when it ends, advances and speaks the next. */
function speakNextInPage() {
  if (!pageActive) return;
  if (pageIndex >= pageQueue.length) {
    pageActive = false;
    pageUtterance = null;
    pushStatus();
    return;
  }

  const mySession = pageSession;
  const utterance = new SpeechSynthesisUtterance(pageQueue[pageIndex]);
  if (pageOptions.rate) utterance.rate = pageOptions.rate;
  if (pageOptions.volume !== undefined) utterance.volume = pageOptions.volume;
  if (pageOptions.voiceName) {
    const voice = speechSynthesis.getVoices().find((v) => v.name === pageOptions.voiceName);
    if (voice) utterance.voice = voice;
  }

  utterance.onend = () => {
    if (mySession !== pageSession) return; // stopped or restarted
    pageIndex++;
    speakNextInPage();
  };
  utterance.onerror = (event) => {
    if (mySession !== pageSession) return;
    if (event.error === "canceled" || event.error === "interrupted") return;
    if (event.error === "not-allowed") {
      showTapToStart(); // needs a real click on the page first
      return;
    }
    console.error("Listen to Page: speech error:", event.error);
    stopInPage();
    pushStatus();
  };

  pageUtterance = utterance;
  speechSynthesis.speak(utterance);
  pushStatus();
}

/** Some browsers refuse speech until the user has clicked the page; offer a button for that. */
function showTapToStart() {
  if (tapButton) return;
  tapButton = document.createElement("button");
  tapButton.textContent = "▶ Click to start reading";
  tapButton.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;" +
    "border:0;border-radius:10px;background:#0071E3;color:#fff;cursor:pointer;" +
    "font:600 14px system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35);";
  tapButton.addEventListener("click", () => {
    removeTapButton();
    speakNextInPage(); // runs inside the click, so it counts as a user gesture
  });
  document.documentElement.append(tapButton);
}

function removeTapButton() {
  if (tapButton) {
    tapButton.remove();
    tapButton = null;
  }
}

function startInPage(options) {
  stopInPage();
  const { chunks, source } = collectChunks();
  if (chunks.length === 0) return;
  pageQueue = chunks;
  pageSource = source;
  pageIndex = 0;
  pageOptions = options;
  pageActive = true;
  pagePaused = false;
  speakNextInPage();
}

function stopInPage() {
  pageSession++; // invalidate callbacks from the utterance being cancelled
  pageActive = false;
  pagePaused = false;
  pageQueue = [];
  pageIndex = 0;
  pageUtterance = null;
  removeTapButton();
  speechSynthesis.cancel();
  // A pause can outlive cancel(), which would leave the next start silent.
  if (speechSynthesis.paused) speechSynthesis.resume();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // only our own extension
  if (!message) return;

  switch (message.type) {
    case "ltp-extract":
      sendResponse(collectChunks());
      return;
    case "ltp-cs-start":
      startInPage(message.options || {});
      break;
    case "ltp-cs-stop":
      stopInPage();
      break;
    case "ltp-cs-pause":
      if (pageActive) {
        pagePaused = true;
        speechSynthesis.pause();
      }
      break;
    case "ltp-cs-resume":
      if (pageActive) {
        pagePaused = false;
        speechSynthesis.resume();
      }
      break;
    default:
      return; // not ours
  }
  sendResponse(pageStatus());
});

// Navigation, reload, or entering the back/forward cache: the voice must not outlive the page.
// In-page speech (Safari) is cancelled here; the background is told so it stops chrome.tts too.
window.addEventListener("pagehide", () => {
  speechSynthesis.cancel();
  chrome.runtime.sendMessage({ type: "ltp-page-hide" }).catch(() => {});
});
})();
