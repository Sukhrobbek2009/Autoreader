const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const startLabel = document.getElementById("start-label");
const pauseLabel = document.getElementById("pause-label");
const pauseIcon = pauseBtn.querySelector(".icon-pause");
const resumeIcon = pauseBtn.querySelector(".icon-resume");
const messageEl = document.getElementById("message");
const rate = document.getElementById("rate");
const rateValue = document.getElementById("rate-value");

// ---- Speed readout and the filled part of the slider track -----------------

function updateRate() {
  const value = Number(rate.value);
  rateValue.textContent = `${value.toFixed(1)}×`;
  const pct = ((value - rate.min) / (rate.max - rate.min)) * 100;
  rate.style.setProperty("--fill", `${pct}%`);
}
rate.addEventListener("input", updateRate);
updateRate();

// ---- Voice picker: type to filter by voice name, language code or language name ----

const voiceInput = document.getElementById("voice-search");
const voiceList = document.getElementById("voice-list");

const DEFAULT_VOICE = { name: "", label: "Default voice", lang: "", langName: "", haystack: "default voice" };
let voices = [DEFAULT_VOICE];
let selectedVoice = DEFAULT_VOICE;
let shown = [];        // voices currently listed
let activeIndex = -1;  // keyboard/mouse highlight within `shown`

let languageNames;
try {
  languageNames = new Intl.DisplayNames(undefined, { type: "language" });
} catch {
  languageNames = null;
}

function describeLanguage(lang) {
  if (!lang) return "";
  const tag = lang.replace("_", "-");
  try {
    return (languageNames && languageNames.of(tag)) || lang;
  } catch {
    return lang;
  }
}

// macOS's built-in gimmick voices (they sing, hum or sound deliberately strange).
const NOVELTY_VOICES = new Set([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "good news",
  "jester", "organ", "superstar", "trinoids", "whisper", "wobble", "zarvox",
]);

function isNovelty(name) {
  // ignore a trailing "(...)" qualifier, e.g. "Albert (English (US))"
  return NOVELTY_VOICES.has(name.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase());
}

/** Reads speechSynthesis's current voices. It can be empty at first and fire "voiceschanged" later. */
function loadVoices() {
  const seen = new Set();
  const loaded = [];
  for (const v of speechSynthesis.getVoices()) {
    if (!v.name || seen.has(v.name) || isNovelty(v.name)) continue;
    seen.add(v.name);
    const langName = describeLanguage(v.lang);
    loaded.push({
      name: v.name,
      label: v.name,
      lang: v.lang || "",
      langName,
      haystack: `${v.name} ${v.lang || ""} ${langName}`.toLowerCase(),
    });
  }
  loaded.sort((a, b) => a.langName.localeCompare(b.langName) || a.name.localeCompare(b.name));
  voices = [DEFAULT_VOICE, ...loaded];

  // The voice objects were just rebuilt, so point the selection at the new copy
  selectedVoice = voices.find((v) => v.name === selectedVoice.name) || DEFAULT_VOICE;
  applySavedVoice();
  if (voiceList.hidden) voiceInput.value = selectedVoice.label;
  if (!voiceList.hidden) renderList(voiceInput.value === selectedVoice.label ? "" : voiceInput.value);
}

/** Every space-separated word you type must appear somewhere in the voice's name or language. */
function filterVoices(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return voices.filter((v) => words.every((w) => v.haystack.includes(w)));
}

function renderList(query = "") {
  shown = filterVoices(query);
  voiceList.replaceChildren();

  if (shown.length === 0) {
    const empty = document.createElement("li");
    empty.className = "combo-empty";
    empty.textContent = "No voices match";
    voiceList.append(empty);
    activeIndex = -1;
  } else {
    shown.forEach((v, i) => {
      const li = document.createElement("li");
      li.id = `voice-opt-${i}`;
      li.className = "combo-option";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(v === selectedVoice));
      li.dataset.index = String(i);

      const name = document.createElement("span");
      name.className = "combo-name";
      name.textContent = v.label;
      li.append(name);

      if (v.langName) {
        const lang = document.createElement("span");
        lang.className = "combo-lang";
        lang.textContent = v.langName;
        li.append(lang);
      }
      voiceList.append(li);
    });
    const selectedAt = shown.indexOf(selectedVoice);
    setActive(selectedAt >= 0 ? selectedAt : 0);
  }
  voiceList.hidden = false;
  voiceInput.setAttribute("aria-expanded", "true");
}

function setActive(index) {
  const prev = voiceList.querySelector(".is-active");
  if (prev) prev.classList.remove("is-active");
  activeIndex = index;
  const el = voiceList.querySelector(`[data-index="${index}"]`);
  if (el) {
    el.classList.add("is-active");
    voiceInput.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  } else {
    voiceInput.removeAttribute("aria-activedescendant");
  }
}

function closeList() {
  voiceList.hidden = true;
  voiceInput.setAttribute("aria-expanded", "false");
  voiceInput.removeAttribute("aria-activedescendant");
  voiceInput.value = selectedVoice.label; // discard half-typed searches
}

function chooseVoice(voice) {
  userChoseVoice = true; // a saved voice must not override this
  selectedVoice = voice;
  closeList();
}

voiceInput.value = selectedVoice.label;

voiceInput.addEventListener("focus", () => {
  voiceInput.select();   // typing replaces the current name
  renderList("");        // show everything until the user types
});
voiceInput.addEventListener("click", () => {
  if (voiceList.hidden) renderList("");
});
voiceInput.addEventListener("input", () => renderList(voiceInput.value));
voiceInput.addEventListener("blur", closeList);

voiceInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (voiceList.hidden) return renderList("");
    if (shown.length === 0) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((activeIndex + step + shown.length) % shown.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!voiceList.hidden && shown[activeIndex]) chooseVoice(shown[activeIndex]);
  } else if (e.key === "Escape" && !voiceList.hidden) {
    e.preventDefault();
    closeList();
  }
});

// mousedown (not click) so the input keeps focus and blur doesn't close the list first
voiceList.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const option = e.target.closest(".combo-option");
  if (option) chooseVoice(shown[Number(option.dataset.index)]);
});
voiceList.addEventListener("mousemove", (e) => {
  const option = e.target.closest(".combo-option");
  if (option && Number(option.dataset.index) !== activeIndex) setActive(Number(option.dataset.index));
});

// ---- Saved settings (chrome.storage.local) ----------------------------------

let savedVoiceName = null;
let userChoseVoice = false;

/** Re-run after every voice load: the saved voice may only appear once voices finish loading. */
function applySavedVoice() {
  if (userChoseVoice || !savedVoiceName) return;
  const match = voices.find((v) => v.name === savedVoiceName);
  if (match) selectedVoice = match;
}

async function restoreSettings() {
  const saved = await chrome.storage.local.get(["voiceName", "rate"]);
  if (typeof saved.rate === "number" && saved.rate >= Number(rate.min) && saved.rate <= Number(rate.max)) {
    rate.value = String(saved.rate);
    updateRate();
  }
  savedVoiceName = saved.voiceName || null;
  applySavedVoice();
  if (voiceList.hidden) voiceInput.value = selectedVoice.label;
}

loadVoices();
speechSynthesis.addEventListener("voiceschanged", loadVoices);
restoreSettings();

// ---- Messaging --------------------------------------------------------------

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("is-error", isError);
  messageEl.hidden = !text;
}

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

/** Start enabled only when idle; Pause/Stop only while reading. */
function render(status) {
  const active = Boolean(status && (status.playing || status.paused));
  const paused = Boolean(status && status.paused);

  startBtn.disabled = active;
  pauseBtn.disabled = !active;
  stopBtn.disabled = !active;

  // While paused, the Pause button becomes Resume
  pauseLabel.textContent = paused ? "Resume" : "Pause";
  pauseIcon.classList.toggle("is-hidden", paused);
  resumeIcon.classList.toggle("is-hidden", !paused);
}

async function refreshStatus() {
  try {
    render(await send("ltp-get-status"));
  } catch {
    render(null); // background not reachable; treat as idle
  }
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true; // guard against double clicks while starting
  showMessage("");
  try {
    await chrome.storage.local.set({ voiceName: selectedVoice.name, rate: Number(rate.value) });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab found.");

    // Inject the extractor into the page (safe to repeat; it guards itself)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    const status = await send("ltp-start", {
      rate: Number(rate.value),
      voiceName: selectedVoice.name || undefined,
    });
    render(status);
    if (!status || !(status.playing || status.paused)) {
      showMessage("Nothing readable was found on this page.", true);
    } else if (status.source === "selection") {
      showMessage("Reading your selection.");
    }
  } catch (err) {
    console.error("Listen to Page:", err);
    const detail = err && err.message ? err.message : String(err);
    showMessage(
      /^Cannot access/.test(detail)
        ? "Chrome doesn't allow extensions on this page. Open a regular web page and try again."
        : `Couldn't start: ${detail}`,
      true
    );
    await refreshStatus();
  }
});

pauseBtn.addEventListener("click", async () => {
  const status = await send("ltp-get-status");
  render(await send(status && status.paused ? "ltp-resume" : "ltp-pause"));
});

stopBtn.addEventListener("click", async () => {
  render(await send("ltp-stop"));
});

// If text is highlighted on the page, Start reads just that. Show it on the button.
// (The popup can't change the page's selection, so checking once on open is enough.)
async function checkSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection() || "").toString().trim().length > 0,
    });
    if (result && result.result) startLabel.textContent = "Read selection";
  } catch {
    // restricted page (chrome://) or no access: keep the plain "Start" label
  }
}
checkSelection();

// Reading can end on its own, so keep the buttons in sync while the popup is open
refreshStatus();
setInterval(refreshStatus, 500);
