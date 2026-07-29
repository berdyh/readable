/**
 * Bridge between credential sources (env vars + CLI auth files) and the
 * persistent AuthProfileStore. This is what the runtime calls at startup
 * to get a fully populated store ready for `runWithModelFallback`.
 *
 * Mirrors OpenClaw `auth-profiles/external-cli-sync.ts:99-312` minus the
 * keychain step.
 */

import { collectProviderApiKeys } from "./env-keys";
import { detectCliCredentials, type DetectedCliCredentials } from "./cli-detect";
import { loadAuthProfileStore, upsertAuthProfileInStore } from "./auth-profile-store";
import type { AuthProfile, AuthProfileStore, RoutingProviderId } from "./types";

const ALL_PROVIDERS: RoutingProviderId[] = [
  "openai",
  "openai-codex",
  "anthropic",
  "gemini",
  "google-vertex",
  "openrouter",
];

function shortFingerprint(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // Unsigned 32-bit base36 — short, stable, and never collides with the
  // human-friendly strings in the source field.
  return (hash >>> 0).toString(36);
}

function profileIdForEnvKey(provider: RoutingProviderId, source: string, key: string): string {
  if (source === "live") {
    return `${provider}:live`;
  }
  if (source === "primary") {
    return `${provider}:env`;
  }
  if (source.startsWith("numbered:")) {
    return `${provider}:env-${shortFingerprint(key)}`;
  }
  if (source === "list") {
    return `${provider}:env-${shortFingerprint(key)}`;
  }
  if (source.startsWith("fallback:")) {
    const name = source.slice("fallback:".length).toLowerCase();
    return `${provider}:env-${name}`;
  }
  return `${provider}:env-${shortFingerprint(key)}`;
}

function applyEnvKeysToStore(
  store: AuthProfileStore,
  env?: Record<string, string | undefined>,
): AuthProfileStore {
  let next = store;
  for (const provider of ALL_PROVIDERS) {
    const keys = collectProviderApiKeys(provider, { env });
    for (const { key, source } of keys) {
      const id = profileIdForEnvKey(provider, source, key);
      next = upsertAuthProfileInStore(next, {
        id,
        provider,
        type: "api_key",
        secret: key,
        source: source === "live" ? "live" : "env",
        ephemeral: source === "live",
      });
    }
  }
  return next;
}

function applyCliCredentialsToStore(
  store: AuthProfileStore,
  cli: DetectedCliCredentials,
): AuthProfileStore {
  let next = store;

  if (cli.codex) {
    next = upsertAuthProfileInStore(next, {
      id: "openai-codex:cli",
      provider: "openai-codex",
      type: "oauth",
      secret: cli.codex.accessToken,
      oauthRefresh: cli.codex.refreshToken,
      expiresAt: cli.codex.expiresAt,
      label: cli.codex.accountId ?? "Codex CLI",
      source: "cli-file",
    });
  }

  if (cli.claude) {
    next = upsertAuthProfileInStore(next, {
      id: "anthropic:cli",
      provider: "anthropic",
      type: "oauth",
      secret: cli.claude.accessToken,
      oauthRefresh: cli.claude.refreshToken,
      expiresAt: cli.claude.expiresAt,
      label: "Claude CLI",
      source: "cli-file",
    });
  }

  if (cli.gemini) {
    next = upsertAuthProfileInStore(next, {
      id: "gemini:cli",
      provider: "gemini",
      type: "oauth",
      secret: cli.gemini.accessToken,
      oauthRefresh: cli.gemini.refreshToken,
      expiresAt: cli.gemini.expiresAt,
      label: "Gemini CLI",
      source: "cli-file",
    });
  }

  if (cli.gcloud) {
    next = upsertAuthProfileInStore(next, {
      id: "google-vertex:adc",
      provider: "google-vertex",
      type: "oauth",
      // Empty access token signals "use refresh token to mint one at
      // request time". The provider implementation handles that.
      secret: cli.gcloud.accessToken,
      oauthRefresh: cli.gcloud.refreshToken,
      label: cli.gcloud.accountId ?? "gcloud ADC",
      source: "cli-file",
    });
  }

  return next;
}

export interface BuildAuthProfileStoreOptions {
  agentId?: string;
  /** Defaults to true. Disable in tests to start from a blank store. */
  loadFromDisk?: boolean;
  /**
   * Defaults to true. Disable to skip CLI/keychain reads (e.g. when you
   * just want to know what's available from env without paying for the
   * filesystem stats).
   */
  includeCli?: boolean;
  /** Inject env for tests. */
  env?: Record<string, string | undefined>;
  /** Inject CLI detection result for tests. */
  cliResult?: DetectedCliCredentials;
}

/**
 * Build a fully populated AuthProfileStore by merging:
 *
 *   1. Persisted store (loaded from disk unless `loadFromDisk: false`)
 *   2. CLI-detected OAuth profiles (per-provider, idempotent ids)
 *   3. Env-key profiles (priority chain — see `env-keys.ts`)
 *
 * Later sources upsert over earlier ones — so an env override of a CLI
 * profile would replace its secret. CLI profiles are listed BEFORE env
 * profiles so that, in the ordering pass, oauth wins over api_key per
 * the round-robin rules.
 */
export async function buildAuthProfileStore(
  options: BuildAuthProfileStoreOptions = {},
): Promise<AuthProfileStore> {
  const agentId = options.agentId ?? "default";

  const persisted: AuthProfileStore =
    options.loadFromDisk === false
      ? { profiles: [], usageStats: {}, order: {} }
      : await loadAuthProfileStore(agentId);

  let store: AuthProfileStore = persisted;

  if (options.includeCli !== false) {
    const cli = options.cliResult ?? (await detectCliCredentials());
    store = applyCliCredentialsToStore(store, cli);
  }

  store = applyEnvKeysToStore(store, options.env);

  return store;
}

export interface ProviderAvailability {
  provider: RoutingProviderId;
  /** Profiles currently in the store for this provider. */
  profiles: AuthProfile[];
  /** True if at least one OAuth/CLI-sourced profile exists. */
  hasCli: boolean;
  /** True if at least one env-sourced profile exists. */
  hasEnv: boolean;
}

/**
 * Snapshot per-provider availability based on a built store. Used by the
 * setup CLI ("you have Claude + OpenRouter; pick one") and by the router
 * to skip providers with no usable profile.
 */
export function listAvailableProviders(store: AuthProfileStore): ProviderAvailability[] {
  const buckets = new Map<RoutingProviderId, ProviderAvailability>();
  for (const provider of ALL_PROVIDERS) {
    buckets.set(provider, {
      provider,
      profiles: [],
      hasCli: false,
      hasEnv: false,
    });
  }
  for (const profile of store.profiles) {
    const bucket = buckets.get(profile.provider);
    if (!bucket) continue;
    bucket.profiles.push(profile);
    if (profile.source === "cli-file") bucket.hasCli = true;
    if (profile.source === "env" || profile.source === "live") bucket.hasEnv = true;
  }
  return Array.from(buckets.values()).filter((b) => b.profiles.length > 0);
}
