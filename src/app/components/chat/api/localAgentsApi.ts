/**
 * The one call that asks which local coding agents this machine can run.
 *
 * Route: `GET /api/llm/local-agents`.
 */
import type { LocalAgentsPayload } from "../model/localAgents";

const DISABLED: LocalAgentsPayload = { enabled: false, agents: [] };

/**
 * Never throws. The picker is an enhancement to a chat panel that works
 * without it, so a failed probe means "no picker", not "no chat" — and the
 * route already answers `{ enabled: false }` rather than erroring for the
 * expected cases, leaving only transport failures to absorb here.
 */
export async function fetchLocalAgents(): Promise<LocalAgentsPayload> {
  try {
    const response = await fetch("/api/llm/local-agents", { cache: "no-store" });
    if (!response.ok) {
      return DISABLED;
    }
    return (await response.json()) as LocalAgentsPayload;
  } catch {
    return DISABLED;
  }
}
