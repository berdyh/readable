import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The exposure route is a write into the reader's mastery ledger, so the
 * things worth pinning are the ones that would still return 200: writing
 * under the wrong user, writing on behalf of an anonymous caller, or
 * forwarding the raw body instead of the parsed one.
 *
 * `@/server/persona` is only partially mocked — `parsePayload.ts` reads
 * the real MAX_* budgets from it, and stubbing those would make the
 * validation assertions here test the stub instead of the route.
 */

const authMock = vi.hoisted(() => {
  const AUTH_REQUIRED_MESSAGE = "Sign in to use personalized reading features.";

  class AuthenticationRequiredError extends Error {
    constructor(message = AUTH_REQUIRED_MESSAGE) {
      super(message);
      this.name = "AuthenticationRequiredError";
    }
  }

  return { AUTH_REQUIRED_MESSAGE, AuthenticationRequiredError };
});

vi.mock("@/server/auth", () => ({
  AUTH_REQUIRED_MESSAGE: authMock.AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError: authMock.AuthenticationRequiredError,
  isAuthenticationRequiredError: vi.fn(
    (error: unknown) => error instanceof authMock.AuthenticationRequiredError,
  ),
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock("@/server/persona", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/persona")>();
  return {
    ...actual,
    recordExposureSignal: vi.fn(),
  };
});

import {
  AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { MAX_CONCEPTS_PER_INTERACTION, recordExposureSignal } from "@/server/persona";

import { POST } from "./route";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function createPostRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/persona/exposure", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

const validBody = {
  paperId: "1706.03762",
  concepts: [{ concept: "attention", domain: "ml", description: "A mechanism." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(requireAuthenticatedUserId).mockResolvedValue("user_123");
  vi.mocked(recordExposureSignal).mockResolvedValue(undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("/api/persona/exposure success path", () => {
  it("records the exposure under the authenticated reader", async () => {
    const response = await POST(createPostRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(recordExposureSignal).toHaveBeenCalledWith({
      userId: "user_123",
      paperId: "1706.03762",
      concepts: [{ concept: "attention", domain: "ml", description: "A mechanism." }],
    });
  });

  it("takes the user id from the session and ignores any the body claims", async () => {
    // The ledger is per-reader. A body-supplied user id would let any
    // signed-in caller write into somebody else's mastery record, and the
    // response would look identical.
    await POST(createPostRequest({ ...validBody, userId: "user_999" }));

    expect(recordExposureSignal).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_123" }),
    );
  });

  it("forwards the parsed payload, not the raw body", async () => {
    const response = await POST(
      createPostRequest({
        paperId: "  1706.03762  ",
        concepts: [
          { concept: "  attention  ", domain: "  ml  ", description: "  A mechanism.  " },
          { concept: "softmax", extra: "drop me" },
        ],
        signal: "qa_asked",
      }),
    );

    expect(response.status).toBe(200);
    // Trimmed, field-restricted, and stripped of anything the caller made
    // up — including a `signal`, which this route pins to summary_exposure.
    expect(recordExposureSignal).toHaveBeenCalledWith({
      userId: "user_123",
      paperId: "1706.03762",
      concepts: [
        { concept: "attention", domain: "ml", description: "A mechanism." },
        { concept: "softmax", domain: undefined, description: undefined },
      ],
    });
    expect(vi.mocked(recordExposureSignal).mock.calls[0][0]).not.toHaveProperty("signal");
  });

  it("caps the concept list at the per-interaction budget", async () => {
    const response = await POST(
      createPostRequest({
        paperId: "1706.03762",
        concepts: Array.from({ length: MAX_CONCEPTS_PER_INTERACTION + 5 }, (_, index) => ({
          concept: `concept-${index}`,
        })),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(recordExposureSignal).mock.calls[0][0].concepts).toHaveLength(
      MAX_CONCEPTS_PER_INTERACTION,
    );
  });
});

describe("/api/persona/exposure auth gate", () => {
  it("rejects an anonymous caller and writes nothing", async () => {
    vi.mocked(requireAuthenticatedUserId).mockRejectedValue(new AuthenticationRequiredError());

    const response = await POST(createPostRequest(validBody));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTH_REQUIRED_MESSAGE });
    // The ledger is the point of the route; a 401 that still recorded the
    // signal would attribute one reader's exposure to nobody, or worse.
    expect(recordExposureSignal).not.toHaveBeenCalled();
  });

  it("resolves the user before recording, so a slow auth failure cannot race the write", async () => {
    const order: string[] = [];
    vi.mocked(requireAuthenticatedUserId).mockImplementation(async () => {
      order.push("auth");
      return "user_123";
    });
    vi.mocked(recordExposureSignal).mockImplementation(async () => {
      order.push("record");
    });

    await POST(createPostRequest(validBody));

    expect(order).toEqual(["auth", "record"]);
  });
});

describe("/api/persona/exposure payload validation", () => {
  it.each([
    [{}, "paperId is required."],
    [{ paperId: "   ", concepts: [] }, "paperId is required."],
    [{ paperId: "../../etc/passwd", concepts: [] }, "paperId is not a valid paper id."],
    [{ paperId: "x".repeat(65), concepts: [] }, "paperId is not a valid paper id."],
    [{ paperId: "1706.03762" }, "concepts must be an array."],
    [{ paperId: "1706.03762", concepts: {} }, "concepts must be an array."],
    [{ paperId: "1706.03762", concepts: [] }, "concepts must include at least one named concept."],
    [
      { paperId: "1706.03762", concepts: [{ concept: "   " }, null, 7] },
      "concepts must include at least one named concept.",
    ],
  ])("rejects %j with 400 and records nothing", async (body, message) => {
    const response = await POST(createPostRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(recordExposureSignal).not.toHaveBeenCalled();
  });

  it("rejects a non-object body", async () => {
    for (const body of [null, [], "hello", 7]) {
      const response = await POST(createPostRequest(body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Request body must be a JSON object.",
      });
    }
    expect(recordExposureSignal).not.toHaveBeenCalled();
  });

  it("returns 400 rather than 500 when the body is not JSON at all", async () => {
    const request = new Request("http://localhost/api/persona/exposure", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    }) as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(recordExposureSignal).not.toHaveBeenCalled();
  });

  it("validates before consulting auth, so a malformed body never reaches the session", async () => {
    // Deliberate ordering: parsing is pure and cheap, and rejecting it
    // early keeps a bad client from being told "sign in" when the real
    // problem is its payload. Nothing user-scoped is read to produce it.
    await POST(createPostRequest({}));

    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
  });
});

describe("/api/persona/exposure failure handling", () => {
  it("maps a ledger write failure to 500 without leaking the underlying error", async () => {
    vi.mocked(recordExposureSignal).mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    );

    const response = await POST(createPostRequest(validBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to record exposure." });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("does not report success when the write failed", async () => {
    vi.mocked(recordExposureSignal).mockRejectedValue(new Error("boom"));

    const response = await POST(createPostRequest(validBody));

    await expect(response.json()).resolves.not.toMatchObject({ ok: true });
  });
});
