const AUTO_SAVE_DELAY_MS = 350;
const CUSTOM_MODEL_OPTION = "__custom_model__";

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

const PROVIDER_API_KEY_PLACEHOLDER = {
  deepseek: "DeepSeek API key",
  glm: "GLM API key",
  glm_coding: "GLM Coding API key",
  qwen: "DashScope API key",
  openai: "OpenAI API key"
};

const PROVIDER_MODELS = {
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat", recommended: true, fastest: true },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner", recommended: false, fastest: false }
  ],
  glm: [
    { id: "glm-4.5-air", label: "GLM 4.5 Air", recommended: true, fastest: true },
    { id: "glm-4.6", label: "GLM 4.6", recommended: true, fastest: false },
    { id: "glm-4.7", label: "GLM 4.7", recommended: false, fastest: false },
    { id: "glm-4.5", label: "GLM 4.5", recommended: false, fastest: false }
  ],
  glm_coding: [
    { id: "glm-4.5-air", label: "GLM 4.5 Air", recommended: true, fastest: true },
    { id: "glm-4.6", label: "GLM 4.6", recommended: true, fastest: false },
    { id: "glm-4.7", label: "GLM 4.7", recommended: false, fastest: false },
    { id: "codegeex-4", label: "CodeGeeX 4", recommended: false, fastest: false }
  ],
  qwen: [
    { id: "qwen-turbo", label: "Qwen Turbo", recommended: true, fastest: true },
    { id: "qwen-plus", label: "Qwen Plus", recommended: true, fastest: false },
    { id: "qwen-max", label: "Qwen Max", recommended: false, fastest: false },
    { id: "qwen3-coder-flash", label: "Qwen3 Coder Flash", recommended: false, fastest: false },
    { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", recommended: false, fastest: false }
  ],
  openai: [
    { id: "gpt-5-nano", label: "GPT-5 Nano", recommended: false, fastest: true },
    { id: "gpt-5-mini", label: "GPT-5 Mini", recommended: true, fastest: false },
    { id: "gpt-5", label: "GPT-5", recommended: false, fastest: false },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", recommended: true, fastest: false },
    { id: "gpt-4.1", label: "GPT-4.1", recommended: false, fastest: false },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", recommended: false, fastest: false }
  ]
};

const DEFAULT_SETTINGS = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  contextBeforeWords: 80,
  contextAfterWords: 80,
  multiTurn: true,
  targetLanguage: "Simplified Chinese",
  theme: "system"
};

const form = document.getElementById("settings-form");
const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const baseUrlInput = document.getElementById("baseUrl");
const modelPresetSelect = document.getElementById("modelPreset");
const modelCustomInput = document.getElementById("modelCustom");
const targetLanguageSelect = document.getElementById("targetLanguage");
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

modelPresetSelect.addEventListener("change", () => {
  applyModelInputVisibility();
  scheduleSave({ updateApiKey: false });
});

modelCustomInput.addEventListener("input", () => {
  scheduleSave({ updateApiKey: false });
});

targetLanguageSelect.addEventListener("change", () => {
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
  updateApiKeyPlaceholder(provider);
  const preset = PROVIDER_PRESETS[provider];
  if (preset) {
    baseUrlInput.value = preset.baseUrl;
    syncModelControls(provider, preset.model);
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
    model: getModelFromInputs(),
    targetLanguage: targetLanguageSelect.value,
    contextBeforeWords: beforeWordsInput.value,
    contextAfterWords: afterWordsInput.value,
    multiTurn: multiTurnInput.checked,
    theme: themeSelect.value,
    apiKey: apiKeyInput.value
  };
}

function fillForm(settings) {
  providerSelect.value = settings.provider;
  updateApiKeyPlaceholder(settings.provider);
  apiKeyInput.value = settings.apiKey || "";
  baseUrlInput.value = settings.baseUrl;
  syncModelControls(settings.provider, settings.model);
  ensureSelectHasOption(targetLanguageSelect, settings.targetLanguage);
  targetLanguageSelect.value = settings.targetLanguage;
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

function syncModelControls(provider, modelValue) {
  const modelOptions = getProviderModelOptions(provider);
  renderModelOptions(modelOptions);

  const defaultModel = PROVIDER_PRESETS[provider]?.model || DEFAULT_SETTINGS.model;
  const normalizedModel = normalizeText(modelValue, defaultModel);
  const hasPreset = modelOptions.some((item) => item.id === normalizedModel);

  if (hasPreset) {
    modelPresetSelect.value = normalizedModel;
    modelCustomInput.value = "";
  } else {
    modelPresetSelect.value = CUSTOM_MODEL_OPTION;
    modelCustomInput.value = normalizedModel;
  }
  applyModelInputVisibility();
}

function getProviderModelOptions(provider) {
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS[DEFAULT_SETTINGS.provider];
  const source = Array.isArray(PROVIDER_MODELS[provider]) ? PROVIDER_MODELS[provider] : [];
  const options = [...source];

  if (!options.some((item) => item.id === preset.model)) {
    options.push({
      id: preset.model,
      label: preset.model,
      recommended: true,
      fastest: false
    });
  }

  return options;
}

function renderModelOptions(modelOptions) {
  modelPresetSelect.innerHTML = "";
  for (const item of modelOptions) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = formatModelOptionLabel(item);
    modelPresetSelect.appendChild(option);
  }

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_MODEL_OPTION;
  customOption.textContent = "Manual input";
  modelPresetSelect.appendChild(customOption);
}

function formatModelOptionLabel(item) {
  const baseLabel = item.id;
  const tags = [];
  if (item.recommended) {
    tags.push("Recommended");
  }
  if (item.fastest) {
    tags.push("Fastest");
  }
  if (tags.length === 0) {
    return baseLabel;
  }
  return `${baseLabel} (${tags.join(", ")})`;
}

function applyModelInputVisibility() {
  const useCustomModel = modelPresetSelect.value === CUSTOM_MODEL_OPTION;
  modelCustomInput.classList.toggle("hidden", !useCustomModel);
}

function getModelFromInputs() {
  if (modelPresetSelect.value === CUSTOM_MODEL_OPTION) {
    return modelCustomInput.value.trim();
  }
  return modelPresetSelect.value;
}

function normalizeSettings(raw) {
  const provider = raw.provider in PROVIDER_PRESETS ? raw.provider : DEFAULT_SETTINGS.provider;
  const preset = PROVIDER_PRESETS[provider];
  return {
    provider,
    apiKey: String(raw.apiKey || "").trim(),
    baseUrl: normalizeText(raw.baseUrl, preset.baseUrl).replace(/\/+$/, ""),
    model: normalizeText(raw.model, preset.model),
    targetLanguage: normalizeTargetLanguage(raw.targetLanguage),
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

function normalizeTargetLanguage(value) {
  const text = String(value ?? "").trim();
  return text || DEFAULT_SETTINGS.targetLanguage;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function ensureSelectHasOption(select, value) {
  if (!value) {
    return;
  }
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) {
    return;
  }
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function updateApiKeyPlaceholder(provider) {
  const resolvedProvider = provider in PROVIDER_API_KEY_PLACEHOLDER ? provider : DEFAULT_SETTINGS.provider;
  apiKeyInput.placeholder = PROVIDER_API_KEY_PLACEHOLDER[resolvedProvider] || "API key";
}
