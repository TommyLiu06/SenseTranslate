export const SETTINGS_KEY = "senseTranslateSettings";

export const PROVIDER_PRESETS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash"
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

export const PROVIDER_API_KEY_PLACEHOLDER = {
  deepseek: "DeepSeek API key",
  glm: "GLM API key",
  glm_coding: "GLM Coding API key",
  qwen: "DashScope API key",
  openai: "OpenAI API key"
};

export const PROVIDER_MODELS = {
  deepseek: [
    { id: "deepseek-v4-flash", label: "deepseek-v4-flash", recommended: true, fastest: true },
    { id: "deepseek-v4-pro", label: "deepseek-v4-pro", recommended: true, fastest: false }
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

export const DEFAULT_SETTINGS = {
  provider: "deepseek",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  contextBeforeWords: 80,
  contextAfterWords: 80,
  multiTurn: true,
  targetLanguage: "Simplified Chinese",
  theme: "system"
};

export function normalizeSettings(raw = {}) {
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
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

export function resolveProvider(value, fallback = DEFAULT_SETTINGS.provider) {
  if (typeof value === "string" && Object.hasOwn(PROVIDER_PRESETS, value)) {
    return value;
  }
  return fallback;
}

export function normalizeTheme(value) {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return DEFAULT_SETTINGS.theme;
}

export function normalizeTargetLanguage(value) {
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

export function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

