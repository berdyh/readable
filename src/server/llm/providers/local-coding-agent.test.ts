import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _credentialStagingForTests,
  classifyLocalAgentFailure,
  describeLocalCodingAgents,
  LocalAgentInvocationError,
  LocalCodingAgentProvider,
  parseLocalAgentPin,
  resetLocalAgentAuthProbeCache,
} from "./local-coding-agent";
import { resetCliCredentialCache } from "../routing";

const ENV_KEYS = [
  "LLM_LOCAL_AGENTS",
  "LLM_AGENT_CLAUDE_CODE_COMMAND",
  "LLM_AGENT_CODEX_COMMAND",
  "LLM_AGENT_CODEX_AUTH_FILE",
  "LLM_AGENT_CLAUDE_CODE_AUTH_FILE",
  "LLM_AGENT_GEMINI_COMMAND",
  "LLM_AGENT_GEMINI_ALLOW_UNSAFE",
  "LLM_AGENT_GEMINI_ARGS_JSON",
  "LLM_AGENT_OPENCODE_COMMAND",
  "LLM_AGENT_OPENCODE_ALLOW_UNSAFE",
  "LLM_AGENT_CODEX_MODEL",
  "LLM_AGENT_CODEX_REASONING_EFFORT",
  "LLM_AGENT_CODEX_ARGS_JSON",
  "LLM_AGENT_CLAUDE_CODE_ARGS_JSON",
  "LLM_AGENT_OPENCODE_ARGS_JSON",
  "LLM_AGENT_ANTIGRAVITY_COMMAND",
  "LLM_AGENT_ANTIGRAVITY_ARGS_JSON",
  "LLM_LOCAL_AGENT_ALLOW_UNSAFE",
  "LLM_LOCAL_AGENT_ENV_ALLOWLIST",
  "LLM_LOCAL_AGENT_TIMEOUT_MS",
  "LLM_LOCAL_AGENT_PROBE_TIMEOUT_MS",
  "CUSTOM_ALLOWED_AGENT_ENV",
  "DATABASE_URL",
  "OPENROUTER_API_KEY",
  "CODEX_AUTH_FILE",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "GEMINI_CONFIG_DIR",
  "OPENCODE_CONFIG_DIR",
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "PATH",
];

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

async function makeAgentScript(dir: string, name: string, body: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(file, 0o755);
  return file;
}

describe("LocalCodingAgentProvider", () => {
  let original: Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(async () => {
    original = snapshotEnv();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-agent-test-"));
    process.env.LLM_LOCAL_AGENT_TIMEOUT_MS = "5000";
    // cli-detect caches auth-file reads by (path, mtime); temp files written
    // milliseconds apart would otherwise be served from a previous test's read.
    resetCliCredentialCache();
  });

  afterEach(async () => {
    restoreEnv(original);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("routes text requests to the configured local agent executable", async () => {
    const agent = await makeAgentScript(
      tempDir,
      "agent.sh",
      `
input="$(cat)"
case "$input" in
  *"User prompt:
Explain"*) printf 'local answer' ;;
  *) printf 'wrong prompt' ;;
esac
`,
    );
    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = agent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateText({
        systemPrompt: "Be concise.",
        userPrompt: "Explain local routing.",
      }),
    ).resolves.toBe("local answer");
  });

  it("falls back across configured local agents and normalizes JSON output", async () => {
    const failingAgent = await makeAgentScript(
      tempDir,
      "fail.sh",
      "printf 'rate limited' >&2\nexit 1",
    );
    const jsonAgent = await makeAgentScript(
      tempDir,
      "json.sh",
      `
cat >/dev/null
printf 'Here is the JSON:\\n{"ok":true,"source":"codex"}'
`,
    );
    process.env.LLM_LOCAL_AGENTS = "claude-code,codex-cli";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = failingAgent;
    process.env.LLM_AGENT_CODEX_COMMAND = jsonAgent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateJson({
        systemPrompt: "Return JSON.",
        userPrompt: "Status?",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      }),
    ).resolves.toBe('{"ok":true,"source":"codex"}');
  });

  it("skips auto-detected npx wrappers unless explicitly configured", async () => {
    const geminiWrapper = await makeAgentScript(
      tempDir,
      "gemini",
      `
# Simulate the user's npx --prefer-online shim.
# npx --prefer-online @google/gemini-cli
printf 'gemini wrapper should not run'
`,
    );
    const codexAgent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf 'codex fallback'
`,
    );
    process.env.PATH = path.dirname(geminiWrapper);
    process.env.HOME = tempDir;
    process.env.LLM_LOCAL_AGENTS = "gemini-cli,codex-cli";
    process.env.LLM_LOCAL_AGENT_ALLOW_UNSAFE = "1";
    process.env.LLM_AGENT_CODEX_COMMAND = codexAgent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateText({
        systemPrompt: "Be concise.",
        userPrompt: "Use the local agent.",
      }),
    ).resolves.toBe("codex fallback");
  });

  it("skips tool-capable agents by default even when configured", async () => {
    const geminiAgent = await makeAgentScript(
      tempDir,
      "gemini.sh",
      "printf 'unsafe gemini should not run'",
    );
    const opencodeAgent = await makeAgentScript(
      tempDir,
      "opencode.sh",
      "printf 'unsafe opencode should not run'",
    );
    const codexAgent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf 'safe codex'
`,
    );
    process.env.LLM_LOCAL_AGENTS = "gemini-cli,opencode,codex-cli";
    process.env.LLM_AGENT_GEMINI_COMMAND = geminiAgent;
    process.env.LLM_AGENT_OPENCODE_COMMAND = opencodeAgent;
    process.env.LLM_AGENT_CODEX_COMMAND = codexAgent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateText({
        systemPrompt: "Be concise.",
        userPrompt: "Use a safe local agent.",
      }),
    ).resolves.toBe("safe codex");
  });

  it("allows tool-capable agents only with explicit local opt-in", async () => {
    const geminiAgent = await makeAgentScript(tempDir, "gemini.sh", "printf 'unsafe opt-in'");
    process.env.LLM_LOCAL_AGENTS = "gemini-cli";
    process.env.LLM_AGENT_GEMINI_COMMAND = geminiAgent;
    process.env.LLM_LOCAL_AGENT_ALLOW_UNSAFE = "1";

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateText({
        systemPrompt: "Be concise.",
        userPrompt: "Use Gemini.",
      }),
    ).resolves.toBe("unsafe opt-in");
  });

  it("allows custom unsafe invocations without the global unsafe flag", async () => {
    const opencodeAgent = await makeAgentScript(
      tempDir,
      "opencode.sh",
      "printf 'custom invocation'",
    );
    process.env.LLM_LOCAL_AGENTS = "opencode";
    process.env.LLM_AGENT_OPENCODE_COMMAND = opencodeAgent;
    process.env.LLM_AGENT_OPENCODE_ARGS_JSON = JSON.stringify(["--no-tools", "{prompt}"]);

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    await expect(
      provider.generateText({
        systemPrompt: "Be concise.",
        userPrompt: "Use custom opencode args.",
      }),
    ).resolves.toBe("custom invocation");
  });

  it("passes configured model and reasoning effort to Codex CLI", async () => {
    const codexAgent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf '%s' "$*"
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexAgent;
    process.env.LLM_AGENT_CODEX_MODEL = "gpt-5.5";
    process.env.LLM_AGENT_CODEX_REASONING_EFFORT = "xhigh";

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Use Codex.",
    });

    expect(output).toMatch(/^exec --model gpt-5\.5/);
    expect(output).toContain('--config model_reasoning_effort="xhigh"');
  });

  it("does not pass --ask-for-approval, which codex exec rejects with exit 2", async () => {
    // Regression guard for the bug that made LLM_PROVIDER=coding-agent fail
    // every call. `codex exec` has not accepted this flag since it moved to
    // the interactive command; passing it aborts before the model is reached,
    // and the failure surfaced only as "All providers exhausted (unknown)".
    const codexAgent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf '%s' "$*"
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexAgent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Use Codex.",
    });

    expect(output).not.toContain("--ask-for-approval");
    expect(output).toContain("--sandbox read-only");
    expect(output).toContain("--ephemeral");
  });

  it("keeps the variadic --tools '' last in the Claude Code argv", async () => {
    // `--tools` swallows every following argument as a tool name, so the empty
    // string that means "no tools" only works as the final argument. Anything
    // appended after it would silently become a tool name instead of a flag.
    const claudeAgent = await makeAgentScript(
      tempDir,
      "claude.sh",
      `
cat >/dev/null
for arg in "$@"; do printf 'arg:%s\\n' "$arg"; done
`,
    );
    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = claudeAgent;
    // Exercise the model flag too, so the guard also covers argv built with
    // optional segments present.
    process.env.LLM_AGENT_CLAUDE_CODE_MODEL = "claude-sonnet-5";

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Check argv.",
    });

    const args = output.trimEnd().split("\n");
    expect(args.at(-2)).toBe("arg:--tools");
    expect(args.at(-1)).toBe("arg:");
  });

  it("runs agents with throwaway HOME/XDG dirs and does not expose app secrets by default", async () => {
    const agent = await makeAgentScript(
      tempDir,
      "agent.sh",
      `
cat >/dev/null
printf 'cwd=%s\\nhome=%s\\nxdg=%s\\ndb=%s\\nopenrouter=%s\\nallowed=%s\\ncodexAuth=%s\\ncodexHome=%s' "$(pwd)" "\${HOME:-missing}" "\${XDG_CONFIG_HOME:-missing}" "\${DATABASE_URL:-missing}" "\${OPENROUTER_API_KEY:-missing}" "\${CUSTOM_ALLOWED_AGENT_ENV:-missing}" "\${CODEX_AUTH_FILE:-missing}" "\${CODEX_HOME:-missing}"
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = agent;
    process.env.LLM_LOCAL_AGENT_ENV_ALLOWLIST =
      "CUSTOM_ALLOWED_AGENT_ENV,HOME,XDG_CONFIG_HOME,CODEX_HOME,CODEX_AUTH_FILE";
    process.env.CUSTOM_ALLOWED_AGENT_ENV = "visible";
    process.env.DATABASE_URL = "postgres://secret";
    process.env.OPENROUTER_API_KEY = "sk-or-secret";
    const realHome = path.join(tempDir, "real-home");
    const realConfig = path.join(tempDir, "real-config");
    process.env.HOME = realHome;
    process.env.XDG_CONFIG_HOME = realConfig;
    // No credential on disk, so nothing is staged and CODEX_HOME stays unset —
    // the allowlist must not be able to smuggle the real one back in.
    process.env.LLM_AGENT_CODEX_AUTH_FILE = path.join(tempDir, "missing-auth.json");
    process.env.CODEX_HOME = path.join(tempDir, "real-codex-home");

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Check isolation.",
    });

    expect(output).toContain("cwd=");
    expect(output).not.toContain(process.cwd());
    expect(output).toContain("readable-agent-");
    expect(output).not.toContain(realHome);
    expect(output).not.toContain(realConfig);
    expect(output).toContain("home=");
    expect(output).toContain("xdg=");
    // `CODEX_AUTH_FILE` is not a real Codex env var — it must never be set.
    expect(output).toContain("codexAuth=missing");
    expect(output).toContain("codexHome=missing");
    expect(output).not.toContain("real-codex-home");
    expect(output).toContain("db=missing");
    expect(output).toContain("openrouter=missing");
    expect(output).toContain("allowed=visible");
  });

  it("stages the Codex credential into a private CODEX_HOME inside the sandbox", async () => {
    // The root cause of the original failure: Codex reads $CODEX_HOME/auth.json
    // and nothing else, so redirecting HOME without redirecting CODEX_HOME left
    // it unauthenticated (real symptom: HTTP 401 on wss://api.openai.com).
    const agent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf 'codexHome=%s\\nauth=%s' "\${CODEX_HOME:-missing}" "$(cat "\${CODEX_HOME:-/nonexistent}/auth.json" 2>/dev/null || echo missing)"
`,
    );
    const authFile = path.join(tempDir, "codex-auth.json");
    await writeFile(authFile, JSON.stringify({ tokens: { access_token: "codex-token" } }), "utf8");

    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = agent;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = authFile;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Check credentials.",
    });

    expect(output).toContain("codex-token");
    // The staged copy lives in the throwaway invocation dir, not the real one.
    expect(output).toMatch(/codexHome=.*readable-agent-.*codex-home/);
    expect(output).not.toContain(authFile);
  });

  it("stages only claudeAiOauth, leaving third-party MCP tokens behind", async () => {
    // ~/.claude/.credentials.json also holds `mcpOAuth` bearer tokens for every
    // MCP server the developer has authorised. Handing those to a headless
    // agent would be a real credential leak, so only Claude's own OAuth block
    // crosses into the sandbox.
    const agent = await makeAgentScript(
      tempDir,
      "claude.sh",
      `
cat >/dev/null
printf 'creds=%s' "$(cat "\${CLAUDE_CONFIG_DIR:-/nonexistent}/.credentials.json" 2>/dev/null || echo missing)"
`,
    );
    const credsFile = path.join(tempDir, "claude-credentials.json");
    await writeFile(
      credsFile,
      JSON.stringify({
        claudeAiOauth: { accessToken: "claude-token", subscriptionType: "max" },
        mcpOAuth: { "plugin:vercel": { accessToken: "third-party-secret" } },
      }),
      "utf8",
    );

    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = agent;
    process.env.LLM_AGENT_CLAUDE_CODE_AUTH_FILE = credsFile;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    const output = await provider.generateText({
      systemPrompt: "Be concise.",
      userPrompt: "Check credentials.",
    });

    expect(output).toContain("claude-token");
    expect(output).toContain("max");
    expect(output).not.toContain("third-party-secret");
    expect(output).not.toContain("mcpOAuth");
  });

  it("writes a mid-call Codex token refresh back to the real auth file", async () => {
    const authFile = path.join(tempDir, "codex-auth.json");
    await writeFile(authFile, JSON.stringify({ tokens: { access_token: "old-token" } }), "utf8");
    // The fake CLI refreshes its token: it rewrites the staged auth.json the
    // way Codex does when the access token has expired.
    const agent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf '{"tokens":{"access_token":"new-token"}}' > "\${CODEX_HOME}/auth.json"
printf 'answer'
`,
    );

    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = agent;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = authFile;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    await provider.generateText({ systemPrompt: "Be concise.", userPrompt: "Refresh." });

    const persisted = JSON.parse(await readFile(authFile, "utf8"));
    expect(persisted.tokens.access_token).toBe("new-token");
  });

  it("does not clobber a real auth file that changed mid-call", async () => {
    const authFile = path.join(tempDir, "codex-auth.json");
    await writeFile(authFile, JSON.stringify({ tokens: { access_token: "old-token" } }), "utf8");
    // Simulate a concurrent `codex login` racing the invocation: the fake CLI
    // rewrites the REAL file (as the user's login would) and refreshes its
    // staged copy. The user's newer login must win over our write-back.
    const agent = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
cat >/dev/null
printf '{"tokens":{"access_token":"user-relogin"}}' > ${JSON.stringify(authFile)}
printf '{"tokens":{"access_token":"stale-refresh"}}' > "\${CODEX_HOME}/auth.json"
printf 'answer'
`,
    );

    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = agent;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = authFile;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    await provider.generateText({ systemPrompt: "Be concise.", userPrompt: "Race." });

    const persisted = JSON.parse(await readFile(authFile, "utf8"));
    expect(persisted.tokens.access_token).toBe("user-relogin");
  });

  it("merges a Claude refresh back without dropping mcpOAuth tokens", async () => {
    const credsFile = path.join(tempDir, "claude-credentials.json");
    await writeFile(
      credsFile,
      JSON.stringify({
        claudeAiOauth: { accessToken: "old-token", subscriptionType: "max" },
        mcpOAuth: { "plugin:vercel": { accessToken: "third-party-secret" } },
      }),
      "utf8",
    );
    const agent = await makeAgentScript(
      tempDir,
      "claude.sh",
      `
cat >/dev/null
printf '{"claudeAiOauth":{"accessToken":"new-token","subscriptionType":"max"}}' > "\${CLAUDE_CONFIG_DIR}/.credentials.json"
printf 'answer'
`,
    );

    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = agent;
    process.env.LLM_AGENT_CLAUDE_CODE_AUTH_FILE = credsFile;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });
    await provider.generateText({ systemPrompt: "Be concise.", userPrompt: "Refresh." });

    const persisted = JSON.parse(await readFile(credsFile, "utf8"));
    expect(persisted.claudeAiOauth.accessToken).toBe("new-token");
    // The block that never entered the sandbox survives the write-back.
    expect(persisted.mcpOAuth["plugin:vercel"].accessToken).toBe("third-party-secret");
  });

  it("reports a signed-out agent as auth_permanent instead of unknown", async () => {
    const agent = await makeAgentScript(
      tempDir,
      "claude.sh",
      `
cat >/dev/null
printf 'Not logged in · Please run /login' >&2
exit 1
`,
    );
    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = agent;

    const provider = new LocalCodingAgentProvider({ provider: "coding-agent" });

    // The stderr tail and the exit code both have to survive to the caller —
    // an opaque failure here is what let the broken invocation go unnoticed.
    await expect(
      provider.generateText({ systemPrompt: "Be concise.", userPrompt: "Ask." }),
    ).rejects.toThrow(/exited with status 1[\s\S]*Not logged in/);
  });

  it("classifies a missing binary rather than retrying it forever", () => {
    expect(
      classifyLocalAgentFailure(
        new LocalAgentInvocationError({
          agent: "codex-cli",
          command: "/nope/codex",
          spawnCode: "ENOENT",
          summary: "codex-cli could not be started.",
        }),
      ),
    ).toBe("not_installed");
  });

  it("classifies a rejected CLI flag as format so the ladder fails fast", () => {
    expect(
      classifyLocalAgentFailure(
        new LocalAgentInvocationError({
          agent: "codex-cli",
          command: "/usr/bin/codex",
          exitCode: 2,
          stderrTail: "error: unexpected argument '--ask-for-approval' found",
          summary: "codex-cli exited with status 2.",
        }),
      ),
    ).toBe("format");
  });

  it("prefers the auth signal over Codex's chatty reconnect noise", () => {
    // Codex prints five "Reconnecting…" lines around its 401. The generic
    // classifier would match "try again" (→ overloaded) first, which is how a
    // dead credential kept looking like a transient blip.
    expect(
      classifyLocalAgentFailure(
        new LocalAgentInvocationError({
          agent: "codex-cli",
          command: "/usr/bin/codex",
          exitCode: 1,
          stderrTail: [
            "ERROR: Reconnecting... 2/5",
            "failed to connect to websocket: HTTP error: 401 Unauthorized",
            "ERROR: try again later",
          ].join("\n"),
          summary: "codex-cli exited with status 1.",
        }),
      ),
    ).toBe("auth_permanent");
  });
});

describe("parseLocalAgentPin", () => {
  it("accepts safe built-in agents, normalizing aliases", () => {
    expect(parseLocalAgentPin("claude-code")).toBe("claude-code");
    expect(parseLocalAgentPin("claude")).toBe("claude-code");
    expect(parseLocalAgentPin("Codex")).toBe("codex-cli");
  });

  it("rejects everything that is not a safe built-in", () => {
    // The value selects a binary to spawn, so tool-capable agents and free
    // text must never pass — even ones the provider knows about.
    expect(parseLocalAgentPin("gemini-cli")).toBeUndefined();
    expect(parseLocalAgentPin("opencode")).toBeUndefined();
    expect(parseLocalAgentPin("/usr/bin/evil")).toBeUndefined();
    expect(parseLocalAgentPin(42)).toBeUndefined();
    expect(parseLocalAgentPin(undefined)).toBeUndefined();
  });
});

describe("describeLocalCodingAgents", () => {
  let original: Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(async () => {
    original = snapshotEnv();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-agent-status-"));
    process.env.LLM_LOCAL_AGENT_PROBE_TIMEOUT_MS = "5000";
    resetCliCredentialCache();
    resetLocalAgentAuthProbeCache();
  });

  afterEach(async () => {
    restoreEnv(original);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("separates 'not installed' from 'not signed in'", async () => {
    const codexBinary = await makeAgentScript(tempDir, "codex.sh", "exit 0");
    const authFile = path.join(tempDir, "codex-auth.json");
    await writeFile(authFile, JSON.stringify({ tokens: { access_token: "t" } }), "utf8");

    process.env.LLM_LOCAL_AGENTS = "codex-cli,claude-code";
    process.env.LLM_AGENT_CODEX_COMMAND = codexBinary;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = authFile;
    // Claude's binary is absent entirely.
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = path.join(tempDir, "absent-claude");

    const statuses = await describeLocalCodingAgents();
    const codex = statuses.find((entry) => entry.agent === "codex-cli");
    const claude = statuses.find((entry) => entry.agent === "claude-code");

    expect(codex).toMatchObject({
      displayName: "Codex",
      installed: true,
      authenticated: true,
      unavailableReason: null,
    });
    expect(claude).toMatchObject({
      displayName: "Claude Code",
      installed: false,
      authenticated: false,
      unavailableReason: "not_installed",
    });
    expect(claude?.hint).toContain("claude login");
  });

  it("marks an installed-but-signed-out agent as not_authenticated", async () => {
    const codexBinary = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
if [ "$1 $2" = "login status" ]; then printf 'Not logged in\\n'; exit 1; fi
exit 0
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexBinary;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = path.join(tempDir, "no-such-auth.json");

    const [codex] = await describeLocalCodingAgents();

    expect(codex).toMatchObject({
      installed: true,
      authenticated: false,
      unavailableReason: "not_authenticated",
    });
  });

  it("trusts the CLI's signed-in answer over the credential file's shape", async () => {
    // The macOS-Keychain scenario: no readable credential file at all, but the
    // CLI itself says it is signed in. Shape-checking greyed this out; the
    // probe must not.
    const codexBinary = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
if [ "$1 $2" = "login status" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi
exit 0
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexBinary;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = path.join(tempDir, "no-such-auth.json");

    const [codex] = await describeLocalCodingAgents();

    expect(codex).toMatchObject({
      installed: true,
      authenticated: true,
      unavailableReason: null,
    });
  });

  it("falls back to the credential file when the CLI has no status subcommand", async () => {
    // An older codex that predates `login status` exits 2 with a usage error.
    // That is not a signed-out verdict — the file shape-check decides instead.
    const codexBinary = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
if [ "$1 $2" = "login status" ]; then printf "error: unrecognized subcommand 'login'\\n" >&2; exit 2; fi
exit 0
`,
    );
    const authFile = path.join(tempDir, "codex-auth.json");
    await writeFile(authFile, JSON.stringify({ tokens: { access_token: "t" } }), "utf8");

    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexBinary;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = authFile;

    const [codex] = await describeLocalCodingAgents();

    expect(codex).toMatchObject({ installed: true, authenticated: true });
  });

  it("lets Claude's JSON loggedIn verdict override the exit code", async () => {
    // `claude auth status` prints {"loggedIn": ...} JSON. The boolean is the
    // CLI's own answer and must win even when the exit code disagrees.
    const claudeBinary = await makeAgentScript(
      tempDir,
      "claude.sh",
      `
if [ "$1 $2" = "auth status" ]; then printf '{"loggedIn": false, "authMethod": "none"}\\n'; exit 0; fi
exit 0
`,
    );
    const credsFile = path.join(tempDir, "claude-credentials.json");
    await writeFile(credsFile, JSON.stringify({ claudeAiOauth: { accessToken: "t" } }), "utf8");

    process.env.LLM_LOCAL_AGENTS = "claude-code";
    process.env.LLM_AGENT_CLAUDE_CODE_COMMAND = claudeBinary;
    process.env.LLM_AGENT_CLAUDE_CODE_AUTH_FILE = credsFile;

    const [claude] = await describeLocalCodingAgents();

    expect(claude).toMatchObject({
      installed: true,
      authenticated: false,
      unavailableReason: "not_authenticated",
    });
  });

  it("caches the probe verdict instead of re-spawning the CLI per call", async () => {
    const counterFile = path.join(tempDir, "probe-count");
    const codexBinary = await makeAgentScript(
      tempDir,
      "codex.sh",
      `
if [ "$1 $2" = "login status" ]; then echo probe >> ${JSON.stringify(counterFile)}; exit 0; fi
exit 0
`,
    );
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = codexBinary;
    // Point staging away from any real ~/.codex so the probe sandbox never
    // sees the developer's credential and the mtime input stays stable.
    process.env.LLM_AGENT_CODEX_AUTH_FILE = path.join(tempDir, "no-such-auth.json");

    await describeLocalCodingAgents();
    await describeLocalCodingAgents();

    const probes = (await readFile(counterFile, "utf8")).trim().split("\n");
    expect(probes).toHaveLength(1);
  });
});

describe("credential write-back hardening", () => {
  let original: Record<string, string | undefined>;
  let tempDir: string;

  const codexAuth = JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { access_token: "codex-token", refresh_token: "codex-refresh" },
  });
  const claudeCredentials = JSON.stringify({
    claudeAiOauth: { accessToken: "claude-token", refreshToken: "claude-refresh" },
    mcpOAuth: { vercel: { accessToken: "unrelated" } },
  });

  beforeEach(async () => {
    original = snapshotEnv();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-agent-writeback-"));
  });

  afterEach(async () => {
    restoreEnv(original);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists a valid Codex token refresh back to the real auth file", async () => {
    const source = path.join(tempDir, "auth.json");
    await writeFile(source, codexAuth, "utf8");
    process.env.LLM_AGENT_CODEX_AUTH_FILE = source;

    const sandbox = path.join(tempDir, "sandbox");
    const staged = await _credentialStagingForTests.stageCodexCredentials(sandbox);
    expect(staged.staged).toBe(true);

    const refreshed = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "rotated-token", refresh_token: "rotated-refresh" },
    });
    await writeFile(path.join(sandbox, "codex-home", "auth.json"), refreshed, "utf8");
    await staged.persistRefresh?.();

    expect(await readFile(source, "utf8")).toBe(refreshed);
  });

  it("refuses to write back Codex content that is not a credential", async () => {
    const source = path.join(tempDir, "auth.json");
    await writeFile(source, codexAuth, "utf8");
    process.env.LLM_AGENT_CODEX_AUTH_FILE = source;

    const sandbox = path.join(tempDir, "sandbox");
    const staged = await _credentialStagingForTests.stageCodexCredentials(sandbox);
    const stagedPath = path.join(sandbox, "codex-home", "auth.json");

    for (const garbage of [
      "not json at all",
      JSON.stringify({ tokens: {} }),
      JSON.stringify({ tokens: { access_token: 42 } }),
      JSON.stringify({ evil: "payload" }),
    ]) {
      await writeFile(stagedPath, garbage, "utf8");
      await staged.persistRefresh?.();
      expect(await readFile(source, "utf8")).toBe(codexAuth);
    }
  });

  it("merges a valid Claude refresh while refusing malformed oauth blocks", async () => {
    const source = path.join(tempDir, ".credentials.json");
    await writeFile(source, claudeCredentials, "utf8");
    process.env.LLM_AGENT_CLAUDE_CODE_AUTH_FILE = source;

    const sandbox = path.join(tempDir, "sandbox");
    const staged = await _credentialStagingForTests.stageClaudeCredentials(sandbox);
    expect(staged.staged).toBe(true);
    const stagedPath = path.join(sandbox, "claude-home", ".credentials.json");

    // Malformed refresh: accessToken missing / wrong type — never written.
    await writeFile(stagedPath, JSON.stringify({ claudeAiOauth: { accessToken: 42 } }), "utf8");
    await staged.persistRefresh?.();
    expect(await readFile(source, "utf8")).toBe(claudeCredentials);

    // Valid refresh: merged into the current file, mcpOAuth preserved.
    await writeFile(
      stagedPath,
      JSON.stringify({ claudeAiOauth: { accessToken: "rotated", refreshToken: "r2" } }),
      "utf8",
    );
    await staged.persistRefresh?.();
    const merged = JSON.parse(await readFile(source, "utf8")) as Record<string, unknown>;
    expect(merged.claudeAiOauth).toEqual({ accessToken: "rotated", refreshToken: "r2" });
    expect(merged.mcpOAuth).toEqual({ vercel: { accessToken: "unrelated" } });
  });

  it("skips write-back entirely when custom ARGS_JSON overrides are in use", async () => {
    const source = path.join(tempDir, "auth.json");
    await writeFile(source, codexAuth, "utf8");
    process.env.LLM_AGENT_CODEX_AUTH_FILE = source;
    process.env.LLM_AGENT_CODEX_ARGS_JSON = JSON.stringify(["exec", "--custom"]);

    const sandbox = path.join(tempDir, "sandbox");
    const staged = await _credentialStagingForTests.stageAgentCredentials("codex-cli", sandbox);

    // Credentials still stage (the call should work)…
    expect(staged.staged).toBe(true);
    // …but nothing may ever be written back from an untrusted invocation.
    expect(staged.persistRefresh).toBeUndefined();
  });

  it("keeps write-back for the trusted built-in invocation", async () => {
    const source = path.join(tempDir, "auth.json");
    await writeFile(source, codexAuth, "utf8");
    process.env.LLM_AGENT_CODEX_AUTH_FILE = source;
    delete process.env.LLM_AGENT_CODEX_ARGS_JSON;

    const sandbox = path.join(tempDir, "sandbox");
    const staged = await _credentialStagingForTests.stageAgentCredentials("codex-cli", sandbox);

    expect(staged.persistRefresh).toBeDefined();
  });
});
