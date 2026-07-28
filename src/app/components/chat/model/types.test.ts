import { describe, expect, it } from "vitest";

import type { ChatCitation, WireChatMessage } from "./types";
import { fromWireMessage, toSource, toPersistedMessage } from "./types";

const wireTrust = {
  status: "sourced" as const,
  hasEvidence: true,
  validCitationCount: 2,
  invalidCitationCount: 0,
  warnings: [],
  retrieval: {
    vector: { status: "ok" as const, hitCount: 4 },
    text: { status: "ok" as const, hitCount: 3 },
  },
};

function wireMessage(overrides: Partial<WireChatMessage> = {}): WireChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "An answer.",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("toSource", () => {
  it("keeps a chunk citation navigable", () => {
    expect(toSource({ chunkId: "c1", page: 4, quote: "a quote" })).toEqual({
      chunkId: "c1",
      page: 4,
      quote: "a quote",
    });
  });

  it("prefers the chunk id even when title metadata is also present", () => {
    expect(toSource({ chunkId: "c1", title: "Paper", url: "https://example.com" })).toEqual({
      chunkId: "c1",
      page: undefined,
      quote: undefined,
    });
  });

  it("falls back to the url as both id and title when only a url is present", () => {
    expect(toSource({ url: "https://example.com/p" })).toEqual({
      id: "https://example.com/p",
      title: "https://example.com/p",
      url: "https://example.com/p",
      page: undefined,
    });
  });

  it("drops a citation the UI cannot render rather than showing a blank row", () => {
    // The history endpoint accepts any citation carrying at least one field, so
    // a quote-only entry is valid on the wire but has nothing to render.
    expect(toSource({ quote: "orphaned quote" })).toBeUndefined();
    expect(toSource({ page: 7 })).toBeUndefined();
  });
});

describe("fromWireMessage", () => {
  it("lifts metadata.trust to the top level for rendering", () => {
    const message = fromWireMessage(wireMessage({ metadata: { version: 1, trust: wireTrust } }));

    expect(message.trust).toEqual(wireTrust);
    expect(message.metadata?.trust).toEqual(wireTrust);
  });

  it("leaves trust undefined when the wire message carries no metadata", () => {
    expect(fromWireMessage(wireMessage()).trust).toBeUndefined();
  });

  it("keeps renderable citations and discards the rest", () => {
    const citations: ChatCitation[] = [
      { chunkId: "c1", page: 2 },
      { quote: "orphaned" },
      { title: "A paper", url: "https://example.com" },
    ];

    const message = fromWireMessage(wireMessage({ citations }));

    expect(message.citations).toHaveLength(2);
    expect(message.citations?.[0]).toMatchObject({ chunkId: "c1" });
    expect(message.citations?.[1]).toMatchObject({ title: "A paper" });
  });

  it("omits citations entirely when none survive", () => {
    const message = fromWireMessage(wireMessage({ citations: [{ quote: "orphaned" }] }));

    expect(message.citations).toBeUndefined();
  });

  it("carries the wire-owned fields through unchanged", () => {
    const message = fromWireMessage(
      wireMessage({ id: "m9", role: "user", content: "Why?", reasoning: "because" }),
    );

    expect(message).toMatchObject({
      id: "m9",
      role: "user",
      content: "Why?",
      reasoning: "because",
      createdAt: 1_700_000_000_000,
    });
  });
});

describe("toPersistedMessage", () => {
  it("mirrors an assistant's trust down into metadata so the row round-trips", () => {
    const persisted = toPersistedMessage({
      id: "m1",
      role: "assistant",
      content: "An answer.",
      createdAt: 1,
      trust: wireTrust,
    });

    expect(persisted.metadata).toEqual({ version: 1, trust: wireTrust });
  });

  it("leaves existing metadata alone", () => {
    const metadata = { version: 1 as const, trust: wireTrust };
    const persisted = toPersistedMessage({
      id: "m1",
      role: "assistant",
      content: "An answer.",
      createdAt: 1,
      metadata,
      trust: { status: "uncited" },
    });

    expect(persisted.metadata).toBe(metadata);
  });

  it("does not fabricate metadata for a user message", () => {
    const persisted = toPersistedMessage({
      id: "m1",
      role: "user",
      content: "Why?",
      createdAt: 1,
      trust: wireTrust,
    });

    expect(persisted.metadata).toBeUndefined();
  });
});
