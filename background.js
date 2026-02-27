const MENU_ID = "sense-translate-menu";
const SETTINGS_KEY = "senseTranslateSettings";
const ENCRYPTED_API_KEYS_KEY = "senseTranslateEncryptedApiKeys";
const CRYPTO_SECRET_KEY = "senseTranslateCryptoSecret";

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
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  contextBeforeWords: 80,
  contextAfterWords: 80,
  multiTurn: true,
  targetLanguage: "Simplified Chinese",
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

  if (message.type === "GET_PROVIDER_API_KEY") {
    getProviderApiKeyForRequested(message.provider)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {}, {
      updateApiKey: Boolean(message.updateApiKey),
      providerForApiKey: message.providerForApiKey,
      apiKey: typeof message.apiKey === "string" ? message.apiKey : ""
    })
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
  const stored = await getStoredSettings();
  const apiKey = await getProviderApiKey(stored.provider);
  return { ...stored, apiKey };
}

async function saveSettings(nextSettings, options = {}) {
  const current = await getStoredSettings();
  const merged = normalizeSettings({ ...current, ...nextSettings });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });

  if (options.updateApiKey) {
    const providerForApiKey = resolveProvider(options.providerForApiKey, merged.provider);
    const plainApiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
    await setProviderApiKey(providerForApiKey, plainApiKey);
  }

  const apiKey = await getProviderApiKey(merged.provider);
  return { ...merged, apiKey };
}

async function getStoredSettings() {
  const storage = await chrome.storage.sync.get(SETTINGS_KEY);
  const raw = storage[SETTINGS_KEY] || {};
  const normalized = normalizeSettings(raw);
  await migrateLegacyApiKeyIfNeeded(raw, normalized);
  return normalized;
}

async function migrateLegacyApiKeyIfNeeded(raw, normalized) {
  const legacyApiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  if (!legacyApiKey) {
    return;
  }

  const existing = await getProviderApiKey(normalized.provider);
  if (!existing) {
    await setProviderApiKey(normalized.provider, legacyApiKey);
  }

  await chrome.storage.sync.set({ [SETTINGS_KEY]: normalized });
}

async function getProviderApiKeyForRequested(providerValue) {
  const provider = resolveProvider(providerValue, DEFAULT_SETTINGS.provider);
  const apiKey = await getProviderApiKey(provider);
  return { provider, apiKey };
}

function normalizeSettings(raw) {
  const provider = resolveProvider(raw.provider, DEFAULT_SETTINGS.provider);
  const providerPreset = PROVIDER_PRESETS[provider];
  const contextBeforeWords = clampInteger(raw.contextBeforeWords, 0, 1000, DEFAULT_SETTINGS.contextBeforeWords);
  const contextAfterWords = clampInteger(raw.contextAfterWords, 0, 1000, DEFAULT_SETTINGS.contextAfterWords);
  const multiTurn = typeof raw.multiTurn === "boolean" ? raw.multiTurn : DEFAULT_SETTINGS.multiTurn;
  const targetLanguage = normalizeTargetLanguage(raw.targetLanguage);
  const theme = normalizeTheme(raw.theme);

  return {
    provider,
    baseUrl: normalizeBaseUrl(raw.baseUrl, providerPreset.baseUrl),
    model: normalizeModel(raw.model, providerPreset.model),
    contextBeforeWords,
    contextAfterWords,
    multiTurn,
    targetLanguage,
    theme
  };
}

function resolveProvider(value, fallback) {
  if (typeof value === "string" && PROVIDER_PRESETS[value]) {
    return value;
  }
  return fallback;
}

function normalizeTheme(value) {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return DEFAULT_SETTINGS.theme;
}

function normalizeTargetLanguage(value) {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.targetLanguage;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SETTINGS.targetLanguage;
  }
  return trimmed.slice(0, 64);
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

async function getProviderApiKey(providerValue) {
  const provider = resolveProvider(providerValue, DEFAULT_SETTINGS.provider);
  const storage = await chrome.storage.local.get(ENCRYPTED_API_KEYS_KEY);
  const encryptedApiKeys = isObject(storage[ENCRYPTED_API_KEYS_KEY]) ? storage[ENCRYPTED_API_KEYS_KEY] : {};
  const encryptedPayload = encryptedApiKeys[provider];
  if (!encryptedPayload) {
    return "";
  }

  try {
    return await decryptSecretPayload(encryptedPayload);
  } catch (_) {
    return "";
  }
}

async function setProviderApiKey(providerValue, plainApiKey) {
  const provider = resolveProvider(providerValue, DEFAULT_SETTINGS.provider);
  const storage = await chrome.storage.local.get(ENCRYPTED_API_KEYS_KEY);
  const encryptedApiKeys = isObject(storage[ENCRYPTED_API_KEYS_KEY]) ? storage[ENCRYPTED_API_KEYS_KEY] : {};

  if (!plainApiKey) {
    delete encryptedApiKeys[provider];
  } else {
    encryptedApiKeys[provider] = await encryptSecretPayload(plainApiKey);
  }

  await chrome.storage.local.set({ [ENCRYPTED_API_KEYS_KEY]: encryptedApiKeys });
}

async function encryptSecretPayload(text) {
  const key = await getCryptoKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plainBytes = new TextEncoder().encode(text);
  const encryptedBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  return {
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encryptedBuffer))
  };
}

async function decryptSecretPayload(payload) {
  if (!isObject(payload) || payload.algorithm !== "AES-GCM") {
    return "";
  }

  const iv = base64ToBytes(payload.iv);
  const encryptedBytes = base64ToBytes(payload.data);
  if (iv.length === 0 || encryptedBytes.length === 0) {
    return "";
  }

  const key = await getCryptoKey();
  const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedBytes);
  return new TextDecoder("utf-8").decode(decryptedBuffer);
}

async function getCryptoKey() {
  const storage = await chrome.storage.local.get(CRYPTO_SECRET_KEY);
  let secretBase64 = storage[CRYPTO_SECRET_KEY];

  if (typeof secretBase64 !== "string" || !secretBase64) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secretBase64 = bytesToBase64(bytes);
    await chrome.storage.local.set({ [CRYPTO_SECRET_KEY]: secretBase64 });
  }

  const rawKeyBytes = base64ToBytes(secretBase64);
  return crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  try {
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    return new Uint8Array();
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clearConversationForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of conversationMemory.keys()) {
    if (key.startsWith(prefix)) {
      conversationMemory.delete(key);
    }
  }
}

function getConversationKey(sender, mode) {
  const tabId = sender?.tab?.id ?? -1;
  let pageKey = sender?.url || sender?.tab?.url || "unknown";
  try {
    const url = new URL(pageKey);
    pageKey = `${url.origin}${url.pathname}`;
  } catch (_) {
    // Keep fallback string.
  }
  const safeMode = mode === "explain" ? "explain" : "translate";
  return `${tabId}:${pageKey}:${safeMode}`;
}

async function handleStreamRequest(message, sender) {
  if (!message.requestId) {
    throw new Error("Missing requestId.");
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("Please set API Key in Sense Translate settings.");
  }

  const conversationKey = getConversationKey(sender, message.mode);
  const contextMessages = settings.multiTurn ? conversationMemory.get(conversationKey) || [] : [];
  const { systemPrompt, userPrompt } = buildPrompts(message, settings);
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

function buildPrompts(message, settings) {
  const selectedText = (message.selectedText || "").trim();
  const beforeContext = (message.beforeContext || "").trim();
  const afterContext = (message.afterContext || "").trim();
  const targetLanguage = normalizeTargetLanguage(message.targetLanguage || settings.targetLanguage);

  if (message.mode === "explain") {
    return {
      systemPrompt: [
        "You are Sense Translate.",
        "Explain the selected text itself based on surrounding context.",
        `Respond in ${targetLanguage}.`,
        "Focus on meaning, references, tone, and possible ambiguity."
      ].join(" "),
      userPrompt: [
        `Please explain the selected text clearly in ${targetLanguage}.`,
        "",
        `Selected text: ${selectedText || "(empty)"}`,
        `Context before: ${beforeContext || "(empty)"}`,
        `Context after: ${afterContext || "(empty)"}`,
        "",
        "Output requirements:",
        "1) Start with one concise summary sentence.",
        "2) Then provide 2-4 bullet points with key details."
      ].join("\n")
    };
  }

  return {
    systemPrompt: [
      "You are Sense Translate.",
      `Translate selected text into ${targetLanguage} using surrounding context.`,
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
