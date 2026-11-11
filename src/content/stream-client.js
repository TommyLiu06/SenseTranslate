// One port owns one request. Disconnecting it cancels the network request.
export function openStream(runtime, request, handlers, timers = globalThis) {
  let port;
  let heartbeat;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    timers.clearInterval(heartbeat);
    port?.onMessage.removeListener(onMessage);
    port?.onDisconnect.removeListener(onDisconnect);
    port?.disconnect();
  };
  const onDisconnect = () => {
    if (finished) return;
    const error = runtime.lastError?.message || "Translation connection closed. Please retry.";
    cleanup();
    handlers.onError(error);
  };
  const onMessage = (message) => {
    if (finished || message?.requestId !== request.requestId) return;
    if (message.type === "STREAM_CHUNK") {
      handlers.onChunk(message.chunk || "");
    } else if (message.type === "STREAM_DONE") {
      cleanup();
      handlers.onDone(message.text || "");
    } else if (message.type === "STREAM_ERROR") {
      cleanup();
      handlers.onError(message.error || "Unknown stream error.");
    }
  };
  try {
    port = runtime.connect({ name: "sense-translate-stream" });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    heartbeat = timers.setInterval(() => {
      try { port.postMessage({ type: "PING" }); }
      catch { onDisconnect(); }
    }, 20_000);
    port.postMessage({ ...request, type: "START_STREAM" });
  } catch (error) {
    cleanup();
    // Defer failures so callers can register the returned cancel function first.
    queueMicrotask(() => handlers.onError(error.message || String(error)));
  }
  return cleanup;
}
