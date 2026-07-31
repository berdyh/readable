import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessageRecord } from "@/server/db/types";

import {
  InvalidChatPayloadError,
  boundedJsonByteLength,
  isObjectRecord,
  legacyAssistantMetadata,
  parseChatMessage,
  parseChatMetadata,
  parseCitations,
  parsePersistedChatMetadata,
  sanitizeCount,
  sanitizeReason,
  sanitizeWarnings,
  toApiMessage,
} from "./messages";

function validTrustMetadata() {
  return {
    version: 1 as const,
    trust: {
      status: "sourced",
      hasEvidence: true,
      validCitationCount: 1,
      invalidCitationCount: 0,
      warnings: [] as string[],
      retrieval: {
        vector: { status: "ok", hitCount: 3 },
        text: { status: "ok", hitCount: 2 },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isObjectRecord", () => {
  it("accepts plain objects", () => {
    expect(isObjectRecord({})).toBe(true);
    expect(isObjectRecord({ a: 1 })).toBe(true);
  });

  it("rejects arrays, null, and primitives", () => {
    expect(isObjectRecord([])).toBe(false);
    expect(isObjectRecord(null)).toBe(false);
    expect(isObjectRecord(undefined)).toBe(false);
    expect(isObjectRecord("x")).toBe(false);
    expect(isObjectRecord(0)).toBe(false);
  });
});

describe("boundedJsonByteLength", () => {
  it("measures UTF-8 bytes of the JSON encoding, not characters", () => {
    expect(boundedJsonByteLength({ a: "b" })).toBe(9);
    // "é" is two UTF-8 bytes, so it costs more than its single character.
    expect(boundedJsonByteLength("é")).toBe(4);
  });
});

describe("sanitizeCount", () => {
  it("floors positive finite numbers", () => {
    expect(sanitizeCount(2.8)).toBe(2);
    expect(sanitizeCount(0)).toBe(0);
  });

  it("clamps negatives, non-numbers, and non-finite values to 0", () => {
    expect(sanitizeCount(-4)).toBe(0);
    expect(sanitizeCount(Number.NaN)).toBe(0);
    expect(sanitizeCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sanitizeCount("5")).toBe(0);
    expect(sanitizeCount(undefined)).toBe(0);
  });

  it("caps at the metadata count ceiling", () => {
    expect(sanitizeCount(10_001)).toBe(10_000);
    expect(sanitizeCount(1e9)).toBe(10_000);
  });
});

describe("sanitizeWarnings", () => {
  it("returns an empty array for non-arrays", () => {
    expect(sanitizeWarnings(undefined)).toEqual([]);
    expect(sanitizeWarnings("warn")).toEqual([]);
  });

  it("trims, drops empties and non-strings", () => {
    expect(sanitizeWarnings([" one ", "", "   ", 5, null, "two"])).toEqual(["one", "two"]);
  });

  it("keeps at most 8 warnings and truncates each to 240 chars", () => {
    const warnings = sanitizeWarnings([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "x".repeat(300),
    ]);
    expect(warnings).toHaveLength(8);
    expect(warnings).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);

    const [long] = sanitizeWarnings(["x".repeat(300)]);
    expect(long).toBe("x".repeat(240));
  });
});

describe("sanitizeReason", () => {
  it("returns undefined for non-strings and blank strings", () => {
    expect(sanitizeReason(undefined)).toBeUndefined();
    expect(sanitizeReason(42)).toBeUndefined();
    expect(sanitizeReason("   ")).toBeUndefined();
  });

  it("trims and truncates to 500 chars", () => {
    expect(sanitizeReason("  why  ")).toBe("why");
    expect(sanitizeReason("y".repeat(900))).toBe("y".repeat(500));
  });
});

describe("parseChatMetadata", () => {
  it("rejects non-objects", () => {
    expect(() => parseChatMetadata("nope")).toThrow(InvalidChatPayloadError);
    expect(() => parseChatMetadata([])).toThrow("Chat message metadata must be an object.");
  });

  it("rejects payloads over 8 KiB", () => {
    const oversized = validTrustMetadata();
    oversized.trust.warnings = ["x".repeat(9000)];
    expect(() => parseChatMetadata(oversized)).toThrow("Chat message metadata is too large.");
  });

  it("rejects unsupported versions but allows an omitted version", () => {
    expect(() => parseChatMetadata({ ...validTrustMetadata(), version: 2 })).toThrow(
      "Chat message metadata version is unsupported.",
    );

    const withoutVersion: Record<string, unknown> = validTrustMetadata();
    delete withoutVersion.version;
    expect(parseChatMetadata(withoutVersion).version).toBe(1);
  });

  it("rejects a missing or non-object trust block", () => {
    expect(() => parseChatMetadata({ version: 1 })).toThrow(
      "Chat message metadata trust must be an object.",
    );
  });

  it("falls back to unknown for unrecognized statuses", () => {
    const parsed = parseChatMetadata({
      version: 1,
      trust: {
        status: "hacked",
        retrieval: {
          vector: { status: "hacked" },
          text: { status: "hacked" },
        },
      },
    });

    expect(parsed.trust.status).toBe("unknown");
    expect(parsed.trust.retrieval.vector.status).toBe("unknown");
    expect(parsed.trust.retrieval.text.status).toBe("unknown");
  });

  it("defaults a missing retrieval block to unknown/zero", () => {
    const parsed = parseChatMetadata({ version: 1, trust: { status: "refused" } });

    expect(parsed).toEqual({
      version: 1,
      trust: {
        status: "refused",
        hasEvidence: false,
        validCitationCount: 0,
        invalidCitationCount: 0,
        warnings: [],
        retrieval: {
          vector: { status: "unknown", hitCount: 0, reason: undefined },
          text: { status: "unknown", hitCount: 0 },
        },
      },
    });
  });

  it("drops unknown keys and coerces hasEvidence to a strict boolean", () => {
    const parsed = parseChatMetadata({
      version: 1,
      token: "drop-me",
      trust: {
        status: "sourced",
        hasEvidence: "yes",
        secret: "drop-me",
        retrieval: {
          vector: { status: "ok", hitCount: 1, apiKey: "drop-me" },
          text: { status: "ok", hitCount: 1 },
        },
      },
    });

    expect(parsed.trust.hasEvidence).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("drop-me");
  });

  it("keeps a persisted cited_text source label", () => {
    const metadata = validTrustMetadata();
    const parsed = parseChatMetadata({
      ...metadata,
      trust: { ...metadata.trust, source: "cited_text" },
    });

    expect(parsed.trust.source).toBe("cited_text");
  });

  it("keeps model_knowledge and drops unknown or non-string source labels", () => {
    const metadata = validTrustMetadata();

    const known = parseChatMetadata({
      ...metadata,
      trust: { ...metadata.trust, source: "model_knowledge" },
    });
    expect(known.trust.source).toBe("model_knowledge");

    for (const invalid of ["hallucinated", 42, { label: "cited_text" }, null]) {
      const parsed = parseChatMetadata({
        ...metadata,
        trust: { ...metadata.trust, source: invalid },
      });
      expect(parsed.trust.source).toBeUndefined();
    }
  });

  it("round-trips source through the persisted-row path", () => {
    const metadata = validTrustMetadata();

    const kept = parsePersistedChatMetadata(
      { ...metadata, trust: { ...metadata.trust, source: "cited_text" } },
      "assistant",
    );
    expect(kept?.trust.source).toBe("cited_text");

    const dropped = parsePersistedChatMetadata(
      { ...metadata, trust: { ...metadata.trust, source: "hallucinated" } },
      "assistant",
    );
    expect(dropped?.trust.source).toBeUndefined();
  });
});

describe("legacyAssistantMetadata", () => {
  it("describes trust as unavailable with a legacy_message reason", () => {
    expect(legacyAssistantMetadata()).toEqual({
      version: 1,
      trust: {
        status: "unavailable",
        hasEvidence: false,
        validCitationCount: 0,
        invalidCitationCount: 0,
        warnings: ["Answer trust metadata was not captured for this legacy message."],
        retrieval: {
          vector: { status: "unavailable", hitCount: 0, reason: "legacy_message" },
          text: { status: "unavailable", hitCount: 0 },
        },
      },
    });
  });
});

describe("parsePersistedChatMetadata", () => {
  it("returns undefined for user messages regardless of stored value", () => {
    expect(parsePersistedChatMetadata(validTrustMetadata(), "user")).toBeUndefined();
    expect(parsePersistedChatMetadata(undefined, "user")).toBeUndefined();
  });

  it("returns legacy metadata for assistant rows with no stored metadata", () => {
    expect(parsePersistedChatMetadata(undefined, "assistant")).toEqual(legacyAssistantMetadata());
    expect(parsePersistedChatMetadata(null, "assistant")).toEqual(legacyAssistantMetadata());
  });

  it("returns legacy metadata instead of throwing on corrupt stored metadata", () => {
    expect(parsePersistedChatMetadata("corrupt", "assistant")).toEqual(legacyAssistantMetadata());
    expect(parsePersistedChatMetadata({ version: 9 }, "assistant")).toEqual(
      legacyAssistantMetadata(),
    );
  });

  it("passes valid stored metadata through the sanitizer", () => {
    expect(parsePersistedChatMetadata(validTrustMetadata(), "assistant")).toEqual({
      version: 1,
      trust: {
        status: "sourced",
        hasEvidence: true,
        validCitationCount: 1,
        invalidCitationCount: 0,
        warnings: [],
        retrieval: {
          vector: { status: "ok", hitCount: 3, reason: undefined },
          text: { status: "ok", hitCount: 2 },
        },
      },
    });
  });
});

describe("parseCitations", () => {
  it("returns undefined when citations are absent", () => {
    expect(parseCitations(undefined)).toBeUndefined();
  });

  it("rejects non-arrays and non-object entries", () => {
    expect(() => parseCitations(null)).toThrow("Chat message citations must be an array.");
    expect(() => parseCitations(["not-a-citation"])).toThrow(
      "Chat message citation entries must be objects.",
    );
  });

  it("keeps only known string fields, trimmed, plus a finite page", () => {
    expect(
      parseCitations([
        {
          id: " c1 ",
          title: " Title ",
          url: " https://example.com ",
          chunkId: " chunk-1 ",
          quote: " cited text ",
          page: 2,
          ignored: "drop me",
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        title: "Title",
        url: "https://example.com",
        chunkId: "chunk-1",
        quote: "cited text",
        page: 2,
      },
    ]);
  });

  it("drops blank strings and non-finite pages", () => {
    expect(parseCitations([{ id: "c1", title: "   ", page: Number.NaN }])).toEqual([{ id: "c1" }]);
  });

  it("rejects entries that carry no recognizable metadata", () => {
    expect(() => parseCitations([{ ignored: "drop me" }])).toThrow(
      "Chat message citation entries must include citation metadata.",
    );
  });

  it("accepts an empty array", () => {
    expect(parseCitations([])).toEqual([]);
  });
});

describe("parseChatMessage", () => {
  it("rejects non-objects", () => {
    expect(() => parseChatMessage("msg")).toThrow("Chat message must be an object.");
    expect(() => parseChatMessage(null)).toThrow(InvalidChatPayloadError);
  });

  it("requires a trimmed id, a valid role, and non-empty content", () => {
    expect(() => parseChatMessage({ role: "user", content: "hi" })).toThrow(
      "Chat message id is required.",
    );
    expect(() => parseChatMessage({ id: "m1", role: "system", content: "hi" })).toThrow(
      'Chat message role must be "user" or "assistant".',
    );
    expect(() => parseChatMessage({ id: "m1", role: "user", content: "   " })).toThrow(
      "Chat message content is required.",
    );
  });

  it("trims id, content, and reasoning", () => {
    const message = parseChatMessage({
      id: " m1 ",
      role: "user",
      content: " hello ",
      reasoning: " because ",
      createdAt: 5,
    });

    expect(message).toEqual({
      id: "m1",
      role: "user",
      content: "hello",
      citations: undefined,
      reasoning: "because",
      createdAt: 5,
    });
  });

  it("defaults createdAt to now when missing or non-finite", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const now = Date.now();

    expect(parseChatMessage({ id: "m1", role: "user", content: "hi" }).createdAt).toBe(now);
    expect(
      parseChatMessage({ id: "m1", role: "user", content: "hi", createdAt: Number.NaN }).createdAt,
    ).toBe(now);
  });

  it("ignores metadata on user messages and parses it on assistant messages", () => {
    const userMessage = parseChatMessage({
      id: "m1",
      role: "user",
      content: "hi",
      metadata: validTrustMetadata(),
      createdAt: 1,
    });
    expect(userMessage.metadata).toBeUndefined();

    const assistantMessage = parseChatMessage({
      id: "m2",
      role: "assistant",
      content: "answer",
      metadata: validTrustMetadata(),
      createdAt: 1,
    });
    expect(assistantMessage.metadata?.trust.status).toBe("sourced");
  });

  it("propagates citation and metadata validation failures", () => {
    expect(() =>
      parseChatMessage({ id: "m1", role: "user", content: "hi", citations: "nope" }),
    ).toThrow("Chat message citations must be an array.");

    expect(() =>
      parseChatMessage({ id: "m1", role: "assistant", content: "hi", metadata: "nope" }),
    ).toThrow("Chat message metadata must be an object.");
  });

  it("drops unknown top-level fields", () => {
    const message = parseChatMessage({
      id: "m1",
      role: "user",
      content: "hi",
      createdAt: 1,
      token: "drop-me",
    });

    expect(message).not.toHaveProperty("token");
  });
});

describe("toApiMessage", () => {
  it("maps a persisted assistant record, backfilling legacy metadata", () => {
    const record: ChatMessageRecord = {
      id: "m1",
      role: "assistant",
      content: "answer",
      createdAt: 1,
    };

    expect(toApiMessage(record)).toEqual({
      id: "m1",
      role: "assistant",
      content: "answer",
      citations: undefined,
      reasoning: undefined,
      metadata: legacyAssistantMetadata(),
      createdAt: 1,
    });
  });

  it("omits metadata for user records and sanitizes stored citations", () => {
    const record = {
      id: "m2",
      role: "user",
      content: "question",
      citations: [{ chunkId: " chunk-1 ", page: 3, ignored: "drop me" }],
      reasoning: "kept as-is",
      metadata: validTrustMetadata(),
      createdAt: 2,
    } as unknown as ChatMessageRecord;

    expect(toApiMessage(record)).toEqual({
      id: "m2",
      role: "user",
      content: "question",
      citations: [{ chunkId: "chunk-1", page: 3 }],
      reasoning: "kept as-is",
      metadata: undefined,
      createdAt: 2,
    });
  });

  it("throws on unparseable stored citations", () => {
    const record = {
      id: "m3",
      role: "assistant",
      content: "answer",
      citations: ["not-a-citation"],
      createdAt: 3,
    } as unknown as ChatMessageRecord;

    expect(() => toApiMessage(record)).toThrow(InvalidChatPayloadError);
  });
});
