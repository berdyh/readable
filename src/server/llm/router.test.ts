import { afterEach, describe, expect, it } from "vitest";

import { buildCandidates } from "./router";

const ENV_KEYS = [
  "LLM_ALLOWED_PROVIDERS",
  "OPENROUTER_MODEL",
  "OPENROUTER_QA_MODEL",
  "OPENROUTER_FALLBACK_MODELS",
  "OPENROUTER_QA_FALLBACK_MODELS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_FALLBACK_MODELS",
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

  afterEach(() => {
    restoreEnv(original);
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
});
