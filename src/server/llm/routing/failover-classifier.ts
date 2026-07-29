/**
 * Map raw HTTP statuses + error messages to a `FailoverReason`.
 *
 * Mirrors OpenClaw's classifier
 * (`pi-embedded-helpers/errors.ts:622-728`) with the same pragmatic
 * rule-of-thumb: status code first, message-based reclassification only
 * when status is ambiguous (400/402/422).
 */

import type { FailoverReason } from "./types";

const PERMANENT_AUTH_HINTS = [
  "invalid_api_key",
  "invalid api key",
  "invalid token",
  "expired token",
  "authentication failed",
  "unauthorized",
  "permission_denied",
  // Local CLI agents report a missing/expired subscription login as prose on
  // stderr rather than as an HTTP status. Claude Code prints
  // "Not logged in · Please run /login"; Codex prints a login hint alongside
  // its 401. Without these the whole class of "the CLI is installed but you
  // never signed in" failures classified as `unknown` and burned the ladder.
  "not logged in",
  "not authenticated",
  "please run /login",
  "please run `codex login`",
  "run codex login",
  "codex login",
  "claude login",
  "no credentials found",
];

const RATE_LIMIT_HINTS = [
  "rate limit",
  "rate-limit",
  "rate_limit",
  "too many requests",
  "usage_limit",
  "quota_exhausted",
  // OpenAI sends this on 402 when the per-window quota is hit but the
  // account is still in good standing — semantically a rate_limit, not a
  // billing failure.
  "usage cap",
];

const BILLING_HINTS = [
  "insufficient_quota",
  "insufficient quota",
  "billing",
  "payment_required",
  "plan_canceled",
  "subscription expired",
];

const OVERLOADED_HINTS = [
  "overloaded",
  "capacity",
  "overload",
  "try again",
  "service is overloaded",
];

const FORMAT_HINTS = [
  "invalid_request",
  "invalid request",
  "unprocessable",
  "schema",
  "json_schema",
  "json schema",
  "response_format",
  // A local CLI rejecting our argv is the same class of bug as a malformed
  // request body: *we* built it wrong, and no amount of retrying fixes it.
  // Failing fast is what surfaces it — this is exactly how the stale
  // `--ask-for-approval never` flag stayed invisible behind "(unknown)".
  "unexpected argument",
  "unrecognized option",
  "unrecognized argument",
  "unknown option",
  "unknown flag",
];

/**
 * The agent's binary is not there at all. Distinct from `auth` because no
 * credential change will help, and distinct from `format` because a
 * *different* agent may still be installed — so the ladder should advance
 * once and then stop probing this one.
 */
const NOT_INSTALLED_HINTS = [
  "enoent",
  "command not found",
  "no such file or directory",
  "is not recognized as an internal or external command",
  "eaccess",
  "permission denied (os error 13)",
];

const TIMEOUT_HINTS = [
  "timeout",
  "timed out",
  "gateway timeout",
  "econnreset",
  "econnrefused",
  "eai_again",
  "fetch failed",
  "aborted",
];

const MODEL_NOT_FOUND_HINTS = [
  "model_not_found",
  "model not found",
  "no such model",
  "unknown model",
];

const EMPTY_RESPONSE_HINTS = ["no choices", "empty content", "empty response"];

function lowerSafe(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toLowerCase();
}

function anyHint(text: string, hints: string[]): boolean {
  if (!text) return false;
  for (const hint of hints) {
    if (text.includes(hint)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify based purely on HTTP status. Returns null if status is OK.
 *
 * `body` is consulted only for ambiguous statuses (400, 402, 422). Pass
 * it when available — it greatly improves classification accuracy on
 * OpenAI's overloaded `400 Bad Request` and on rate-limit-as-402 cases.
 */
export function classifyHttpStatus(status: number, body?: string): FailoverReason | null {
  if (status >= 200 && status < 300) {
    return null;
  }

  const lower = lowerSafe(body);

  // 401/403: authentication. Distinguish "transient auth" (probably wrong
  // current profile) from "permanent" (key revoked).
  if (status === 401 || status === 403) {
    if (anyHint(lower, PERMANENT_AUTH_HINTS)) {
      return "auth_permanent";
    }
    return "auth";
  }

  // 402: usually billing — but OpenAI uses 402 for usage-window cap too,
  // which we want to treat as rate_limit so the cooldown drains faster.
  if (status === 402) {
    if (anyHint(lower, RATE_LIMIT_HINTS)) return "rate_limit";
    return "billing";
  }

  // 404: model not found.
  if (status === 404) {
    return "model_not_found";
  }

  // 408 / 410 / 5xx (except 529): timeout-ish.
  if (
    status === 408 ||
    status === 410 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return "timeout";
  }

  // 429: rate limit.
  if (status === 429) {
    return "rate_limit";
  }

  // 529: Anthropic / a few others use this for "overloaded".
  if (status === 529) {
    return "overloaded";
  }

  // 400/422: format-ish. Only reclassify if message strongly suggests
  // something else.
  if (status === 400 || status === 422) {
    if (anyHint(lower, RATE_LIMIT_HINTS)) return "rate_limit";
    if (anyHint(lower, OVERLOADED_HINTS)) return "overloaded";
    if (anyHint(lower, BILLING_HINTS)) return "billing";
    if (anyHint(lower, MODEL_NOT_FOUND_HINTS)) return "model_not_found";
    return "format";
  }

  // Anything else in 4xx/5xx — fall through to message classifier.
  return classifyMessage(body) ?? "no_error_details";
}

/**
 * Does this text carry a permanent-auth marker, regardless of what else is in
 * it?
 *
 * `classifyMessage` is ordered for HTTP bodies, which carry one error. A local
 * CLI's stderr is a transcript: Codex's 401 arrives wrapped in five
 * `Reconnecting…` lines, so the `try again` overloaded-hint matches first and
 * a dead credential reads as a transient blip. Callers holding multi-line
 * process output should ask this first.
 */
export function hasPermanentAuthHint(text: unknown): boolean {
  return anyHint(lowerSafe(text), PERMANENT_AUTH_HINTS);
}

/**
 * Classify based on a free-text error message (no status). Useful for
 * SDK-level errors where there's no HTTP status (`fetch failed`,
 * `aborted`, etc.). Returns null if nothing matches.
 */
export function classifyMessage(message: unknown): FailoverReason | null {
  const lower = lowerSafe(message);
  if (!lower) return null;

  // Checked first: a missing binary is unambiguous, and the same message
  // ("spawn codex ENOENT") carries no other signal to confuse it with.
  if (anyHint(lower, NOT_INSTALLED_HINTS)) return "not_installed";
  if (anyHint(lower, RATE_LIMIT_HINTS)) return "rate_limit";
  if (anyHint(lower, BILLING_HINTS)) return "billing";
  if (anyHint(lower, OVERLOADED_HINTS)) return "overloaded";
  if (anyHint(lower, TIMEOUT_HINTS)) return "timeout";
  if (anyHint(lower, PERMANENT_AUTH_HINTS)) return "auth_permanent";
  if (anyHint(lower, MODEL_NOT_FOUND_HINTS)) return "model_not_found";
  if (anyHint(lower, EMPTY_RESPONSE_HINTS)) return "empty_response";
  if (anyHint(lower, FORMAT_HINTS)) return "format";

  if (lower.includes("session") && lower.includes("expir")) {
    return "session_expired";
  }

  return null;
}

/**
 * One-shot helper that combines status + message classification with a
 * sane fallback. Use when you have one or both pieces of context.
 *
 * Real-world errors often carry the diagnostic in `message` (the
 * provider's `Error.message` is `"[OpenAI] request failed (401):
 * { error: invalid_api_key }"`) rather than `body`. We feed both into
 * the hint matcher together so reclassification (e.g. 401 → auth_permanent
 * on `invalid_api_key`) works regardless of which field carries it.
 */
export function classifyFailoverSignal(input: {
  status?: number;
  body?: string;
  message?: unknown;
}): FailoverReason {
  const messageString =
    typeof input.message === "string"
      ? input.message
      : input.message !== undefined && input.message !== null
        ? (() => {
            try {
              return JSON.stringify(input.message);
            } catch {
              return String(input.message);
            }
          })()
        : "";
  const combined = [input.body ?? "", messageString].filter(Boolean).join(" ");

  if (typeof input.status === "number") {
    const fromStatus = classifyHttpStatus(input.status, combined);
    if (fromStatus) return fromStatus;
  }
  const fromMessage = classifyMessage(combined);
  if (fromMessage) return fromMessage;
  return "unknown";
}

/**
 * Whether a reason should advance the fallback loop to the next
 * candidate (true) or fail fast (false).
 *
 * Mirrors OpenClaw `failover-policy.ts:3-15`.
 */
export function shouldAdvanceFallback(reason: FailoverReason): boolean {
  switch (reason) {
    case "auth_permanent":
    case "format":
      // These won't be helped by a different provider — the request shape
      // itself is wrong, or the credential is permanently broken.
      return false;
    case "not_installed":
      // A missing binary says nothing about the *next* candidate, which may
      // be a different CLI entirely. Advance — but see
      // `shouldAllowCooldownProbeForReason`, which refuses to keep probing
      // the absent one.
      return true;
    default:
      return true;
  }
}

/**
 * Whether a reason should keep the profile available for a "probe" call
 * even while in cooldown. Transient reasons get probes; persistent ones
 * (auth, billing, model_not_found) skip.
 *
 * Mirrors OpenClaw `failover-policy.ts:shouldAllowCooldownProbeForReason`.
 */
export function shouldAllowCooldownProbeForReason(reason: FailoverReason | undefined): boolean {
  switch (reason) {
    case "rate_limit":
    case "overloaded":
    case "timeout":
    case "unknown":
    case "no_error_details":
    case "unclassified":
    case "empty_response":
      return true;
    case "not_installed":
      // Installing a CLI is a human action, not something that resolves on a
      // timer. Probing burns a process spawn per request to relearn a fact
      // that has not changed.
      return false;
    default:
      return false;
  }
}
