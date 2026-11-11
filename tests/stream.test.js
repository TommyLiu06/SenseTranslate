import test from "node:test";
import assert from "node:assert/strict";
import { readCompletionStream, streamChatCompletion } from "../src/background/stream.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";

const encoder = new TextEncoder();
const event = (content, ending = "\n\n") => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}${ending}`;

function streamChunks(chunks, { close = true, onCancel = () => {} } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      if (close) controller.close();
    },
    cancel: onCancel
  });
}

test("decodes byte-split Unicode and CRLF and stops at DONE before the connection closes", async () => {
  const bytes = encoder.encode(`: keepalive\r\n\r\n${event("你好 ", "\r\n\r\n")}${event("世界", "\r\n\r\n")}data: [DONE]\r\n\r\n`);
  let canceled = false;
  const chunks = [];
  const result = await readCompletionStream(streamChunks(Array.from(bytes, (byte) => Uint8Array.of(byte)), {
    close: false, onCancel: () => { canceled = true; }
  }), (chunk) => chunks.push(chunk));
  assert.equal(result, "你好 世界");
  assert.deepEqual(chunks, ["你好 ", "世界"]);
  assert.equal(canceled, true);
});

test("flushes final events without a terminating newline and supports content arrays", async () => {
  const chunks = [];
  const result = await readCompletionStream(streamChunks([
    event([{ text: "Hello" }, " world"]),
    event("!", "")
  ]), (chunk) => chunks.push(chunk));
  assert.equal(result, "Hello world!");
  assert.deepEqual(chunks, ["Hello world", "!"]);
});

test("joins multiline SSE data and accepts bare CR delimiters", async () => {
  const result = await readCompletionStream(streamChunks([
    'event: message\rdata: {"choices":\rdata: [{"delta":{"content":"hello"}}]}\r\rdata: [DONE]\r\r'
  ]), () => {});
  assert.equal(result, "hello");
});

test("reports malformed events, API stream errors, and empty model output", async () => {
  await assert.rejects(readCompletionStream(streamChunks(["data: invalid\n\n"]), () => {}), /invalid streaming/);
  await assert.rejects(readCompletionStream(streamChunks(['data: {"error":{"message":"quota exceeded"}}\n\n']), () => {}), /quota exceeded/);
  await assert.rejects(readCompletionStream(streamChunks(['data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\ndata: [DONE]\n\n']), () => {}), /no translation/);
});

test("rejects a complete oversized SSE event received in one chunk", async () => {
  let emitted = false;
  await assert.rejects(readCompletionStream(streamChunks([event("a".repeat(1_048_577))]), () => { emitted = true; }), /size limit/);
  await assert.rejects(readCompletionStream(streamChunks([`data: ${" ".repeat(1_048_577)}[DONE]\n\n`]), () => {}), /size limit/);
  assert.equal(emitted, false);
});

test("aborting a pending stream cancels its reader", async () => {
  const controller = new AbortController();
  let canceled = false;
  const pending = readCompletionStream(streamChunks([], { close: false, onCancel: () => { canceled = true; } }), () => {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true);
});

test("sends provider parameters and authentication and surfaces HTTP failures", async () => {
  const settings = { ...DEFAULT_SETTINGS, apiKey: "test-key" };
  let request;
  const result = await streamChatCompletion({
    settings, messages: [{ role: "user", content: "hello" }], onDelta: () => {},
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(event("translated") + "data: [DONE]\n\n");
    }
  });
  assert.equal(result, "translated");
  assert.equal(request.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(request.options.body).thinking, { type: "disabled" });
  await assert.rejects(streamChatCompletion({ settings, messages: [], onDelta: () => {}, fetchImpl: async () => new Response("denied", { status: 401 }) }), /401.*denied/);
});

test("rejects invalid URL protocols before fetch and permits local HTTP services", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(event("local")); };
  for (const baseUrl of ["file:///private", "javascript:alert(1)", "ftp://example.com/"]) {
    await assert.rejects(streamChatCompletion({ settings: { ...DEFAULT_SETTINGS, baseUrl }, messages: [], onDelta: () => {}, fetchImpl }), /must use HTTP or HTTPS/);
  }
  await assert.rejects(streamChatCompletion({ settings: { ...DEFAULT_SETTINGS, baseUrl: "not a URL" }, messages: [], onDelta: () => {}, fetchImpl }), /valid HTTP or HTTPS Base URL/);
  assert.equal(calls, 0);
  const result = await streamChatCompletion({ settings: { ...DEFAULT_SETTINGS, baseUrl: "http://127.0.0.1:3456/v1" }, messages: [], onDelta: () => {}, fetchImpl });
  assert.equal(result, "local");
  assert.equal(calls, 1);
});
