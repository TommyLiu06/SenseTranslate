import test from "node:test";
import assert from "node:assert/strict";
import { TranslationCache, getCacheKey } from "../src/content/cache.js";
import { pickWords } from "../src/content/selection.js";
import { openStream } from "../src/content/stream-client.js";

test("translation cache evicts the least recently used entry", () => {
  const cache = new TranslationCache(2);
  cache.set("a", { translation: "A" });
  cache.set("b", { translation: "B" });
  cache.get("a");
  cache.set("c", { translation: "C" });
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a").translation, "A");
});

test("cache keys include endpoint and conversation settings", () => {
  const input = { selectedText: "a", beforeContext: "b", afterContext: "c", settings: { provider: "openai", model: "custom", baseUrl: "https://one.test", multiTurn: true } };
  const first = getCacheKey(input);
  assert.notEqual(first, getCacheKey({ ...input, settings: { ...input.settings, baseUrl: "https://two.test" } }));
  assert.notEqual(first, getCacheKey({ ...input, settings: { ...input.settings, multiTurn: false } }));
});

test("context word limits handle whitespace and invalid counts", () => {
  assert.equal(pickWords(" one\n two\tthree ", 2, true), "two three");
  assert.equal(pickWords(" one\n two\tthree ", 2, false), "one two");
  assert.equal(pickWords("one two", -1, true), "");
  assert.equal(pickWords("one two", 0, false), "");
});

function streamHarness() {
  const listeners = () => ({
    values: new Set(),
    addListener(fn) { this.values.add(fn); },
    removeListener(fn) { this.values.delete(fn); },
    emit(value) { for (const fn of this.values) fn(value); }
  });
  const messages = [];
  let disconnects = 0;
  let cleared = 0;
  const port = {
    onMessage: listeners(), onDisconnect: listeners(),
    postMessage: (message) => messages.push(message),
    disconnect: () => { disconnects += 1; port.onDisconnect.emit(); }
  };
  const runtime = { connect: () => port };
  const timers = { setInterval: () => 1, clearInterval: () => { cleared += 1; } };
  return { port, runtime, timers, messages, disconnects: () => disconnects, cleared: () => cleared };
}

test("stream completion disconnects and ignores trailing events", () => {
  const harness = streamHarness();
  const chunks = [];
  const results = [];
  const errors = [];
  openStream(harness.runtime, { requestId: "id" }, { onChunk: (chunk) => chunks.push(chunk), onDone: (text) => results.push(text), onError: (error) => errors.push(error) }, harness.timers);
  harness.port.onMessage.emit({ type: "STREAM_CHUNK", requestId: "another", chunk: "wrong" });
  harness.port.onMessage.emit({ type: "STREAM_CHUNK", requestId: "id", chunk: "hello" });
  harness.port.onMessage.emit({ type: "STREAM_DONE", requestId: "id", text: "hello" });
  harness.port.onMessage.emit({ type: "STREAM_CHUNK", requestId: "id", chunk: "late" });
  assert.deepEqual(chunks, ["hello"]);
  assert.deepEqual(results, ["hello"]);
  assert.deepEqual(errors, []);
  assert.equal(harness.disconnects(), 1);
  assert.equal(harness.cleared(), 1);
});

test("explicit cancellation disconnects without reporting an error", () => {
  const harness = streamHarness();
  const errors = [];
  const cancel = openStream(harness.runtime, { requestId: "id" }, { onChunk() {}, onDone() {}, onError: (error) => errors.push(error) }, harness.timers);
  cancel();
  cancel();
  assert.deepEqual(errors, []);
  assert.equal(harness.disconnects(), 1);
});

test("unexpected port disconnection reports a useful error", () => {
  const harness = streamHarness();
  harness.runtime.lastError = { message: "Background stopped" };
  const errors = [];
  openStream(harness.runtime, { requestId: "id" }, { onChunk() {}, onDone() {}, onError: (error) => errors.push(error) }, harness.timers);
  harness.port.onDisconnect.emit();
  assert.deepEqual(errors, ["Background stopped"]);
});
