"use client";

import { MessageSquare, MessageSquarePlus, PanelRightClose } from "lucide-react";

import type { ChatTab } from "../model/types";
import { ChatTabStrip } from "./ChatTabStrip";

/** Sidecar identity, panel actions, and the saved-chat tab strip. */
export function ChatPanelHeader({
  paperId,
  tabs,
  activeTabId,
  isSubmitting,
  onSelectTab,
  onCloseTab,
  onNewChat,
  onClose,
}: {
  paperId: string;
  tabs: ChatTab[];
  activeTabId?: string;
  isSubmitting: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-col border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Research chat</h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{paperId}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            disabled={isSubmitting}
            className="touch-target relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="touch-target relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close chat"
            title="Close chat"
          >
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ChatTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        disabled={isSubmitting}
        onSelect={onSelectTab}
        onClose={onCloseTab}
      />
    </header>
  );
}
