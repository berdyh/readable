/**
 * Shared types for the OpenClaw-inspired multi-provider routing layer.
 *
 * Pattern adapted from OpenClaw (MIT, © 2025 Peter Steinberger):
 * https://github.com/openclaw/openclaw — see model-fallback.ts and
 * live-auth-keys.ts for the upstream implementation.
 */

import type { LlmProvider } from "../types";

/**
 * Provider IDs that can appear in a model reference. The base set mirrors
 * `LlmProvider` but `RoutingProviderId` also distinguishes runtime variants
 * — `openai-codex` is OpenAI billed against a Codex OAuth subscription
 * rather than an API key, and is treated as a separate provider.
 */
export type RoutingProviderId =
  | LlmProvider
  | "openai-codex"
  | "google-vertex"
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "antigravity"
  | "opencode";

/**
 * Slash-form `provider/model` reference. Always lowercased; provider must
 * be a known `RoutingProviderId`.
 */
export type ModelRef = `${RoutingProviderId}/${string}`;

export interface ParsedModelRef {
  provider: RoutingProviderId;
  model: string;
}

/**
 * Why an attempt failed. Drives whether the loop advances to the next
 * candidate (most reasons), waits in cooldown (rate_limit, billing), or
 * fails fast (auth_permanent, format).
 *
 * Mirrors OpenClaw's `FailoverReason` (pi-embedded-helpers/types.ts:3-16).
 */
export type FailoverReason =
  | "auth" // 401/403, transient — try a different profile or provider
  | "auth_permanent" // sustained 401/403 with permanent-auth markers
  | "format" // 400/422 due to bad request/schema; not a transport problem
  | "rate_limit" // 429
  | "overloaded" // 529 / explicit "overloaded" responses
  | "billing" // 402 / quota-exhausted billing problems
  | "timeout" // 408/410/500/502/503/504, network timeouts
  | "model_not_found" // 404 — provider doesn't have this model
  | "session_expired" // OAuth token has expired and can be refreshed
  | "empty_response" // 200 OK but no content
  | "no_error_details" // non-OK with no body or unparseable body
  | "unclassified" // we got something but couldn't classify it
  | "unknown"; // anything else (network error, abort, etc.)

export interface FailoverErrorInit {
  reason: FailoverReason;
  provider: RoutingProviderId;
  model: string;
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * One profile = one credential the router can use to call a provider.
 *
 * - `api_key`: classic API key from env (`OPENAI_API_KEY` etc.)
 * - `oauth`: OAuth tokens read from a CLI auth file
 *   (`~/.codex/auth.json`, `~/.claude/.credentials.json`, ...)
 * - `token`: long-lived session token (e.g. Anthropic Console, Workspace)
 */
export type AuthProfileType = "api_key" | "oauth" | "token";

export interface AuthProfile {
  /**
   * Stable id, e.g. `openai:default`, `anthropic:work`, `openai-codex:cli`.
   * Used for cooldown tracking and round-robin order.
   */
  id: string;
  provider: RoutingProviderId;
  type: AuthProfileType;
  /**
   * The actual credential. For api_key this is a bearer token; for oauth
   * this is an access token (refresh token lives in `oauthRefresh`).
   * NEVER log this.
   */
  secret: string;
  /** Display label; safe to show in CLI output. */
  label?: string;
  /** OAuth refresh token, if applicable. */
  oauthRefresh?: string;
  /** ms-since-epoch when the access token expires, if known. */
  expiresAt?: number;
  /** Where the credential came from — useful in `openclaw models auth list`-style output. */
  source?: "env" | "cli-file" | "manual" | "live";
  /**
   * If true, never write back to the on-disk store; treat as ephemeral.
   * Used for `OPENCLAW_LIVE_*_KEY` short-circuit credentials.
   */
  ephemeral?: boolean;
}

export interface ProfileUsageStats {
  /** ms-since-epoch of last successful call. Undefined = never. */
  lastUsed?: number;
  /** ms-since-epoch when the cooldown lifts. */
  cooldownUntil?: number;
  /** Stored to drive next backoff step. */
  cooldownLevel?: number;
  /** Reason the cooldown was set. */
  cooldownReason?: FailoverReason;
  /** Number of consecutive failures (resets on success). */
  errorCount?: number;
  /**
   * If the profile has been hard-disabled (e.g. permanent auth failure).
   * Set by classifier; cleared only by manual `clearAuthProfileCooldown`.
   */
  disabledUntil?: number;
}

export type UsageStats = Record<string, ProfileUsageStats>;

export interface AuthProfileStore {
  profiles: AuthProfile[];
  usageStats: UsageStats;
  /**
   * Per-provider explicit ordering. Empty = derive automatically from
   * profile-type heuristic + lastUsed.
   */
  order: Partial<Record<RoutingProviderId, string[]>>;
}

export interface ModelCandidate {
  provider: RoutingProviderId;
  model: string;
  /** Source — primary | fallback list | configured-provider fallback. */
  source: "primary" | "fallback" | "configured-provider-fallback";
}

export interface FallbackAttempt {
  candidate: ModelCandidate;
  profileId?: string;
  reason: FailoverReason;
  status?: number;
  errorMessage: string;
  attemptedAt: number;
}
