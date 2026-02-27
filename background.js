const MENU_ID = "sense-translate-menu";
const SETTINGS_KEY = "senseTranslateSettings";

const PROVIDER_PRESETS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5-air"
  },
  glm_coding: {
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    model: "glm-4.5-air"
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  }
};

const DEFAULT_SETTINGS = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  contextBeforeWords: 80,
  contextAfterWords: 80,
  multiTurn: true,
  theme: "system"
};

const conversationMemory = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await createContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await createContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "SENSE_TRANSLATE_TRIGGER",
      selectedText: info.selectionText || ""
    });
  } catch (error) {
    console.warn("Failed to trigger translation in content script:", error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearConversationForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearConversationForTab(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {})
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "START_STREAM") {
    sendResponse({ ok: true, accepted: true });
    handleStreamRequest(message, sender).catch((error) => {
      sendStreamEvent(sender, {
        type: "STREAM_ERROR",
        requestId: message.requestId,
        mode: message.mode,
        error: error.message || String(error)
      });
    });
    return false;
  }

  return false;
});

async function createContextMenu() {
  try {
    await chrome.contextMenus.remove(MENU_ID);
  } catch (_) {
    // Ignore if menu does not exist yet.
  }

  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "Sense Translate",
      contexts: ["selection"]
    },
    () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        console.warn("Failed to create context menu:", lastError.message);
      }
    }
  );
}

async function getSettings() {
  const storage = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(storage[SETTINGS_KEY] || {});
}

async function saveSettings(nextSettings) {
  const current = await getSettings();
  const merged = normalizeSettings({ ...current, ...nextSettings });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
  return merged;
}

function normalizeSettings(raw) {
  const provider = typeof raw.provider === "string" && PROVIDER_PRESETS[raw.provider]
    ? raw.provider
    : DEFAULT_SETTINGS.provider;

  const providerPreset = PROVIDER_PRESETS[provider];
  const contextBeforeWords = clampInteger(raw.contextBeforeWords, 0, 1000, DEFAULT_SETTINGS.contextBeforeWords);
  const contextAfterWords = clampInteger(raw.contextAfterWords, 0, 1000, DEFAULT_SETTINGS.contextAfterWords);
  const multiTurn = typeof raw.multiTurn === "boolean" ? raw.multiTurn : DEFAULT_SETTINGS.multiTurn;
  const theme = raw.theme === "light" || raw.theme === "dark" || raw.theme === "system"
    ? raw.theme
    : DEFAULT_SETTINGS.theme;

  return {
    provider,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    baseUrl: normalizeBaseUrl(raw.baseUrl, providerPreset.baseUrl),
    model: normalizeModel(raw.model, providerPreset.model),
    contextBeforeWords,
    contextAfterWords,
    multiTurn,
    theme
  };
}

function normalizeBaseUrl(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeModel(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clearConversationForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of conversationMemory.keys()) {
    if (key.startsWith(prefix)) {
      conversationMemory.delete(key);
    }
  }
}

function getConversationKey(sender) {
  const tabId = sender?.tab?.id ?? -1;
  let pageKey = sender?.url || sender?.tab?.url || "unknown";
  try {
    const url = new URL(pageKey);
    pageKey = `${url.origin}${url.pathname}`;
  } catch (_) {
    // Keep fallback string.
  }
  return `${tabId}:${pageKey}`;
}

async function handleStreamRequest(message, sender) {
  if (!message.requestId) {
    throw new Error("Missing requestId.");
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("Please set API Key in Sense Translate settings.");
  }

  const conversationKey = getConversationKey(sender);
  const contextMessages = settings.multiTurn ? conversationMemory.get(conversationKey) || [] : [];
  const { systemPrompt, userPrompt } = buildPrompts(message);
  const messages = [
    { role: "system", content: systemPrompt },
    ...contextMessages.slice(-10),
    { role: "user", content: userPrompt }
  ];

  let streamedText = "";
  const finalText = await streamChatCompletion({
    settings,
    messages,
    onDelta: (chunk) => {
      streamedText += chunk;
      sendStreamEvent(sender, {
        type: "STREAM_CHUNK",
        requestId: message.requestId,
        mode: message.mode,
        chunk
      });
    }
  });

  const completedText = finalText || streamedText;
  sendStreamEvent(sender, {
    type: "STREAM_DONE",
    requestId: message.requestId,
    mode: message.mode,
    text: completedText
  });

  if (settings.multiTurn) {
    const updated = [
      ...contextMessages,
      { role: "user", content: userPrompt },
      { role: "assistant", content: completedText }
    ].slice(-20);
    conversationMemory.set(conversationKey, updated);
  }
}

function buildPrompts(message) {
  const selectedText = (message.selectedText || "").trim();
  const beforeContext = (message.beforeContext || "").trim();
  const afterContext = (message.afterContext || "").trim();

  if (message.mode === "explain") {
    const translationText = (message.translationText || "").trim();
    return {
      systemPrompt: [
        "You are Sense Translate.",
        "Explain translation choices clearly in Simplified Chinese.",
        "Focus on meaning, ambiguity, tone, and contextual clues."
      ].join(" "),
      userPrompt: [
        "请解释以下翻译结果，尽量简洁但具体。",
        "",
        `原文：${selectedText || "(empty)"}`,
        `译文：${translationText || "(empty)"}`,
        `上文：${beforeContext || "(empty)"}`,
        `下文：${afterContext || "(empty)"}`,
        "",
        "输出要求：",
        "1) 先给出一句总结。",
        "2) 再用 2-4 条要点说明关键词或语气处理。",
        "3) 使用简体中文。"
      ].join("\n")
    };
  }

  return {
    systemPrompt: [
      "You are Sense Translate.",
      "Translate selected text into Simplified Chinese using surrounding context.",
      "Keep terminology accurate, natural, concise, and faithful to intent.",
      "Output only the translated text without extra commentary."
    ].join(" "),
    userPrompt: [
      `Selected text:\n${selectedText || "(empty)"}`,
      `Context before:\n${beforeContext || "(empty)"}`,
      `Context after:\n${afterContext || "(empty)"}`
    ].join("\n\n")
  };
}

async function streamChatCompletion({ settings, messages, onDelta }) {
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${truncate(errorText, 400)}`);
  }

  if (!response.body) {
    throw new Error("API response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let aggregate = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const parsed = parseSseDataLine(line);
      if (!parsed) {
        continue;
      }
      if (parsed === "[DONE]") {
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(parsed);
      } catch (_) {
        continue;
      }

      const token = extractDeltaText(payload);
      if (!token) {
        continue;
      }
      aggregate += token;
      onDelta(token);
    }
  }

  if (buffer) {
    const parsed = parseSseDataLine(buffer);
    if (parsed && parsed !== "[DONE]") {
      try {
        const payload = JSON.parse(parsed);
        const token = extractDeltaText(payload);
        if (token) {
          aggregate += token;
          onDelta(token);
        }
      } catch (_) {
        // Ignore trailing invalid JSON chunk.
      }
    }
  }

  return aggregate.trim();
}

function parseSseDataLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return "";
  }
  if (!trimmed.startsWith("data:")) {
    return "";
  }
  return trimmed.slice(5).trim();
}

function extractDeltaText(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return "";
  }

  const delta = choice.delta || choice.message || {};
  if (typeof delta.content === "string") {
    return delta.content;
  }
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
  }
  if (typeof delta.reasoning_content === "string") {
    return "";
  }
  return "";
}

function truncate(text, length) {
  const normalized = String(text || "");
  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, length)}...`;
}

function sendStreamEvent(sender, payload) {
  const tabId = sender?.tab?.id;
  if (!tabId) {
    return;
  }
  const options = Number.isInteger(sender.frameId) ? { frameId: sender.frameId } : undefined;
  chrome.tabs.sendMessage(tabId, payload, options).catch(() => {
    // Ignore if target frame is gone.
  });
}
