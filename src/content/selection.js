export function extractContextFromRange(range, beforeWordCount, afterWordCount) {
  try {
    const body = document.body || document.documentElement;
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(body);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(body);
    afterRange.setStart(range.endContainer, range.endOffset);
    return {
      beforeContext: pickWords(beforeRange.toString(), beforeWordCount, true),
      afterContext: pickWords(afterRange.toString(), afterWordCount, false)
    };
  } catch {
    return { beforeContext: "", afterContext: "" };
  }
}

export function pickWords(text, count, fromEnd) {
  const size = Math.max(0, Math.trunc(Number(count) || 0));
  if (!size) return "";
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return (fromEnd ? words.slice(-size) : words.slice(0, size)).join(" ");
}
