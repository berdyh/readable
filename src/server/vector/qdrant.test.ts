import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureQdrantCollection,
  getQdrantEnvironment,
  pingQdrant,
  type QdrantEnvironmentConfig,
} from "./qdrant";

const env: QdrantEnvironmentConfig = {
  url: "http://localhost:6333",
  timeoutMs: 1000,
  collection: "paper_chunks",
  vectorSize: 1536,
  distance: "Cosine",
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("pingQdrant", () => {
  it("accepts Qdrant readiness endpoints that return plain text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("all shards are ready", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(pingQdrant(env)).resolves.toBeUndefined();
  });
});

describe("getQdrantEnvironment", () => {
  it("derives a local fallback collection when remote embedding keys are absent", () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.QDRANT_COLLECTION;
    delete process.env.QDRANT_VECTOR_SIZE;

    const result = getQdrantEnvironment();

    expect(result.collection).toBe("paper_chunks_local_hash_v1");
    expect(result.vectorSize).toBe(384);
  });
});

describe("ensureQdrantCollection", () => {
  it("adds missing payload indexes for an existing collection", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              config: {
                params: {
                  vectors: { size: 1536, distance: "Cosine" },
                },
              },
              payload_schema: {
                paperId: { data_type: "keyword" },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { acknowledged: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await ensureQdrantCollection(env);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[1][0])).toContain("/collections/paper_chunks/index");
    expect(JSON.parse(calls[1][1]?.body as string)).toEqual({
      field_name: "pageNumber",
      field_schema: "integer",
    });
  });
});
