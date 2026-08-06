import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordConceptSignal: vi.fn(),
  upsertConceptEdges: vi.fn(),
  upsertConcepts: vi.fn(),
  upsertInteractions: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  recordConceptSignal: mocks.recordConceptSignal,
  upsertConceptEdges: mocks.upsertConceptEdges,
  upsertConcepts: mocks.upsertConcepts,
  upsertInteractions: mocks.upsertInteractions,
}));

import {
  MAX_CONCEPT_DESCRIPTION_LENGTH,
  MAX_CONCEPT_DOMAIN_LENGTH,
  MAX_CONCEPT_NAME_LENGTH,
  MAX_CONCEPTS_PER_INTERACTION,
  recordConceptGraph,
  recordExposureSignal,
  recordPersonaSignals,
} from "./record";

beforeEach(() => {
  mocks.recordConceptSignal.mockReset().mockResolvedValue(undefined);
  mocks.upsertConceptEdges.mockReset().mockResolvedValue(undefined);
  mocks.upsertConcepts.mockReset().mockResolvedValue(undefined);
  mocks.upsertInteractions.mockReset().mockResolvedValue(undefined);
});

const PAPER_ID = "1706.03762";

function upsertedConcepts(): Array<{
  conceptKey: string;
  displayName: string;
  description?: string;
}> {
  // Only the first argument is the node list; the second is the paper id.
  return mocks.upsertConcepts.mock.calls.flatMap((call) => call[0]);
}

function upsertedEdges<T>(): T[] {
  return mocks.upsertConceptEdges.mock.calls.flatMap((call) => call[0]);
}

describe("concept string bounding", () => {
  it("caps name, description, and domain lengths before persisting", async () => {
    await recordConceptGraph(
      [
        {
          concept: "a".repeat(500),
          description: "d".repeat(1000),
          domain: "m".repeat(200),
        },
      ],
      PAPER_ID,
    );

    const [node] = upsertedConcepts();
    expect(node.displayName.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
    expect(node.description?.length).toBeLessThanOrEqual(MAX_CONCEPT_DESCRIPTION_LENGTH);
    const domain = node.conceptKey.slice(0, node.conceptKey.indexOf(":"));
    expect(domain.length).toBeLessThanOrEqual(MAX_CONCEPT_DOMAIN_LENGTH);
  });

  it("strips control characters from model-supplied strings", async () => {
    await recordConceptGraph(
      [
        {
          concept: "atten\u0000tion\u001b[31m mechanism",
          description: "uses\u0007 bell\r\ncharacters",
          domain: "m\u0008l",
        },
      ],
      PAPER_ID,
    );

    const [node] = upsertedConcepts();
    expect(node.displayName).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(node.description).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(node.conceptKey).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("bounds prerequisite stub-node names too", async () => {
    await recordConceptGraph(
      [
        {
          concept: "attention",
          domain: "ml",
          dependsOn: ["p".repeat(500)],
        },
      ],
      PAPER_ID,
    );

    const stub = upsertedConcepts().find((node) => node.displayName.startsWith("p"));
    expect(stub).toBeDefined();
    expect(stub!.displayName.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
  });

  it("drops entries that are empty after sanitization", async () => {
    const keys = await recordConceptGraph(
      [{ concept: "\u0000\u0001\u0002" }, { concept: "   " }, { concept: "softmax", domain: "ml" }],
      PAPER_ID,
    );

    expect(keys).toEqual(["ml:softmax"]);
  });
});

describe("recordConceptGraph", () => {
  it("dedupes concepts that normalize to the same key", async () => {
    const keys = await recordConceptGraph(
      [
        { concept: "Attention Mechanisms", domain: "ml" },
        { concept: "attention mechanism", domain: "ml" },
        { concept: "softmax", domain: "ml" },
      ],
      PAPER_ID,
    );

    expect(keys).toEqual(["ml:attention mechanism", "ml:softmax"]);
    expect(upsertedConcepts()).toHaveLength(2);
  });

  it("resolves prefixed prerequisites to their own domain and unprefixed to the parent's", async () => {
    await recordConceptGraph(
      [
        {
          concept: "transformer",
          domain: "ml",
          dependsOn: ["statistics:softmax", "attention"],
          confidence: 0.9,
        },
      ],
      PAPER_ID,
    );

    const edges = upsertedEdges<{
      fromKey: string;
      toKey: string;
      relation: string;
      confidence?: number;
      source: string;
    }>();
    expect(edges.map((edge) => edge.toKey)).toEqual(["statistics:softmax", "ml:attention"]);
    expect(edges.every((edge) => edge.fromKey === "ml:transformer")).toBe(true);
    expect(edges.every((edge) => edge.relation === "depends_on")).toBe(true);
    expect(edges.every((edge) => edge.confidence === 0.9)).toBe(true);
  });

  it("creates stub nodes for prerequisite-only concepts so the FK holds", async () => {
    await recordConceptGraph(
      [{ concept: "transformer", domain: "ml", dependsOn: ["positional encoding"] }],
      PAPER_ID,
    );

    const nodes = upsertedConcepts();
    expect(nodes.map((node) => node.conceptKey)).toEqual([
      "ml:transformer",
      "ml:positional encoding",
    ]);
    const stub = nodes[1];
    expect(stub.displayName).toBe("positional encoding");
    expect(stub.description).toBeUndefined();
  });

  it("skips self-edges", async () => {
    await recordConceptGraph(
      [{ concept: "attention", domain: "ml", dependsOn: ["Attention", "softmax"] }],
      PAPER_ID,
    );

    const edges = upsertedEdges<{ toKey: string }>();
    expect(edges.map((edge) => edge.toKey)).toEqual(["ml:softmax"]);
  });

  it("tags edges with the caller's provenance", async () => {
    await recordConceptGraph(
      [{ concept: "attention", domain: "ml", dependsOn: ["softmax"] }],
      PAPER_ID,
      "citation",
    );

    const edges = upsertedEdges<{ source: string }>();
    expect(edges[0].source).toBe("citation");
  });

  it("passes the source paper to both graph writes, stub nodes included", async () => {
    await recordConceptGraph(
      [{ concept: "transformer", domain: "ml", dependsOn: ["positional encoding"] }],
      PAPER_ID,
    );

    // One call each, so every node written here — including the
    // prerequisite stub — carries the same provenance.
    expect(mocks.upsertConcepts).toHaveBeenCalledOnce();
    expect(mocks.upsertConcepts.mock.calls[0][1]).toBe(PAPER_ID);
    expect(mocks.upsertConceptEdges).toHaveBeenCalledOnce();
    expect(mocks.upsertConceptEdges.mock.calls[0][1]).toBe(PAPER_ID);
  });
});

describe("recordExposureSignal", () => {
  it("is a no-op for anonymous readers", async () => {
    await recordExposureSignal({
      paperId: "1706.03762",
      concepts: [{ concept: "attention", domain: "ml" }],
    });
    await recordExposureSignal({
      userId: "   ",
      paperId: "1706.03762",
      concepts: [{ concept: "attention", domain: "ml" }],
    });

    expect(mocks.recordConceptSignal).not.toHaveBeenCalled();
  });

  it("applies the same bounds on the exposure path", async () => {
    await recordExposureSignal({
      userId: "user-1",
      paperId: "1706.03762",
      concepts: [{ concept: "x".repeat(300), description: "y".repeat(600) }],
    });

    const [args] = mocks.recordConceptSignal.mock.calls[0];
    expect(args.concepts[0].displayName.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
    expect(args.concepts[0].description.length).toBeLessThanOrEqual(MAX_CONCEPT_DESCRIPTION_LENGTH);
  });
});

describe("concept key domains", () => {
  it("lands domain-tagged concepts under domain:name keys, defaulting to general", async () => {
    const keys = await recordConceptGraph(
      [{ concept: "Attention", domain: "ml" }, { concept: "Attention" }],
      PAPER_ID,
    );

    expect(keys).toEqual(["ml:attention", "general:attention"]);
  });
});

describe("recordPersonaSignals concept cap", () => {
  it("persists at most MAX_CONCEPTS_PER_INTERACTION concepts", async () => {
    const concepts = Array.from({ length: MAX_CONCEPTS_PER_INTERACTION + 4 }, (_, index) => ({
      concept: `concept ${index}`,
      domain: "ml",
    }));

    await recordPersonaSignals({
      userId: "user-1",
      paperId: "1706.03762",
      interactionType: "qa",
      prompt: "prompt",
      response: "response",
      chunkIds: [],
      concepts,
    });

    expect(upsertedConcepts()).toHaveLength(MAX_CONCEPTS_PER_INTERACTION);
    const [interaction] = mocks.upsertInteractions.mock.calls[0][0];
    expect(interaction.personaConceptIds).toHaveLength(MAX_CONCEPTS_PER_INTERACTION);
  });
});

describe("recordPersonaSignals ledger behavior", () => {
  const baseArgs = {
    userId: "user-1",
    paperId: PAPER_ID,
    prompt: "prompt",
    response: "response",
    chunkIds: ["chunk-1"],
    concepts: [{ concept: "attention", domain: "ml" }],
  };

  it("records graph only (no ledger, no interaction) for anonymous users", async () => {
    await recordPersonaSignals({
      ...baseArgs,
      userId: undefined,
      interactionType: "qa",
    });

    expect(mocks.upsertConcepts).toHaveBeenCalledOnce();
    // Provenance is paper-derived, so it is recorded even with no user.
    expect(mocks.upsertConcepts.mock.calls[0][1]).toBe(PAPER_ID);
    expect(mocks.recordConceptSignal).not.toHaveBeenCalled();
    expect(mocks.upsertInteractions).not.toHaveBeenCalled();
  });

  it("skipLedger suppresses the mastery-ledger write but not the interaction log", async () => {
    await recordPersonaSignals({
      ...baseArgs,
      interactionType: "summarize",
      skipLedger: true,
    });

    expect(mocks.recordConceptSignal).not.toHaveBeenCalled();
    expect(mocks.upsertInteractions).toHaveBeenCalledOnce();
  });

  it("writes a typed ledger signal for the interaction type when not skipped", async () => {
    await recordPersonaSignals({
      ...baseArgs,
      interactionType: "qa",
    });

    expect(mocks.recordConceptSignal).toHaveBeenCalledOnce();
    const [args] = mocks.recordConceptSignal.mock.calls[0];
    expect(args.signal).toBe("qa_asked");
    expect(args.concepts[0].conceptKey).toBe("ml:attention");
    expect(mocks.upsertInteractions).toHaveBeenCalledOnce();
  });
});
