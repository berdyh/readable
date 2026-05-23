import { beforeEach, describe, expect, it } from 'vitest';

import {
  FallbackSummaryError,
  parseModelRef,
  resetProbeStateForTests,
  runWithModelFallback,
  type RunFn,
  type RunFnContext,
} from '../fallback';
import type { AuthProfile, AuthProfileStore } from '../types';

const makeStore = (overrides: Partial<AuthProfileStore> = {}): AuthProfileStore => ({
  profiles: [],
  usageStats: {},
  order: {},
  ...overrides,
});

const profile = (overrides: Partial<AuthProfile> & { id: string }): AuthProfile => ({
  provider: 'openai',
  type: 'api_key',
  secret: 'sk-x',
  ...overrides,
});

class MockHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MockHttpError';
    this.status = status;
  }
}

beforeEach(() => {
  resetProbeStateForTests();
});

describe('parseModelRef', () => {
  it('splits provider and model on the first slash', () => {
    expect(parseModelRef('openai/gpt-4o-mini')).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(parseModelRef('anthropic/claude-3-5-sonnet-20241022')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    });
  });

  it('preserves slashes in the model portion', () => {
    expect(parseModelRef('openrouter/meta-llama/llama-3.3-70b:free')).toMatchObject({
      provider: 'openrouter',
      model: 'meta-llama/llama-3.3-70b:free',
    });
  });

  it('throws on a missing slash', () => {
    expect(() => parseModelRef('gpt-4o-mini')).toThrow(/slash form/);
  });
});

describe('runWithModelFallback success path', () => {
  it('uses the first ready profile for the primary candidate', async () => {
    const calls: RunFnContext[] = [];
    const run: RunFn<string> = async (ctx) => {
      calls.push(ctx);
      return `ok:${ctx.provider}/${ctx.model}/${ctx.profile.id}`;
    };

    const store = makeStore({ profiles: [profile({ id: 'openai:env' })] });
    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      store,
      run,
    });

    expect(result.result).toBe('ok:openai/gpt-4o-mini/openai:env');
    expect(result.attempts).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].profile.id).toBe('openai:env');
  });

  it('promotes the successful profile in the order list', async () => {
    const store = makeStore({
      profiles: [
        profile({ id: 'a' }),
        profile({ id: 'b' }),
      ],
      order: { openai: ['a', 'b'] },
    });

    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      store,
      run: async () => 'ok',
    });

    expect(result.store.order?.openai?.[0]).toBe('a');
  });
});

describe('runWithModelFallback failover behavior', () => {
  it('advances to the fallback candidate on a 429', async () => {
    const tries: string[] = [];
    const run: RunFn<string> = async (ctx) => {
      tries.push(`${ctx.provider}:${ctx.profile.id}`);
      if (ctx.provider === 'openai') {
        throw new MockHttpError(429, 'rate limit');
      }
      return 'fallback-success';
    };

    const store = makeStore({
      profiles: [
        profile({ id: 'openai:env', provider: 'openai' }),
        profile({ id: 'openrouter:env', provider: 'openrouter' }),
      ],
    });

    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      fallbacks: ['openrouter/meta-llama/llama-3.3-70b:free'],
      store,
      run,
    });

    expect(result.result).toBe('fallback-success');
    expect(result.candidate.provider).toBe('openrouter');
    expect(tries).toEqual(['openai:openai:env', 'openrouter:openrouter:env']);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].reason).toBe('rate_limit');
  });

  it('tries every profile within a provider before advancing', async () => {
    const tries: string[] = [];
    const run: RunFn<string> = async (ctx) => {
      tries.push(ctx.profile.id);
      if (ctx.profile.id !== 'b') {
        throw new MockHttpError(429, 'limit');
      }
      return 'ok';
    };

    const store = makeStore({
      profiles: [
        profile({ id: 'a', provider: 'openai' }),
        profile({ id: 'b', provider: 'openai' }),
      ],
    });

    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      store,
      run,
    });

    expect(result.result).toBe('ok');
    expect(tries).toEqual(['a', 'b']);
    expect(result.attempts).toHaveLength(1);
  });

  it('throws FallbackSummaryError when all candidates are exhausted', async () => {
    const run: RunFn<string> = async () => {
      throw new MockHttpError(503, 'service unavailable');
    };

    const store = makeStore({
      profiles: [
        profile({ id: 'a', provider: 'openai' }),
        profile({ id: 'b', provider: 'openrouter' }),
      ],
    });

    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        fallbacks: ['openrouter/meta-llama/llama-3.3-70b:free'],
        store,
        run,
      }),
    ).rejects.toBeInstanceOf(FallbackSummaryError);
  });
});

describe('runWithModelFallback fail-fast cases', () => {
  it('does not advance on auth_permanent', async () => {
    const tries: string[] = [];
    const run: RunFn<string> = async (ctx) => {
      tries.push(ctx.provider);
      throw new MockHttpError(401, 'invalid_api_key');
    };

    const store = makeStore({
      profiles: [
        profile({ id: 'a', provider: 'openai' }),
        profile({ id: 'b', provider: 'openrouter' }),
      ],
    });

    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        fallbacks: ['openrouter/meta-llama/llama-3.3-70b:free'],
        store,
        run,
      }),
    ).rejects.toMatchObject({ reason: 'auth_permanent' });
    // Only the openai profile got tried — fallback skipped.
    expect(tries).toEqual(['openai']);
  });

  it('does not advance on format errors', async () => {
    const run: RunFn<string> = async () => {
      throw new MockHttpError(400, 'invalid_request: missing field');
    };

    const store = makeStore({
      profiles: [profile({ id: 'a', provider: 'openai' })],
    });

    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        fallbacks: ['openrouter/x:free'],
        store,
        run,
      }),
    ).rejects.toMatchObject({ reason: 'format' });
  });
});

describe('runWithModelFallback cooldown handling', () => {
  it('skips a candidate whose only profile is in cooldown', async () => {
    const visits: string[] = [];
    const run: RunFn<string> = async (ctx) => {
      visits.push(ctx.provider);
      return 'ok';
    };

    const store = makeStore({
      profiles: [
        profile({ id: 'openai:env', provider: 'openai' }),
        profile({ id: 'openrouter:env', provider: 'openrouter' }),
      ],
      usageStats: {
        // 'openai:env' cools down from billing — permanent, never probe
        'openai:env': {
          cooldownUntil: 9_999_999_999_999,
          cooldownReason: 'billing',
          cooldownLevel: 0,
        },
      },
    });

    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      fallbacks: ['openrouter/meta-llama/llama-3.3-70b:free'],
      store,
      run,
    });

    expect(result.candidate.provider).toBe('openrouter');
    expect(visits).toEqual(['openrouter']);
  });

  it('issues a probe call when the only profile is in transient cooldown', async () => {
    const visits: RunFnContext[] = [];
    const run: RunFn<string> = async (ctx) => {
      visits.push(ctx);
      return 'probe-success';
    };

    const store = makeStore({
      profiles: [profile({ id: 'openai:env' })],
      usageStats: {
        'openai:env': {
          cooldownUntil: 9_999_999_999_999,
          cooldownReason: 'rate_limit',
          cooldownLevel: 1,
        },
      },
    });

    const result = await runWithModelFallback({
      primary: 'openai/gpt-4o-mini',
      store,
      run,
    });

    expect(visits).toHaveLength(1);
    expect(visits[0].isProbe).toBe(true);
    expect(result.result).toBe('probe-success');
  });

  it('does not probe more than once per MIN_PROBE_INTERVAL_MS for the same provider', async () => {
    let attempts = 0;
    const run: RunFn<string> = async () => {
      attempts += 1;
      throw new MockHttpError(429, 'rate limit');
    };

    const store = makeStore({
      profiles: [profile({ id: 'openai:env' })],
      usageStats: {
        'openai:env': {
          cooldownUntil: 9_999_999_999_999,
          cooldownReason: 'rate_limit',
          cooldownLevel: 1,
        },
      },
    });

    // First call: probe attempted, fails again, count hits 1.
    let now = 1_000_000;
    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        store,
        run,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(FallbackSummaryError);
    expect(attempts).toBe(1);

    // Second call within the probe interval — must skip the provider.
    now += 10_000; // 10s later
    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        store,
        run,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(FallbackSummaryError);
    expect(attempts).toBe(1); // unchanged

    // After MIN_PROBE_INTERVAL_MS another probe is allowed.
    now += MIN_PROBE_INTERVAL_MS_PLUS;
    await expect(
      runWithModelFallback({
        primary: 'openai/gpt-4o-mini',
        store,
        run,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(FallbackSummaryError);
    expect(attempts).toBe(2);
  });
});

const MIN_PROBE_INTERVAL_MS_PLUS = 31_000;
