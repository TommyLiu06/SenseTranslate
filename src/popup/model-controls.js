import { DEFAULT_SETTINGS, PROVIDER_PRESETS, PROVIDER_MODELS } from "../shared/settings.js";
export const CUSTOM_MODEL_OPTION = "__custom_model__";

export function createModelControls(modelPresetSelect, modelCustomInput) {
  function syncModelControls(provider, modelValue) {
    const modelOptions = getProviderModelOptions(provider);
    renderModelOptions(modelOptions);

    const defaultModel = PROVIDER_PRESETS[provider]?.model || DEFAULT_SETTINGS.model;
    const normalizedModel = String(modelValue ?? "").trim() || defaultModel;
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
    modelPresetSelect.replaceChildren();
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

  return { syncModelControls, applyModelInputVisibility, getModelFromInputs };
}
