console.log("Listen to Page: background.js loaded");

// ---- Speech queue (chrome.tts) ---------------------------------------------
// chrome.tts has no autoplay restriction, unlike speechSynthesis in a page.

let queue = [];
let queueIndex = 0;
let speaking = false; // true between start and the last chunk / stop
let paused = false;
let source = null;   // "selection" or "page"
let readingTabId = null; // the tab whose text is being read
let session = 0;      // bumped on every start/stop so stale callbacks are ignored
let speechOptions = {};

/** Speaks the current chunk; when it ends, advances and speaks the next. */
function speakNext() {
  if (!speaking) return;
  if (queueIndex >= queue.length) {
    speaking = false;
    paused = false;
    return;
  }

  const mySession = session;
  chrome.tts.speak(queue[queueIndex], {
    ...speechOptions,
    onEvent(event) {
      if (mySession !== session) return; // stopped or restarted
      if (event.type === "end") {
        queueIndex++;
        speakNext();
      } else if (event.type === "error") {
        console.error("Listen to Page: tts error:", event.errorMessage);
        stopReading();
      }
      // "interrupted" / "cancelled" come from stop(); session check covers them
    },
  });
}

/** Asks the tab's content script for the page text, then reads it from the top. */
async function startReading(options = {}) {
  stopReading(); // clear any previous run

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "ltp-extract" });
  } catch (err) {
    // e.g. chrome:// pages or tabs opened before the extension was reloaded
    console.error("Listen to Page: no content script in this tab:", err.message);
    return;
  }
  if (!response || response.chunks.length === 0) return;

  speechOptions = {};
  if (options.rate) speechOptions.rate = options.rate;
  if (options.voiceName) speechOptions.voiceName = options.voiceName;

  queue = response.chunks;
  source = response.source;
  readingTabId = tab.id;
  queueIndex = 0;
  speaking = true;
  paused = false;
  speakNext();
}

function stopReading() {
  session++; // invalidate callbacks from the utterance being interrupted
  speaking = false;
  paused = false;
  readingTabId = null;
  queue = [];
  queueIndex = 0;
  chrome.tts.stop();
}

function pauseReading() {
  if (!speaking || paused) return;
  paused = true;
  chrome.tts.pause();
}

function resumeReading() {
  if (!speaking || !paused) return;
  paused = false;
  chrome.tts.resume();
}

/** playing: audio is being produced; paused: reading but on hold. */
function getStatus() {
  return {
    playing: speaking && !paused,
    paused: speaking && paused,
    chunksLeft: speaking ? queue.length - queueIndex : 0, // includes the chunk being spoken
    source: speaking ? source : null,
  };
}

// ---- Messaging (from the popup) --------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!message || typeof message.type !== "string") return;

  switch (message.type) {
    case "ltp-start":
      // Async: extraction happens in the tab before we can report status.
      startReading({ rate: message.rate, voiceName: message.voiceName }).then(
        () => sendResponse(getStatus())
      );
      return true; // keep the channel open for the async response
    case "ltp-stop":
      stopReading();
      break;
    case "ltp-pause":
      pauseReading();
      break;
    case "ltp-resume":
      resumeReading();
      break;
    case "ltp-get-status":
      break;
    case "ltp-page-hide":
      // The page being read navigated away or unloaded: stop immediately.
      if (sender.tab && sender.tab.id === readingTabId) stopReading();
      break;
    default:
      return; // not ours
  }
  sendResponse(getStatus());
});

// ---- Stop when the tab being read is closed -----------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  if (speaking && tabId === readingTabId) stopReading();
});

// ---- Keyboard shortcut (toggle-reading) -------------------------------------

/** Shows a red "!" on the toolbar icon for a moment, so a failed shortcut isn't silent. */
function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#D70015" });
  chrome.action.setBadgeText({ text: "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-reading") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Playing: the shortcut stops. (Status lives in this worker, so read it directly
    // instead of messaging ourselves with ltp-get-status.)
    const status = getStatus();
    if (status.playing) {
      stopReading();
      return;
    }

    // Paused: pick up where we left off.
    if (status.paused) {
      resumeReading();
      return;
    }

    // Idle: make sure the extractor is in the page (content.js guards against
    // double injection), then start with the last settings saved from the popup.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const { voiceName, rate } = await chrome.storage.local.get(["voiceName", "rate"]);
    await startReading({ rate, voiceName: voiceName || undefined });
  } catch (err) {
    // e.g. chrome:// pages, where extensions can't run
    console.error("Listen to Page: shortcut failed:", err.message);
    flashBadge();
  }
});
