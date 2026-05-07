/**
 * Env-var-driven API key resolution for the routing layer.
 *
 * Priority chain (mirrors OpenClaw `live-auth-keys.ts:110-164`, with
 * READABLE_LIVE prefix):
 *
 *   1. READABLE_LIVE_<PROV>_KEY  — short-circuit; returns alone
 *   2. <PROV>_API_KEYS           — comma/space/semicolon list
 *   3. <PROV>_API_KEY            — primary
 *   4. <PROV>_API_KEY_*          — numbered/suffixed variants
 *   5. fallbackVars per provider — e.g. GOOGLE_API_KEY for google-vertex
 *
 * (1) wins alone — useful for "use this exact key right now, ignore
 * everything else" overrides. (2)–(5) merge.
 */

import type { RoutingProviderId } from './types';

interface ProviderKeyConfig {
  /**
   * Env-var prefix used by the provider. e.g. for `openai`, the chain
   * looks for `OPENAI_API_KEYS`, `OPENAI_API_KEY`, `OPENAI_API_KEY_*`.
   */
  prefix: string;
  /** Extra env var names checked after the standard chain. */
  fallbackVars?: string[];
}

const PROVIDER_KEY_CONFIG: Record<RoutingProviderId, ProviderKeyConfig> = {
  openai: { prefix: 'OPENAI' },
  'openai-codex': {
    prefix: 'OPENAI_CODEX',
    // Codex normally authenticates via CLI OAuth; an env key is a manual
    // override.
    fallbackVars: [],
  },
  anthropic: { prefix: 'ANTHROPIC' },
  gemini: {
    prefix: 'GEMINI',
    fallbackVars: ['GOOGLE_API_KEY'],
  },
  'google-vertex': {
    prefix: 'GOOGLE_VERTEX',
    fallbackVars: ['GOOGLE_API_KEY'],
  },
  openrouter: { prefix: 'OPENROUTER' },
};

/**
 * Parse a delimited string of keys. Accepts comma, semicolon, or
 * whitespace separators. Empty entries are dropped.
 */
function parseKeyList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readSingleKey(
  name: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const raw = env[name];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumberedKeys(
  prefix: string,
  env: Record<string, string | undefined>,
): string[] {
  const namePrefix = `${prefix}_API_KEY_`;
  const matches: Array<{ name: string; value: string }> = [];
  for (const name of Object.keys(env)) {
    if (!name.startsWith(namePrefix)) {
      continue;
    }
    const value = env[name];
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    matches.push({ name, value: trimmed });
  }
  // Stable order — by env-var name ascending so OPENAI_API_KEY_1 lands
  // before OPENAI_API_KEY_2.
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches.map((entry) => entry.value);
}

export interface ResolvedProviderKey {
  /** The credential string. */
  key: string;
  /**
   * Where it came from. `live` means the short-circuit env was set.
   * Useful when constructing AuthProfile.id for stable round-robin.
   */
  source:
    | 'live'
    | 'list'
    | 'primary'
    | `numbered:${string}`
    | `fallback:${string}`;
}

export interface CollectKeysOptions {
  /** Inject env for tests. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolve all candidate API keys for `provider`, in the order they should
 * be tried (deduplicated, preserving first occurrence).
 *
 * Returns `[]` when no key can be discovered. Callers can then either
 * fall back to CLI-OAuth-detected profiles or skip the provider entirely.
 */
export function collectProviderApiKeys(
  provider: RoutingProviderId,
  options: CollectKeysOptions = {},
): ResolvedProviderKey[] {
  const env = options.env ?? process.env;
  const config = PROVIDER_KEY_CONFIG[provider];
  if (!config) {
    return [];
  }

  // (1) Short-circuit override.
  const liveKey = readSingleKey(`READABLE_LIVE_${config.prefix}_KEY`, env);
  if (liveKey) {
    return [{ key: liveKey, source: 'live' }];
  }

  const out: ResolvedProviderKey[] = [];
  const seen = new Set<string>();

  const push = (key: string, source: ResolvedProviderKey['source']) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, source });
    }
  };

  // (2) List form.
  for (const key of parseKeyList(env[`${config.prefix}_API_KEYS`])) {
    push(key, 'list');
  }

  // (3) Primary single.
  const primary = readSingleKey(`${config.prefix}_API_KEY`, env);
  if (primary) {
    push(primary, 'primary');
  }

  // (4) Numbered variants.
  for (const numbered of readNumberedKeys(config.prefix, env)) {
    push(numbered, `numbered:${config.prefix}`);
  }

  // (5) Provider-specific fallbacks.
  for (const fallbackName of config.fallbackVars ?? []) {
    const value = readSingleKey(fallbackName, env);
    if (value) {
      push(value, `fallback:${fallbackName}`);
    }
  }

  return out;
}

/**
 * Convenience wrapper that returns just the bare key strings.
 * `collectProviderApiKeys` is preferred for new code so callers can
 * preserve the source for profile id stability.
 */
export function collectProviderKeyStrings(
  provider: RoutingProviderId,
  options: CollectKeysOptions = {},
): string[] {
  return collectProviderApiKeys(provider, options).map((entry) => entry.key);
}

/**
 * Quick yes/no — is at least one env key configured for this provider?
 * Cheaper than `collectProviderApiKeys` in hot paths because it can early
 * exit on the first match.
 */
export function hasAnyProviderKey(
  provider: RoutingProviderId,
  options: CollectKeysOptions = {},
): boolean {
  const env = options.env ?? process.env;
  const config = PROVIDER_KEY_CONFIG[provider];
  if (!config) {
    return false;
  }

  if (readSingleKey(`READABLE_LIVE_${config.prefix}_KEY`, env)) return true;
  if (parseKeyList(env[`${config.prefix}_API_KEYS`]).length > 0) return true;
  if (readSingleKey(`${config.prefix}_API_KEY`, env)) return true;
  if (readNumberedKeys(config.prefix, env).length > 0) return true;
  for (const name of config.fallbackVars ?? []) {
    if (readSingleKey(name, env)) return true;
  }
  return false;
}
