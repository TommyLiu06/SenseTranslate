const REQUEST_TIMEOUT_MS = 120_000;
const MAX_EVENT_LENGTH = 1_048_576;

export async function streamChatCompletion({ settings, messages, onDelta, signal, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  let baseUrl;
  try {
    baseUrl = new URL(settings.baseUrl);
  } catch {
    throw new Error("Please enter a valid HTTP or HTTPS Base URL in Sense Translate settings.");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const body = { model: settings.model, messages, stream: true, temperature: 0.2 };
  if (settings.provider === "deepseek" && ["deepseek-v4-flash", "deepseek-v4-pro"].includes(settings.model)) {
    body.thinking = { type: "disabled" };
  }

  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(body),
      signal: requestSignal
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`API request failed (${response.status}): ${detail}`);
    }
    if (!response.body) throw new Error("API response body is empty.");
    return await readCompletionStream(response.body, onDelta, requestSignal);
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error("API request timed out. Please retry.");
    throw error;
  }
}

export async function readCompletionStream(body, onDelta, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let aggregate = "";
  let finished = false;

  function dispatch() {
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data.length > MAX_EVENT_LENGTH) throw new Error("API streaming event exceeded the size limit.");
    if (data.trim() === "[DONE]") {
      finished = true;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("API returned an invalid streaming response.");
    }
    if (payload.error) {
      const detail = typeof payload.error === "string" ? payload.error : payload.error.message;
      throw new Error(`API stream failed: ${String(detail || "Unknown provider error").slice(0, 400)}`);
    }
    const token = extractDeltaText(payload);
    if (token) {
      aggregate += token;
      onDelta(token);
    }
  }

  function processLine(line) {
    if (line === "") dispatch();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }

  function consume(final = false) {
    while (!finished) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) break;
      // A CR at a chunk boundary may be followed by LF in the next chunk.
      if (!final && match[0] === "\r" && match.index === buffer.length - 1) break;
      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      processLine(line);
    }
    if (buffer.length + dataLines.reduce((size, line) => size + line.length, 0) > MAX_EVENT_LENGTH) {
      throw new Error("API streaming event exceeded the size limit.");
    }
    if (final && !finished) {
      if (buffer) processLine(buffer);
      buffer = "";
      dispatch();
    }
  }

  const abort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (!finished) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      consume(done);
      if (done) break;
    }
    if (!aggregate.trim()) throw new Error("API returned no translation text.");
    return aggregate.trim();
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function extractDeltaText(payload) {
  const choice = payload?.choices?.[0];
  const delta = choice?.delta || choice?.message;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content.map((item) => typeof item === "string" ? item : typeof item?.text === "string" ? item.text : "").join("");
  }
  return "";
}
