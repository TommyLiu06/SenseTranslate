import { SETTINGS_KEY, normalizeSettings, resolveProvider } from "../shared/settings.js";

export const ENCRYPTED_API_KEYS_KEY = "senseTranslateEncryptedApiKeys";
export const CRYPTO_SECRET_KEY = "senseTranslateCryptoSecret";

// Keep the original storage format so updates retain existing settings and keys.
export function createSettingsStore(api, { cryptoApi = globalThis.crypto } = {}) {
  let operation = Promise.resolve();
  let cryptoKeyPromise;

  function serialize(callback) {
    const result = operation.then(callback);
    operation = result.catch(() => {});
    return result;
  }

  async function getCryptoKey() {
    if (!cryptoKeyPromise) {
      cryptoKeyPromise = (async () => {
        const stored = await api.storage.local.get(CRYPTO_SECRET_KEY);
        let secret = stored[CRYPTO_SECRET_KEY];
        if (typeof secret !== "string" || !secret) {
          secret = bytesToBase64(cryptoApi.getRandomValues(new Uint8Array(32)));
          await api.storage.local.set({ [CRYPTO_SECRET_KEY]: secret });
        }
        return cryptoApi.subtle.importKey("raw", base64ToBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
      })().catch((error) => {
        cryptoKeyPromise = undefined;
        throw error;
      });
    }
    return cryptoKeyPromise;
  }

  async function readApiKey(providerValue) {
    const provider = resolveProvider(providerValue);
    const stored = await api.storage.local.get(ENCRYPTED_API_KEYS_KEY);
    const payload = stored[ENCRYPTED_API_KEYS_KEY]?.[provider];
    if (!payload || payload.algorithm !== "AES-GCM") return "";
    try {
      const key = await getCryptoKey();
      const plain = await cryptoApi.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data)
      );
      return new TextDecoder().decode(plain);
    } catch {
      // Invalid or unavailable local keys must not prevent opening settings.
      return "";
    }
  }

  async function writeApiKey(providerValue, value) {
    const provider = resolveProvider(providerValue);
    const stored = await api.storage.local.get(ENCRYPTED_API_KEYS_KEY);
    const existing = stored[ENCRYPTED_API_KEYS_KEY];
    const keys = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
    const plainText = typeof value === "string" ? value.trim() : "";
    if (!plainText) {
      delete keys[provider];
    } else {
      const key = await getCryptoKey();
      const iv = cryptoApi.getRandomValues(new Uint8Array(12));
      const data = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
      keys[provider] = { algorithm: "AES-GCM", iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
    }
    await api.storage.local.set({ [ENCRYPTED_API_KEYS_KEY]: keys });
  }

  async function readSettings() {
    const stored = await api.storage.sync.get(SETTINGS_KEY);
    const raw = stored[SETTINGS_KEY] || {};
    const settings = normalizeSettings(raw);
    // Older releases stored a plaintext key in sync storage. Migrate it once.
    if (typeof raw.apiKey === "string") {
      if (raw.apiKey.trim() && !(await readApiKey(settings.provider))) {
        await writeApiKey(settings.provider, raw.apiKey);
      }
      await api.storage.sync.set({ [SETTINGS_KEY]: settings });
    }
    return settings;
  }

  return {
    getStoredSettings: () => serialize(readSettings),
    getSettings: ({ includeApiKey = true } = {}) => serialize(async () => {
      const settings = await readSettings();
      return includeApiKey ? { ...settings, apiKey: await readApiKey(settings.provider) } : settings;
    }),
    getProviderApiKey: (provider) => serialize(() => readApiKey(provider)),
    saveSettings: (nextSettings, options = {}) => serialize(async () => {
      const current = await readSettings();
      const settings = normalizeSettings({ ...current, ...nextSettings });
      if (options.updateApiKey) {
        await writeApiKey(resolveProvider(options.providerForApiKey, settings.provider), options.apiKey);
      }
      if (JSON.stringify(current) !== JSON.stringify(settings)) {
        await api.storage.sync.set({ [SETTINGS_KEY]: settings });
      }
      return { ...settings, apiKey: await readApiKey(settings.provider) };
    })
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0));
}
