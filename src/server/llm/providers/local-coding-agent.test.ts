import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalCodingAgentProvider } from "./local-coding-agent";

const ENV_KEYS = [
  "LLM_LOCAL_AGENTS",
  "LLM_AGENT_CLAUDE_CODE_COMMAND",
  "LLM_AGENT_CODEX_COMMAND",
  "LLM_AGENT_CODEX_AUTH_FILE",
  "LLM_AGENT_GEMINI_COMMAND",
  "LLM_AGENT_GEMINI_ALLOW_UNSAFE",
  "LLM_AGENT_GEMINI_ARGS_JSON",
  "LLM_AGENT_OPENCODE_COMMAND",
  "LLM_AGENT_OPENCODE_ALLOW_UNSAFE",
  "LLM_AGENT_CODEX_MODEL",
  "LLM_AGENT_CODEX_REASONING_EFFORT",
  "LLM_AGENT_OPENCODE_ARGS_JSON",
  "LLM_AGENT_ANTIGRAVITY_COMMAND",
  "LLM_AGENT_ANTIGRAVITY_ARGS_JSON",
  "LLM_LOCAL_AGENT_ALLOW_UNSAFE",
  "LLM_LOCAL_AGENT_ENV_ALLOWLIST",
  "LLM_LOCAL_AGENT_TIMEOUT_MS",
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
    expect(output).toContain("--ask-for-approval never");
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
    const codexAuthFile = path.join(tempDir, "codex-auth.json");
    process.env.HOME = realHome;
    process.env.XDG_CONFIG_HOME = realConfig;
    process.env.LLM_AGENT_CODEX_AUTH_FILE = codexAuthFile;
    process.env.CODEX_AUTH_FILE = path.join(tempDir, "ambient-codex-auth.json");
    process.env.CODEX_HOME = path.join(tempDir, "codex-home");

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
    expect(output).toContain("codexAuth=");
    expect(output).toContain(codexAuthFile);
    expect(output).not.toContain("ambient-codex-auth");
    expect(output).toContain("codexHome=missing");
    expect(output).toContain("db=missing");
    expect(output).toContain("openrouter=missing");
    expect(output).toContain("allowed=visible");
  });
});
