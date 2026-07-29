/**
 * Failover error class plus helpers to coerce arbitrary errors into a
 * structured form the fallback loop can reason about.
 *
 * Mirrors OpenClaw `failover-error.ts` + `coerceToFailoverError`.
 */

import { classifyFailoverSignal, classifyMessage } from "./failover-classifier";
import type { FailoverErrorInit, FailoverReason, RoutingProviderId } from "./types";

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider: RoutingProviderId;
  readonly model: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, init: FailoverErrorInit) {
    super(message);
    this.name = "FailoverError";
    this.reason = init.reason;
    this.provider = init.provider;
    this.model = init.model;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    if (init.cause !== undefined) {
      // ES2022; widely available in Node 20+.
      (this as unknown as { cause: unknown }).cause = init.cause;
    }
  }
}

export interface CoerceContext {
  provider: RoutingProviderId;
  model: string;
}

/**
 * Pull a numeric HTTP status out of an arbitrary error shape. Looks at
 * the common slots used by `fetch`-Response-derived errors and provider
 * SDKs (OpenAI, Anthropic).
 */
function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "httpStatus", "code"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    // Some SDKs put the status in a string. Parse if it looks numeric.
    if (typeof value === "string" && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }
  // OpenAI SDK: error.response.status
  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function readBody(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["body", "responseText", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  // Stringify a JSON body for classifier hints.
  for (const key of ["data", "errorDetails", "response"]) {
    const value = record[key];
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function readRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;

  for (const key of ["retryAfter", "retry_after", "retryAfterMs"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return key === "retryAfterMs" ? value : value * 1000;
    }
    if (typeof value === "string") {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return key === "retryAfterMs" ? numeric : numeric * 1000;
      }
    }
  }

  // Headers shape — `Retry-After` in seconds.
  const headers = record.headers;
  if (headers && typeof headers === "object") {
    const get = (headers as { get?: (name: string) => string | null }).get;
    if (typeof get === "function") {
      const value = get.call(headers, "retry-after");
      if (value) {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) return numeric * 1000;
      }
    } else {
      const value = (headers as Record<string, unknown>)["retry-after"];
      if (typeof value === "string") {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) return numeric * 1000;
      }
    }
  }

  return undefined;
}

function readMessage(error: unknown): string {
  if (!error) return "Unknown error.";
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Convert anything thrown by a provider call into a FailoverError. If
 * the input is *already* a FailoverError, it's returned as-is.
 */
export function coerceToFailoverError(error: unknown, ctx: CoerceContext): FailoverError {
  if (error instanceof FailoverError) {
    return error;
  }

  // Aborted requests (AbortError, DOMException 'AbortError', or a
  // custom timeout) are not failover-worthy in the OpenClaw sense — the
  // user/runtime canceled. We still wrap them so the loop has a uniform
  // type to handle, but mark as 'unknown'.
  if (error && typeof error === "object") {
    const name = (error as { name?: string }).name;
    if (name === "AbortError") {
      return new FailoverError(readMessage(error), {
        reason: "unknown",
        provider: ctx.provider,
        model: ctx.model,
        cause: error,
      });
    }
  }

  const status = readStatus(error);
  const body = readBody(error);
  const message = readMessage(error);
  const retryAfterMs = readRetryAfter(error);

  const reason = classifyFailoverSignal({ status, body, message });

  return new FailoverError(message, {
    reason,
    provider: ctx.provider,
    model: ctx.model,
    status,
    retryAfterMs,
    cause: error,
  });
}

/**
 * Inverse helper — try to extract a FailoverReason from any thrown error
 * (FailoverError or otherwise) without producing a wrapper. Useful when
 * you want to log/branch on `reason` but don't need to construct a new
 * error.
 */
export function reasonFromError(error: unknown): FailoverReason | undefined {
  if (error instanceof FailoverError) {
    return error.reason;
  }
  const status = readStatus(error);
  const body = readBody(error);
  const message = readMessage(error);
  if (typeof status === "number") {
    return classifyFailoverSignal({ status, body, message });
  }
  return classifyMessage(message) ?? undefined;
}
