"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Check, Trash2, X } from "lucide-react";

import type { ChatTab } from "../model/types";

/**
 * Saved conversations for this paper.
 *
 * Closing a tab deletes the session on the server, so the trash control is
 * always visible (never hover-only, which is invisible on touch) and asks for a
 * second click before it destroys anything.
 */
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <div
      className="flex gap-1 overflow-x-auto px-3 pb-2"
      role="tablist"
      aria-label="Saved chats"
    >
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        const isPendingDelete = pendingDeleteId === tab.id;

        return (
          <div
            key={tab.id}
            className={clsx(
              "inline-flex h-8 max-w-[190px] shrink-0 items-center rounded-md border text-xs transition-colors duration-150",
              isPendingDelete
                ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
                : isActive
                  ? "border-zinc-300 bg-zinc-100 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            )}
            title={tab.title}
          >
            {isPendingDelete ? (
              <>
                <span className="px-2.5 py-1.5 font-medium">Delete chat?</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDeleteId(null);
                    onClose(tab.id);
                  }}
                  disabled={disabled}
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-r-md text-rose-600 transition-colors duration-150 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300 dark:hover:bg-rose-900/50"
                  aria-label={`Confirm deleting ${tab.title}`}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-r-md text-zinc-500 transition-colors duration-150 hover:bg-rose-100 dark:text-zinc-400 dark:hover:bg-rose-900/50"
                  aria-label="Keep chat"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
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
                  onClick={() => setPendingDeleteId(tab.id)}
                  disabled={disabled}
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-r-md text-zinc-400 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label={`Delete ${tab.title}`}
                  title="Delete chat"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
