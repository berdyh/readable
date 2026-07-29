/**
 * Persistent auth-profile + usage-stats store.
 *
 * Stored as JSON under `~/.readable/agents/<agentId>/auth-profiles.json`
 * (split: profiles separately from usageStats) so that secret writes
 * don't compete with high-frequency cooldown writes.
 *
 * Override via env:
 *   READABLE_STATE_DIR  — full path to state root (wins over READABLE_HOME)
 *   READABLE_HOME       — defaults to ~/.readable
 *
 * Mirrors OpenClaw `auth-profiles/store.ts` + `usage-state.ts` with the
 * keychain-backed bits removed (Linux-server target).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AuthProfile,
  AuthProfileStore,
  FailoverReason,
  ProfileUsageStats,
  RoutingProviderId,
  UsageStats,
} from "./types";

const DEFAULT_AGENT_ID = "default";

/** Cooldown ladder for non-billing transient reasons (in ms). */
const TRANSIENT_BACKOFF_LADDER_MS = [
  60_000, // 1m
  5 * 60_000, // 5m
  25 * 60_000, // 25m
  60 * 60_000, // 1h cap
];

/** Cooldown ladder for billing-related reasons (in ms). */
const BILLING_BACKOFF_LADDER_MS = [
  5 * 60 * 60_000, // 5h
  24 * 60 * 60_000, // 24h cap
];

function getStateRoot(): string {
  const explicit = process.env.READABLE_STATE_DIR;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  const home = process.env.READABLE_HOME?.trim();
  if (home) {
    return home;
  }
  return path.join(os.homedir(), ".readable");
}

export interface StorePathSet {
  agentDir: string;
  profilesPath: string;
  usagePath: string;
}

export function getStorePaths(agentId: string = DEFAULT_AGENT_ID): StorePathSet {
  const agentDir = path.join(getStateRoot(), "agents", agentId);
  return {
    agentDir,
    profilesPath: path.join(agentDir, "auth-profiles.json"),
    usagePath: path.join(agentDir, "auth-state.json"),
  };
}

async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, payload, { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
  // Best-effort: tighten dir permissions even if it already existed.
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // Filesystem may not support chmod (e.g. on Windows or some FUSE
    // mounts). Not fatal.
  }
}

interface PersistedProfilesShape {
  profiles?: AuthProfile[];
  order?: AuthProfileStore["order"];
}

interface PersistedUsageShape {
  usageStats?: UsageStats;
}

/**
 * Read both files, return a normalized AuthProfileStore. Missing files
 * yield an empty store (this is the fresh-install path).
 */
export async function loadAuthProfileStore(
  agentId: string = DEFAULT_AGENT_ID,
): Promise<AuthProfileStore> {
  const paths = getStorePaths(agentId);
  const [profilesShape, usageShape] = await Promise.all([
    readJsonSafe<PersistedProfilesShape>(paths.profilesPath),
    readJsonSafe<PersistedUsageShape>(paths.usagePath),
  ]);

  return {
    profiles: profilesShape?.profiles ?? [],
    order: profilesShape?.order ?? {},
    usageStats: usageShape?.usageStats ?? {},
  };
}

export async function saveAuthProfilesOnly(
  store: Pick<AuthProfileStore, "profiles" | "order">,
  agentId: string = DEFAULT_AGENT_ID,
): Promise<void> {
  const paths = getStorePaths(agentId);
  // Strip ephemeral profiles — they're only used in-memory for live key
  // overrides.
  const persistable = (store.profiles ?? []).filter((p) => !p.ephemeral);
  await writeJsonAtomic(paths.profilesPath, {
    profiles: persistable,
    order: store.order ?? {},
  });
}

export async function saveUsageStatsOnly(
  usageStats: UsageStats,
  agentId: string = DEFAULT_AGENT_ID,
): Promise<void> {
  const paths = getStorePaths(agentId);
  await writeJsonAtomic(paths.usagePath, { usageStats });
}

export async function saveAuthProfileStore(
  store: AuthProfileStore,
  agentId: string = DEFAULT_AGENT_ID,
): Promise<void> {
  await Promise.all([
    saveAuthProfilesOnly(store, agentId),
    saveUsageStatsOnly(store.usageStats ?? {}, agentId),
  ]);
}

/**
 * Insert or update a profile by id (merges with existing entry).
 * Caller is responsible for invoking saveAuthProfilesOnly afterwards if
 * persistence is desired.
 */
export function upsertAuthProfileInStore(
  store: AuthProfileStore,
  profile: AuthProfile,
): AuthProfileStore {
  const next = { ...store, profiles: [...store.profiles] };
  const index = next.profiles.findIndex((p) => p.id === profile.id);
  if (index >= 0) {
    next.profiles[index] = { ...next.profiles[index], ...profile };
  } else {
    next.profiles.push(profile);
  }
  return next;
}

/** Remove a profile by id; returns the new store (no-op if absent). */
export function removeAuthProfileFromStore(
  store: AuthProfileStore,
  profileId: string,
): AuthProfileStore {
  return {
    ...store,
    profiles: store.profiles.filter((p) => p.id !== profileId),
  };
}

function pickBackoffLadder(reason: FailoverReason): number[] {
  if (reason === "billing") {
    return BILLING_BACKOFF_LADDER_MS;
  }
  return TRANSIENT_BACKOFF_LADDER_MS;
}

/**
 * Apply a cooldown to a profile and bump its level. Pure — returns a new
 * UsageStats map; caller persists via saveUsageStatsOnly.
 *
 * If `retryAfterMs` is provided, that wins over the ladder (subject to
 * the ladder's max as a floor — providers sometimes return aggressive
 * Retry-After values that don't actually let us retry sensibly).
 */
export function applyCooldown(
  usage: UsageStats,
  profileId: string,
  reason: FailoverReason,
  retryAfterMs?: number,
  now: number = Date.now(),
): UsageStats {
  const current: ProfileUsageStats = usage[profileId] ?? {};
  const ladder = pickBackoffLadder(reason);
  const previousLevel = current.cooldownLevel ?? -1;
  const nextLevel = Math.min(ladder.length - 1, previousLevel + 1);
  const ladderMs = ladder[nextLevel];

  let cooldownMs = ladderMs;
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)) {
    // Honor Retry-After but never less than the ladder step.
    cooldownMs = Math.max(retryAfterMs, ladderMs);
  }

  // Defensive: if a stale snapshot or clock skew yields a `now` smaller
  // than the existing cooldownUntil, never shorten the cooldown — pick
  // whichever is later. Prevents a buggy upstream from accidentally
  // releasing a profile we already decided to back off.
  const proposedUntil = now + cooldownMs;
  const finalUntil = Math.max(current.cooldownUntil ?? 0, proposedUntil);

  const next: ProfileUsageStats = {
    ...current,
    cooldownUntil: finalUntil,
    cooldownLevel: nextLevel,
    cooldownReason: reason,
    errorCount: (current.errorCount ?? 0) + 1,
  };

  if (reason === "auth_permanent") {
    // Treat as hard-disabled until manually cleared. Pick "disabled = far
    // future" rather than removing the profile so the user can see why.
    next.disabledUntil = now + 365 * 24 * 60 * 60_000; // 1y sentinel
  }

  return { ...usage, [profileId]: next };
}

/** Reset cooldown + level + error count for a profile (success path). */
export function recordProfileSuccess(
  usage: UsageStats,
  profileId: string,
  now: number = Date.now(),
): UsageStats {
  const current = usage[profileId] ?? {};
  return {
    ...usage,
    [profileId]: {
      lastUsed: now,
      cooldownLevel: -1,
      // Drop cooldownUntil/cooldownReason if previously set.
      cooldownUntil: undefined,
      cooldownReason: undefined,
      errorCount: 0,
      disabledUntil: current.disabledUntil, // preserve permanent disable
    },
  };
}

/** Manually clear a cooldown without touching lastUsed. */
export function clearProfileCooldown(usage: UsageStats, profileId: string): UsageStats {
  const current = usage[profileId];
  if (!current) return usage;
  return {
    ...usage,
    [profileId]: {
      ...current,
      cooldownUntil: undefined,
      cooldownLevel: -1,
      cooldownReason: undefined,
      disabledUntil: undefined,
    },
  };
}

export function isProfileInCooldown(
  usage: UsageStats,
  profileId: string,
  now: number = Date.now(),
): boolean {
  const stats = usage[profileId];
  if (!stats) return false;
  if (stats.disabledUntil && stats.disabledUntil > now) return true;
  if (stats.cooldownUntil && stats.cooldownUntil > now) return true;
  return false;
}

export function getSoonestCooldownExpiry(
  usage: UsageStats,
  profileIds: string[],
  now: number = Date.now(),
): number | undefined {
  let soonest: number | undefined;
  for (const id of profileIds) {
    const stats = usage[id];
    if (!stats) continue;
    const candidates: number[] = [];
    if (stats.cooldownUntil && stats.cooldownUntil > now) {
      candidates.push(stats.cooldownUntil);
    }
    if (stats.disabledUntil && stats.disabledUntil > now) {
      candidates.push(stats.disabledUntil);
    }
    for (const candidate of candidates) {
      if (soonest === undefined || candidate < soonest) {
        soonest = candidate;
      }
    }
  }
  return soonest;
}

/** Profiles for one provider, in insertion order. */
export function listProfilesForProvider(
  store: AuthProfileStore,
  provider: RoutingProviderId,
): AuthProfile[] {
  return store.profiles.filter((p) => p.provider === provider);
}
