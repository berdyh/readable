import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { LlmConfig, LlmProvider, LlmProviderInterface, LlmRequest } from "../types";
import {
  FailoverError,
  runWithModelFallback,
  type AuthProfile,
  type AuthProfileStore,
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
  stdin?: string;
  outputFile?: string;
  cleanupDir?: string;
}

const DEFAULT_AGENT_ORDER: CodingAgentId[] = ["codex-cli"];
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
  try {
    const content = readFileSync(command, "utf8").slice(0, 4096);
    return content.includes("npx") && content.includes("--prefer-online");
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

function buildLocalAgentEnv(agent: CodingAgentId, tempDir: string): NodeJS.ProcessEnv {
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
  copyExplicitAgentAuthEnv(agent, env);

  return env;
}

function copyExplicitAgentAuthEnv(agent: CodingAgentId, env: NodeJS.ProcessEnv): void {
  if (agent !== "codex-cli") {
    return;
  }

  const authFile = getAgentEnvValue(agent, "AUTH_FILE") ?? process.env.CODEX_AUTH_FILE?.trim();
  if (authFile) {
    env.CODEX_AUTH_FILE = authFile;
  }
}

function getAgentModelName(agent: CodingAgentId): string {
  return getAgentEnvValue(agent, "MODEL") ?? "default";
}

function buildModelRef(agent: CodingAgentId): ModelRef {
  const model = getAgentModelName(agent);
  return `${agent}/${model}` as ModelRef;
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
  const overrideArgs = parseArgsJson(agent, prompt, tempDir, outputFile);
  if (overrideArgs) {
    return {
      command,
      args: overrideArgs,
      cwd: tempDir,
      agent,
      stdin: prompt,
      outputFile,
      cleanupDir: tempDir,
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
          "--tools",
          "",
        ],
        cwd: tempDir,
        agent,
        stdin: prompt,
        cleanupDir: tempDir,
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
          "--ask-for-approval",
          "never",
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
        stdin: prompt,
        outputFile,
        cleanupDir: tempDir,
      };
    case "gemini-cli":
      return {
        command,
        args: ["--prompt", prompt],
        cwd: tempDir,
        agent,
        outputFile,
        cleanupDir: tempDir,
      };
    case "opencode":
      return {
        command,
        args: ["run", "--no-summary", prompt],
        cwd: tempDir,
        agent,
        outputFile,
        cleanupDir: tempDir,
      };
    case "antigravity":
      throw new Error(
        "Antigravity has no built-in headless invocation. Set LLM_AGENT_ANTIGRAVITY_ARGS_JSON.",
      );
  }
}

function runProcess(spec: InvocationSpec, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: buildLocalAgentEnv(spec.agent, spec.cwd),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let didTimeout = false;
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
      reject(error);
    });
    child.on("close", (code) => {
      clearTimers();
      if (didTimeout) {
        reject(new Error(`Local coding agent timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Local coding agent exited with status ${code}. ${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      resolve(stdout);
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
    if (spec.cleanupDir) {
      await rm(spec.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function runLocalAgentWithFallback(
  request: LlmRequest,
  mode: AgentMode,
  taskName?: string,
): Promise<string> {
  const agentOrder = getConfiguredAgentOrder();
  const store = buildAgentStore(agentOrder);
  if (store.profiles.length === 0) {
    throw new Error(
      "No safe local coding agents are available. Install/login to Codex CLI or Claude Code, configure LLM_AGENT_*_COMMAND, or opt into tool-capable agents with LLM_LOCAL_AGENT_ALLOW_UNSAFE=1/custom LLM_AGENT_*_ARGS_JSON for local development only.",
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
      const output = await invokeLocalAgent(agent, ctx.profile.secret, prompt);
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

  constructor(_config?: LlmConfig, taskType?: string) {
    this.taskType = taskType;
  }

  async generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string> {
    return runLocalAgentWithFallback(request, "json", options?.taskName ?? this.taskType);
  }

  async generateText(request: LlmRequest): Promise<string> {
    return runLocalAgentWithFallback(request, "text", this.taskType);
  }

  getProviderName(): LlmProvider {
    return "coding-agent";
  }
}
