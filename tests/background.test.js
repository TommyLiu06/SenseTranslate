import test from "node:test";
import assert from "node:assert/strict";
import { registerBackground, STREAM_PORT_NAME } from "../src/background/controller.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { buildPrompts } from "../src/background/prompts.js";

function event() {
  const listeners = [];
  return { listeners, addListener: (listener) => listeners.push(listener), emit: (...args) => listeners.map((listener) => listener(...args)) };
}

function fixture(streamCompletion = async () => "translated") {
  const api = {
    runtime: { id: "extension-id", getURL: (path) => `moz-extension://extension-id/${path}`, onMessage: event(), onConnect: event(), onInstalled: event(), onStartup: event() },
    contextMenus: { onClicked: event(), remove: async () => {}, create: () => {} },
    tabs: { onUpdated: event(), onRemoved: event(), sendMessage: async () => {} }
  };
  const store = {
    getSettings: async ({ includeApiKey = true } = {}) => includeApiKey ? { ...DEFAULT_SETTINGS, apiKey: "secret" } : { ...DEFAULT_SETTINGS },
    getProviderApiKey: async () => "secret", saveSettings: async (settings) => settings
  };
  registerBackground(api, { store, streamCompletion });
  return { api, store };
}

const contentSender = { id: "extension-id", tab: { id: 0, url: "https://example.com/" }, frameId: 0, url: "https://example.com/" };
const popupSender = { id: "extension-id", url: "moz-extension://extension-id/popup.html" };

function request(api, message, sender) {
  return new Promise((resolve) => api.runtime.onMessage.emit(message, sender, resolve));
}

function createPort(sender = contentSender) {
  return {
    name: STREAM_PORT_NAME, sender, onMessage: event(), onDisconnect: event(), sent: [], disconnected: false,
    postMessage(message) { this.sent.push(message); },
    disconnect() { if (!this.disconnected) { this.disconnected = true; this.onDisconnect.emit(); } }
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const streamRequest = { type: "START_STREAM", requestId: "request-1", mode: "translate", selectedText: "hello" };

test("content settings omit credentials and settings writes require the popup sender", async () => {
  const { api } = fixture();
  const publicResponse = await request(api, { type: "GET_SETTINGS" }, contentSender);
  assert.equal(Object.hasOwn(publicResponse.settings, "apiKey"), false);
  assert.equal((await request(api, { type: "GET_SETTINGS" }, popupSender)).settings.apiKey, "secret");
  assert.equal((await request(api, { type: "GET_SETTINGS" }, { ...popupSender, tab: { id: 1 } })).settings.apiKey, "secret");
  assert.equal((await request(api, { type: "GET_PROVIDER_API_KEY", provider: "deepseek" }, contentSender)).ok, false);
  assert.equal((await request(api, { type: "SAVE_SETTINGS", settings: {} }, contentSender)).ok, false);
});

test("ports stream text, retain completed conversation context, and disconnect", async () => {
  const calls = [];
  const { api } = fixture(async (options) => {
    calls.push(options);
    options.onDelta("translated");
    return "translated";
  });
  for (let index = 0; index < 2; index += 1) {
    const port = createPort();
    api.runtime.onConnect.emit(port);
    port.onMessage.emit(streamRequest);
    await tick();
    assert.deepEqual(port.sent.map((message) => message.type), ["STREAM_CHUNK", "STREAM_DONE"]);
    assert.equal(port.disconnected, true);
  }
  assert.equal(calls[0].messages.length, 2);
  assert.equal(calls[1].messages.length, 4);
  const otherFrame = createPort({ ...contentSender, frameId: 2 });
  api.runtime.onConnect.emit(otherFrame);
  otherFrame.onMessage.emit(streamRequest);
  await tick();
  assert.equal(calls[2].messages.length, 2);
});

test("closing a port aborts the provider request and suppresses terminal events", async () => {
  let signal;
  const { api } = fixture(async (options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const port = createPort();
  api.runtime.onConnect.emit(port);
  port.onMessage.emit(streamRequest);
  await tick();
  port.disconnect();
  await tick();
  assert.equal(signal.aborted, true);
  assert.equal(port.sent.length, 0);
});

test("navigation clears history and aborts active streams for that tab", async () => {
  let hold = false;
  let activeSignal;
  const lengths = [];
  const { api } = fixture(async (options) => {
    lengths.push(options.messages.length);
    activeSignal = options.signal;
    if (hold) return new Promise((resolve, reject) => activeSignal.addEventListener("abort", () => reject(activeSignal.reason), { once: true }));
    return "done";
  });
  const first = createPort();
  api.runtime.onConnect.emit(first);
  first.onMessage.emit(streamRequest);
  await tick();
  hold = true;
  const pending = createPort();
  api.runtime.onConnect.emit(pending);
  pending.onMessage.emit(streamRequest);
  await tick();
  api.tabs.onUpdated.emit(0, { status: "loading" });
  assert.equal(activeSignal.aborted, true);
  await tick();
  hold = false;
  const third = createPort();
  api.runtime.onConnect.emit(third);
  third.onMessage.emit(streamRequest);
  await tick();
  assert.deepEqual(lengths, [2, 4, 2]);
});

test("invalid stream requests return errors and explanations use their own task", async () => {
  const { api } = fixture();
  const port = createPort();
  api.runtime.onConnect.emit(port);
  port.onMessage.emit({ ...streamRequest, selectedText: "" });
  await tick();
  assert.equal(port.sent[0].type, "STREAM_ERROR");
  const prompts = buildPrompts({ selectedText: "hello", mode: "explain", targetLanguage: "Japanese" }, DEFAULT_SETTINGS);
  assert.match(prompts.systemPrompt, /EXPLAIN_SELECTED_TEXT/);
  assert.match(prompts.systemPrompt, /Japanese/);
  assert.match(prompts.userPrompt, /hello/);
});
