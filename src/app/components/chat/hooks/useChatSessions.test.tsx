import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The last two of the six chat flows (docs/open-issues.md): sending and
 * receiving a message, and session persistence across a reload. Both are
 * fetch orchestration, so they are tested at the hook that owns every
 * chat network call, with `fetch` mocked at the route level.
 */

const clerk = vi.hoisted(() => ({
  useUser: vi.fn(() => ({ isLoaded: true, isSignedIn: true })),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: clerk.useUser,
}));

import { useChatSessions } from "./useChatSessions";

interface RouteLog {
  method: string;
  url: string;
  body?: unknown;
}

const fetchMock = vi.fn();
const requests: RouteLog[] = [];

interface StubOptions {
  history?: unknown;
  qaFails?: boolean;
}

function stubRoutes(options: StubOptions = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    if (url.startsWith("/api/chat/history") && method === "GET") {
      return new Response(JSON.stringify(options.history ?? { sessions: [] }), { status: 200 });
    }
    if (url.startsWith("/api/chat/history") && method === "POST") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.startsWith("/api/chat/session")) {
      return new Response(
        JSON.stringify({ session: { id: "session-1", paperId: "p", createdAt: "" } }),
        {
          status: 200,
        },
      );
    }
    if (url.startsWith("/api/qa")) {
      if (options.qaFails) {
        return new Response(JSON.stringify({ error: "QA exploded." }), { status: 502 });
      }
      return new Response(
        JSON.stringify({
          answer: "Self-attention weighs every token against the others.",
          cites: [{ chunkId: "S1-p1", page: 3, quote: "self-attention" }],
          trust: { status: "sourced", hasEvidence: true },
          source: "model_knowledge",
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  });
}

const hookProps = { paperId: "arxiv:1706.03762", isOpen: true, enabled: true };

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockReset();
  stubRoutes();
  vi.stubGlobal("fetch", fetchMock);
  clerk.useUser.mockReturnValue({ isLoaded: true, isSignedIn: true });
});

describe("chat flow: sending and receiving a message", () => {
  it("creates a session, persists both sides, and renders the answer with its trust + source", async () => {
    const { result } = renderHook(() => useChatSessions(hookProps));

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    await act(async () => {
      await result.current.sendQuestion("What is self-attention?");
    });

    const messages = result.current.activeTab?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "What is self-attention?" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "Self-attention weighs every token against the others.",
    });
    // Trust arrives with the source label folded in for the chip.
    expect(messages[1].trust).toMatchObject({ status: "sourced", source: "model_knowledge" });
    expect(messages[1].citations?.[0]).toMatchObject({ chunkId: "S1-p1", page: 3 });

    // The tab took its title from the first question.
    expect(result.current.activeTab?.title).toBe("What is self-attention?");

    // Both sides were persisted to history, in order: user then assistant.
    const saves = requests.filter(
      (request) => request.url.startsWith("/api/chat/history") && request.method === "POST",
    );
    expect(saves).toHaveLength(2);
    const savedRoles = saves.map(
      (request) => (request.body as { message: { role: string } }).message.role,
    );
    expect(savedRoles).toEqual(["user", "assistant"]);
    // The persisted assistant row carries trust under metadata (wire shape).
    const persistedAssistant = saves[1].body as {
      message: { metadata?: { version: number; trust?: { source?: string } } };
    };
    expect(persistedAssistant.message.metadata?.trust?.source).toBe("model_knowledge");
  });

  it("keeps the user message and shows an error bubble when QA fails", async () => {
    stubRoutes({ qaFails: true });

    const { result } = renderHook(() => useChatSessions(hookProps));
    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    await act(async () => {
      await result.current.sendQuestion("Will this fail?");
    });

    const messages = result.current.activeTab?.messages ?? [];
    expect(messages[0]).toMatchObject({ role: "user", content: "Will this fail?" });
    expect(messages[1]).toMatchObject({ role: "assistant", status: "error" });
    expect(result.current.error).toBe("QA exploded.");
  });
});

describe("chat flow: session persistence across a reload", () => {
  const persistedHistory = {
    sessions: [
      {
        sessionId: "session-9",
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: "m1", role: "user", content: "What is attention?", createdAt: 1 },
          {
            id: "m2",
            role: "assistant",
            content: "A weighting over inputs.",
            citations: [{ chunkId: "S1-p1", page: 2, quote: "attention" }],
            metadata: {
              version: 1,
              trust: { status: "sourced", hasEvidence: true, source: "cited_text" },
            },
            createdAt: 2,
          },
        ],
      },
    ],
  };

  it("restores saved sessions after a reload, with trust lifted for rendering", async () => {
    stubRoutes({ history: persistedHistory });

    // First mount — the "session before the reload".
    const first = renderHook(() => useChatSessions(hookProps));
    await waitFor(() => {
      expect(first.result.current.isLoadingHistory).toBe(false);
    });
    expect(first.result.current.activeTab?.sessionId).toBe("session-9");
    first.unmount();

    // Reload: a fresh mount must rebuild the same tabs from the server.
    const second = renderHook(() => useChatSessions(hookProps));
    await waitFor(() => {
      expect(second.result.current.isLoadingHistory).toBe(false);
    });

    const tab = second.result.current.activeTab;
    expect(tab?.sessionId).toBe("session-9");
    expect(tab?.title).toBe("What is attention?");
    expect(tab?.messages).toHaveLength(2);

    const assistant = tab?.messages[1];
    expect(assistant?.content).toBe("A weighting over inputs.");
    // fromWireMessage lifts metadata.trust to the top level…
    expect(assistant?.trust).toMatchObject({ status: "sourced", source: "cited_text" });
    // …and narrows citations to renderable sources.
    expect(assistant?.citations?.[0]).toMatchObject({ chunkId: "S1-p1", page: 2 });
  });

  it("falls back to a fresh draft tab when no history exists", async () => {
    const { result } = renderHook(() => useChatSessions(hookProps));

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    expect(result.current.activeTab?.sessionId).toBeNull();
    expect(result.current.activeTab?.messages).toEqual([]);
  });

  it("never fetches history for signed-out readers", async () => {
    clerk.useUser.mockReturnValue({ isLoaded: true, isSignedIn: false });

    renderHook(() => useChatSessions(hookProps));

    await waitFor(() => {
      expect(clerk.useUser).toHaveBeenCalled();
    });
    expect(requests.filter((request) => request.url.startsWith("/api/chat/history"))).toHaveLength(
      0,
    );
  });
});
