/**
 * Multi-provider fallback loop with profile-level cooldowns.
 *
 * Pattern adapted from OpenClaw `model-fallback.ts:804-1149`. The loop
 * itself is sequential and immediate — there is NO exp-backoff inside.
 * Backoff lives in the per-profile cooldown state (`auth-profile-store`).
 *
 * Flow per call:
 *
 *   1. Resolve candidate chain: primary + fallbacks (in order, deduped).
 *   2. For each candidate (provider/model):
 *      a. List ready profiles for that provider via
 *         resolveAuthProfileOrder.
 *      b. If all profiles are in cooldown, decide:
 *         - permanent reason → skip provider entirely
 *         - transient reason → if last probe was >MIN_PROBE_INTERVAL_MS
 *           ago, attempt one "probe" using the soonest-expiring profile
 *      c. Try profiles top-to-bottom. On success, record + return. On
 *         FailoverError: if shouldAdvanceFallback → apply cooldown,
 *         continue. Otherwise → re-throw immediately.
 *   3. If candidates exhausted, throw FallbackSummaryError with the
 *      attempts log.
 *
 * Provider invocation is delegated to a `RunFn<T>` injected by the
 * caller — the loop is provider-agnostic and trivial to unit-test.
 */

import {
  applyCooldown,
  clearProfileCooldown,
  isProfileInCooldown,
  recordProfileSuccess,
  saveUsageStatsOnly,
} from "./auth-profile-store";
import { promoteAuthProfileInOrder, resolveAuthProfileOrder } from "./auth-profile-order";
import { shouldAdvanceFallback, shouldAllowCooldownProbeForReason } from "./failover-classifier";
import { coerceToFailoverError, FailoverError } from "./failover-error";
import type {
  AuthProfile,
  AuthProfileStore,
  FallbackAttempt,
  ModelCandidate,
  ModelRef,
  RoutingProviderId,
} from "./types";

const MIN_PROBE_INTERVAL_MS = 30_000;

const SLASH_REF_PATTERN = /^([\w-]+)\/(.+)$/;

export function parseModelRef(ref: ModelRef | string): ModelCandidate {
  const match = SLASH_REF_PATTERN.exec(ref);
  if (!match) {
    throw new Error(`Invalid model ref "${ref}". Expected "provider/model" slash form.`);
  }
  return {
    provider: match[1].toLowerCase() as RoutingProviderId,
    model: match[2],
    source: "primary",
  };
}

export interface RunFnContext {
  provider: RoutingProviderId;
  model: string;
  profile: AuthProfile;
  /** 0-indexed attempt counter across the entire run. */
  attemptIndex: number;
  /** True when this attempt is a cooldown probe. */
  isProbe: boolean;
}

export type RunFn<T> = (ctx: RunFnContext) => Promise<T>;

export interface RunWithFallbackOptions<T> {
  primary: ModelRef | string;
  fallbacks?: Array<ModelRef | string>;
  /**
   * Required. The store providing profiles + usage stats. Caller is
   * responsible for building it (typically via buildAuthProfileStore).
   */
  store: AuthProfileStore;
  /** Default 'default'. Used for usage-stats persistence. */
  agentId?: string;
  /** Provider invocation. Receives the resolved profile. */
  run: RunFn<T>;
  /**
   * If true, persist usageStats writes after each attempt. Default false
   * — most callers will want to defer persistence to one writeback at
   * the end of a request. Set true for long-running daemons.
   */
  persistUsageWrites?: boolean;
  /** Test injection. Defaults to () => Date.now(). */
  now?: () => number;
}

export interface RunWithFallbackResult<T> {
  result: T;
  candidate: ModelCandidate;
  profile: AuthProfile;
  attempts: FallbackAttempt[];
  /**
   * The store after applying success/failure mutations. Persisted only
   * when persistUsageWrites is true; otherwise the caller decides.
   */
  store: AuthProfileStore;
}

export class FallbackSummaryError extends Error {
  readonly attempts: FallbackAttempt[];
  readonly soonestCooldownExpiry?: number;

  constructor(attempts: FallbackAttempt[], options: { soonestCooldownExpiry?: number } = {}) {
    const tail =
      attempts.length > 0
        ? attempts
            .slice(-3)
            .map((a) => `${a.candidate.provider}/${a.candidate.model} (${a.reason})`)
            .join(" → ")
        : "no attempts";
    super(`All providers exhausted. Last attempts: ${tail}`);
    this.name = "FallbackSummaryError";
    this.attempts = attempts;
    this.soonestCooldownExpiry = options.soonestCooldownExpiry;
  }
}

/**
 * Probe-throttle state per agent. Module-level for simplicity — Next.js
 * keeps the server module instance long enough to make this useful, and
 * the only consequence of resetting it is one extra probe per provider
 * after a cold start.
 */
const probeState = new Map<string, Map<RoutingProviderId, number>>();

function getProbeMap(agentId: string): Map<RoutingProviderId, number> {
  let map = probeState.get(agentId);
  if (!map) {
    map = new Map();
    probeState.set(agentId, map);
  }
  return map;
}

function buildCandidateChain(
  primary: ModelRef | string,
  fallbacks: Array<ModelRef | string> | undefined,
): ModelCandidate[] {
  const chain: ModelCandidate[] = [parseModelRef(primary)];
  const seen = new Set<string>(`${chain[0].provider}/${chain[0].model}`);
  for (const ref of fallbacks ?? []) {
    const candidate = parseModelRef(ref);
    candidate.source = "fallback";
    const key = `${candidate.provider}/${candidate.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push(candidate);
  }
  return chain;
}

interface CooldownDecision {
  /** If set, skip this candidate entirely. */
  skip?: true;
  /** If set, attempt one probe with this profile id. */
  probeProfileId?: string;
}

function decideCooldownAction(
  store: AuthProfileStore,
  candidate: ModelCandidate,
  agentId: string,
  now: number,
): CooldownDecision {
  const profileIds = resolveAuthProfileOrder(store, candidate.provider, {
    now,
    ignoreCooldown: true,
  });
  if (profileIds.length === 0) {
    return { skip: true };
  }
  const ready = profileIds.filter((id) => !isProfileInCooldown(store.usageStats ?? {}, id, now));
  if (ready.length > 0) {
    // Caller will handle ready profiles; no cooldown decision needed.
    return {};
  }

  // All profiles in cooldown. Decide based on the worst-recent-reason.
  const probeMap = getProbeMap(agentId);
  const lastProbe = probeMap.get(candidate.provider) ?? 0;
  if (now - lastProbe < MIN_PROBE_INTERVAL_MS) {
    return { skip: true };
  }

  // Find a profile whose cooldown reason allows probing. Prefer the one
  // whose cooldown is expiring soonest.
  const probable = profileIds
    .map((id) => {
      const stats = store.usageStats?.[id];
      return {
        id,
        until: stats?.cooldownUntil ?? 0,
        reason: stats?.cooldownReason,
      };
    })
    .filter((entry) => shouldAllowCooldownProbeForReason(entry.reason))
    .sort((a, b) => a.until - b.until);

  if (probable.length === 0) {
    return { skip: true };
  }

  return { probeProfileId: probable[0].id };
}

export async function runWithModelFallback<T>(
  options: RunWithFallbackOptions<T>,
): Promise<RunWithFallbackResult<T>> {
  const agentId = options.agentId ?? "default";
  const now = options.now ?? (() => Date.now());

  const candidates = buildCandidateChain(options.primary, options.fallbacks);
  let store = options.store;
  const attempts: FallbackAttempt[] = [];
  let attemptIndex = 0;
  const profileIdsTriedInRun = new Map<RoutingProviderId, Set<string>>();

  for (const candidate of candidates) {
    const decision = decideCooldownAction(store, candidate, agentId, now());
    const triedForProvider = profileIdsTriedInRun.get(candidate.provider) ?? new Set<string>();
    if (decision.skip) {
      if (triedForProvider.size === 0) {
        continue;
      }
    }

    const orderedIds = resolveAuthProfileOrder(store, candidate.provider, {
      now: now(),
    });
    let attemptList: string[];
    if (decision.skip && triedForProvider.size > 0) {
      // A different model on the same provider may still be viable even
      // after the provider profile was put into cooldown by the previous
      // candidate in this same request.
      attemptList = Array.from(triedForProvider);
    } else if (decision.probeProfileId) {
      attemptList = [decision.probeProfileId];
      getProbeMap(agentId).set(candidate.provider, now());
    } else {
      attemptList = orderedIds.filter(
        (id) => !isProfileInCooldown(store.usageStats ?? {}, id, now()),
      );
    }

    for (const profileId of attemptList) {
      const profile = store.profiles.find((p) => p.id === profileId);
      if (!profile) continue;
      if (!profileIdsTriedInRun.has(candidate.provider)) {
        profileIdsTriedInRun.set(candidate.provider, new Set());
      }
      profileIdsTriedInRun.get(candidate.provider)?.add(profileId);

      const isProbe = decision.probeProfileId === profileId;

      try {
        const result = await options.run({
          provider: candidate.provider,
          model: candidate.model,
          profile,
          attemptIndex,
          isProbe,
        });

        // Success — clear cooldown, record success, promote.
        const usage = isProbe
          ? recordProfileSuccess(
              clearProfileCooldown(store.usageStats ?? {}, profileId),
              profileId,
              now(),
            )
          : recordProfileSuccess(store.usageStats ?? {}, profileId, now());

        store = promoteAuthProfileInOrder(
          { ...store, usageStats: usage },
          candidate.provider,
          profileId,
        );

        if (options.persistUsageWrites) {
          await saveUsageStatsOnly(usage, agentId).catch(() => undefined);
        }

        return {
          result,
          candidate,
          profile,
          attempts,
          store,
        };
      } catch (rawError) {
        attemptIndex += 1;
        const error =
          rawError instanceof FailoverError
            ? rawError
            : coerceToFailoverError(rawError, {
                provider: candidate.provider,
                model: candidate.model,
              });

        attempts.push({
          candidate,
          profileId,
          reason: error.reason,
          status: error.status,
          errorMessage: error.message,
          attemptedAt: now(),
        });

        // Apply cooldown for this profile.
        const usage = applyCooldown(
          store.usageStats ?? {},
          profileId,
          error.reason,
          error.retryAfterMs,
          now(),
        );
        store = { ...store, usageStats: usage };

        if (options.persistUsageWrites) {
          await saveUsageStatsOnly(usage, agentId).catch(() => undefined);
        }

        if (!shouldAdvanceFallback(error.reason)) {
          throw error;
        }
        // Otherwise: continue to next profile, then next candidate.
      }
    }
  }

  // Compute the soonest-cooldown expiry across all attempted providers
  // for caller UX (e.g. setup CLI: "all providers cooling down; retry in
  // 4m 12s").
  let soonest: number | undefined;
  for (const attempt of attempts) {
    const id = attempt.profileId;
    if (!id) continue;
    const stats = store.usageStats?.[id];
    if (stats?.cooldownUntil && stats.cooldownUntil > now()) {
      soonest =
        soonest === undefined || stats.cooldownUntil < soonest ? stats.cooldownUntil : soonest;
    }
  }

  throw new FallbackSummaryError(attempts, { soonestCooldownExpiry: soonest });
}

/** Reset the in-memory probe-throttle state. Useful for tests. */
export function resetProbeStateForTests(): void {
  probeState.clear();
}
