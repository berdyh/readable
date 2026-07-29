"use client";

import { clsx } from "clsx";
import { GripVertical } from "lucide-react";

import { getPanelWidthBounds } from "../model/panelWidth";

/**
 * Drag/keyboard handle on the sidecar's left edge. The hit area is 12px wide
 * while the painted rule stays 1px, so the target is comfortable without
 * thickening the seam between the paper and the chat.
 */
export function ChatResizeHandle({
  width,
  isResizing,
  onPointerDown,
  onKeyDown,
}: {
  width: number;
  isResizing: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const bounds = getPanelWidthBounds();

  return (
    <div
      role="separator"
      aria-label="Resize chat panel"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Resize chat panel"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={clsx(
        "group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1.5 cursor-col-resize touch-none items-center justify-center outline-none lg:flex",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-zinc-200 after:transition-[width,background-color] after:duration-150 after:content-['']",
        "hover:after:w-0.5 hover:after:bg-emerald-500 focus-visible:after:w-0.5 focus-visible:after:bg-emerald-500",
        "dark:after:bg-zinc-800 dark:hover:after:bg-emerald-400 dark:focus-visible:after:bg-emerald-400",
        isResizing && "after:w-0.5 after:bg-emerald-500 dark:after:bg-emerald-400",
      )}
    >
      <GripVertical
        className={clsx(
          "pointer-events-none h-5 w-5 rounded bg-white/90 p-0.5 text-zinc-400 shadow-sm transition-opacity duration-150 dark:bg-zinc-950/90 dark:text-zinc-500",
          isResizing
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
        aria-hidden="true"
      />
    </div>
  );
}
