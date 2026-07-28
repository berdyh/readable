"use client";

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";

import type { ChatTab } from "../model/types";

/** Saved conversations for this paper. */
export function ChatTabStrip({
  tabs,
  activeTabId,
  disabled,
  onSelect,
  onClose,
}: {
  tabs: ChatTab[];
  activeTabId?: string;
  disabled: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto px-3 pb-2" role="tablist" aria-label="Saved chats">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;

        return (
          <div
            key={tab.id}
            className={clsx(
              "group inline-flex h-8 max-w-[190px] shrink-0 items-center rounded-md border text-xs transition-colors duration-150",
              isActive
                ? "border-zinc-300 bg-zinc-100 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            )}
            title={tab.title}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left"
            >
              {tab.title}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              disabled={disabled}
              className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition-opacity duration-150 hover:bg-zinc-200 hover:text-rose-600 focus:opacity-100 disabled:cursor-not-allowed group-hover:opacity-100 dark:hover:bg-zinc-700"
              aria-label={`Delete ${tab.title}`}
              title="Delete chat"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
