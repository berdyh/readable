import { describe, expect, it } from 'vitest';

import {
  promoteAuthProfileInOrder,
  resolveAuthProfileOrder,
} from '../auth-profile-order';
import type { AuthProfile, AuthProfileStore } from '../types';

const profile = (overrides: Partial<AuthProfile> & { id: string }): AuthProfile => ({
  provider: 'openai',
  type: 'api_key',
  secret: 'x',
  ...overrides,
});

const storeWith = (profiles: AuthProfile[]): AuthProfileStore => ({
  profiles,
  usageStats: {},
  order: {},
});

describe('resolveAuthProfileOrder bucket priority', () => {
  it('orders oauth > token > api_key when all are present', () => {
    const store = storeWith([
      profile({ id: 'k:1', type: 'api_key' }),
      profile({ id: 't:1', type: 'token' }),
      profile({ id: 'o:1', type: 'oauth' }),
    ]);
    expect(resolveAuthProfileOrder(store, 'openai')).toEqual(['o:1', 't:1', 'k:1']);
  });

  it('within a bucket, never-used profiles come before used', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'api_key' }),
        profile({ id: 'c', type: 'api_key' }),
      ],
      usageStats: {
        a: { lastUsed: 100 },
        // b never used
        c: { lastUsed: 50 },
      },
      order: {},
    };
    // never-used (b) first; then ascending lastUsed: c (50) then a (100)
    expect(resolveAuthProfileOrder(store, 'openai')).toEqual(['b', 'c', 'a']);
  });
});

describe('cooldown handling', () => {
  it('moves profiles in active cooldown to the end (preserving relative order)', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'api_key' }),
        profile({ id: 'c', type: 'api_key' }),
      ],
      usageStats: {
        a: { cooldownUntil: 10_000 }, // active
        // b: ready
        c: { cooldownUntil: 10_000 }, // active
      },
      order: {},
    };
    expect(resolveAuthProfileOrder(store, 'openai', { now: 0 })).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('treats a cooldown that has expired as ready', () => {
    const store: AuthProfileStore = {
      profiles: [profile({ id: 'a', type: 'api_key' })],
      usageStats: { a: { cooldownUntil: 100 } },
      order: {},
    };
    expect(resolveAuthProfileOrder(store, 'openai', { now: 1_000 })).toEqual(['a']);
  });

  it('respects disabledUntil sentinel like cooldownUntil', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'api_key' }),
      ],
      usageStats: { b: { disabledUntil: Number.MAX_SAFE_INTEGER } },
      order: {},
    };
    expect(resolveAuthProfileOrder(store, 'openai', { now: 0 })).toEqual(['a', 'b']);
  });

  it('ignoreCooldown returns the bucket-sorted order unchanged', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'api_key' }),
      ],
      usageStats: { a: { cooldownUntil: Number.MAX_SAFE_INTEGER } },
      order: {},
    };
    expect(
      resolveAuthProfileOrder(store, 'openai', { now: 0, ignoreCooldown: true }),
    ).toEqual(['a', 'b']);
  });
});

describe('explicit order override', () => {
  it('promotes listed ids to front, preserves rest in bucket order', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'oauth' }),
        profile({ id: 'c', type: 'api_key' }),
      ],
      usageStats: {},
      order: { openai: ['c', 'a'] },
    };
    expect(resolveAuthProfileOrder(store, 'openai')).toEqual(['c', 'a', 'b']);
  });

  it('drops listed ids that no longer exist', () => {
    const store: AuthProfileStore = {
      profiles: [profile({ id: 'a', type: 'api_key' })],
      usageStats: {},
      order: { openai: ['ghost', 'a'] },
    };
    expect(resolveAuthProfileOrder(store, 'openai')).toEqual(['a']);
  });
});

describe('provider isolation', () => {
  it('ignores profiles for other providers', () => {
    const store = storeWith([
      profile({ id: 'a', provider: 'openai' }),
      profile({ id: 'b', provider: 'anthropic' }),
    ]);
    expect(resolveAuthProfileOrder(store, 'openai')).toEqual(['a']);
    expect(resolveAuthProfileOrder(store, 'anthropic')).toEqual(['b']);
  });

  it('returns [] for a provider with no profiles', () => {
    expect(resolveAuthProfileOrder(storeWith([]), 'gemini')).toEqual([]);
  });
});

describe('promoteAuthProfileInOrder', () => {
  it('moves the id to the front', () => {
    const store: AuthProfileStore = {
      profiles: [
        profile({ id: 'a', type: 'api_key' }),
        profile({ id: 'b', type: 'api_key' }),
      ],
      usageStats: {},
      order: { openai: ['a'] },
    };
    const next = promoteAuthProfileInOrder(store, 'openai', 'b');
    expect(next.order?.openai).toEqual(['b', 'a']);
  });

  it('is a no-op when already at front', () => {
    const store: AuthProfileStore = {
      profiles: [profile({ id: 'a', type: 'api_key' })],
      usageStats: {},
      order: { openai: ['a'] },
    };
    const next = promoteAuthProfileInOrder(store, 'openai', 'a');
    expect(next).toBe(store);
  });

  it('initializes order entry when none was set', () => {
    const store: AuthProfileStore = {
      profiles: [profile({ id: 'a', type: 'api_key' })],
      usageStats: {},
      order: {},
    };
    const next = promoteAuthProfileInOrder(store, 'openai', 'a');
    expect(next.order?.openai).toEqual(['a']);
  });
});
