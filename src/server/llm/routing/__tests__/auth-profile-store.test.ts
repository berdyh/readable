import { describe, expect, it } from 'vitest';

import {
  applyCooldown,
  clearProfileCooldown,
  getSoonestCooldownExpiry,
  isProfileInCooldown,
  recordProfileSuccess,
  removeAuthProfileFromStore,
  upsertAuthProfileInStore,
} from '../auth-profile-store';
import type { AuthProfile, AuthProfileStore } from '../types';

const baseProfile = (overrides: Partial<AuthProfile> = {}): AuthProfile => ({
  id: 'openai:default',
  provider: 'openai',
  type: 'api_key',
  secret: 'sk-1',
  ...overrides,
});

const baseStore = (overrides: Partial<AuthProfileStore> = {}): AuthProfileStore => ({
  profiles: [],
  usageStats: {},
  order: {},
  ...overrides,
});

describe('upsertAuthProfileInStore', () => {
  it('adds a profile when id is new', () => {
    const next = upsertAuthProfileInStore(baseStore(), baseProfile());
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe('openai:default');
  });

  it('merges over an existing profile by id', () => {
    const start = baseStore({ profiles: [baseProfile({ secret: 'old' })] });
    const next = upsertAuthProfileInStore(
      start,
      baseProfile({ secret: 'new', label: 'Renamed' }),
    );
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].secret).toBe('new');
    expect(next.profiles[0].label).toBe('Renamed');
  });
});

describe('removeAuthProfileFromStore', () => {
  it('drops by id', () => {
    const start = baseStore({
      profiles: [baseProfile(), baseProfile({ id: 'openai:b', secret: 'sk-2' })],
    });
    const next = removeAuthProfileFromStore(start, 'openai:default');
    expect(next.profiles.map((p) => p.id)).toEqual(['openai:b']);
  });

  it('is a no-op for an absent id', () => {
    const start = baseStore({ profiles: [baseProfile()] });
    const next = removeAuthProfileFromStore(start, 'nope');
    expect(next.profiles).toHaveLength(1);
  });
});

describe('applyCooldown ladder', () => {
  it('walks the transient ladder: 1m → 5m → 25m → 1h cap', () => {
    const now = 1_000_000;
    let usage = applyCooldown({}, 'p', 'rate_limit', undefined, now);
    expect(usage.p.cooldownLevel).toBe(0);
    expect(usage.p.cooldownUntil).toBe(now + 60_000);

    usage = applyCooldown(usage, 'p', 'rate_limit', undefined, now);
    expect(usage.p.cooldownLevel).toBe(1);
    expect(usage.p.cooldownUntil).toBe(now + 5 * 60_000);

    usage = applyCooldown(usage, 'p', 'rate_limit', undefined, now);
    expect(usage.p.cooldownLevel).toBe(2);
    expect(usage.p.cooldownUntil).toBe(now + 25 * 60_000);

    usage = applyCooldown(usage, 'p', 'rate_limit', undefined, now);
    expect(usage.p.cooldownLevel).toBe(3);
    expect(usage.p.cooldownUntil).toBe(now + 60 * 60_000);

    // Past the cap — stays at 1h.
    usage = applyCooldown(usage, 'p', 'rate_limit', undefined, now);
    expect(usage.p.cooldownLevel).toBe(3);
    expect(usage.p.cooldownUntil).toBe(now + 60 * 60_000);
  });

  it('uses billing ladder for billing reason: 5h → 24h cap', () => {
    const now = 0;
    let usage = applyCooldown({}, 'p', 'billing', undefined, now);
    expect(usage.p.cooldownUntil).toBe(5 * 60 * 60_000);
    usage = applyCooldown(usage, 'p', 'billing', undefined, now);
    expect(usage.p.cooldownUntil).toBe(24 * 60 * 60_000);
  });

  it('honours retryAfterMs when it exceeds the ladder step', () => {
    const now = 0;
    const usage = applyCooldown({}, 'p', 'rate_limit', 90_000, now);
    expect(usage.p.cooldownUntil).toBe(90_000);
  });

  it('floors retryAfterMs to the ladder step when smaller', () => {
    const now = 0;
    const usage = applyCooldown({}, 'p', 'rate_limit', 1_000, now);
    // ladder step at level 0 is 60s; smaller retryAfter is ignored.
    expect(usage.p.cooldownUntil).toBe(60_000);
  });

  it('marks auth_permanent profiles as disabled (sentinel)', () => {
    const now = 1_700_000_000_000;
    const usage = applyCooldown({}, 'p', 'auth_permanent', undefined, now);
    expect(usage.p.disabledUntil).toBeGreaterThan(now);
  });

  it('preserves errorCount across cooldowns', () => {
    let usage = applyCooldown({}, 'p', 'rate_limit', undefined, 0);
    expect(usage.p.errorCount).toBe(1);
    usage = applyCooldown(usage, 'p', 'timeout', undefined, 0);
    expect(usage.p.errorCount).toBe(2);
  });
});

describe('recordProfileSuccess', () => {
  it('clears cooldownUntil + level + errorCount and sets lastUsed', () => {
    const before = applyCooldown({}, 'p', 'rate_limit', undefined, 0);
    const after = recordProfileSuccess(before, 'p', 5_000);
    expect(after.p.cooldownLevel).toBe(-1);
    expect(after.p.cooldownUntil).toBeUndefined();
    expect(after.p.errorCount).toBe(0);
    expect(after.p.lastUsed).toBe(5_000);
  });

  it('preserves disabledUntil (permanent disable survives a probe success)', () => {
    const before = applyCooldown({}, 'p', 'auth_permanent', undefined, 0);
    const after = recordProfileSuccess(before, 'p', 5_000);
    expect(after.p.disabledUntil).toBeGreaterThan(0);
  });
});

describe('clearProfileCooldown', () => {
  it('clears cooldown + disabledUntil leaving lastUsed', () => {
    const before = recordProfileSuccess(
      applyCooldown({}, 'p', 'rate_limit', undefined, 0),
      'p',
      5_000,
    );
    expect(before.p.lastUsed).toBe(5_000);
    const after = clearProfileCooldown(before, 'p');
    expect(after.p.cooldownUntil).toBeUndefined();
    expect(after.p.disabledUntil).toBeUndefined();
    expect(after.p.lastUsed).toBe(5_000);
  });

  it('is a no-op for an absent profile', () => {
    expect(clearProfileCooldown({}, 'absent')).toEqual({});
  });
});

describe('isProfileInCooldown', () => {
  it('returns true while cooldownUntil > now', () => {
    const usage = applyCooldown({}, 'p', 'rate_limit', undefined, 0);
    expect(isProfileInCooldown(usage, 'p', 30_000)).toBe(true);
    expect(isProfileInCooldown(usage, 'p', 120_000)).toBe(false);
  });

  it('respects disabledUntil even after cooldown lifts', () => {
    const usage = applyCooldown({}, 'p', 'auth_permanent', undefined, 0);
    expect(isProfileInCooldown(usage, 'p', 1_000_000)).toBe(true);
  });
});

describe('getSoonestCooldownExpiry', () => {
  it('returns the earliest active expiry across the listed ids', () => {
    const usage = {
      a: { cooldownUntil: 1_000 },
      b: { cooldownUntil: 5_000 },
      c: { cooldownUntil: 100 },
    };
    expect(getSoonestCooldownExpiry(usage, ['a', 'b', 'c'], 0)).toBe(100);
    // Ignores expired ones.
    expect(getSoonestCooldownExpiry(usage, ['a', 'b', 'c'], 200)).toBe(1_000);
  });

  it('returns undefined when no ids are in active cooldown', () => {
    expect(getSoonestCooldownExpiry({}, ['a'], 0)).toBeUndefined();
  });
});
