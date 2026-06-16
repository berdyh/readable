import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRouterProvider } from "../openrouter";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_QA_MODEL",
  "OPENROUTER_SUMMARY_MODEL",
  "OPENROUTER_INLINE_MODEL",
  "OPENROUTER_FALLBACK_MODELS",
  "OPENROUTER_FALLBACK_MODEL",
  "OPENROUTER_QA_FALLBACK_MODELS",
  "OPENROUTER_QA_FALLBACK_MODEL",
  "OPENROUTER_HTTP_REFERER",
  "OPENROUTER_X_TITLE",
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

describe("OpenRouterProvider model resolution", () => {
  let original: Record<string, string | undefined>;

  afterEach(() => {
    restoreEnv(original);
    vi.unstubAllGlobals();
  });

  it("respects an explicit model from the routing layer over env vars", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_QA_MODEL = "task-specific/should-not-win";
    process.env.OPENROUTER_MODEL = "general/should-not-win";

    const provider = new OpenRouterProvider(
      { provider: "openrouter", model: "routing-layer/explicit" },
      "qa",
    );

    expect((provider as unknown as { config: { model: string } }).config.model).toBe(
      "routing-layer/explicit",
    );
  });

  it("prefers task-specific env over general OPENROUTER_MODEL", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_QA_MODEL = "task/qa-wins";
    process.env.OPENROUTER_MODEL = "general/should-not-shadow";

    const provider = new OpenRouterProvider({ provider: "openrouter" }, "qa");

    expect((provider as unknown as { config: { model: string } }).config.model).toBe(
      "task/qa-wins",
    );
  });

  it("falls back to general OPENROUTER_MODEL when no task-specific env is set", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_MODEL = "general/used-as-fallback";

    const provider = new OpenRouterProvider({ provider: "openrouter" }, "qa");

    expect((provider as unknown as { config: { model: string } }).config.model).toBe(
      "general/used-as-fallback",
    );
  });

  it("falls back to catalog default when no env override is set", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";

    const provider = new OpenRouterProvider({ provider: "openrouter" }, "qa");

    // From models.json — task: qa, provider: openrouter.
    expect((provider as unknown as { config: { model: string } }).config.model).toBe(
      "meta-llama/llama-3.3-70b-instruct:free",
    );
  });

  it("applies the same priority chain for the summary task", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_SUMMARY_MODEL = "task/summary-wins";
    process.env.OPENROUTER_MODEL = "general/should-not-shadow";

    const provider = new OpenRouterProvider({ provider: "openrouter" }, "paper_summary");

    expect((provider as unknown as { config: { model: string } }).config.model).toBe(
      "task/summary-wins",
    );
  });

  it("resolves task-specific and global fallback models without duplicating the primary model", () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_QA_FALLBACK_MODELS = "task/fallback-one:free, routing-layer/explicit";
    process.env.OPENROUTER_FALLBACK_MODELS = "global/fallback-two:free task/fallback-one:free";

    const provider = new OpenRouterProvider(
      { provider: "openrouter", model: "routing-layer/explicit" },
      "qa",
    );

    expect(
      (provider as unknown as { config: { fallbackModels: string[] } }).config.fallbackModels,
    ).toEqual(["task/fallback-one:free", "global/fallback-two:free"]);
  });

  it("sends OpenRouter native model fallbacks in the chat completions body", async () => {
    original = snapshotEnv();
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.OPENROUTER_HTTP_REFERER = "https://example.test";
    process.env.OPENROUTER_X_TITLE = "Readable Test";
    process.env.OPENROUTER_FALLBACK_MODELS = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"answer":"ok"}' } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenRouterProvider(
      { provider: "openrouter", model: "deepseek/deepseek-v4-flash:free" },
      "qa",
    );

    await provider.generateJson({
      systemPrompt: "Answer as JSON.",
      userPrompt: "Hi",
      schema: { type: "object" },
    });

    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [input: RequestInfo | URL, init?: RequestInit]
    >;
    const init = fetchCalls[0]?.[1];
    expect(init).toBeDefined();
    expect(init?.headers).toMatchObject({
      "HTTP-Referer": "https://example.test",
      "X-OpenRouter-Title": "Readable Test",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek/deepseek-v4-flash:free",
      models: ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"],
    });
  });
});
