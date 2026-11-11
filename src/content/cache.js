export class TranslationCache {
  constructor(limit = 100) {
    this.limit = limit;
    this.entries = new Map();
  }

  get(key) {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  delete(key) {
    this.entries.delete(key);
  }
}

export function getCacheKey({ selectedText, beforeContext, afterContext, settings }) {
  return JSON.stringify({
    selectedText: selectedText.trim(),
    beforeContext: beforeContext.trim(),
    afterContext: afterContext.trim(),
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    targetLanguage: settings.targetLanguage,
    multiTurn: settings.multiTurn
  });
}
