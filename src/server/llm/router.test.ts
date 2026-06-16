import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCandidates, generateText } from "./router";

const ENV_KEYS = [
  "LLM_ALLOWED_PROVIDERS",
  "OPENROUTER_MODEL",
  "OPENROUTER_QA_MODEL",
  "OPENROUTER_FALLBACK_MODELS",
  "OPENROUTER_QA_FALLBACK_MODELS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_FALLBACK_MODELS",
  "CODING_AGENT_MODEL",
  "LLM_LOCAL_AGENTS",
  "LLM_AGENT_CODEX_COMMAND",
  "LLM_LOCAL_AGENT_TIMEOUT_MS",
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

describe("buildCandidates", () => {
  let original: Record<string, string | undefined>;
  let tempDir: string | undefined;

  afterEach(async () => {
    restoreEnv(original);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("leaves OpenRouter same-provider model fallbacks to the native models array", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_QA_MODEL = "deepseek/deepseek-v4-flash:free";
    process.env.OPENROUTER_FALLBACK_MODELS =
      "openrouter/free nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

    const candidates = buildCandidates("openrouter", "qa");

    expect(candidates).toEqual({
      primary: "openrouter/deepseek/deepseek-v4-flash:free",
      fallbacks: [],
    });
  });

  it("keeps non-OpenRouter same-provider model fallbacks in the routing layer", () => {
    original = snapshotEnv();
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.OPENAI_FALLBACK_MODELS = "gpt-4.1-mini gpt-4o-mini";

    const candidates = buildCandidates("openai", "qa");

    expect(candidates).toEqual({
      primary: "openai/gpt-4o-mini",
      fallbacks: ["openai/gpt-4.1-mini"],
    });
  });

  it("still adds configured cross-provider fallbacks for OpenRouter primaries", () => {
    original = snapshotEnv();
    process.env.LLM_ALLOWED_PROVIDERS = "openrouter,openai";
    process.env.OPENROUTER_QA_MODEL = "deepseek/deepseek-v4-flash:free";
    process.env.OPENROUTER_FALLBACK_MODELS = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt-4o-mini";

    const candidates = buildCandidates("openrouter", "qa");

    expect(candidates).toEqual({
      primary: "openrouter/deepseek/deepseek-v4-flash:free",
      fallbacks: ["openai/gpt-4o-mini"],
    });
  });

  it("uses default local-agent routing without HTTP model lookup", () => {
    original = snapshotEnv();

    const candidates = buildCandidates("coding-agent", "qa");

    expect(candidates).toEqual({
      primary: "coding-agent/default",
      fallbacks: [],
    });
  });

  it("keeps coding-agent on the local fast path when API fallback env is stale", async () => {
    original = snapshotEnv();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "readable-router-agent-test-"));
    const agent = path.join(tempDir, "codex.sh");
    await writeFile(
      agent,
      `#!/bin/sh
cat >/dev/null
printf 'local codex answer'
`,
      "utf8",
    );
    await chmod(agent, 0o755);

    process.env.LLM_ALLOWED_PROVIDERS = "openrouter,openai";
    process.env.LLM_LOCAL_AGENTS = "codex-cli";
    process.env.LLM_AGENT_CODEX_COMMAND = agent;
    process.env.LLM_LOCAL_AGENT_TIMEOUT_MS = "5000";

    await expect(
      generateText(
        {
          systemPrompt: "Be concise.",
          userPrompt: "Use the local agent.",
        },
        { provider: "coding-agent", taskName: "qa" },
      ),
    ).resolves.toBe("local codex answer");
  });
});
