import { resolveProvider } from "../shared/settings.js";
import { createSettingsStore } from "./settings-store.js";
import { buildPrompts } from "./prompts.js";
import { streamChatCompletion } from "./stream.js";

const MENU_ID = "sense-translate-menu";
export const STREAM_PORT_NAME = "sense-translate-stream";
const MAX_CONVERSATIONS = 100;

export function registerBackground(api, { store = createSettingsStore(api), streamCompletion = streamChatCompletion } = {}) {
  const conversations = new Map();
  const activeRequests = new Map();

  if (api.storage?.local?.setAccessLevel) {
    void api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      .catch((error) => console.warn("Failed to restrict credential storage access:", error));
  }

  async function createContextMenu() {
    try {
      await api.contextMenus.remove(MENU_ID);
    } catch {
      // The first installation has no menu to remove.
    }
    // Chrome and Firefox both support the callback overload on the chrome API;
    // browser.contextMenus.create returns an ID and reports errors by exception.
    api.contextMenus.create({ id: MENU_ID, title: "Sense Translate", contexts: ["selection"] });
  }

  const installMenu = () => void createContextMenu().catch((error) => console.warn("Failed to create context menu:", error));
  api.runtime.onInstalled.addListener(installMenu);
  api.runtime.onStartup.addListener(installMenu);
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !Number.isInteger(tab?.id)) return;
    const options = Number.isInteger(info.frameId) ? { frameId: info.frameId } : {};
    void api.tabs.sendMessage(tab.id, {
      type: "SENSE_TRANSLATE_TRIGGER", selectedText: info.selectionText || ""
    }, options).catch((error) => console.warn("Failed to trigger translation:", error));
  });

  function clearTab(tabId) {
    for (const key of conversations.keys()) {
      if (key.startsWith(`${tabId}:`)) conversations.delete(key);
    }
    for (const [port, request] of activeRequests) {
      if (port.sender?.tab?.id === tabId) {
        request.abort();
        port.disconnect();
      }
    }
  }
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") clearTab(tabId);
  });
  api.tabs.onRemoved.addListener(clearTab);

  function isSettingsPage(sender) {
    return sender?.id === api.runtime.id && sender.url === api.runtime.getURL("popup.html");
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    let task;
    if (message.type === "GET_SETTINGS") {
      task = store.getSettings({ includeApiKey: isSettingsPage(sender) }).then((settings) => ({ settings }));
    } else if (message.type === "GET_PROVIDER_API_KEY" || message.type === "SAVE_SETTINGS") {
      if (!isSettingsPage(sender)) {
        sendResponse({ ok: false, error: "Settings changes are only available from the extension popup." });
        return false;
      }
      if (message.type === "GET_PROVIDER_API_KEY") {
        const provider = resolveProvider(message.provider);
        task = store.getProviderApiKey(provider).then((apiKey) => ({ provider, apiKey }));
      } else {
        task = store.saveSettings(message.settings || {}, {
          updateApiKey: Boolean(message.updateApiKey), providerForApiKey: message.providerForApiKey,
          apiKey: typeof message.apiKey === "string" ? message.apiKey : ""
        }).then((settings) => ({ settings }));
      }
    } else {
      return false;
    }
    task.then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    // Callback responses work in Chrome and Firefox without claiming unrelated messages.
    return true;
  });

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== STREAM_PORT_NAME) return;
    if (port.sender?.id !== api.runtime.id || !Number.isInteger(port.sender?.tab?.id)) {
      port.disconnect();
      return;
    }
    let started = false;
    let disconnected = false;
    const controller = new AbortController();
    activeRequests.set(port, controller);

    function send(payload) {
      if (!disconnected) {
        try { port.postMessage(payload); } catch { controller.abort(); }
      }
    }
    port.onDisconnect.addListener(() => {
      disconnected = true;
      controller.abort();
      activeRequests.delete(port);
    });
    port.onMessage.addListener((message) => {
      if (message?.type === "PING") return;
      if (started || message?.type !== "START_STREAM") return;
      started = true;
      void runRequest(message, port.sender, controller.signal, send)
        .catch((error) => {
          if (!controller.signal.aborted) send({
            type: "STREAM_ERROR", requestId: message.requestId, mode: message.mode,
            error: error.message || String(error)
          });
        })
        .finally(() => {
          activeRequests.delete(port);
          port.disconnect();
        });
    });
  });

  async function runRequest(message, sender, signal, send) {
    if (typeof message.requestId !== "string" || !message.requestId) throw new Error("Missing requestId.");
    if (message.mode !== "translate" && message.mode !== "explain") throw new Error("Unknown translation mode.");
    if (typeof message.selectedText !== "string" || !message.selectedText.trim()) throw new Error("Select text before translating.");
    const settings = await store.getSettings();
    signal.throwIfAborted();
    if (!settings.apiKey) throw new Error("Please set API Key in Sense Translate settings.");
    const key = getConversationKey(sender, settings);
    const contextMessages = settings.multiTurn ? conversations.get(key) || [] : [];
    const { systemPrompt, userPrompt } = buildPrompts(message, settings);
    const text = await streamCompletion({
      settings, signal,
      messages: [{ role: "system", content: systemPrompt }, ...contextMessages.slice(-10), { role: "user", content: userPrompt }],
      onDelta: (chunk) => send({ type: "STREAM_CHUNK", requestId: message.requestId, mode: message.mode, chunk })
    });
    signal.throwIfAborted();
    if (settings.multiTurn) {
      conversations.delete(key);
      conversations.set(key, [...contextMessages, { role: "user", content: userPrompt }, { role: "assistant", content: text }].slice(-20));
      if (conversations.size > MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value);
    }
    send({ type: "STREAM_DONE", requestId: message.requestId, mode: message.mode, text });
  }
}

function getConversationKey(sender, settings) {
  // Keep histories isolated by frame and endpoint when provider settings change.
  return `${sender.tab.id}:${sender.frameId ?? 0}:${sender.url || sender.tab.url || ""}:${settings.provider}:${settings.baseUrl}:${settings.model}:${settings.targetLanguage}`;
}
