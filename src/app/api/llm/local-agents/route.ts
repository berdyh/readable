import { NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import {
  describeLocalCodingAgents,
  isLocalAgentRuntime,
  isLocalCodingAgentActive,
} from "@/server/llm";
import type { LocalAgentsResponse } from "@/server/llm/types";

const DISABLED: LocalAgentsResponse = { enabled: false, agents: [] };

/**
 * Which local coding agents this machine can actually run.
 *
 * Gated on auth deliberately: the answer describes the operator's machine —
 * which CLIs are installed and whether they are signed in — and that is not
 * something an anonymous reader of a public paper should be able to enumerate.
 *
 * Returns `{ enabled: false, agents: [] }` rather than an error in the two
 * cases where the question is meaningless: deployed to a serverless platform
 * where no CLI can exist, or configured to use a hosted provider. The client
 * hides the picker on `enabled: false`, so "disabled" and "empty" collapse to
 * the same UI without the client needing to know why.
 */
export async function GET() {
  try {
    await requireAuthenticatedUserId();
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    throw error;
  }

  if (!isLocalAgentRuntime() || !isLocalCodingAgentActive()) {
    return NextResponse.json(DISABLED, { status: 200 });
  }

  try {
    const agents = await describeLocalCodingAgents();
    return NextResponse.json(
      {
        enabled: true,
        agents: agents.map((agent) => ({
          id: agent.agent,
          displayName: agent.displayName,
          installed: agent.installed,
          authenticated: agent.authenticated,
          model: agent.model,
          unavailableReason: agent.unavailableReason,
          hint: agent.hint,
        })),
      } satisfies LocalAgentsResponse,
      { status: 200 },
    );
  } catch (error) {
    // Detection stats files and scans PATH; a permissions surprise should
    // degrade to "no picker", never to a broken chat panel.
    console.error("[llm] Failed to describe local coding agents", error);
    return NextResponse.json(DISABLED, { status: 200 });
  }
}
