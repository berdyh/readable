import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { requireAuthenticatedUserId } from "@/server/auth";
import {
  describeLocalCodingAgents,
  isLocalAgentRuntime,
  isLocalCodingAgentActive,
} from "@/server/llm";

vi.mock("@/server/auth", () => ({
  AUTH_REQUIRED_MESSAGE: "Sign in to use personalized reading features.",
  isAuthenticationRequiredError: vi.fn(() => false),
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock("@/server/llm", () => ({
  describeLocalCodingAgents: vi.fn(),
  isLocalAgentRuntime: vi.fn(),
  isLocalCodingAgentActive: vi.fn(),
}));

describe("/api/llm/local-agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue("user_123");
    vi.mocked(isLocalAgentRuntime).mockReturnValue(true);
    vi.mocked(isLocalCodingAgentActive).mockReturnValue(true);
    vi.mocked(describeLocalCodingAgents).mockResolvedValue([]);
  });

  it("reports each agent's install and auth state", async () => {
    vi.mocked(describeLocalCodingAgents).mockResolvedValue([
      {
        agent: "codex-cli",
        displayName: "Codex",
        installed: true,
        authenticated: true,
        model: "default",
        unavailableReason: null,
      },
      {
        agent: "claude-code",
        displayName: "Claude Code",
        installed: true,
        authenticated: false,
        model: "default",
        unavailableReason: "not_authenticated",
        hint: "run `claude login`",
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.enabled).toBe(true);
    expect(payload.agents).toEqual([
      {
        id: "codex-cli",
        displayName: "Codex",
        installed: true,
        authenticated: true,
        model: "default",
        unavailableReason: null,
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        installed: true,
        authenticated: false,
        model: "default",
        unavailableReason: "not_authenticated",
        hint: "run `claude login`",
      },
    ]);
  });

  it("is disabled, not broken, where no CLI can run", async () => {
    // Deployed to a serverless platform: there is no filesystem to install a
    // CLI on. Erroring here would surface as a broken chat panel.
    vi.mocked(isLocalAgentRuntime).mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false, agents: [] });
    expect(describeLocalCodingAgents).not.toHaveBeenCalled();
  });

  it("is disabled when the app is configured to use a hosted provider", async () => {
    vi.mocked(isLocalCodingAgentActive).mockReturnValue(false);

    const response = await GET();

    await expect(response.json()).resolves.toEqual({ enabled: false, agents: [] });
    expect(describeLocalCodingAgents).not.toHaveBeenCalled();
  });

  it("degrades to disabled rather than 500 if detection throws", async () => {
    vi.mocked(describeLocalCodingAgents).mockRejectedValue(new Error("EACCES"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false, agents: [] });
  });

  it("refuses to enumerate the machine for anonymous callers", async () => {
    const { isAuthenticationRequiredError } = await import("@/server/auth");
    vi.mocked(requireAuthenticatedUserId).mockRejectedValue(new Error("nope"));
    vi.mocked(isAuthenticationRequiredError).mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(describeLocalCodingAgents).not.toHaveBeenCalled();
  });
});
