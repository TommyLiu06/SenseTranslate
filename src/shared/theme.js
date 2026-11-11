import { normalizeTheme } from "./settings.js";

/** Apply a theme and return the listener cleanup for its owner. */
export function applyTheme(element, mode) {
  if (normalizeTheme(mode) !== "system") {
    element.dataset.theme = normalizeTheme(mode);
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => { element.dataset.theme = media.matches ? "dark" : "light"; };
  media.addEventListener("change", update);
  update();
  return () => media.removeEventListener("change", update);
}
