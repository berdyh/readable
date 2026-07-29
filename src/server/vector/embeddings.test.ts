import { afterEach, describe, expect, it, vi } from "vitest";

import { embedTexts, getActiveEmbeddingProvider, getEmbeddingEnvironment } from "./embeddings";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("embedding provider selection", () => {
  it("uses OpenRouter automatically when an OpenRouter token exists", () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.QDRANT_COLLECTION;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.OPENAI_API_KEY;

    const env = getEmbeddingEnvironment();

    expect(getActiveEmbeddingProvider()).toBe("openrouter");
    expect(env.providerId).toBe("openrouter");
    expect(env.collection).toBe(
      "paper_chunks_openrouter_nvidia_llama_nemotron_embed_vl_1b_v2_free",
    );
    expect(env.dimensions).toBe(2048);
  });

  it("falls back to the local embedder when OpenRouter is selected without a token", () => {
    process.env.EMBEDDING_PROVIDER = "openrouter";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.QDRANT_COLLECTION;

    const env = getEmbeddingEnvironment();

    expect(getActiveEmbeddingProvider()).toBe("local");
    expect(env.providerId).toBe("local");
    expect(env.collection).toBe("paper_chunks_local_hash_v1");
    expect(env.dimensions).toBe(384);
  });

  it("generates deterministic local vectors without calling a remote endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const environment = getEmbeddingEnvironment("local");

    const [first, second, different] = await embedTexts(
      [
        "self attention improves parallel decoding",
        "self attention improves parallel decoding",
        "graph search",
      ],
      { environment },
    );

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
    expect(first).toHaveLength(384);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("orders and validates remote embedding response vectors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      embedTexts(["alpha", "beta"], {
        environment: {
          providerId: "openrouter",
          apiKey: "sk-or-test",
          baseUrl: "https://openrouter.test/api/v1",
          model: "test-embedder",
          dimensions: 2,
          timeoutMs: 1_000,
          collection: "paper_chunks_test",
        },
      }),
    ).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("rejects malformed remote embedding response vectors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [1, Number.NaN] }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      embedTexts(["alpha"], {
        environment: {
          providerId: "openrouter",
          apiKey: "sk-or-test",
          baseUrl: "https://openrouter.test/api/v1",
          model: "test-embedder",
          dimensions: 2,
          timeoutMs: 1_000,
          collection: "paper_chunks_test",
        },
      }),
    ).rejects.toThrow("non-finite vector value");
  });
});
