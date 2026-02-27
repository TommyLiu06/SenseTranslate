const AUTO_SAVE_DELAY_MS = 350;

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

let saveTimerId = null;
let pendingSaveOptions = { updateApiKey: false };
let saveChain = Promise.resolve();
let themeCleanup = null;

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

providerSelect.addEventListener("change", () => {
  void handleProviderChange();
});

apiKeyInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: true });
});

baseUrlInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: false });
});

modelInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: false });
});

beforeWordsInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: false });
});

afterWordsInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: false });
});

multiTurnInput.addEventListener("change", () => {
  scheduleSave({ updateApiKey: false });
});

themeSelect.addEventListener("change", () => {
  applyPopupTheme(themeSelect.value);
  void flushScheduledSave().then(() => queueSave({ updateApiKey: false }));
});

window.addEventListener("unload", () => {
  if (typeof themeCleanup === "function") {
    themeCleanup();
  }
});

void load();

async function load() {
  setStatus("Loading...");
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok || !response.settings) {
      throw new Error(response?.error || "Load failed.");
    }
    const settings = normalizeSettings(response.settings);
    fillForm(settings);
    applyPopupTheme(settings.theme);
    setStatus("Saved");
  } catch (error) {
    fillForm(DEFAULT_SETTINGS);
    applyPopupTheme(DEFAULT_SETTINGS.theme);
    setStatus(`Load failed: ${error.message || String(error)}`, true);
  }
}

async function handleProviderChange() {
  await flushScheduledSave();

  const provider = providerSelect.value;
  const preset = PROVIDER_PRESETS[provider];
  if (preset) {
    baseUrlInput.value = preset.baseUrl;
    modelInput.value = preset.model;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_PROVIDER_API_KEY",
      provider
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load provider key.");
    }
    apiKeyInput.value = response.apiKey || "";
  } catch (error) {
    apiKeyInput.value = "";
    setStatus(`Provider key load failed: ${error.message || String(error)}`, true);
  }

  await queueSave({ updateApiKey: false });
}

function scheduleSave(options) {
  pendingSaveOptions.updateApiKey = pendingSaveOptions.updateApiKey || Boolean(options?.updateApiKey);
  if (saveTimerId) {
    clearTimeout(saveTimerId);
  }
  saveTimerId = window.setTimeout(() => {
    const currentOptions = pendingSaveOptions;
    pendingSaveOptions = { updateApiKey: false };
    saveTimerId = null;
    void queueSave(currentOptions);
  }, AUTO_SAVE_DELAY_MS);
}

async function flushScheduledSave() {
  if (!saveTimerId) {
    return;
  }
  clearTimeout(saveTimerId);
  saveTimerId = null;
  const currentOptions = pendingSaveOptions;
  pendingSaveOptions = { updateApiKey: false };
  await queueSave(currentOptions);
}

function queueSave(options) {
  saveChain = saveChain
    .then(() => persistSettings(options))
    .catch((error) => {
      setStatus(`Save failed: ${error.message || String(error)}`, true);
    });
  return saveChain;
}

async function persistSettings(options) {
  setStatus("Saving...");
  const payload = normalizeSettings(readForm());
  const request = {
    type: "SAVE_SETTINGS",
    settings: payload,
    updateApiKey: Boolean(options?.updateApiKey),
    providerForApiKey: payload.provider
  };

  if (options?.updateApiKey) {
    request.apiKey = apiKeyInput.value;
  }

  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok || !response.settings) {
    throw new Error(response?.error || "Save failed.");
  }

  const saved = normalizeSettings(response.settings);
  fillForm(saved);
  applyPopupTheme(saved.theme);
  setStatus("Saved");
}

function readForm() {
  return {
    provider: providerSelect.value,
    baseUrl: baseUrlInput.value,
    model: modelInput.value,
    contextBeforeWords: beforeWordsInput.value,
    contextAfterWords: afterWordsInput.value,
    multiTurn: multiTurnInput.checked,
    theme: themeSelect.value,
    apiKey: apiKeyInput.value
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

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#d84b4b" : "";
}

function applyPopupTheme(mode) {
  if (typeof themeCleanup === "function") {
    themeCleanup();
    themeCleanup = null;
  }

  if (mode !== "system") {
    document.body.dataset.theme = mode;
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.body.dataset.theme = media.matches ? "dark" : "light";
  };
  const listener = () => apply();
  media.addEventListener("change", listener);
  themeCleanup = () => media.removeEventListener("change", listener);
  apply();
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
