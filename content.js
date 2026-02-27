const pageCache = new Map();
const pendingStreams = new Map();

let activePopup = null;
let popupSequence = 0;

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "SENSE_TRANSLATE_TRIGGER") {
    void startTranslationFromSelection(message.selectedText || "");
    return;
  }

  if (message.type === "STREAM_CHUNK") {
    const stream = pendingStreams.get(message.requestId);
    if (stream) {
      stream.onChunk(message.chunk || "");
    }
    return;
  }

  if (message.type === "STREAM_DONE") {
    const stream = pendingStreams.get(message.requestId);
    if (stream) {
      pendingStreams.delete(message.requestId);
      stream.onDone(message.text || "");
    }
    return;
  }

  if (message.type === "STREAM_ERROR") {
    const stream = pendingStreams.get(message.requestId);
    if (stream) {
      pendingStreams.delete(message.requestId);
      stream.onError(message.error || "Unknown stream error.");
    }
  }
});

async function startTranslationFromSelection(fallbackSelectedText) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const selectedText = (selection.toString() || fallbackSelectedText || "").trim();
  if (!selectedText) {
    return;
  }

  const settings = await requestSettings();
  const context = extractContextFromRange(range, settings.contextBeforeWords, settings.contextAfterWords);
  const cacheKey = getCacheKey({
    selectedText,
    beforeContext: context.beforeContext,
    afterContext: context.afterContext,
    provider: settings.provider,
    model: settings.model
  });

  if (activePopup) {
    closePopup();
  }

  const popup = createPopup({ range, settings });
  popup.cacheKey = cacheKey;
  popup.selectedText = selectedText;
  popup.beforeContext = context.beforeContext;
  popup.afterContext = context.afterContext;
  activePopup = popup;

  const cached = pageCache.get(cacheKey);
  if (cached?.translation) {
    popup.mainText.textContent = cached.translation;
    popup.mainText.classList.remove("is-loading");
    setControlsReady(popup, true);
    if (cached.explanation) {
      showExplanation(popup, cached.explanation);
    }
    return;
  }

  runTranslateStream(popup, { force: false });
}

function createPopup({ range, settings }) {
  popupSequence += 1;
  const popupId = `sense-translate-popup-${popupSequence}`;
  const root = document.createElement("section");
  root.id = popupId;
  root.className = "sense-translate-popup";
  root.innerHTML = `
    <header class="sense-translate-header">
      <button class="sense-translate-btn" data-role="close">close</button>
      <button class="sense-translate-btn" data-role="explain" style="display:none;">explain</button>
      <button class="sense-translate-btn" data-role="retry" style="display:none;">retry</button>
    </header>
    <div class="sense-translate-content">
      <div class="sense-translate-main is-loading" data-role="main">Translating...</div>
      <hr class="sense-translate-divider" data-role="divider" style="display:none;" />
      <div class="sense-translate-explain" data-role="explain-content" style="display:none;"></div>
      <div class="sense-translate-note" data-role="note" style="display:none;"></div>
    </div>
  `;

  const parent = document.body || document.documentElement;
  parent.appendChild(root);

  const popup = {
    id: popupId,
    root,
    range,
    requestIds: new Set(),
    closeButton: root.querySelector('[data-role="close"]'),
    explainButton: root.querySelector('[data-role="explain"]'),
    retryButton: root.querySelector('[data-role="retry"]'),
    mainText: root.querySelector('[data-role="main"]'),
    divider: root.querySelector('[data-role="divider"]'),
    explainText: root.querySelector('[data-role="explain-content"]'),
    noteText: root.querySelector('[data-role="note"]'),
    positionHandler: null,
    themeCleanup: null,
    themeMode: settings.theme
  };

  popup.closeButton.addEventListener("click", closePopup);
  popup.explainButton.addEventListener("click", () => void runExplainStream(popup));
  popup.retryButton.addEventListener("click", () => {
    hideExplanation(popup);
    runTranslateStream(popup, { force: true });
  });

  applyTheme(popup, settings.theme);
  bindPositionUpdater(popup);
  setControlsReady(popup, false);
  return popup;
}

function bindPositionUpdater(popup) {
  const updatePosition = () => {
    if (!popup.root.isConnected) {
      return;
    }
    const targetRect = getRangeRect(popup.range);
    const top = targetRect.bottom + window.scrollY + 8;
    const margin = 12;
    const maxLeft = window.scrollX + window.innerWidth - popup.root.offsetWidth - margin;
    const minLeft = window.scrollX + margin;
    const left = clamp(targetRect.left + window.scrollX, minLeft, Math.max(minLeft, maxLeft));
    popup.root.style.top = `${top}px`;
    popup.root.style.left = `${left}px`;
  };

  popup.positionHandler = updatePosition;
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition, true);
  updatePosition();
}

function getRangeRect(range) {
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[rects.length - 1];
  }
  return range.getBoundingClientRect();
}

function closePopup() {
  if (!activePopup) {
    return;
  }

  for (const requestId of activePopup.requestIds) {
    pendingStreams.delete(requestId);
  }

  if (activePopup.positionHandler) {
    window.removeEventListener("scroll", activePopup.positionHandler, true);
    window.removeEventListener("resize", activePopup.positionHandler, true);
  }

  if (typeof activePopup.themeCleanup === "function") {
    activePopup.themeCleanup();
  }

  activePopup.root.remove();
  activePopup = null;
}

function applyTheme(popup, mode) {
  if (typeof popup.themeCleanup === "function") {
    popup.themeCleanup();
  }

  if (mode !== "system") {
    popup.root.dataset.theme = mode;
    popup.themeCleanup = null;
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    popup.root.dataset.theme = media.matches ? "dark" : "light";
  };
  const listener = () => apply();
  media.addEventListener("change", listener);
  popup.themeCleanup = () => media.removeEventListener("change", listener);
  apply();
}

function setControlsReady(popup, ready) {
  popup.explainButton.style.display = ready ? "inline-flex" : "none";
  popup.retryButton.style.display = ready ? "inline-flex" : "none";
}

function hideExplanation(popup) {
  popup.divider.style.display = "none";
  popup.explainText.style.display = "none";
  popup.explainText.textContent = "";
}

function showExplanation(popup, text) {
  popup.divider.style.display = "block";
  popup.explainText.style.display = "block";
  popup.explainText.textContent = text;
}

function showNote(popup, text) {
  popup.noteText.style.display = "block";
  popup.noteText.textContent = text;
}

function clearNote(popup) {
  popup.noteText.style.display = "none";
  popup.noteText.textContent = "";
}

function runTranslateStream(popup, { force }) {
  if (!activePopup || popup !== activePopup) {
    return;
  }

  clearNote(popup);
  setControlsReady(popup, false);
  popup.mainText.textContent = "";
  popup.mainText.classList.add("is-loading");

  if (!force) {
    const cached = pageCache.get(popup.cacheKey);
    if (cached?.translation) {
      popup.mainText.textContent = cached.translation;
      popup.mainText.classList.remove("is-loading");
      setControlsReady(popup, true);
      if (cached.explanation) {
        showExplanation(popup, cached.explanation);
      }
      return;
    }
  }

  hideExplanation(popup);

  const requestId = createRequestId();
  popup.requestIds.add(requestId);
  pendingStreams.set(requestId, {
    onChunk: (chunk) => {
      if (!activePopup || popup !== activePopup) {
        return;
      }
      popup.mainText.textContent += chunk;
      popup.positionHandler?.();
    },
    onDone: (text) => {
      popup.requestIds.delete(requestId);
      if (!activePopup || popup !== activePopup) {
        return;
      }
      const finalText = text || popup.mainText.textContent.trim();
      popup.mainText.textContent = finalText;
      popup.mainText.classList.remove("is-loading");
      setControlsReady(popup, true);
      const previous = pageCache.get(popup.cacheKey) || {};
      pageCache.set(popup.cacheKey, {
        ...previous,
        translation: finalText,
        explanation: previous.explanation || ""
      });
      popup.positionHandler?.();
    },
    onError: (error) => {
      popup.requestIds.delete(requestId);
      if (!activePopup || popup !== activePopup) {
        return;
      }
      popup.mainText.classList.remove("is-loading");
      popup.mainText.textContent = popup.mainText.textContent || "Translation failed.";
      setControlsReady(popup, true);
      showNote(popup, `Error: ${error}`);
      popup.positionHandler?.();
    }
  });

  void chrome.runtime
    .sendMessage({
      type: "START_STREAM",
      requestId,
      mode: "translate",
      selectedText: popup.selectedText,
      beforeContext: popup.beforeContext,
      afterContext: popup.afterContext
    })
    .then((response) => {
      if (!response?.ok) {
        const stream = pendingStreams.get(requestId);
        if (stream) {
          pendingStreams.delete(requestId);
          stream.onError(response?.error || "Failed to start translation stream.");
        }
      }
    })
    .catch((error) => {
      const stream = pendingStreams.get(requestId);
      if (stream) {
        pendingStreams.delete(requestId);
        stream.onError(error.message || String(error));
      }
    });
}

function runExplainStream(popup) {
  if (!activePopup || popup !== activePopup) {
    return;
  }

  const translation = popup.mainText.textContent.trim();
  if (!translation) {
    showNote(popup, "Translation is empty.");
    return;
  }

  const cached = pageCache.get(popup.cacheKey);
  if (cached?.explanation) {
    showExplanation(popup, cached.explanation);
    popup.positionHandler?.();
    return;
  }

  clearNote(popup);
  popup.divider.style.display = "block";
  popup.explainText.style.display = "block";
  popup.explainText.textContent = "";
  popup.explainText.classList.add("is-loading");
  popup.positionHandler?.();

  const requestId = createRequestId();
  popup.requestIds.add(requestId);
  pendingStreams.set(requestId, {
    onChunk: (chunk) => {
      if (!activePopup || popup !== activePopup) {
        return;
      }
      popup.explainText.textContent += chunk;
      popup.positionHandler?.();
    },
    onDone: (text) => {
      popup.requestIds.delete(requestId);
      if (!activePopup || popup !== activePopup) {
        return;
      }
      popup.explainText.classList.remove("is-loading");
      const finalText = text || popup.explainText.textContent.trim();
      popup.explainText.textContent = finalText;
      const previous = pageCache.get(popup.cacheKey) || {};
      pageCache.set(popup.cacheKey, {
        ...previous,
        translation: previous.translation || translation,
        explanation: finalText
      });
      popup.positionHandler?.();
    },
    onError: (error) => {
      popup.requestIds.delete(requestId);
      if (!activePopup || popup !== activePopup) {
        return;
      }
      popup.explainText.classList.remove("is-loading");
      showNote(popup, `Error: ${error}`);
      popup.positionHandler?.();
    }
  });

  void chrome.runtime
    .sendMessage({
      type: "START_STREAM",
      requestId,
      mode: "explain",
      selectedText: popup.selectedText,
      beforeContext: popup.beforeContext,
      afterContext: popup.afterContext,
      translationText: translation
    })
    .then((response) => {
      if (!response?.ok) {
        const stream = pendingStreams.get(requestId);
        if (stream) {
          pendingStreams.delete(requestId);
          stream.onError(response?.error || "Failed to start explanation stream.");
        }
      }
    })
    .catch((error) => {
      const stream = pendingStreams.get(requestId);
      if (stream) {
        pendingStreams.delete(requestId);
        stream.onError(error.message || String(error));
      }
    });
}

async function requestSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (response?.ok && response.settings) {
      return response.settings;
    }
  } catch (_) {
    // Use fallback defaults below.
  }

  return {
    provider: "deepseek",
    model: "deepseek-chat",
    contextBeforeWords: 80,
    contextAfterWords: 80,
    multiTurn: true,
    theme: "system"
  };
}

function extractContextFromRange(range, beforeWordCount, afterWordCount) {
  try {
    const body = document.body || document.documentElement;
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(body);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = document.createRange();
    afterRange.selectNodeContents(body);
    afterRange.setStart(range.endContainer, range.endOffset);

    const beforeContext = pickWords(beforeRange.toString(), beforeWordCount, true);
    const afterContext = pickWords(afterRange.toString(), afterWordCount, false);

    return { beforeContext, afterContext };
  } catch (_) {
    return { beforeContext: "", afterContext: "" };
  }
}

function pickWords(text, count, fromEnd) {
  if (!count || count <= 0) {
    return "";
  }
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return "";
  }
  if (fromEnd) {
    return words.slice(-count).join(" ");
  }
  return words.slice(0, count).join(" ");
}

function getCacheKey({ selectedText, beforeContext, afterContext, provider, model }) {
  return JSON.stringify({
    selectedText: selectedText.trim(),
    beforeContext: beforeContext.trim(),
    afterContext: afterContext.trim(),
    provider,
    model
  });
}

function createRequestId() {
  return `sense-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
