"use client";

import { useCallback, useState } from "react";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

import type { QuestionSelection } from "@/server/qa/types";
import type { Block } from "../../block-editor/types";

import { useChatPanelWidth } from "../hooks/useChatPanelWidth";
import { useChatSessions } from "../hooks/useChatSessions";
import { useLocalAgents } from "../hooks/useLocalAgents";
import { createLocalId } from "../model/types";
import { LocalAgentPicker } from "../primitives/local-agent-picker";
import { ChatAuthGate } from "./ChatAuthGate";
import { ChatComposer } from "./ChatComposer";
import { ChatPanelHeader } from "./ChatPanelHeader";
import { ChatResizeHandle } from "./ChatResizeHandle";
import { ChatTranscript } from "./ChatTranscript";

export interface ChatSidePanelProps {
  paperId: string;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  onInsertBlocks?: (blocks: Block[], insertIndex?: number) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
}

/**
 * The docked research-chat sidecar. Composition only: session state comes from
 * `useChatSessions`, geometry from `useChatPanelWidth`, and every child below is
 * presentational.
 */
export function ChatSidePanel({
  paperId,
  isOpen,
  onToggle,
  onInsertBlocks,
  selection,
  onSelectionClear,
}: ChatSidePanelProps) {
  const [input, setInput] = useState("");
  const { mounted, width, isResizing, onResizePointerDown, onResizeKeyDown } = useChatPanelWidth();

  // Probe only once the panel is actually open — the answer is about the
  // server's machine, not the paper, and asking on every mount would spawn a
  // PATH scan behind a panel nobody looked at.
  const localAgents = useLocalAgents(mounted && isOpen);

  const chat = useChatSessions({
    paperId,
    isOpen,
    enabled: mounted,
    selection,
    onSelectionClear,
    localAgent: localAgents.selectedAgentId,
  });

  const submit = useCallback(
    (question: string) => {
      setInput("");
      void chat.sendQuestion(question);
    },
    [chat],
  );

  const handleNewChat = useCallback(() => {
    setInput("");
    void chat.startNewChat();
  }, [chat]);

  const insertAnswer = useCallback(() => {
    const answer = chat.lastAssistantMessage;
    if (!answer || !onInsertBlocks) {
      return;
    }

    onInsertBlocks([
      {
        id: createLocalId("chat"),
        type: "callout",
        content: answer.content,
        metadata: { type: "info", locked: true },
      },
    ]);
  }, [chat.lastAssistantMessage, onInsertBlocks]);

  if (!isOpen || !mounted) {
    return null;
  }

  return (
    <aside
      className={clsx(
        "relative z-10 flex min-h-[640px] w-full flex-col border-t border-zinc-200 bg-zinc-50 text-zinc-900",
        "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100",
        // top-20 keeps the panel header clear of the fixed account chip.
        "lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)] lg:min-h-0 lg:w-[var(--chat-panel-width)] lg:shrink-0 lg:border-l lg:border-t-0",
        isResizing && "select-none",
      )}
      style={{ "--chat-panel-width": `${width}px` } as React.CSSProperties}
      aria-label="Research chat"
    >
      <ChatResizeHandle
        width={width}
        isResizing={isResizing}
        onPointerDown={onResizePointerDown}
        onKeyDown={onResizeKeyDown}
      />

      {!chat.isLoaded ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-label="Loading chat" />
        </div>
      ) : !chat.isSignedIn ? (
        <ChatAuthGate onClose={() => onToggle(false)} />
      ) : (
        <>
          <ChatPanelHeader
            paperId={paperId}
            tabs={chat.tabs}
            activeTabId={chat.activeTab?.id}
            isSubmitting={chat.isSubmitting}
            onSelectTab={chat.setActiveTabId}
            onCloseTab={(tabId) => void chat.closeTab(tabId)}
            onNewChat={handleNewChat}
            onClose={() => onToggle(false)}
          />

          {localAgents.isVisible ? (
            <LocalAgentPicker
              agents={localAgents.agents}
              selectedAgentId={localAgents.selectedAgentId}
              onSelect={localAgents.selectAgent}
              disabled={chat.isSubmitting}
            />
          ) : null}

          {chat.isLoadingHistory ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Loading saved chats…</span>
            </div>
          ) : (
            <>
              <ChatTranscript
                messages={chat.activeTab?.messages ?? []}
                paperId={paperId}
                isSubmitting={chat.isSubmitting}
                onPrompt={submit}
              />
              <ChatComposer
                value={input}
                onChange={setInput}
                onSubmit={() => submit(input)}
                isSubmitting={chat.isSubmitting}
                selectedText={selection?.text?.trim()}
                onSelectionClear={onSelectionClear}
                error={chat.error}
                canInsertAnswer={Boolean(chat.lastAssistantMessage && onInsertBlocks)}
                onInsertAnswer={insertAnswer}
              />
            </>
          )}
        </>
      )}
    </aside>
  );
}
