import { api } from "../shared/browser.js";
import { SETTINGS_KEY, DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";
import { TranslationCache, getCacheKey } from "./cache.js";
import { extractContextFromRange } from "./selection.js";
import { openStream } from "./stream-client.js";
import { createPopup, destroyPopup, setPopupTheme, setControlsReady, hideExplanation, showExplanation, showNote, clearNote } from "./popup-view.js";

const pageCache = new TranslationCache();
let activePopup = null;
let selectionRevision = 0;

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "SENSE_TRANSLATE_TRIGGER") {
    void startTranslationFromSelection(message.selectedText || "").catch((error) => {
      console.warn("Sense Translate could not open the selection:", error);
    });
  }
});
api.storage.onChanged.addListener((changes, areaName) => {
  const settings = changes[SETTINGS_KEY]?.newValue;
  if (areaName === "sync" && settings && activePopup) setPopupTheme(activePopup, settings.theme);
});
window.addEventListener("pagehide", closePopup);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
});

async function startTranslationFromSelection(fallbackText) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0).cloneRange();
  const selectedText = (selection.toString() || fallbackText).trim();
  if (!selectedText) return;
  const revision = ++selectionRevision;
  const settings = await requestSettings();
  if (revision !== selectionRevision) return;
  // Remove the previous result before collecting document text for the next request.
  closePopup(false);
  const context = extractContextFromRange(range, settings.contextBeforeWords, settings.contextAfterWords);
  const cacheKey = getCacheKey({ selectedText, ...context, settings });
  const popup = createPopup({
    range,
    settings,
    onClose: closePopup,
    onExplain: () => runExplainStream(popup),
    onRetry: () => runTranslateStream(popup, true),
    isActive: () => popup === activePopup
  });
  Object.assign(popup, { selectedText, ...context, settings, cacheKey });
  activePopup = popup;
  runTranslateStream(popup);
}

function closePopup(invalidateSelection = true) {
  if (invalidateSelection) selectionRevision += 1;
  if (!activePopup) return;
  cancelStreams(activePopup);
  destroyPopup(activePopup);
  activePopup = null;
}

function cancelStreams(popup) {
  popup.streams.clear();
  for (const cancel of popup.cancellations.values()) cancel();
  popup.cancellations.clear();
}

function runTranslateStream(popup, force = false) {
  if (popup !== activePopup) return;
  cancelStreams(popup);
  if (force) pageCache.delete(popup.cacheKey);
  clearNote(popup);
  hideExplanation(popup);
  popup.explainButton.disabled = false;
  const cached = pageCache.get(popup.cacheKey);
  if (cached?.translation) {
    popup.mainText.textContent = cached.translation;
    popup.mainText.classList.remove("is-loading");
    setControlsReady(popup, true);
    if (cached.explanation) showExplanation(popup, cached.explanation);
    popup.positionHandler?.();
    return;
  }
  setControlsReady(popup, false);
  popup.mainText.textContent = "";
  popup.mainText.classList.add("is-loading");
  startStream(popup, "translate", {
    onDone: (text) => {
      const translation = text || popup.mainText.textContent.trim();
      popup.mainText.textContent = translation;
      pageCache.set(popup.cacheKey, { translation, explanation: "" });
    },
    onError: () => {
      if (!popup.mainText.textContent) popup.mainText.textContent = "Translation failed.";
    }
  });
}

function runExplainStream(popup) {
  if (popup !== activePopup || popup.streams.has("explain") || popup.streams.has("translate")) return;
  const cached = pageCache.get(popup.cacheKey);
  if (cached?.explanation) {
    showExplanation(popup, cached.explanation);
    popup.positionHandler?.();
    return;
  }
  clearNote(popup);
  showExplanation(popup, "");
  popup.explainText.classList.add("is-loading");
  popup.explainButton.disabled = true;
  startStream(popup, "explain", {
    onDone: (text) => {
      const explanation = text || popup.explainText.textContent.trim();
      popup.explainText.textContent = explanation;
      pageCache.set(popup.cacheKey, { ...pageCache.get(popup.cacheKey), explanation });
    },
    onError: () => {}
  });
}

function startStream(popup, mode, callbacks) {
  const requestId = crypto.randomUUID();
  const textElement = mode === "explain" ? popup.explainText : popup.mainText;
  popup.streams.set(mode, requestId);
  const isCurrent = () => popup === activePopup && popup.streams.get(mode) === requestId;
  const finish = () => {
    popup.streams.delete(mode);
    popup.cancellations.delete(mode);
    textElement.classList.remove("is-loading");
    popup.explainButton.disabled = false;
    setControlsReady(popup, true);
    popup.positionHandler?.();
  };
  popup.cancellations.set(mode, openStream(api.runtime, {
    requestId,
    mode,
    selectedText: popup.selectedText,
    beforeContext: popup.beforeContext,
    afterContext: popup.afterContext,
    targetLanguage: popup.settings.targetLanguage
  }, {
    onChunk: (chunk) => {
      if (!isCurrent()) return;
      textElement.textContent += chunk;
      popup.positionHandler?.();
    },
    onDone: (text) => {
      if (!isCurrent()) return;
      callbacks.onDone(text);
      finish();
    },
    onError: (error) => {
      if (!isCurrent()) return;
      callbacks.onError(error);
      showNote(popup, `Error: ${error}`);
      finish();
    }
  }));
}

async function requestSettings() {
  try {
    const response = await api.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (response?.ok && response.settings) return normalizeSettings(response.settings);
  } catch {
    // The popup can still show an actionable stream error if the background is unavailable.
  }
  return { ...DEFAULT_SETTINGS };
}
