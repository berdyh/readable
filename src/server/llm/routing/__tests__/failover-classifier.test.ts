import { describe, expect, it } from "vitest";

import {
  classifyFailoverSignal,
  classifyHttpStatus,
  classifyMessage,
  shouldAdvanceFallback,
  shouldAllowCooldownProbeForReason,
} from "../failover-classifier";
import { coerceToFailoverError, reasonFromError } from "../failover-error";

describe("classifyHttpStatus", () => {
  it("returns null for 2xx", () => {
    expect(classifyHttpStatus(200)).toBeNull();
    expect(classifyHttpStatus(204)).toBeNull();
  });

  it("maps standard error codes", () => {
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("auth");
    expect(classifyHttpStatus(404)).toBe("model_not_found");
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(410)).toBe("timeout");
    expect(classifyHttpStatus(429)).toBe("rate_limit");
    expect(classifyHttpStatus(500)).toBe("timeout");
    expect(classifyHttpStatus(502)).toBe("timeout");
    expect(classifyHttpStatus(503)).toBe("timeout");
    expect(classifyHttpStatus(504)).toBe("timeout");
    expect(classifyHttpStatus(529)).toBe("overloaded");
  });

  it("reclassifies 401/403 to auth_permanent on permanent-auth markers", () => {
    expect(classifyHttpStatus(401, "invalid_api_key")).toBe("auth_permanent");
    expect(classifyHttpStatus(403, "permission_denied")).toBe("auth_permanent");
  });

  it("reclassifies 402 to rate_limit when message indicates usage cap", () => {
    expect(classifyHttpStatus(402, "usage cap reached")).toBe("rate_limit");
    expect(classifyHttpStatus(402, "insufficient_quota")).toBe("billing");
    expect(classifyHttpStatus(402, "")).toBe("billing");
  });

  it("treats 400/422 as format unless message redirects", () => {
    expect(classifyHttpStatus(400, "invalid_request: missing field")).toBe("format");
    expect(classifyHttpStatus(422, "invalid response_format")).toBe("format");
    expect(classifyHttpStatus(400, "rate limit exceeded")).toBe("rate_limit");
    expect(classifyHttpStatus(400, "service is overloaded")).toBe("overloaded");
    expect(classifyHttpStatus(400, "no such model: foo")).toBe("model_not_found");
    expect(classifyHttpStatus(400, "insufficient_quota")).toBe("billing");
  });
});

describe("classifyMessage", () => {
  it("detects timeout-flavored network errors", () => {
    expect(classifyMessage("fetch failed")).toBe("timeout");
    expect(classifyMessage("ECONNRESET")).toBe("timeout");
    expect(classifyMessage("Request timed out")).toBe("timeout");
  });

  it("returns null for unrelated text", () => {
    expect(classifyMessage("All good")).toBeNull();
    expect(classifyMessage(undefined)).toBeNull();
  });

  it("detects overloaded, billing, model_not_found, session_expired", () => {
    expect(classifyMessage("Service is overloaded")).toBe("overloaded");
    expect(classifyMessage("billing failure")).toBe("billing");
    expect(classifyMessage("Model not found: x")).toBe("model_not_found");
    expect(classifyMessage("Your session is expired")).toBe("session_expired");
  });
});

describe("classifyFailoverSignal combined input", () => {
  it("prefers status when present", () => {
    expect(classifyFailoverSignal({ status: 429 })).toBe("rate_limit");
    expect(classifyFailoverSignal({ status: 401, body: "invalid_api_key" })).toBe("auth_permanent");
  });

  it("falls back to message when no status", () => {
    expect(classifyFailoverSignal({ message: "fetch failed" })).toBe("timeout");
  });

  it('returns "unknown" when both signals are silent', () => {
    expect(classifyFailoverSignal({})).toBe("unknown");
    expect(classifyFailoverSignal({ message: "something weird" })).toBe("unknown");
  });
});

describe("failover policy gates", () => {
  it("shouldAdvanceFallback fails fast on auth_permanent + format", () => {
    expect(shouldAdvanceFallback("auth_permanent")).toBe(false);
    expect(shouldAdvanceFallback("format")).toBe(false);
    // Everything else should advance
    expect(shouldAdvanceFallback("rate_limit")).toBe(true);
    expect(shouldAdvanceFallback("billing")).toBe(true);
    expect(shouldAdvanceFallback("timeout")).toBe(true);
    expect(shouldAdvanceFallback("overloaded")).toBe(true);
    expect(shouldAdvanceFallback("auth")).toBe(true);
    expect(shouldAdvanceFallback("model_not_found")).toBe(true);
    expect(shouldAdvanceFallback("unknown")).toBe(true);
    // A missing binary still advances: the next candidate is a different CLI.
    expect(shouldAdvanceFallback("not_installed")).toBe(true);
  });

  it("shouldAllowCooldownProbeForReason permits transient bumps only", () => {
    expect(shouldAllowCooldownProbeForReason("rate_limit")).toBe(true);
    expect(shouldAllowCooldownProbeForReason("overloaded")).toBe(true);
    expect(shouldAllowCooldownProbeForReason("timeout")).toBe(true);
    expect(shouldAllowCooldownProbeForReason("unknown")).toBe(true);
    expect(shouldAllowCooldownProbeForReason("empty_response")).toBe(true);
    // Persistent
    expect(shouldAllowCooldownProbeForReason("auth_permanent")).toBe(false);
    expect(shouldAllowCooldownProbeForReason("billing")).toBe(false);
    expect(shouldAllowCooldownProbeForReason("format")).toBe(false);
    expect(shouldAllowCooldownProbeForReason("model_not_found")).toBe(false);
    // Installing a CLI is a human action; probing on a timer never helps.
    expect(shouldAllowCooldownProbeForReason("not_installed")).toBe(false);
  });
});

describe("local CLI agent failures", () => {
  it("classifies a missing binary as not_installed", () => {
    expect(classifyMessage("spawn /usr/bin/codex ENOENT")).toBe("not_installed");
    expect(classifyMessage("codex: command not found")).toBe("not_installed");
    expect(classifyMessage("Error: no such file or directory")).toBe("not_installed");
  });

  it("classifies a signed-out CLI as auth_permanent so the ladder fails fast", () => {
    // Claude Code's real stderr when $CLAUDE_CONFIG_DIR has no credentials.
    expect(classifyMessage("Not logged in · Please run /login")).toBe("auth_permanent");
    // Codex's real failure once its auth.json is unreachable.
    expect(classifyMessage("failed to connect to websocket: HTTP error: 401 Unauthorized")).toBe(
      "auth_permanent",
    );
    expect(shouldAdvanceFallback(classifyMessage("Not logged in") ?? "unknown")).toBe(false);
  });

  it("classifies a rejected CLI flag as format rather than unknown", () => {
    // The regression that started this: `codex exec --ask-for-approval never`
    // exits 2 with this on stderr, and used to classify as `unknown`, which
    // advanced the ladder and reported "All providers exhausted (unknown)".
    expect(classifyMessage("error: unexpected argument '--ask-for-approval' found")).toBe("format");
    expect(classifyMessage("error: unrecognized option '--nope'")).toBe("format");
    expect(classifyFailoverSignal({ message: "error: unknown flag: --tools" })).toBe("format");
  });
});

describe("coerceToFailoverError", () => {
  const ctx = { provider: "openai" as const, model: "gpt-4o-mini" };

  it("passes a FailoverError through unchanged", () => {
    const original = coerceToFailoverError(new Error("rate limit hit"), {
      ...ctx,
    });
    const recoerced = coerceToFailoverError(original, ctx);
    expect(recoerced).toBe(original);
  });

  it("extracts status from `status` / `statusCode` / `response.status` / numeric `code`", () => {
    expect(coerceToFailoverError({ status: 429, message: "x" }, ctx).reason).toBe("rate_limit");
    expect(coerceToFailoverError({ statusCode: 401, message: "x" }, ctx).reason).toBe("auth");
    expect(coerceToFailoverError({ response: { status: 503 }, message: "x" }, ctx).reason).toBe(
      "timeout",
    );
    expect(coerceToFailoverError({ code: 404, message: "x" }, ctx).reason).toBe("model_not_found");
  });

  it("reads Retry-After from headers (seconds → ms)", () => {
    const err = coerceToFailoverError(
      {
        status: 429,
        message: "rate limit",
        headers: new Headers({ "retry-after": "7" }),
      },
      ctx,
    );
    expect(err.reason).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(7000);
  });

  it("treats AbortError as unknown rather than auth/format", () => {
    class AbortError extends Error {
      override readonly name = "AbortError";
    }
    const err = coerceToFailoverError(new AbortError("aborted"), ctx);
    expect(err.reason).toBe("unknown");
  });

  it("falls back to message classifier when no status", () => {
    const err = coerceToFailoverError(new Error("fetch failed"), ctx);
    expect(err.reason).toBe("timeout");
    expect(err.status).toBeUndefined();
  });
});

describe("reasonFromError", () => {
  it("returns FailoverError reason directly", () => {
    const err = coerceToFailoverError(new Error("rate limit"), {
      provider: "openai",
      model: "gpt",
    });
    expect(reasonFromError(err)).toBe("rate_limit");
  });

  it("classifies plain errors with status", () => {
    expect(reasonFromError({ status: 429, message: "x" })).toBe("rate_limit");
  });

  it("classifies plain errors without status by message", () => {
    expect(reasonFromError(new Error("fetch failed"))).toBe("timeout");
  });

  it("returns undefined when nothing classifies", () => {
    expect(reasonFromError(new Error("totally fine"))).toBeUndefined();
  });
});
