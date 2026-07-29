"use client";

import { clsx } from "clsx";
import { Terminal } from "lucide-react";

import {
  describeAgentUnavailability,
  isAgentSelectable,
  type LocalAgentStatus,
} from "../model/localAgents";

/**
 * Which local CLI answers questions — Claude Code or Codex.
 *
 * Unavailable agents are rendered, not hidden. Hiding them would leave the
 * user wondering why the agent they installed is missing; showing them greyed
 * out with the reason turns a mystery into a to-do ("not signed in — run
 * `codex login`"). They are disabled at the button level as well as visually,
 * so keyboard and pointer agree.
 */
export function LocalAgentPicker({
  agents,
  selectedAgentId,
  onSelect,
  disabled = false,
}: {
  agents: readonly LocalAgentStatus[];
  selectedAgentId?: string;
  onSelect: (agentId: string) => void;
  disabled?: boolean;
}) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
      role="radiogroup"
      aria-label="Local coding agent"
    >
      <Terminal className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {agents.map((agent) => {
          const selectable = isAgentSelectable(agent);
          const unavailability = describeAgentUnavailability(agent);
          const isSelected = selectable && agent.id === selectedAgentId;

          return (
            <button
              key={agent.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // The reason is the accessible name's suffix, not just a
              // `title` — a tooltip that only appears on hover is invisible to
              // the users most likely to be confused by a dead control.
              aria-label={unavailability ? `${agent.displayName} — ${unavailability}` : undefined}
              title={unavailability ?? `Answer with ${agent.displayName}`}
              disabled={disabled || !selectable}
              onClick={() => onSelect(agent.id)}
              className={clsx(
                "touch-target rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150",
                isSelected
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                !selectable &&
                  "cursor-not-allowed text-zinc-300 hover:bg-transparent dark:text-zinc-600 dark:hover:bg-transparent",
                disabled && selectable && "cursor-not-allowed opacity-50",
              )}
            >
              {agent.displayName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
