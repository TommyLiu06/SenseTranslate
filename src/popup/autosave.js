// Capture the provider and its key when the user edits, never after a delayed save.
export function createAutosave({ send, onSaved = () => {}, onError = () => {}, delay = 350, timers = globalThis }) {
  let pending = null;
  let timer = null;
  let revision = 0;

  function flush() {
    timers.clearTimeout(timer);
    timer = null;
    if (!pending) return Promise.resolve();
    const snapshot = pending;
    const sentRevision = revision;
    pending = null;
    // Dispatch immediately. The background serializes writes even after this UI closes.
    let result;
    try { result = send(snapshot); }
    catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result)
      .then((response) => {
        if (!response?.ok) throw new Error(response?.error || "Save failed.");
        if (sentRevision === revision) onSaved(response);
      })
      .catch((error) => {
        if (sentRevision === revision) onError(error);
      });
  }

  function schedule(request) {
    if (pending && pending.providerForApiKey !== request.providerForApiKey) void flush();
    revision += 1;
    pending = {
      ...structuredClone(request),
      updateApiKey: Boolean(request.updateApiKey || (pending?.updateApiKey && pending.providerForApiKey === request.providerForApiKey))
    };
    timers.clearTimeout(timer);
    timer = timers.setTimeout(flush, delay);
  }

  return { schedule, flush };
}
