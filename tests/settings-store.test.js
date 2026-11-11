import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsStore, CRYPTO_SECRET_KEY, ENCRYPTED_API_KEYS_KEY } from "../src/background/settings-store.js";
import { SETTINGS_KEY, DEFAULT_SETTINGS } from "../src/shared/settings.js";

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  let writes = 0;
  return {
    data,
    get writes() { return writes; },
    async get(key) { await Promise.resolve(); return structuredClone({ [key]: data[key] }); },
    async set(values) { await Promise.resolve(); writes += 1; Object.assign(data, structuredClone(values)); }
  };
}

function fixture(initial) {
  const api = { storage: { sync: storageArea(initial), local: storageArea() } };
  return { api, store: createSettingsStore(api) };
}

test("migrates legacy sync key to encrypted local storage without changing provider settings", async () => {
  const { store, api } = fixture({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, model: "custom-model", apiKey: " legacy-secret " } });
  const settings = await store.getSettings();
  assert.equal(settings.apiKey, "legacy-secret");
  assert.equal(settings.model, "custom-model");
  assert.equal(Object.hasOwn(api.storage.sync.data[SETTINGS_KEY], "apiKey"), false);
  assert.ok(api.storage.local.data[CRYPTO_SECRET_KEY]);
  assert.ok(api.storage.local.data[ENCRYPTED_API_KEYS_KEY].deepseek.data);
  assert.equal(JSON.stringify(api.storage.local.data).includes("legacy-secret"), false);
  const publicSettings = await store.getSettings({ includeApiKey: false });
  assert.equal(Object.hasOwn(publicSettings, "apiKey"), false);
});

test("serializes concurrent provider writes and reuses one encryption key", async () => {
  const { store, api } = fixture();
  await Promise.all([
    store.saveSettings({}, { updateApiKey: true, providerForApiKey: "deepseek", apiKey: "deepseek-secret" }),
    store.saveSettings({}, { updateApiKey: true, providerForApiKey: "openai", apiKey: "openai-secret" }),
    store.saveSettings({ contextBeforeWords: 35 }),
    store.saveSettings({ contextAfterWords: 17 })
  ]);
  assert.equal(await store.getProviderApiKey("deepseek"), "deepseek-secret");
  assert.equal(await store.getProviderApiKey("openai"), "openai-secret");
  const settings = await store.getStoredSettings();
  assert.equal(settings.contextBeforeWords, 35);
  assert.equal(settings.contextAfterWords, 17);
  const restored = createSettingsStore(api);
  assert.equal(await restored.getProviderApiKey("deepseek"), "deepseek-secret");
  assert.equal(await restored.getProviderApiKey("openai"), "openai-secret");
});

test("key edits avoid sync writes and deleting one provider retains the others", async () => {
  const { store, api } = fixture({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  await store.saveSettings({}, { updateApiKey: true, providerForApiKey: "deepseek", apiKey: "one" });
  await store.saveSettings({}, { updateApiKey: true, providerForApiKey: "openai", apiKey: "two" });
  await store.saveSettings({}, { updateApiKey: true, providerForApiKey: "deepseek", apiKey: "" });
  assert.equal(api.storage.sync.writes, 0);
  assert.equal(await store.getProviderApiKey("deepseek"), "");
  assert.equal(await store.getProviderApiKey("openai"), "two");
});

test("a failed storage operation does not poison later saves", async () => {
  const { store, api } = fixture();
  const original = api.storage.sync.set;
  api.storage.sync.set = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(store.saveSettings({ theme: "dark" }), /storage unavailable/);
  api.storage.sync.set = original;
  assert.equal((await store.saveSettings({ theme: "light" })).theme, "light");
});
