"use client";

import { useCallback, useEffect, useState } from "react";

import {
  CHAT_PANEL_WIDTH_STORAGE_KEY,
  DEFAULT_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  getPanelWidthBounds,
} from "../model/panelWidth";

const NUDGE_STEP = 16;
const NUDGE_STEP_LARGE = 48;

/**
 * Sidecar width: persisted across sessions, clamped to the viewport, and
 * drivable by pointer or keyboard. `mounted` also gates the first paint so the
 * server never renders a width read from localStorage.
 */
export function useChatPanelWidth() {
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY));
    const restored = clampChatPanelWidth(savedWidth || DEFAULT_CHAT_PANEL_WIDTH);

    // Deferred so the restore is not a synchronous cascading render, matching
    // the queueMicrotask pattern already used in SkillsPanel.
    queueMicrotask(() => {
      setWidth(restored);
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(CHAT_PANEL_WIDTH_STORAGE_KEY, String(width));
  }, [mounted, width]);

  useEffect(() => {
    const handleResize = () => setWidth((current) => clampChatPanelWidth(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keep the resize cursor while dragging even when the pointer leaves the
  // handle, and stop the drag from selecting the transcript behind it.
  useEffect(() => {
    if (!isResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  const setWidthFromClientX = useCallback((clientX: number) => {
    setWidth(clampChatPanelWidth(window.innerWidth - clientX));
  }, []);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      setWidthFromClientX(event.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => setWidthFromClientX(moveEvent.clientX);
      const stopResize = () => {
        setIsResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [setWidthFromClientX],
  );

  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setWidth((current) => clampChatPanelWidth(current + step));
        break;
      case "ArrowRight":
        event.preventDefault();
        setWidth((current) => clampChatPanelWidth(current - step));
        break;
      case "Home":
        event.preventDefault();
        setWidth(getPanelWidthBounds().max);
        break;
      case "End":
        event.preventDefault();
        setWidth(getPanelWidthBounds().min);
        break;
      default:
        break;
    }
  }, []);

  return { mounted, width, isResizing, onResizePointerDown, onResizeKeyDown };
}
