// Firefox exposes Promise-based APIs under browser; Chrome uses chrome.
export const api = globalThis.browser ?? globalThis.chrome;
