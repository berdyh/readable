"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchLocalAgents } from "../api/localAgentsApi";
import {
  isAgentSelectable,
  pickDefaultAgent,
  shouldShowAgentPicker,
  type LocalAgentStatus,
  type LocalAgentsPayload,
} from "../model/localAgents";

export interface UseLocalAgentsResult {
  /** Whether to render the picker at all. False until the probe resolves. */
  isVisible: boolean;
  agents: LocalAgentStatus[];
  /** The agent questions will be sent to, or `undefined` if none is usable. */
  selectedAgentId: string | undefined;
  selectAgent: (agentId: string) => void;
}

/**
 * Loads the local-agent list once per mount and remembers which one the user
 * picked.
 *
 * Deliberately not persisted across sessions: the answer depends on what is
 * installed and signed in *right now*, and a remembered choice that has since
 * gone stale would put the user back where this whole change started — a
 * request failing for a reason the UI already knew about.
 */
export function useLocalAgents(enabled = true): UseLocalAgentsResult {
  const [payload, setPayload] = useState<LocalAgentsPayload | undefined>(undefined);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void fetchLocalAgents().then((next) => {
      if (cancelled) return;
      setPayload(next);
      setSelectedAgentId(pickDefaultAgent(next.agents));
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const selectAgent = useCallback(
    (agentId: string) => {
      // Guard here as well as in the markup: the picker renders unavailable
      // agents (greyed out, with the reason), so "rendered" must not imply
      // "selectable" anywhere in the chain.
      const target = payload?.agents.find((agent) => agent.id === agentId);
      if (!target || !isAgentSelectable(target)) return;
      setSelectedAgentId(agentId);
    },
    [payload],
  );

  return {
    isVisible: shouldShowAgentPicker(payload),
    agents: payload?.agents ?? [],
    selectedAgentId,
    selectAgent,
  };
}
