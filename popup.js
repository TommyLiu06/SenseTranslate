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

const form = document.getElementById("settings-form");
const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const baseUrlInput = document.getElementById("baseUrl");
const modelInput = document.getElementById("model");
const beforeWordsInput = document.getElementById("beforeWords");
const afterWordsInput = document.getElementById("afterWords");
const multiTurnInput = document.getElementById("multiTurn");
const themeSelect = document.getElementById("theme");
const statusText = document.getElementById("status");

providerSelect.addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[providerSelect.value];
  if (!preset) {
    return;
  }
  baseUrlInput.value = preset.baseUrl;
  modelInput.value = preset.model;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving...");
  const payload = normalizeSettings(readForm());
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: payload
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Save failed.");
    }
    fillForm(response.settings);
    setStatus("Saved.");
  } catch (error) {
    setStatus(`Save failed: ${error.message || String(error)}`);
  }
});

void load();

async function load() {
  try {
    const storage = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = normalizeSettings(storage[SETTINGS_KEY] || {});
    fillForm(settings);
    setStatus("");
  } catch (error) {
    fillForm(DEFAULT_SETTINGS);
    setStatus(`Load failed: ${error.message || String(error)}`);
  }
}

function readForm() {
  return {
    provider: providerSelect.value,
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    model: modelInput.value,
    contextBeforeWords: beforeWordsInput.value,
    contextAfterWords: afterWordsInput.value,
    multiTurn: multiTurnInput.checked,
    theme: themeSelect.value
  };
}

function fillForm(settings) {
  providerSelect.value = settings.provider;
  apiKeyInput.value = settings.apiKey || "";
  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  beforeWordsInput.value = String(settings.contextBeforeWords);
  afterWordsInput.value = String(settings.contextAfterWords);
  multiTurnInput.checked = Boolean(settings.multiTurn);
  themeSelect.value = settings.theme;
}

function setStatus(text) {
  statusText.textContent = text;
}

function normalizeSettings(raw) {
  const provider = raw.provider in PROVIDER_PRESETS ? raw.provider : DEFAULT_SETTINGS.provider;
  const preset = PROVIDER_PRESETS[provider];
  return {
    provider,
    apiKey: String(raw.apiKey || "").trim(),
    baseUrl: normalizeText(raw.baseUrl, preset.baseUrl).replace(/\/+$/, ""),
    model: normalizeText(raw.model, preset.model),
    contextBeforeWords: clampInteger(raw.contextBeforeWords, 0, 1000, DEFAULT_SETTINGS.contextBeforeWords),
    contextAfterWords: clampInteger(raw.contextAfterWords, 0, 1000, DEFAULT_SETTINGS.contextAfterWords),
    multiTurn: typeof raw.multiTurn === "boolean" ? raw.multiTurn : DEFAULT_SETTINGS.multiTurn,
    theme: ["light", "dark", "system"].includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme
  };
}

function normalizeText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
