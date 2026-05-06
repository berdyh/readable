/**
 * Detect installed CLI subscriptions by reading their auth files.
 *
 * The patterns mirror OpenClaw `agents/cli-credentials.ts` minus the
 * macOS-keychain code path (Readable's deployment surface is Linux/Node;
 * a desktop wrapper can layer the keychain reader on top later).
 *
 * Cheap to call repeatedly: results are cached by (path, mtime). If the
 * file hasn't been touched since the last read, we return the cached
 * value. mtime resolution is millisecond-level, which is sufficient
 * because token-rotation writes always change the mtime.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RoutingProviderId } from './types';

export interface CliCredential {
  provider: RoutingProviderId;
  /** Display label for the source — `claude-cli`, `codex-cli`, etc. */
  source:
    | 'claude-cli'
    | 'codex-cli'
    | 'gemini-cli'
    | 'gcloud-adc';
  /** Access / bearer token to send to the provider. */
  accessToken: string;
  /** Refresh token if available — kept so we can re-issue access. */
  refreshToken?: string;
  /** ms-since-epoch token expiry (if known). */
  expiresAt?: number;
  /** OAuth account email / username, if exposed in the file. */
  accountId?: string;
  /** Path the credential was read from (debug/UX only). */
  sourcePath: string;
}

interface CacheEntry<T> {
  mtimeMs: number;
  value: T | null;
}

const cache = new Map<string, CacheEntry<CliCredential>>();

function homedir(): string {
  return os.homedir();
}

async function statMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readWithCache<T extends CliCredential>(
  filePath: string,
  parse: () => Promise<T | null>,
): Promise<T | null> {
  const mtimeMs = await statMtime(filePath);
  if (mtimeMs === null) {
    cache.set(filePath, { mtimeMs: 0, value: null });
    return null;
  }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value as T | null;
  }
  const fresh = await parse();
  cache.set(filePath, { mtimeMs, value: fresh });
  return fresh;
}

// ---------- Codex CLI ----------

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
    expires_at?: string | number;
  };
}

export async function readCodexCliCredentials(): Promise<CliCredential | null> {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
  const filePath = path.join(codexHome, 'auth.json');
  return readWithCache<CliCredential>(filePath, async () => {
    const data = await readJson<CodexAuthFile>(filePath);
    const access = data?.tokens?.access_token;
    if (!access) return null;
    const expiresAt = (() => {
      const raw = data?.tokens?.expires_at;
      if (typeof raw === 'number') return raw * 1000;
      if (typeof raw === 'string') {
        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) return numeric * 1000;
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return undefined;
    })();
    return {
      provider: 'openai-codex',
      source: 'codex-cli',
      accessToken: access,
      refreshToken: data?.tokens?.refresh_token,
      expiresAt,
      accountId: data?.tokens?.account_id,
      sourcePath: filePath,
    };
  });
}

// ---------- Claude CLI ----------

interface ClaudeAuthFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
  };
}

export async function readClaudeCliCredentials(): Promise<CliCredential | null> {
  const filePath = path.join(homedir(), '.claude', '.credentials.json');
  return readWithCache<CliCredential>(filePath, async () => {
    const data = await readJson<ClaudeAuthFile>(filePath);
    const access = data?.claudeAiOauth?.accessToken;
    if (!access) return null;
    return {
      provider: 'anthropic',
      source: 'claude-cli',
      accessToken: access,
      refreshToken: data?.claudeAiOauth?.refreshToken,
      expiresAt: data?.claudeAiOauth?.expiresAt,
      sourcePath: filePath,
    };
  });
}

// ---------- Gemini CLI ----------

interface GeminiAuthFile {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  // Some Gemini CLI builds nest under `credentials`.
  credentials?: GeminiAuthFile;
}

export async function readGeminiCliCredentials(): Promise<CliCredential | null> {
  const filePath = path.join(homedir(), '.gemini', 'oauth_creds.json');
  return readWithCache<CliCredential>(filePath, async () => {
    const data = await readJson<GeminiAuthFile>(filePath);
    const block = data?.credentials ?? data;
    const access = block?.access_token;
    if (!access) return null;
    return {
      provider: 'gemini',
      source: 'gemini-cli',
      accessToken: access,
      refreshToken: block?.refresh_token,
      expiresAt: block?.expiry_date,
      sourcePath: filePath,
    };
  });
}

// ---------- gcloud ADC ----------

interface AdcCredential {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  account?: string;
}

export async function readGoogleAdcCredentials(): Promise<CliCredential | null> {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const filePath =
    (explicit && explicit.length > 0
      ? explicit
      : path.join(homedir(), '.config', 'gcloud', 'application_default_credentials.json'));

  return readWithCache<CliCredential>(filePath, async () => {
    const data = await readJson<AdcCredential>(filePath);
    if (!data) return null;
    if (data.type !== 'authorized_user') {
      // Service-account creds are out of scope for the personal-subscription
      // routing layer; the caller should configure that via env keys instead.
      return null;
    }
    if (!data.refresh_token) return null;
    return {
      provider: 'google-vertex',
      source: 'gcloud-adc',
      // ADC requires us to mint an access token via the refresh flow before
      // we can call any Google API. The fallback layer treats `accessToken`
      // here as a refresh-only credential and fetches an access token at
      // request time.
      accessToken: '',
      refreshToken: data.refresh_token,
      accountId: data.account,
      sourcePath: filePath,
    };
  });
}

// ---------- Aggregate ----------

export interface DetectedCliCredentials {
  codex: CliCredential | null;
  claude: CliCredential | null;
  gemini: CliCredential | null;
  gcloud: CliCredential | null;
}

/**
 * Read all known CLI credential files in parallel. Each entry is
 * independently nullable — a user might have just Claude installed.
 */
export async function detectCliCredentials(): Promise<DetectedCliCredentials> {
  const [codex, claude, gemini, gcloud] = await Promise.all([
    readCodexCliCredentials(),
    readClaudeCliCredentials(),
    readGeminiCliCredentials(),
    readGoogleAdcCredentials(),
  ]);
  return { codex, claude, gemini, gcloud };
}

/** Forget cached credentials — useful from the setup CLI. */
export function resetCliCredentialCache(): void {
  cache.clear();
}

/**
 * Per-provider one-line install hint shown by the setup CLI when a user
 * picks a subscription whose CLI is not installed. Keep these terse and
 * include URLs the user can copy-paste verbatim.
 */
export function getInstallHint(provider: RoutingProviderId): string | undefined {
  switch (provider) {
    case 'anthropic':
      return 'Install Claude Code: `npm i -g @anthropic-ai/claude-code` then run `claude login`.';
    case 'openai-codex':
      return 'Install Codex CLI: `npm i -g @openai/codex` then run `codex login`.';
    case 'gemini':
      return 'Install Gemini CLI: see https://github.com/google-gemini/gemini-cli — then run `gemini auth login`.';
    case 'google-vertex':
      return 'Install gcloud SDK: https://cloud.google.com/sdk/docs/install — then `gcloud auth application-default login`.';
    case 'openai':
      return 'Set OPENAI_API_KEY in .env.local (https://platform.openai.com/api-keys).';
    case 'openrouter':
      return 'Set OPENROUTER_API_KEY in .env.local (https://openrouter.ai/keys). Free tier available.';
    default:
      return undefined;
  }
}
