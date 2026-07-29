/**
 * Resolve the order in which AuthProfiles should be tried for a given
 * provider.
 *
 * Mirrors OpenClaw `auth-profiles/order.ts:resolveAuthProfileOrder`:
 *
 *   1. Bucket by type: oauth > token > api_key
 *   2. Within each bucket, sort by lastUsed ascending (never-used first)
 *   3. Concatenate buckets in priority order
 *   4. Move profiles currently in cooldown to the end (preserving their
 *      relative order)
 *   5. Apply explicit per-provider override from `store.order` if any
 *      profile id is listed there — listed ones win front rank, stable
 *      order
 *
 * The output is a list of profile IDs. Returns [] if the provider has
 * no profiles configured.
 */

import { isProfileInCooldown, listProfilesForProvider } from "./auth-profile-store";
import type { AuthProfile, AuthProfileStore, AuthProfileType, RoutingProviderId } from "./types";

const TYPE_PRIORITY: Record<AuthProfileType, number> = {
  oauth: 0,
  token: 1,
  api_key: 2,
};

interface OrderOptions {
  /** Override for tests; defaults to Date.now(). */
  now?: number;
  /** Skip the cooldown re-ordering pass (useful in tests/probes). */
  ignoreCooldown?: boolean;
}

function compareProfiles(a: AuthProfile, b: AuthProfile): number {
  const typeDelta = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
  if (typeDelta !== 0) return typeDelta;
  const aLast = a.expiresAt ?? Number.POSITIVE_INFINITY;
  const bLast = b.expiresAt ?? Number.POSITIVE_INFINITY;
  if (aLast !== bLast) return aLast - bLast;
  return a.id.localeCompare(b.id);
}

export function resolveAuthProfileOrder(
  store: AuthProfileStore,
  provider: RoutingProviderId,
  options: OrderOptions = {},
): string[] {
  const profiles = listProfilesForProvider(store, provider);
  if (profiles.length === 0) {
    return [];
  }

  const now = options.now ?? Date.now();
  const usage = store.usageStats ?? {};

  // (1)+(2)+(3): bucket by type, sort by lastUsed asc within bucket.
  const sorted = [...profiles].sort((a, b) => {
    const typeDelta = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (typeDelta !== 0) return typeDelta;

    const aLast = usage[a.id]?.lastUsed ?? -1;
    const bLast = usage[b.id]?.lastUsed ?? -1;
    if (aLast !== bLast) return aLast - bLast;

    return compareProfiles(a, b);
  });

  // (5): apply explicit override. Listed-first ranks promoted; rest keep
  // bucket order.
  const explicit = store.order?.[provider] ?? [];
  let ordered = sorted;
  if (explicit.length > 0) {
    const explicitSet = new Set(explicit);
    const promoted: AuthProfile[] = [];
    const rest: AuthProfile[] = [];
    for (const id of explicit) {
      const profile = sorted.find((p) => p.id === id);
      if (profile) promoted.push(profile);
    }
    for (const profile of sorted) {
      if (!explicitSet.has(profile.id)) rest.push(profile);
    }
    ordered = [...promoted, ...rest];
  }

  // (4): cooldown profiles to the end, preserving relative order.
  if (options.ignoreCooldown) {
    return ordered.map((p) => p.id);
  }

  const ready: string[] = [];
  const cooldown: string[] = [];
  for (const profile of ordered) {
    if (isProfileInCooldown(usage, profile.id, now)) {
      cooldown.push(profile.id);
    } else {
      ready.push(profile.id);
    }
  }
  return [...ready, ...cooldown];
}

/**
 * Promote a profile to the front of a provider's explicit order. Used
 * after a successful call so the most-recently-working profile is tried
 * first next time. Returns the new store (caller persists).
 */
export function promoteAuthProfileInOrder(
  store: AuthProfileStore,
  provider: RoutingProviderId,
  profileId: string,
): AuthProfileStore {
  const previous = store.order?.[provider] ?? [];
  if (previous[0] === profileId) {
    return store; // already promoted
  }
  const filtered = previous.filter((id) => id !== profileId);
  return {
    ...store,
    order: { ...(store.order ?? {}), [provider]: [profileId, ...filtered] },
  };
}
