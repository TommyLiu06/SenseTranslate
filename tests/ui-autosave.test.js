import test from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "../src/popup/autosave.js";

const timers = { setTimeout: () => 1, clearTimeout: () => {} };
const request = (provider, apiKey, updateApiKey = false) => ({
  settings: { provider, model: "model" }, providerForApiKey: provider, apiKey, updateApiKey
});

test("autosave keeps the edited provider and key when the form changes before a flush", async () => {
  const sent = [];
  const autosave = createAutosave({ timers, send: async (value) => { sent.push(value); return { ok: true }; } });
  const first = request("deepseek", "old-provider-key", true);
  autosave.schedule(first);
  first.settings.provider = "openai";
  first.apiKey = "other-provider-key";
  await autosave.flush();
  assert.equal(sent[0].settings.provider, "deepseek");
  assert.equal(sent[0].apiKey, "old-provider-key");
});

test("edits after a key edit retain the key update flag and latest values", async () => {
  let sent;
  const autosave = createAutosave({ timers, send: async (value) => { sent = value; return { ok: true }; } });
  autosave.schedule(request("deepseek", "key", true));
  autosave.schedule(request("deepseek", "key"));
  await autosave.flush();
  assert.equal(sent.updateApiKey, true);
  assert.equal(sent.apiKey, "key");
});

test("flush dispatches immediately even while an earlier save is in flight", async () => {
  const sent = [];
  const resolves = [];
  const saved = [];
  const autosave = createAutosave({
    timers,
    send: (value) => { sent.push(value); return new Promise((resolve) => resolves.push(resolve)); },
    onSaved: () => saved.push(true)
  });
  autosave.schedule(request("deepseek", "a", true));
  const first = autosave.flush();
  autosave.schedule(request("openai", "b", true));
  const second = autosave.flush();
  assert.equal(sent.length, 2);
  resolves[0]({ ok: true });
  await first;
  assert.equal(saved.length, 0);
  resolves[1]({ ok: true });
  await second;
  assert.equal(saved.length, 1);
});

test("a failed save is reported without rejecting the event handler", async () => {
  let error;
  const autosave = createAutosave({ timers, send: async () => ({ ok: false, error: "Storage full" }), onError: (value) => { error = value; } });
  autosave.schedule(request("deepseek", "key"));
  await autosave.flush();
  assert.equal(error.message, "Storage full");
});

test("scheduling another provider dispatches the previous provider's pending key first", async () => {
  const sent = [];
  const autosave = createAutosave({ timers, send: async (value) => { sent.push(value); return { ok: true }; } });
  autosave.schedule(request("deepseek", "first", true));
  autosave.schedule(request("openai", "second", true));
  assert.equal(sent[0].providerForApiKey, "deepseek");
  await autosave.flush();
  assert.equal(sent[1].providerForApiKey, "openai");
});

test("synchronous runtime failures are handled like rejected requests", async () => {
  let error;
  const autosave = createAutosave({ timers, send: () => { throw new Error("Extension reloaded"); }, onError: (value) => { error = value; } });
  autosave.schedule(request("deepseek", "key"));
  await autosave.flush();
  assert.equal(error.message, "Extension reloaded");
});
