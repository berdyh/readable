/**
 * Client view of the local coding agents the server says this machine can run.
 *
 * Derived from `@/server/llm/types` rather than redeclared, on the same rule
 * the chat wire types follow: the server owns the shape, so a route change
 * breaks this file at compile time instead of producing a picker that silently
 * renders nothing.
 */
import type { LocalAgentsResponse, LocalAgentWireStatus } from "@/server/llm/types";

export type LocalAgentStatus = LocalAgentWireStatus;
export type LocalAgentsPayload = LocalAgentsResponse;

/** Can the user pick this agent? */
export function isAgentSelectable(agent: LocalAgentStatus): boolean {
  return agent.unavailableReason === null;
}

/**
 * Why the user cannot pick this agent, in their words rather than the wire's.
 * `undefined` for a selectable agent — the caller uses that to decide whether
 * a tooltip is warranted at all.
 *
 * The server also sends a `hint` (the install/login command). It is appended
 * rather than substituted: "Not installed" alone leaves the user guessing, and
 * the raw hint alone reads like an instruction without saying what is wrong.
 */
export function describeAgentUnavailability(agent: LocalAgentStatus): string | undefined {
  const reason = agent.unavailableReason;
  if (reason === null) return undefined;

  const summary =
    reason === "not_installed"
      ? `${agent.displayName} is not installed.`
      : reason === "not_authenticated"
        ? `${agent.displayName} is installed but not signed in.`
        : `${agent.displayName} is not enabled for local use.`;

  return agent.hint ? `${summary} ${agent.hint}` : summary;
}

/**
 * Which agent to start on: the first selectable one, in the server's
 * preference order.
 *
 * Returns `undefined` when nothing is usable. That is a real state — every CLI
 * missing or signed out — and it has to stay distinguishable from "not loaded
 * yet", because the two render differently.
 */
export function pickDefaultAgent(agents: readonly LocalAgentStatus[]): string | undefined {
  return agents.find(isAgentSelectable)?.id;
}

/**
 * Is the picker worth rendering at all?
 *
 * A single agent is still worth showing — it tells the user which one is
 * answering. An empty or disabled list is not: there is nothing to choose
 * between and nothing to report.
 */
export function shouldShowAgentPicker(payload: LocalAgentsPayload | undefined): boolean {
  return Boolean(payload?.enabled && payload.agents.length > 0);
}
