/**
 * Sidecar width math. Pure except for reading `window.innerWidth`, so the
 * resizer hook stays free of geometry rules.
 */

export const CHAT_PANEL_WIDTH_STORAGE_KEY = "readable:chat-panel-width";
export const DEFAULT_CHAT_PANEL_WIDTH = 460;
export const MIN_CHAT_PANEL_WIDTH = 360;
export const MAX_CHAT_PANEL_WIDTH = 760;

/** Space kept for the reading column so the panel can never eat the whole page. */
const DESKTOP_PANEL_MARGIN = 80;

export function getPanelWidthBounds(): { min: number; max: number } {
  if (typeof window === "undefined") {
    return { min: MIN_CHAT_PANEL_WIDTH, max: MAX_CHAT_PANEL_WIDTH };
  }

  const viewportWidth = window.innerWidth;
  if (viewportWidth < 640) {
    return { min: viewportWidth, max: viewportWidth };
  }

  const max = Math.min(MAX_CHAT_PANEL_WIDTH, viewportWidth - DESKTOP_PANEL_MARGIN);
  const min = Math.min(MIN_CHAT_PANEL_WIDTH, max);
  return { min, max: Math.max(min, max) };
}

export function clampChatPanelWidth(width: number): number {
  const { min, max } = getPanelWidthBounds();
  if (!Number.isFinite(width)) {
    return Math.min(DEFAULT_CHAT_PANEL_WIDTH, max);
  }
  return Math.min(Math.max(width, min), max);
}
