import { describe, expect, it } from "vitest";

import { MAX_CONCEPT_NAME_LENGTH, MAX_CONCEPTS_PER_INTERACTION } from "@/server/persona";

import { parseExposurePayload } from "./parsePayload";

describe("parseExposurePayload", () => {
  it("rejects non-object bodies", () => {
    expect(() => parseExposurePayload(null)).toThrow(/JSON object/);
    expect(() => parseExposurePayload("string")).toThrow(/JSON object/);
    expect(() => parseExposurePayload([])).toThrow(/JSON object/);
  });

  it("rejects a missing or invalid paperId", () => {
    expect(() => parseExposurePayload({ concepts: [{ concept: "x" }] })).toThrow(
      /paperId is required/,
    );
    expect(() => parseExposurePayload({ paperId: "   ", concepts: [{ concept: "x" }] })).toThrow(
      /paperId is required/,
    );
    expect(() =>
      parseExposurePayload({ paperId: "a".repeat(65), concepts: [{ concept: "x" }] }),
    ).toThrow(/not a valid paper id/);
    expect(() =>
      parseExposurePayload({ paperId: "id with spaces", concepts: [{ concept: "x" }] }),
    ).toThrow(/not a valid paper id/);
    expect(() =>
      parseExposurePayload({ paperId: "<script>", concepts: [{ concept: "x" }] }),
    ).toThrow(/not a valid paper id/);
  });

  it("accepts arXiv-shaped paper ids, including legacy slashed ids", () => {
    for (const paperId of ["1706.03762", "2301.12345v2", "cs/0112017"]) {
      expect(parseExposurePayload({ paperId, concepts: [{ concept: "x" }] }).paperId).toBe(paperId);
    }
  });

  it("rejects an empty or invalid-only concepts array", () => {
    expect(() => parseExposurePayload({ paperId: "1706.03762", concepts: [] })).toThrow(
      /at least one named concept/,
    );
    expect(() =>
      parseExposurePayload({
        paperId: "1706.03762",
        concepts: [null, 42, { concept: "  " }, { notConcept: "x" }],
      }),
    ).toThrow(/at least one named concept/);
    expect(() => parseExposurePayload({ paperId: "1706.03762", concepts: "nope" })).toThrow(
      /must be an array/,
    );
  });

  it("caps the concept count at the shared per-interaction bound", () => {
    const concepts = Array.from({ length: MAX_CONCEPTS_PER_INTERACTION + 6 }, (_, index) => ({
      concept: `concept ${index}`,
    }));

    const payload = parseExposurePayload({ paperId: "1706.03762", concepts });
    expect(payload.concepts).toHaveLength(MAX_CONCEPTS_PER_INTERACTION);
  });

  it("validates before capping so garbage cannot crowd out valid entries", () => {
    const garbage = Array.from({ length: MAX_CONCEPTS_PER_INTERACTION + 4 }, () => null);
    const payload = parseExposurePayload({
      paperId: "1706.03762",
      concepts: [...garbage, { concept: "softmax" }, { concept: "attention" }],
    });

    expect(payload.concepts.map((entry) => entry.concept)).toEqual(["softmax", "attention"]);
  });

  it("bounds concept string lengths", () => {
    const payload = parseExposurePayload({
      paperId: "1706.03762",
      concepts: [
        { concept: "n".repeat(500), domain: "d".repeat(500), description: "x".repeat(2000) },
      ],
    });

    const [entry] = payload.concepts;
    expect(entry.concept.length).toBeLessThanOrEqual(MAX_CONCEPT_NAME_LENGTH);
    expect(entry.domain!.length).toBeLessThanOrEqual(40);
    expect(entry.description!.length).toBeLessThanOrEqual(240);
  });
});
