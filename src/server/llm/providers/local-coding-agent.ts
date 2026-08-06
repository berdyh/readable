import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { LlmConfig, LlmProvider, LlmProviderInterface, LlmRequest } from "../types";
import {
  classifyMessage,
  FailoverError,
  hasPermanentAuthHint,
  getInstallHint,
  readClaudeCliCredentials,
  readCodexCliCredentials,
  resolveClaudeCredentialsPath,
  resolveCodexAuthFilePath,
  runWithModelFallback,
  type AuthProfile,
  type AuthProfileStore,
  type FailoverReason,
  type ModelRef,
} from "../routing";

export type CodingAgentId = "claude-code" | "codex-cli" | "gemini-cli" | "antigravity" | "opencode";

type AgentMode = "json" | "text";

interface CommandResolution {
  command: string;
  source: "env" | "path" | "cache";
}

export interface LocalCodingAgentCommand {
  agent: CodingAgentId;
  command: string;
  source: CommandResolution["source"];
}

interface InvocationSpec {
  command: string;
  args: string[];
  cwd: string;
  agent: CodingAgentId;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  outputFile?: string;
  cleanupDir?: string;
  /** Write a mid-call token refresh back to the real credential file. */
  persistCredentials?: () => Promise<void>;
}

/**
 * Codex and Claude Code are both first-class. Order is preference, not
 * exclusivity — a missing or signed-out agent is skipped by
 * `listAvailableLocalCodingAgents` before it ever costs a spawn.
 */
const DEFAULT_AGENT_ORDER: CodingAgentId[] = ["codex-cli", "claude-code"];

const AGENT_DISPLAY_NAMES: Record<CodingAgentId, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex",
  "gemini-cli": "Gemini CLI",
  antigravity: "Antigravity",
  opencode: "opencode",
};
const SAFE_BUILT_IN_AGENTS = new Set<CodingAgentId>(["codex-cli", "claude-code"]);
const UNSAFE_AGENT_OPT_IN_FLAG = "LLM_LOCAL_AGENT_ALLOW_UNSAFE";
const CUSTOM_INVOCATION_ONLY_AGENTS = new Set<CodingAgentId>(["antigravity"]);

const AGENT_ENV_KEYS: Record<CodingAgentId, string> = {
  "claude-code": "CLAUDE_CODE",
  "codex-cli": "CODEX",
  "gemini-cli": "GEMINI",
  antigravity: "ANTIGRAVITY",
  opencode: "OPENCODE",
};

const AGENT_BIN_NAMES: Record<CodingAgentId, string | undefined> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  antigravity: undefined,
  opencode: "opencode",
};

const AGENT_ALIASES: Record<string, CodingAgentId> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  claude_code: "claude-code",
  codex: "codex-cli",
  "codex-cli": "codex-cli",
  codex_cli: "codex-cli",
  gemini: "gemini-cli",
  "gemini-cli": "gemini-cli",
  gemini_cli: "gemini-cli",
  antigravity: "antigravity",
  opencode: "opencode",
};

const DEFAULT_TIMEOUT_MS = 180_000;

const DEFAULT_AGENT_ENV_ALLOWLIST = ["PATH", "SHELL", "TERM", "USER", "LOGNAME", "LANG", "LC_ALL"];

const PROTECTED_AGENT_ENV_KEYS = new Set([
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "CODEX_AUTH_FILE",
  "CLAUDE_CONFIG_DIR",
  "GEMINI_CONFIG_DIR",
  "OPENCODE_CONFIG_DIR",
]);

function normalizeAgentId(value: string): CodingAgentId | undefined {
  return AGENT_ALIASES[value.trim().toLowerCase()];
}

/**
 * Validate a client-supplied agent pin down to the safe built-in ids.
 *
 * Route handlers share this instead of keeping their own allowlists: the value
 * ends up selecting a binary to spawn, so it is allowlisted rather than passed
 * through — and one allowlist that every route uses cannot drift out of sync
 * with the agents the provider actually considers safe.
 */
export function parseLocalAgentPin(value: unknown): CodingAgentId | undefined {
  if (typeof value !== "string") return undefined;
  const agent = normalizeAgentId(value);
  return agent && SAFE_BUILT_IN_AGENTS.has(agent) ? agent : undefined;
}

function splitAgentList(value: string | undefined): CodingAgentId[] {
  const raw = value?.trim();
  if (!raw) {
    return DEFAULT_AGENT_ORDER;
  }
  const seen = new Set<CodingAgentId>();
  const result: CodingAgentId[] = [];
  for (const entry of raw.split(/[\s,;/]+/)) {
    const agent = normalizeAgentId(entry);
    if (!agent || seen.has(agent)) continue;
    seen.add(agent);
    result.push(agent);
  }
  return result.length > 0 ? result : DEFAULT_AGENT_ORDER;
}

function getConfiguredAgentOrder(): CodingAgentId[] {
  return splitAgentList(process.env.LLM_LOCAL_AGENTS ?? process.env.LLM_ALLOWED_AGENTS);
}

function findOnPath(command: string): string | undefined {
  if (path.isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return undefined;
    }
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  return undefined;
}

function isLikelyNpxWrapper(command: string): boolean {
  // Read only the head of the file. `readFileSync().slice(4096)` loaded the
  // whole binary first, and the resolved `claude` command is a >100MB native
  // executable — that one line cost ~1.5s of blocked event loop on every
  // agent-status call.
  try {
    const fd = openSync(command, "r");
    try {
      const head = Buffer.alloc(4096);
      const bytesRead = readSync(fd, head, 0, head.length, 0);
      const content = head.toString("utf8", 0, bytesRead);
      return content.includes("npx") && content.includes("--prefer-online");
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function newestExisting(paths: string[]): string | undefined {
  const existing = paths
    .filter((item) => {
      try {
        accessSync(item, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })
    .map((item) => ({ item, mtimeMs: statSync(item).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return existing[0]?.item;
}

function newestNpxPackageBin(packageDirName: string, relativeBinPath: string): string | undefined {
  const root = path.join(os.homedir(), ".npm", "_npx");
  if (!existsSync(root)) {
    return undefined;
  }

  const candidates: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    candidates.push(path.join(root, dir.name, "node_modules", packageDirName, relativeBinPath));
  }
  return newestExisting(candidates);
}

function cachedCommandForAgent(agent: CodingAgentId): string | undefined {
  switch (agent) {
    case "codex-cli":
      return newestNpxPackageBin(".bin", "codex");
    case "opencode":
      return (
        newestNpxPackageBin("opencode-linux-x64", "bin/opencode") ??
        newestNpxPackageBin("opencode-linux-x64-baseline", "bin/opencode") ??
        newestNpxPackageBin("opencode-linux-x64-musl", "bin/opencode") ??
        newestNpxPackageBin("opencode-linux-x64-baseline-musl", "bin/opencode")
      );
    case "gemini-cli":
      return (
        newestNpxPackageBin(".bin", "gemini") ??
        newestNpxPackageBin("@google/gemini-cli", "dist/index.js")
      );
    default:
      return undefined;
  }
}

function resolveAgentCommand(agent: CodingAgentId): CommandResolution | undefined {
  const envKey = AGENT_ENV_KEYS[agent];
  const configured = process.env[`LLM_AGENT_${envKey}_COMMAND`]?.trim();
  if (configured) {
    const resolved = findOnPath(configured);
    return resolved ? { command: resolved, source: "env" } : undefined;
  }

  const cached = cachedCommandForAgent(agent);
  if (cached) {
    return { command: cached, source: "cache" };
  }

  const binaryName = AGENT_BIN_NAMES[agent];
  if (!binaryName) {
    return undefined;
  }
  const resolved = findOnPath(binaryName);
  if (resolved && isLikelyNpxWrapper(resolved)) {
    return undefined;
  }
  return resolved ? { command: resolved, source: "path" } : undefined;
}

export function listAvailableLocalCodingAgents(
  agentOrder = getConfiguredAgentOrder(),
): LocalCodingAgentCommand[] {
  const available: LocalCodingAgentCommand[] = [];
  for (const agent of agentOrder) {
    if (!canUseLocalAgent(agent)) continue;
    const resolution = resolveAgentCommand(agent);
    if (!resolution) continue;
    available.push({
      agent,
      command: resolution.command,
      source: resolution.source,
    });
  }
  return available;
}

/**
 * Env markers set by the serverless platforms this app can be deployed to.
 * Spawning a CLI there is not "unconfigured", it is impossible — there is no
 * persistent filesystem to install one on and no `~/.codex` to authenticate
 * from.
 */
const SERVERLESS_ENV_MARKERS = [
  "VERCEL",
  "NETLIFY",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "K_SERVICE",
  "FUNCTIONS_WORKER_RUNTIME",
];

/**
 * Can this process spawn local CLI agents at all?
 *
 * Deliberately a denylist rather than an allowlist of "is this localhost":
 * a self-hosted container is a perfectly good place to run Codex, and
 * `describeLocalCodingAgents` will honestly report "not installed" there if it
 * is not. Only the platforms where the answer is structurally no are excluded.
 */
export function isLocalAgentRuntime(): boolean {
  return !SERVERLESS_ENV_MARKERS.some((marker) => Boolean(process.env[marker]?.trim()));
}

/** Why an agent cannot be selected. `null` means it can. */
export type LocalAgentUnavailableReason = "not_installed" | "not_authenticated" | "not_enabled";

export interface LocalCodingAgentStatus {
  agent: CodingAgentId;
  displayName: string;
  /** The binary resolved on PATH, in the npx cache, or via LLM_AGENT_*_COMMAND. */
  installed: boolean;
  /** The CLI reports itself signed in (probe-first, credential-file fallback). */
  authenticated: boolean;
  /** The model this agent would run with, or "default" to let the CLI decide. */
  model: string;
  unavailableReason: LocalAgentUnavailableReason | null;
  /** One-line remedy, when there is one. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Auth probing
// ---------------------------------------------------------------------------

/**
 * The CLI's own "am I signed in" subcommand, per agent. Verified against
 * codex-cli 0.145.0 (`codex login status`: exit 0 / "Not logged in" + exit 1)
 * and claude 2.1.220 (`claude auth status`: JSON with a `loggedIn` boolean).
 */
const AGENT_AUTH_PROBE_ARGS: Partial<Record<CodingAgentId, string[]>> = {
  "codex-cli": ["login", "status"],
  "claude-code": ["auth", "status"],
};

const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 15_000;
/** A signed-in verdict only goes stale if the credential rotates underneath us. */
const AUTH_PROBE_SIGNED_IN_TTL_MS = 10 * 60_000;
/**
 * A signed-out verdict expires fast: signing in mid-session usually touches
 * the credential file (which invalidates by mtime), but not always — macOS
 * Keychain logins leave no file to watch.
 */
const AUTH_PROBE_SIGNED_OUT_TTL_MS = 30_000;

/** `"indeterminate"` = the probe could not run or its output fit no known shape. */
type AuthProbeVerdict = boolean | "indeterminate";

interface AuthProbeCacheEntry {
  value: boolean;
  credentialMtimeMs: number | null;
  expiresAt: number;
}

const authProbeCache = new Map<string, AuthProbeCacheEntry>();
const pendingAuthProbes = new Map<string, Promise<AuthProbeVerdict>>();

/** Forget cached probe verdicts — for tests and the setup CLI. */
export function resetLocalAgentAuthProbeCache(): void {
  authProbeCache.clear();
  pendingAuthProbes.clear();
}

async function credentialFileMtime(agent: CodingAgentId): Promise<number | null> {
  const filePath = resolveAgentAuthFile(agent);
  if (!filePath) return null;
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

interface AuthProbeProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Unlike `runProcess`, a non-zero exit here is an answer, not an error —
 * "Not logged in" comes back as exit 1 — so all three streams are returned
 * for interpretation instead of being folded into a thrown message.
 */
function runAuthProbeProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<AuthProbeProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`auth probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function interpretAuthProbe(
  agent: CodingAgentId,
  result: AuthProbeProcessResult,
): AuthProbeVerdict {
  if (agent === "claude-code") {
    // `claude auth status` prints JSON with a boolean `loggedIn` when the
    // subcommand exists. That is the CLI's own answer — it wins over the exit
    // code (and over whatever the credential file looks like).
    try {
      const json = extractBalancedJson(result.stdout);
      if (json) {
        const parsed = JSON.parse(json) as { loggedIn?: unknown };
        if (typeof parsed.loggedIn === "boolean") {
          return parsed.loggedIn;
        }
      }
    } catch {
      // Not JSON — fall through to the generic interpretation.
    }
  }

  if (/not logged in/i.test(`${result.stdout}\n${result.stderr}`)) {
    return false;
  }
  if (result.exitCode === 0) {
    return true;
  }
  // Non-zero exit without a recognisable signed-out message: most likely an
  // older/newer CLI that does not know the subcommand. Not a verdict.
  return "indeterminate";
}

/**
 * Ask the CLI itself whether it is signed in.
 *
 * The probe runs in the same sandbox a real invocation gets (staged
 * credential, redirected HOME), so the verdict is by construction "would a
 * real call authenticate" — including on macOS, where Claude Code may hold
 * its credential in the Keychain and no file exists to shape-check.
 */
async function probeAgentAuthStatus(
  agent: CodingAgentId,
  command: string,
): Promise<AuthProbeVerdict> {
  const probeArgs = AGENT_AUTH_PROBE_ARGS[agent];
  if (!probeArgs) return "indeterminate";
  const timeoutMs = Number(
    process.env.LLM_LOCAL_AGENT_PROBE_TIMEOUT_MS ?? DEFAULT_AUTH_PROBE_TIMEOUT_MS,
  );
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-agent-probe-"));
  try {
    await prepareInvocationDirs(tempDir);
    const credentials = await stageAgentCredentials(agent, tempDir);
    const env = { ...buildLocalAgentEnv(tempDir), ...credentials.env };
    const result = await runAuthProbeProcess(command, probeArgs, tempDir, env, timeoutMs);
    return interpretAuthProbe(agent, result);
  } catch {
    return "indeterminate";
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function probeAgentAuthStatusCached(
  agent: CodingAgentId,
  command: string,
): Promise<AuthProbeVerdict> {
  const key = `${agent}:${command}`;
  const credentialMtimeMs = await credentialFileMtime(agent);
  const cached = authProbeCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.credentialMtimeMs === credentialMtimeMs) {
    return cached.value;
  }

  let pending = pendingAuthProbes.get(key);
  if (!pending) {
    pending = probeAgentAuthStatus(agent, command).finally(() => pendingAuthProbes.delete(key));
    pendingAuthProbes.set(key, pending);
  }
  const verdict = await pending;
  if (verdict !== "indeterminate") {
    authProbeCache.set(key, {
      value: verdict,
      credentialMtimeMs,
      expiresAt:
        Date.now() + (verdict ? AUTH_PROBE_SIGNED_IN_TTL_MS : AUTH_PROBE_SIGNED_OUT_TTL_MS),
    });
  }
  return verdict;
}

/**
 * Is this agent signed in?
 *
 * Probe-first: the CLI's own status subcommand is the authority, because only
 * the CLI tracks its own credential formats. Shape-checking the credential
 * file — the previous implementation — is kept solely as the fallback for
 * when the probe is indeterminate (a CLI too old or too new to know the
 * subcommand, a spawn failure, a timeout). That fallback reuses `cli-detect`'s
 * parsers, which mtime-cache their reads.
 */
async function isAgentAuthenticated(agent: CodingAgentId, command: string): Promise<boolean> {
  switch (agent) {
    case "codex-cli":
    case "claude-code": {
      const probed = await probeAgentAuthStatusCached(agent, command);
      if (probed !== "indeterminate") {
        return probed;
      }
      const explicit = getAgentEnvValue(agent, "AUTH_FILE");
      return agent === "codex-cli"
        ? (await readCodexCliCredentials(explicit).catch(() => null)) !== null
        : (await readClaudeCliCredentials(explicit).catch(() => null)) !== null;
    }
    default:
      // Opt-in agents manage their own credentials; we cannot verify them, so
      // we do not claim they are broken either.
      return true;
  }
}

/**
 * Per-agent installed/authenticated report for the chat window's picker.
 *
 * Deliberately reports *every* agent in the configured order, including the
 * unusable ones — the UI needs the negative cases to grey them out with a
 * reason. Vibe Kanban computes the same information and then drops it on the
 * floor (its `checkAgentAvailability` endpoint has no caller and its pickers
 * list every agent as selectable); the whole point of returning it here is
 * that the picker consumes it.
 */
export async function describeLocalCodingAgents(
  agentOrder = getConfiguredAgentOrder(),
): Promise<LocalCodingAgentStatus[]> {
  return Promise.all(
    agentOrder.map(async (agent): Promise<LocalCodingAgentStatus> => {
      const displayName = AGENT_DISPLAY_NAMES[agent];
      const model = getAgentModelName(agent);
      const enabled = canUseLocalAgent(agent);
      const resolution = enabled ? resolveAgentCommand(agent) : undefined;
      const installed = resolution !== undefined;
      const authenticated = installed && (await isAgentAuthenticated(agent, resolution.command));

      const unavailableReason: LocalAgentUnavailableReason | null = !enabled
        ? "not_enabled"
        : !installed
          ? "not_installed"
          : !authenticated
            ? "not_authenticated"
            : null;

      return {
        agent,
        displayName,
        installed,
        authenticated,
        model,
        unavailableReason,
        hint: unavailableReason ? getInstallHint(agent) : undefined,
      };
    }),
  );
}

function buildAgentStore(agentOrder = getConfiguredAgentOrder()): AuthProfileStore {
  const profiles: AuthProfile[] = [];
  const order: AuthProfileStore["order"] = {};

  for (const { agent, command, source } of listAvailableLocalCodingAgents(agentOrder)) {
    const profileId = `${agent}:local`;
    profiles.push({
      id: profileId,
      provider: agent,
      type: "token",
      secret: command,
      label: `${agent} (${source})`,
      source: "manual",
      ephemeral: true,
    });
    order[agent] = [profileId];
  }

  return {
    profiles,
    order,
    usageStats: {},
  };
}

function getAgentEnvValue(agent: CodingAgentId, suffix: string): string | undefined {
  const key = AGENT_ENV_KEYS[agent];
  const value = process.env[`LLM_AGENT_${key}_${suffix}`]?.trim();
  return value || undefined;
}

function hasArgsOverride(agent: CodingAgentId): boolean {
  return Boolean(getAgentEnvValue(agent, "ARGS_JSON"));
}

function isTruthyEnv(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

function allowsUnsafeAgent(agent: CodingAgentId): boolean {
  const key = AGENT_ENV_KEYS[agent];
  return (
    isTruthyEnv(process.env[UNSAFE_AGENT_OPT_IN_FLAG]) ||
    isTruthyEnv(process.env[`LLM_AGENT_${key}_ALLOW_UNSAFE`])
  );
}

function canUseLocalAgent(agent: CodingAgentId): boolean {
  if (SAFE_BUILT_IN_AGENTS.has(agent)) {
    return true;
  }
  if (hasArgsOverride(agent)) {
    return true;
  }
  if (CUSTOM_INVOCATION_ONLY_AGENTS.has(agent)) {
    return false;
  }
  return allowsUnsafeAgent(agent);
}

function splitEnvAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,;/]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function copyAllowedEnv(env: NodeJS.ProcessEnv, keys: string[], protectSandboxKeys: boolean): void {
  for (const key of keys) {
    if (protectSandboxKeys && PROTECTED_AGENT_ENV_KEYS.has(key)) {
      continue;
    }
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
}

function buildLocalAgentEnv(tempDir: string): NodeJS.ProcessEnv {
  const homeDir = path.join(tempDir, "home");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    NO_COLOR: "1",
    HOME: homeDir,
    TMPDIR: tempDir,
    XDG_CONFIG_HOME: path.join(tempDir, "xdg-config"),
    XDG_CACHE_HOME: path.join(tempDir, "xdg-cache"),
    XDG_DATA_HOME: path.join(tempDir, "xdg-data"),
  };

  copyAllowedEnv(env, DEFAULT_AGENT_ENV_ALLOWLIST, false);
  copyAllowedEnv(env, splitEnvAllowlist(process.env.LLM_LOCAL_AGENT_ENV_ALLOWLIST), true);

  return env;
}

// ---------------------------------------------------------------------------
// Credential staging
// ---------------------------------------------------------------------------

/**
 * The sandbox redirects `HOME` so the agent cannot read the developer's dot
 * files, and strips the app's own environment so it cannot read `DATABASE_URL`
 * or any `*_API_KEY`. Both of those are still true. What it *also* did — and
 * what made `LLM_PROVIDER=coding-agent` fail every call — was cut the agent
 * off from its own subscription credential, which lives under the real `HOME`.
 *
 * The fix is not to un-isolate `HOME`. It is to copy the one file the agent
 * needs into the throwaway sandbox and point the agent's own config-dir env
 * var at the copy. The staged file is `0600`, lives inside the per-invocation
 * temp dir, and is deleted with it in `invokeLocalAgent`'s `finally`.
 *
 * The alternative — exporting `CODEX_HOME=$HOME/.codex` — also works (proved
 * it), but hands the agent the developer's entire Codex home: `config.toml`,
 * MCP server definitions, session transcripts, skills and plugins. Staging a
 * lone `auth.json` gives it strictly less.
 *
 * A refresh the agent performs mid-call lands in the staged copy, which used
 * to be deleted with the temp dir — correct but wasteful (one refresh
 * round-trip per request once the access token expired), and a real problem
 * the day upstream rotates refresh tokens on use. Each stager therefore
 * returns a `persistRefresh` closure that copies a changed staged credential
 * back to the real file after the invocation, guarded so it never overwrites
 * a file that changed underneath it. Codex copies the file verbatim (it is
 * the CLI's own format either way); Claude Code merges only the
 * `claudeAiOauth` block back, so the `mcpOAuth` tokens that never entered the
 * sandbox cannot be dropped by the write.
 */
interface StagedCredentials {
  env: Record<string, string>;
  staged: boolean;
  /**
   * Copy a token refresh the agent wrote inside the sandbox back to the real
   * credential file. Best-effort: it must never fail the request, and it
   * refuses to write when the real file changed mid-call (a concurrent
   * `codex login`, another invocation's write-back) — a lost refresh only
   * costs one extra refresh round-trip, a clobbered login costs the user a
   * re-auth.
   */
  persistRefresh?: () => Promise<void>;
}

const NO_CREDENTIALS: StagedCredentials = { env: {}, staged: false };

/**
 * Replace a credential file atomically (write-then-rename) so a crash
 * mid-write can never leave the user's real auth file half-written.
 */
async function replacePrivateFile(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, filePath);
}

function resolveAgentAuthFile(agent: CodingAgentId): string | undefined {
  const explicit = getAgentEnvValue(agent, "AUTH_FILE");
  if (explicit) return explicit;

  switch (agent) {
    case "codex-cli":
      return resolveCodexAuthFilePath();
    case "claude-code":
      return resolveClaudeCredentialsPath();
    default:
      return undefined;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 });
}

/**
 * The write-back copies sandbox-written bytes over the user's real
 * credential file, so before writing we insist the staged content still
 * has the shape of the credential it is meant to be. A crashed agent,
 * a truncated write, or a hostile process inside the sandbox must not
 * be able to replace the user's auth file with arbitrary content.
 */
function isValidCodexAuthPayload(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { tokens?: { access_token?: unknown } };
    return (
      typeof parsed?.tokens?.access_token === "string" && parsed.tokens.access_token.length > 0
    );
  } catch {
    return false;
  }
}

/** Same shape check for Claude Code's `claudeAiOauth` block. */
function isValidClaudeOauthPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const accessToken = (value as { accessToken?: unknown }).accessToken;
  return typeof accessToken === "string" && accessToken.length > 0;
}

/**
 * Codex reads `$CODEX_HOME/auth.json` and nothing else — there is no
 * `CODEX_AUTH_FILE`, which is why the old hook of that name was inert.
 * Everything in `auth.json` (`auth_mode`, `tokens`, `last_refresh`) is the
 * credential itself, so it is copied verbatim; the rest of `~/.codex` is not.
 *
 * Two Codex behaviours this has to respect: `CODEX_HOME` pointing at a
 * directory that does not exist is a hard error rather than an implicit
 * mkdir, so the file is written (creating the dir) before the var is set; and
 * `OPENAI_API_KEY` does *not* authenticate the CLI, so there is no env-var
 * shortcut that would let us skip staging a file.
 */
async function stageCodexCredentials(tempDir: string): Promise<StagedCredentials> {
  const source = resolveAgentAuthFile("codex-cli");
  if (!source) return NO_CREDENTIALS;
  const raw = await readFile(source, "utf8").catch(() => undefined);
  if (!raw) return NO_CREDENTIALS;

  const codexHome = path.join(tempDir, "codex-home");
  const stagedPath = path.join(codexHome, "auth.json");
  await writePrivateFile(stagedPath, raw);
  return {
    env: { CODEX_HOME: codexHome },
    staged: true,
    persistRefresh: async () => {
      const refreshed = await readFile(stagedPath, "utf8").catch(() => undefined);
      if (!refreshed || refreshed === raw) return;
      if (!isValidCodexAuthPayload(refreshed)) return;
      const current = await readFile(source, "utf8").catch(() => undefined);
      if (current !== raw) return;
      await replacePrivateFile(source, refreshed);
    },
  };
}

/**
 * Claude Code reads `$CLAUDE_CONFIG_DIR/.credentials.json`.
 *
 * That file is *not* only Claude's own credential: alongside `claudeAiOauth`
 * it holds `mcpOAuth` access tokens for every MCP server the developer has
 * authorised (Vercel, GitLab, Neon, …). Copying it wholesale would hand a
 * headless agent a pile of unrelated third-party bearer tokens, so only the
 * `claudeAiOauth` object is carried across.
 */
async function stageClaudeCredentials(tempDir: string): Promise<StagedCredentials> {
  const source = resolveAgentAuthFile("claude-code");
  if (!source) return NO_CREDENTIALS;
  const parsed = await readJsonFile(source);
  const oauth = parsed?.claudeAiOauth;
  if (!oauth || typeof oauth !== "object") return NO_CREDENTIALS;

  const configDir = path.join(tempDir, "claude-home");
  const stagedPath = path.join(configDir, ".credentials.json");
  const originalOauth = JSON.stringify(oauth);
  await writePrivateFile(stagedPath, JSON.stringify({ claudeAiOauth: oauth }));
  return {
    env: { CLAUDE_CONFIG_DIR: configDir },
    staged: true,
    persistRefresh: async () => {
      const staged = await readJsonFile(stagedPath);
      const refreshed = staged?.claudeAiOauth;
      if (!isValidClaudeOauthPayload(refreshed)) return;
      if (JSON.stringify(refreshed) === originalOauth) return;
      // Merge into the *current* file, not the one read at staging time, so
      // keys that never entered the sandbox (mcpOAuth) survive — but only if
      // Claude's own block is still the one we staged from.
      const currentSource = await readJsonFile(source);
      if (!currentSource) return;
      if (JSON.stringify(currentSource.claudeAiOauth ?? null) !== originalOauth) return;
      await replacePrivateFile(
        source,
        JSON.stringify({ ...currentSource, claudeAiOauth: refreshed }),
      );
    },
  };
}

async function stageAgentCredentials(
  agent: CodingAgentId,
  tempDir: string,
): Promise<StagedCredentials> {
  let credentials: StagedCredentials;
  switch (agent) {
    case "codex-cli":
      credentials = await stageCodexCredentials(tempDir);
      break;
    case "claude-code":
      credentials = await stageClaudeCredentials(tempDir);
      break;
    default:
      // Agents behind the unsafe opt-in bring their own credentials via
      // LLM_LOCAL_AGENT_ENV_ALLOWLIST; we do not guess at their file layout.
      return NO_CREDENTIALS;
  }

  // With LLM_AGENT_*_ARGS_JSON the invocation is whatever the developer
  // typed, so the sandbox guarantees the write-back relies on no longer
  // hold — an arbitrary argv can point the agent's config-dir env var
  // anywhere or run something that is not the trusted CLI at all. Stage
  // credentials so the call works, but never write anything back.
  if (hasArgsOverride(agent) && credentials.persistRefresh) {
    return { ...credentials, persistRefresh: undefined };
  }

  return credentials;
}

/** Test-only access to the credential staging/write-back internals. */
export const _credentialStagingForTests = {
  stageCodexCredentials,
  stageClaudeCredentials,
  stageAgentCredentials,
};

function getAgentModelName(agent: CodingAgentId): string {
  return getAgentEnvValue(agent, "MODEL") ?? "default";
}

function buildModelRef(agent: CodingAgentId): ModelRef {
  const model = getAgentModelName(agent);
  return `${agent}/${model}` as ModelRef;
}

function buildClaudeModelArgs(agent: CodingAgentId): string[] {
  const model = getAgentModelName(agent);
  return model === "default" ? [] : ["--model", model];
}

function buildCodexConfigArgs(agent: CodingAgentId): string[] {
  const args: string[] = [];
  const model = getAgentModelName(agent);
  if (model !== "default") {
    args.push("--model", model);
  }

  const reasoningEffort = getAgentEnvValue(agent, "REASONING_EFFORT");
  if (reasoningEffort) {
    args.push("--config", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }

  return args;
}

function buildPrompt(request: LlmRequest, mode: AgentMode, taskName?: string): string {
  const schemaInstruction =
    mode === "json" && request.schema
      ? [
          "Return only valid JSON. Do not wrap it in Markdown.",
          "The JSON must satisfy this schema:",
          JSON.stringify(request.schema),
        ].join("\n")
      : "Return only the final answer. Do not modify files or run tools.";

  return [
    "You are answering inside the Readable local development server.",
    "Act as a pure LLM backend for the app, not as an interactive coding session.",
    "Do not edit files. Do not start long-running processes. Do not ask follow-up questions.",
    taskName ? `Task: ${taskName}` : undefined,
    "",
    "System prompt:",
    request.systemPrompt,
    "",
    "User prompt:",
    request.userPrompt,
    "",
    schemaInstruction,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

function parseArgsJson(
  agent: CodingAgentId,
  prompt: string,
  cwd: string,
  outputFile?: string,
): string[] | null {
  const key = AGENT_ENV_KEYS[agent];
  const raw = process.env[`LLM_AGENT_${key}_ARGS_JSON`]?.trim();
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`LLM_AGENT_${key}_ARGS_JSON must be a JSON string array.`);
  }
  return parsed.map((entry) =>
    entry
      .replaceAll("{prompt}", prompt)
      .replaceAll("{cwd}", cwd)
      .replaceAll("{output}", outputFile ?? ""),
  );
}

async function prepareInvocationDirs(tempDir: string): Promise<void> {
  await Promise.all(
    ["home", "xdg-config", "xdg-cache", "xdg-data"].map((dir) =>
      mkdir(path.join(tempDir, dir), { recursive: true }),
    ),
  );
}

async function buildInvocation(
  agent: CodingAgentId,
  command: string,
  prompt: string,
): Promise<InvocationSpec> {
  if (!canUseLocalAgent(agent)) {
    const key = AGENT_ENV_KEYS[agent];
    throw new Error(
      `${agent} is not enabled for local coding-agent mode. Set LLM_AGENT_${key}_ARGS_JSON or LLM_AGENT_${key}_ALLOW_UNSAFE=1 to opt in locally.`,
    );
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-agent-"));
  await prepareInvocationDirs(tempDir);
  const outputFile = path.join(tempDir, "response.txt");

  // Staged credentials are applied last so they win over
  // LLM_LOCAL_AGENT_ENV_ALLOWLIST, which is forbidden from setting the
  // sandbox keys directly.
  const credentials = await stageAgentCredentials(agent, tempDir);
  const env = { ...buildLocalAgentEnv(tempDir), ...credentials.env };

  const overrideArgs = parseArgsJson(agent, prompt, tempDir, outputFile);
  if (overrideArgs) {
    return {
      command,
      args: overrideArgs,
      cwd: tempDir,
      agent,
      env,
      stdin: prompt,
      outputFile,
      cleanupDir: tempDir,
      persistCredentials: credentials.persistRefresh,
    };
  }

  switch (agent) {
    case "claude-code":
      return {
        command,
        args: [
          "--print",
          "--output-format",
          "text",
          "--no-session-persistence",
          "--permission-mode",
          "default",
          "--disable-slash-commands",
          ...buildClaudeModelArgs(agent),
          // `--tools` is variadic, so the empty string that means "no tools"
          // must stay last — anything appended after it would be swallowed as
          // another tool name.
          "--tools",
          "",
        ],
        cwd: tempDir,
        agent,
        env,
        stdin: prompt,
        cleanupDir: tempDir,
        persistCredentials: credentials.persistRefresh,
      };
    case "codex-cli":
      return {
        command,
        args: [
          "exec",
          ...buildCodexConfigArgs(agent),
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          // No `--ask-for-approval`: `codex exec` has not accepted it since
          // the flag moved to the interactive command, and passing it aborts
          // with exit 2 before the model is ever contacted. Non-interactive
          // exec already reports `approval: never`.
          "--cd",
          tempDir,
          "--ephemeral",
          "--color",
          "never",
          "--output-last-message",
          outputFile,
          "-",
        ],
        cwd: tempDir,
        agent,
        env,
        stdin: prompt,
        outputFile,
        cleanupDir: tempDir,
        persistCredentials: credentials.persistRefresh,
      };
    case "gemini-cli":
      return {
        command,
        args: ["--prompt", prompt],
        cwd: tempDir,
        agent,
        env,
        outputFile,
        cleanupDir: tempDir,
      };
    case "opencode":
      return {
        command,
        args: ["run", "--no-summary", prompt],
        cwd: tempDir,
        agent,
        env,
        outputFile,
        cleanupDir: tempDir,
      };
    case "antigravity":
      throw new Error(
        "Antigravity has no built-in headless invocation. Set LLM_AGENT_ANTIGRAVITY_ARGS_JSON.",
      );
  }
}

/** How much of the agent's stderr to keep for the error message. */
const STDERR_TAIL_LIMIT = 2_000;

/**
 * A local agent invocation that did not produce output.
 *
 * The old code threw a bare `Error` whose message was
 * `Local coding agent exited with status N. <stderr>`. The status and the
 * stderr were both in there, but as prose — by the time the failover loop had
 * classified it and `FallbackSummaryError` had summarised it, all that survived
 * was `codex-cli/gpt-5.5 (unknown)`. Keeping the pieces as fields means the
 * reason is derived from the stderr rather than guessed from a sentence, and
 * the caller can still print the tail.
 */
export class LocalAgentInvocationError extends Error {
  readonly agent: CodingAgentId;
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrTail: string;
  readonly spawnCode?: string;
  readonly timedOut: boolean;

  constructor(init: {
    agent: CodingAgentId;
    command: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stderrTail?: string;
    spawnCode?: string;
    timedOut?: boolean;
    summary: string;
  }) {
    const detail = init.stderrTail?.trim();
    super(detail ? `${init.summary} ${detail}` : init.summary);
    this.name = "LocalAgentInvocationError";
    this.agent = init.agent;
    this.command = init.command;
    this.exitCode = init.exitCode ?? null;
    this.signal = init.signal ?? null;
    this.stderrTail = detail ?? "";
    this.spawnCode = init.spawnCode;
    this.timedOut = init.timedOut ?? false;
  }
}

function tail(text: string, limit = STDERR_TAIL_LIMIT): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed;
}

/**
 * Turn a failed invocation into a routing reason.
 *
 * Auth is checked before anything else because a signed-out CLI is chatty:
 * Codex prints five `Reconnecting…` lines around its 401, and the generic
 * classifier would match `try again` (→ overloaded) before it ever reached the
 * auth hints. Getting this wrong is what kept the ladder retrying a credential
 * that was never going to work.
 */
export function classifyLocalAgentFailure(error: LocalAgentInvocationError): FailoverReason {
  if (error.spawnCode === "ENOENT" || error.spawnCode === "EACCES") {
    return "not_installed";
  }
  if (error.timedOut) {
    return "timeout";
  }

  const haystack = error.stderrTail;
  if (hasPermanentAuthHint(haystack)) {
    return "auth_permanent";
  }
  // Everything else — including "a rejected flag means *our* argv is stale",
  // which classifies as `format` and fails the ladder fast rather than
  // spending every remaining agent on it.
  return classifyMessage(haystack) ?? "unknown";
}

function runProcess(spec: InvocationSpec, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let didTimeout = false;
    let stdinError: Error | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
      forceKillTimer.unref();
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimers();
      reject(
        new LocalAgentInvocationError({
          agent: spec.agent,
          command: spec.command,
          spawnCode: (error as NodeJS.ErrnoException).code,
          stderrTail: error.message,
          summary: `${spec.agent} could not be started (${spec.command}).`,
        }),
      );
    });
    child.on("close", (code, signal) => {
      clearTimers();
      if (didTimeout) {
        reject(
          new LocalAgentInvocationError({
            agent: spec.agent,
            command: spec.command,
            exitCode: code,
            signal,
            stderrTail: tail(stderr),
            timedOut: true,
            summary: `${spec.agent} timed out after ${timeoutMs}ms.`,
          }),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new LocalAgentInvocationError({
            agent: spec.agent,
            command: spec.command,
            exitCode: code,
            signal,
            // Some CLIs put the useful line on stdout; fall back to it so the
            // reason is never derived from an empty string.
            stderrTail: tail(stderr) || tail(stdout),
            summary: `${spec.agent} exited with status ${code ?? "unknown"}.`,
          }),
        );
        return;
      }
      if (stdinError) {
        // A clean exit is not a successful invocation if the agent never
        // received the prompt. Resolving `stdout` here would hand back an
        // answer to a question that was never asked — a silent wrong result,
        // which is worse than the crash this handler exists to prevent.
        reject(
          new LocalAgentInvocationError({
            agent: spec.agent,
            command: spec.command,
            exitCode: code,
            signal,
            stderrTail: tail(stderr) || tail(stdout),
            summary: `${spec.agent} exited cleanly but closed its input before the prompt was delivered (${stdinError.message}).`,
          }),
        );
        return;
      }
      resolve(stdout);
    });

    // An agent that exits before reading its input — a crash, a rejected
    // flag, a wrapper that never consumes stdin — closes this pipe under us,
    // and the write then raises EPIPE on the stdin stream. `child.on("error")`
    // does not cover it: stdin is a separate emitter, so an unhandled error
    // there takes down the process instead of taking this path at all.
    //
    // Record it rather than discard it. A non-zero exit is the better
    // diagnosis and wins above; a zero exit needs this, or an agent that
    // ignored the prompt and printed something anyway would look like success.
    child.stdin.on("error", (error: Error) => {
      stdinError ??= error;
    });

    if (spec.stdin) {
      child.stdin.write(spec.stdin);
    }
    child.stdin.end();
  });
}

async function readAgentOutput(spec: InvocationSpec, stdout: string): Promise<string> {
  if (spec.outputFile && existsSync(spec.outputFile)) {
    const fileOutput = await readFile(spec.outputFile, "utf8").catch(() => "");
    if (fileOutput.trim()) {
      return fileOutput;
    }
  }
  return stdout;
}

function extractBalancedJson(text: string): string | undefined {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const source = fenced?.[1]?.trim() ?? trimmed;

  try {
    JSON.parse(source);
    return source;
  } catch {
    // Fall through to balanced-object extraction.
  }

  const start = source.search(/[\[{]/);
  if (start < 0) {
    return undefined;
  }

  const opener = source[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, index + 1);
        JSON.parse(candidate);
        return candidate;
      }
    }
  }

  return undefined;
}

async function invokeLocalAgent(
  agent: CodingAgentId,
  command: string,
  prompt: string,
): Promise<string> {
  const timeoutMs = Number(process.env.LLM_LOCAL_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const spec = await buildInvocation(agent, command, prompt);
  try {
    const stdout = await runProcess(spec, timeoutMs);
    return (await readAgentOutput(spec, stdout)).trim();
  } finally {
    // Runs on failure too — a call can refresh the token and then fail on
    // the model, and the refresh is still worth keeping.
    await spec.persistCredentials?.().catch(() => undefined);
    if (spec.cleanupDir) {
      await rm(spec.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function runLocalAgentWithFallback(
  request: LlmRequest,
  mode: AgentMode,
  taskName?: string,
  pinnedAgent?: CodingAgentId,
): Promise<string> {
  const agentOrder = pinnedAgent ? [pinnedAgent] : getConfiguredAgentOrder();
  const store = buildAgentStore(agentOrder);
  if (store.profiles.length === 0) {
    throw new Error(
      pinnedAgent
        ? `${AGENT_DISPLAY_NAMES[pinnedAgent]} is not available locally. ${getInstallHint(pinnedAgent) ?? ""}`.trim()
        : "No safe local coding agents are available. Install/login to Codex CLI or Claude Code, configure LLM_AGENT_*_COMMAND, or opt into tool-capable agents with LLM_LOCAL_AGENT_ALLOW_UNSAFE=1/custom LLM_AGENT_*_ARGS_JSON for local development only.",
    );
  }

  const availableAgents = store.profiles.map((profile) => profile.provider as CodingAgentId);
  const primary = buildModelRef(availableAgents[0]);
  const fallbacks = availableAgents.slice(1).map(buildModelRef);
  const prompt = buildPrompt(request, mode, taskName);

  const result = await runWithModelFallback({
    primary,
    fallbacks,
    store,
    agentId: "local-coding-agents",
    persistUsageWrites: false,
    run: async (ctx) => {
      const agent = ctx.provider as CodingAgentId;
      let output: string;
      try {
        output = await invokeLocalAgent(agent, ctx.profile.secret, prompt);
      } catch (error) {
        if (error instanceof LocalAgentInvocationError) {
          // Re-throw as a FailoverError so the loop gets a real reason and the
          // message keeps the exit code + stderr tail all the way out to
          // FallbackSummaryError.
          throw new FailoverError(error.message, {
            reason: classifyLocalAgentFailure(error),
            provider: ctx.provider,
            model: ctx.model,
            cause: error,
          });
        }
        throw error;
      }

      if (!output.trim()) {
        throw new FailoverError("Local coding agent returned an empty response.", {
          reason: "empty_response",
          provider: ctx.provider,
          model: ctx.model,
        });
      }

      if (mode === "json") {
        const json = extractBalancedJson(output);
        if (!json) {
          throw new FailoverError("Local coding agent did not return valid JSON.", {
            reason: "unknown",
            provider: ctx.provider,
            model: ctx.model,
          });
        }
        return JSON.stringify(JSON.parse(json));
      }

      return output;
    },
  });

  return result.result;
}

export class LocalCodingAgentProvider implements LlmProviderInterface {
  private readonly taskType?: string;
  /**
   * Set when the caller picked a specific agent (the chat window's picker).
   * Pinning replaces the configured order rather than reordering it: the user
   * asked for Claude Code, so silently answering with Codex would be worse
   * than failing.
   */
  private readonly pinnedAgent?: CodingAgentId;

  constructor(config?: LlmConfig, taskType?: string) {
    this.taskType = taskType;
    this.pinnedAgent =
      typeof config?.localAgent === "string" ? normalizeAgentId(config.localAgent) : undefined;
  }

  async generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string> {
    return runLocalAgentWithFallback(
      request,
      "json",
      options?.taskName ?? this.taskType,
      this.pinnedAgent,
    );
  }

  async generateText(request: LlmRequest): Promise<string> {
    return runLocalAgentWithFallback(request, "text", this.taskType, this.pinnedAgent);
  }

  getProviderName(): LlmProvider {
    return "coding-agent";
  }
}
