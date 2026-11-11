import { applyTheme } from '../shared/theme.js';
let popupSequence = 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function buildPopupContents(root) {
  const header = document.createElement('header');
  header.className = 'sense-translate-header';
  for (const [role, icon] of [['close', '✕'], ['explain', '✦'], ['retry', '↻']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sense-translate-btn';
    button.dataset.role = role;
    button.title = role;
    button.setAttribute('aria-label', role);
    button.textContent = icon;
    if (role !== 'close') button.style.display = 'none';
    header.appendChild(button);
  }
  const content = document.createElement('div');
  content.className = 'sense-translate-content';
  for (const [role, className, tag] of [['main', 'main', 'div'], ['divider', 'divider', 'hr'], ['explain-content', 'explain', 'div'], ['note', 'note', 'div']]) {
    const element = document.createElement(tag);
    element.dataset.role = role;
    element.className = 'sense-translate-' + className;
    if (role === 'main') element.classList.add('is-loading');
    else element.style.display = 'none';
    content.appendChild(element);
  }
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Sense Translate');
  content.setAttribute('aria-live', 'polite');
  root.append(header, content);
}

export function createPopup({ range, settings, onClose, onExplain, onRetry, isActive }) {
  popupSequence += 1;
  const popupId = `sense-translate-popup-${popupSequence}`;
  const root = document.createElement("section");
  root.id = popupId;
  root.className = "sense-translate-popup";
  buildPopupContents(root);

  const parent = document.body || document.documentElement;
  parent.appendChild(root);

  const popup = {
    id: popupId,
    root,
    range,
    streams: new Map(),
    cancellations: new Map(),
    header: root.querySelector(".sense-translate-header"),
    closeButton: root.querySelector('[data-role="close"]'),
    explainButton: root.querySelector('[data-role="explain"]'),
    retryButton: root.querySelector('[data-role="retry"]'),
    mainText: root.querySelector('[data-role="main"]'),
    divider: root.querySelector('[data-role="divider"]'),
    explainText: root.querySelector('[data-role="explain-content"]'),
    noteText: root.querySelector('[data-role="note"]'),
    positionHandler: null,
    dragCleanup: null,
    outsideClickCleanup: null,
    followSelection: true,
    themeCleanup: null,
    themeMode: settings.theme
  };

  popup.closeButton.addEventListener("click", onClose);
  popup.explainButton.addEventListener("click", onExplain);
  popup.retryButton.addEventListener("click", onRetry);

  setPopupTheme(popup, settings.theme);
  bindPositionUpdater(popup);
  bindDragController(popup);
  bindOutsideCloseHandler(popup, onClose, isActive);
  setControlsReady(popup, false);
  return popup;
}

function bindPositionUpdater(popup) {
  popup.root.style.position = "absolute";
  const updatePosition = () => {
    if (!popup.followSelection) {
      return;
    }
    if (!popup.root.isConnected) {
      return;
    }
    const targetRect = getRangeRect(popup.range);
    const margin = 12;
    const below = targetRect.bottom + 8;
    const maxTop = window.innerHeight - popup.root.offsetHeight - margin;
    const viewportTop = below > maxTop ? Math.max(margin, targetRect.top - popup.root.offsetHeight - 8) : below;
    const top = window.scrollY + Math.min(viewportTop, Math.max(margin, maxTop));
    const maxLeft = window.scrollX + window.innerWidth - popup.root.offsetWidth - margin;
    const minLeft = window.scrollX + margin;
    const left = clamp(targetRect.left + window.scrollX, minLeft, Math.max(minLeft, maxLeft));
    popup.root.style.top = `${top}px`;
    popup.root.style.left = `${left}px`;
  };

  popup.positionHandler = updatePosition;
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition, true);
  updatePosition();
}

export function detachPositionUpdater(popup) {
  if (!popup.positionHandler) {
    return;
  }
  window.removeEventListener("scroll", popup.positionHandler, true);
  window.removeEventListener("resize", popup.positionHandler, true);
  popup.positionHandler = null;
}

function bindDragController(popup) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onPointerMove = (event) => {
    if (!dragging) {
      return;
    }

    const margin = 6;
    const maxLeft = Math.max(margin, window.innerWidth - popup.root.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - popup.root.offsetHeight - margin);
    const nextLeft = clamp(event.clientX - offsetX, margin, maxLeft);
    const nextTop = clamp(event.clientY - offsetY, margin, maxTop);

    popup.root.style.left = `${nextLeft}px`;
    popup.root.style.top = `${nextTop}px`;
  };

  const onPointerUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    popup.root.classList.remove("is-dragging");
    popup.header.classList.remove("is-dragging");
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest(".sense-translate-btn")) {
      return;
    }

    const rect = popup.root.getBoundingClientRect();
    popup.followSelection = false;
    detachPositionUpdater(popup);
    popup.root.style.position = "fixed";
    popup.root.style.left = `${rect.left}px`;
    popup.root.style.top = `${rect.top}px`;
    popup.root.style.right = "auto";
    popup.root.style.bottom = "auto";

    dragging = true;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    popup.root.classList.add("is-dragging");
    popup.header.classList.add("is-dragging");
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    event.preventDefault();
  };

  popup.header.addEventListener("pointerdown", onPointerDown, true);
  popup.dragCleanup = () => {
    popup.header.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
  };
}

function bindOutsideCloseHandler(popup, onClose, isActive) {
  const onPointerDown = (event) => {
    if (!isActive()) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (popup.root.contains(target)) {
      return;
    }
    onClose();
  };

  // Delay binding to avoid reacting to the click that may have just triggered translation.
  window.setTimeout(() => {
    if (!isActive()) {
      return;
    }
    document.addEventListener("pointerdown", onPointerDown, true);
  }, 0);

  popup.outsideClickCleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}

function getRangeRect(range) {
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[rects.length - 1];
  }
  return range.getBoundingClientRect();
}

export function setControlsReady(popup, ready) {
  popup.explainButton.style.display = ready ? "inline-flex" : "none";
  popup.retryButton.style.display = ready ? "inline-flex" : "none";
}

export function hideExplanation(popup) {
  popup.divider.style.display = "none";
  popup.explainText.style.display = "none";
  popup.explainText.textContent = "";
  popup.explainText.classList.remove("is-loading");
}

export function showExplanation(popup, text) {
  popup.divider.style.display = "block";
  popup.explainText.style.display = "block";
  popup.explainText.textContent = text;
}

export function showNote(popup, text) {
  popup.noteText.style.display = "block";
  popup.noteText.textContent = text;
}

export function clearNote(popup) {
  popup.noteText.style.display = "none";
  popup.noteText.textContent = "";
}


export function setPopupTheme(popup, mode) {
  popup.themeCleanup?.();
  popup.themeCleanup = applyTheme(popup.root, mode);
}

export function destroyPopup(popup) {
  detachPositionUpdater(popup);
  popup.dragCleanup?.();
  popup.outsideClickCleanup?.();
  popup.themeCleanup?.();
  popup.root.remove();
}
