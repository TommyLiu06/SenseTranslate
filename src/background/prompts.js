import { normalizeTargetLanguage } from "../shared/settings.js";

export function buildPrompts(message, settings) {
  const selectedText = String(message.selectedText || "").trim();
  const beforeContext = String(message.beforeContext || "").trim();
  const afterContext = String(message.afterContext || "").trim();
  const targetLanguage = normalizeTargetLanguage(message.targetLanguage || settings.targetLanguage);

  if (message.mode === "explain") {
    return {
      systemPrompt: [
        "You are Sense Translate.",
        "Current task: EXPLAIN_SELECTED_TEXT.",
        "Explain the selected text itself based on surrounding context.",
        `Respond in ${targetLanguage}.`,
        "Focus on meaning, references, tone, and possible ambiguity.",
        "Do not use Markdown formatting."
      ].join(" "),
      userPrompt: [
        "TASK=EXPLAIN_SELECTED_TEXT",
        `Please explain the selected text clearly in ${targetLanguage}.`,
        "",
        `Selected text: ${selectedText || "(empty)"}`,
        `Context before: ${beforeContext || "(empty)"}`,
        `Context after: ${afterContext || "(empty)"}`,
        "",
        "Output requirements:",
        "1) Start with one concise summary sentence.",
        "2) Then provide 2-4 short plain-text detail sentences.",
        "3) Do not use markdown syntax, headings, bullet lists, code blocks, or tables."
      ].join("\n")
    };
  }

  return {
    systemPrompt: [
      "You are Sense Translate.",
      "Current task: TRANSLATE.",
      `Translate selected text into ${targetLanguage} using surrounding context.`,
      "Keep terminology accurate, natural, concise, and faithful to intent.",
      "Output only the translated text without extra commentary."
    ].join(" "),
    userPrompt: [
      "TASK=TRANSLATE",
      `Selected text:\n${selectedText || "(empty)"}`,
      `Context before:\n${beforeContext || "(empty)"}`,
      `Context after:\n${afterContext || "(empty)"}`
    ].join("\n\n")
  };
}

