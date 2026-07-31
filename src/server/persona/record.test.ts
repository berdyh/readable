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

function upsertedConcepts(): Array<{
  conceptKey: string;
  displayName: string;
  description?: string;
}> {
  return mocks.upsertConcepts.mock.calls.flat(2);
}

describe("concept string bounding", () => {
  it("caps name, description, and domain lengths before persisting", async () => {
    await recordConceptGraph([
      {
        concept: "a".repeat(500),
        description: "d".repeat(1000),
        domain: "m".repeat(200),
      },
    ]);

    const [node] = upsertedConcepts();
    expect(node.displayName.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
    expect(node.description?.length).toBeLessThanOrEqual(MAX_CONCEPT_DESCRIPTION_LENGTH);
    const domain = node.conceptKey.slice(0, node.conceptKey.indexOf(":"));
    expect(domain.length).toBeLessThanOrEqual(MAX_CONCEPT_DOMAIN_LENGTH);
  });

  it("strips control characters from model-supplied strings", async () => {
    await recordConceptGraph([
      {
        concept: "atten\u0000tion\u001b[31m mechanism",
        description: "uses\u0007 bell\r\ncharacters",
        domain: "m\u0008l",
      },
    ]);

    const [node] = upsertedConcepts();
    expect(node.displayName).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(node.description).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(node.conceptKey).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("bounds prerequisite stub-node names too", async () => {
    await recordConceptGraph([
      {
        concept: "attention",
        domain: "ml",
        dependsOn: ["p".repeat(500)],
      },
    ]);

    const stub = upsertedConcepts().find((node) => node.displayName.startsWith("p"));
    expect(stub).toBeDefined();
    expect(stub!.displayName.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
  });

  it("drops entries that are empty after sanitization", async () => {
    const keys = await recordConceptGraph([
      { concept: "\u0000\u0001\u0002" },
      { concept: "   " },
      { concept: "softmax", domain: "ml" },
    ]);

    expect(keys).toEqual(["ml:softmax"]);
  });
});

describe("recordExposureSignal", () => {
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
    const keys = await recordConceptGraph([
      { concept: "Attention", domain: "ml" },
      { concept: "Attention" },
    ]);

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
