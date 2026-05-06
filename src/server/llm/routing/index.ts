/**
 * Public facade for the OpenClaw-inspired routing layer.
 *
 * Pattern adapted from OpenClaw (MIT, © 2025 Peter Steinberger):
 * https://github.com/openclaw/openclaw
 */

export type {
  AuthProfile,
  AuthProfileStore,
  AuthProfileType,
  FailoverErrorInit,
  FailoverReason,
  FallbackAttempt,
  ModelCandidate,
  ModelRef,
  ParsedModelRef,
  ProfileUsageStats,
  RoutingProviderId,
  UsageStats,
} from './types';

export {
  collectProviderApiKeys,
  collectProviderKeyStrings,
  hasAnyProviderKey,
  type ResolvedProviderKey,
  type CollectKeysOptions,
} from './env-keys';

export {
  classifyFailoverSignal,
  classifyHttpStatus,
  classifyMessage,
  shouldAdvanceFallback,
  shouldAllowCooldownProbeForReason,
} from './failover-classifier';

export {
  FailoverError,
  coerceToFailoverError,
  reasonFromError,
  type CoerceContext,
} from './failover-error';

export {
  applyCooldown,
  clearProfileCooldown,
  getSoonestCooldownExpiry,
  getStorePaths,
  isProfileInCooldown,
  listProfilesForProvider,
  loadAuthProfileStore,
  recordProfileSuccess,
  removeAuthProfileFromStore,
  saveAuthProfileStore,
  saveAuthProfilesOnly,
  saveUsageStatsOnly,
  upsertAuthProfileInStore,
  type StorePathSet,
} from './auth-profile-store';

export {
  promoteAuthProfileInOrder,
  resolveAuthProfileOrder,
} from './auth-profile-order';

export {
  detectCliCredentials,
  getInstallHint,
  readClaudeCliCredentials,
  readCodexCliCredentials,
  readGeminiCliCredentials,
  readGoogleAdcCredentials,
  resetCliCredentialCache,
  type CliCredential,
  type DetectedCliCredentials,
} from './cli-detect';

export {
  buildAuthProfileStore,
  listAvailableProviders,
  type BuildAuthProfileStoreOptions,
  type ProviderAvailability,
} from './external-cli-sync';

export {
  FallbackSummaryError,
  parseModelRef,
  resetProbeStateForTests,
  runWithModelFallback,
  type RunFn,
  type RunFnContext,
  type RunWithFallbackOptions,
  type RunWithFallbackResult,
} from './fallback';
