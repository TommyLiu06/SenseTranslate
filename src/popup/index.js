import { api } from "../shared/browser.js";
import { DEFAULT_SETTINGS, PROVIDER_PRESETS, PROVIDER_API_KEY_PLACEHOLDER, normalizeSettings } from "../shared/settings.js";
import { applyTheme } from "../shared/theme.js";
import { createAutosave } from "./autosave.js";
import { CUSTOM_MODEL_OPTION, createModelControls } from "./model-controls.js";

const form = document.getElementById("settings-form");
const field = (id) => document.getElementById(id);
const providerSelect = field("provider");
const apiKeyInput = field("apiKey");
const baseUrlInput = field("baseUrl");
const modelPresetSelect = field("modelPreset");
const modelCustomInput = field("modelCustom");
const targetLanguageSelect = field("targetLanguage");
const beforeWordsInput = field("beforeWords");
const afterWordsInput = field("afterWords");
const multiTurnInput = field("multiTurn");
const themeSelect = field("theme");
const statusText = field("status");
const controls = createModelControls(modelPresetSelect, modelCustomInput);
let activeProvider = DEFAULT_SETTINGS.provider;
let providerRevision = 0;
let themeCleanup = null;
let loaded = false;

const autosave = createAutosave({
  send: (request) => api.runtime.sendMessage(request),
  onSaved: () => setStatus("Saved."),
  onError: (error) => setStatus(`Save failed: ${error.message || String(error)}`, true)
});

function readSettings() {
  return normalizeSettings({
    provider: activeProvider,
    baseUrl: baseUrlInput.value,
    model: controls.getModelFromInputs(),
    targetLanguage: targetLanguageSelect.value,
    contextBeforeWords: beforeWordsInput.value,
    contextAfterWords: afterWordsInput.value,
    multiTurn: multiTurnInput.checked,
    theme: themeSelect.value
  });
}

function scheduleSave(updateApiKey = false) {
  if (!loaded) return;
  try {
    autosave.schedule({
      type: "SAVE_SETTINGS",
      settings: readSettings(),
      updateApiKey,
      providerForApiKey: activeProvider,
      apiKey: apiKeyInput.value
    });
    setStatus("Saving...");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

form.addEventListener("submit", (event) => event.preventDefault());
apiKeyInput.addEventListener("input", () => scheduleSave(true));
for (const input of [baseUrlInput, modelCustomInput, beforeWordsInput, afterWordsInput]) {
  input.addEventListener("input", () => scheduleSave());
}
for (const input of [targetLanguageSelect, multiTurnInput]) {
  input.addEventListener("change", () => scheduleSave());
}
modelPresetSelect.addEventListener("change", () => {
  controls.applyModelInputVisibility();
  if (modelPresetSelect.value === CUSTOM_MODEL_OPTION && !modelCustomInput.value.trim()) {
    modelCustomInput.focus();
    return;
  }
  scheduleSave();
});
themeSelect.addEventListener("change", () => {
  updateTheme(themeSelect.value);
  scheduleSave();
});
providerSelect.addEventListener("change", () => void changeProvider());
window.addEventListener("pagehide", () => {
  void autosave.flush();
  themeCleanup?.();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void autosave.flush();
});

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#d84b4b" : "";
}

function updateTheme(mode) {
  themeCleanup?.();
  themeCleanup = applyTheme(document.body, mode);
}

function updateApiKeyPlaceholder() {
  apiKeyInput.placeholder = PROVIDER_API_KEY_PLACEHOLDER[activeProvider] || "API key";
}

async function changeProvider() {
  // The previous snapshot still contains the previous provider, endpoint, and key.
  void autosave.flush();
  const revision = ++providerRevision;
  activeProvider = providerSelect.value;
  const provider = activeProvider;
  const preset = PROVIDER_PRESETS[provider];
  baseUrlInput.value = preset.baseUrl;
  controls.syncModelControls(provider, preset.model);
  apiKeyInput.value = "";
  apiKeyInput.disabled = true;
  updateApiKeyPlaceholder();
  scheduleSave();
  try {
    const response = await api.runtime.sendMessage({ type: "GET_PROVIDER_API_KEY", provider });
    if (revision !== providerRevision) return;
    if (!response?.ok) throw new Error(response?.error || "Failed to load provider key.");
    apiKeyInput.value = response.apiKey || "";
  } catch (error) {
    if (revision === providerRevision) setStatus(`Provider key load failed: ${error.message || String(error)}`, true);
  } finally {
    if (revision === providerRevision) apiKeyInput.disabled = false;
  }
}

function fillForm(raw) {
  const settings = normalizeSettings(raw);
  activeProvider = settings.provider;
  providerSelect.value = settings.provider;
  updateApiKeyPlaceholder();
  apiKeyInput.value = raw.apiKey || "";
  baseUrlInput.value = settings.baseUrl;
  controls.syncModelControls(settings.provider, settings.model);
  if (!Array.from(targetLanguageSelect.options).some((option) => option.value === settings.targetLanguage)) {
    const option = document.createElement("option");
    option.value = option.textContent = settings.targetLanguage;
    targetLanguageSelect.appendChild(option);
  }
  targetLanguageSelect.value = settings.targetLanguage;
  beforeWordsInput.value = settings.contextBeforeWords;
  afterWordsInput.value = settings.contextAfterWords;
  multiTurnInput.checked = settings.multiTurn;
  themeSelect.value = settings.theme;
  updateTheme(settings.theme);
}

async function load() {
  for (const input of form.elements) input.disabled = true;
  try {
    const response = await api.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok || !response.settings) throw new Error(response?.error || "Load failed.");
    fillForm(response.settings);
    loaded = true;
  } catch (error) {
    fillForm(DEFAULT_SETTINGS);
    setStatus(`Load failed: ${error.message || String(error)}. Reopen settings to retry.`, true);
  } finally {
    // Leave failed loads read-only so a transient failure cannot overwrite saved settings.
    for (const input of form.elements) input.disabled = !loaded;
  }
}

void load();
