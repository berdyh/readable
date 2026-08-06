import { describe, expect, it, vi } from "vitest";

import type { QuestionEvidenceContext, QuestionSelection } from "@/server/qa/types";

vi.mock("@/server/qa", () => ({
  loadQuestionEvidence: vi.fn(),
  parseQuestionSelection: vi.fn((selection: QuestionSelection) => selection),
}));

vi.mock("@/server/llm", () => ({
  generateJson: vi.fn(),
}));

vi.mock("@/server/persona", () => ({
  recordPersonaSignals: vi.fn().mockResolvedValue(undefined),
}));

import { loadQuestionEvidence } from "@/server/qa";
import { generateJson } from "@/server/llm";
import { recordPersonaSignals } from "@/server/persona";

import { summarizeSelection } from "./selection";

const mockEvidence = (): QuestionEvidenceContext => ({
  paperId: "paper-1",
  query: "highlighted passage",
  hits: [
    {
      id: "uuid-hit",
      chunkId: "chunk-1",
      text: "Self-attention weighs every token against every other token.",
      section: "Model",
      pageNumber: 3,
      score: 0.9,
      distance: 0.1,
      citations: [],
      figureIds: [],
    },
  ],
  expandedWindow: [],
  figures: [],
  citations: [],
  retrieval: {
    vector: { status: "ok", hitCount: 1 },
    text: { status: "ok", hitCount: 1 },
  },
  selection: undefined,
});

const validPayload = {
  bullets: [{ text: "It weighs tokens.", citation_ids: ["chunk-1"] }],
  more: ["Deeper nuance."],
  citations: [{ chunk_id: "chunk-1", page: 3, quote: "Self-attention weighs" }],
  concepts: [],
};

const selection: QuestionSelection = { text: "self-attention weighs every token" };

describe("summarizeSelection", () => {
  const mockedEvidence = vi.mocked(loadQuestionEvidence);
  const mockedGenerate = vi.mocked(generateJson);
  const mockedRecord = vi.mocked(recordPersonaSignals);

  it("injects the persona calibration block into the prompt", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(JSON.stringify(validPayload));

    await summarizeSelection("paper-1", selection, { userId: "user-1" });

    const request = mockedGenerate.mock.calls.at(-1)?.[0] as { userPrompt: string };
    expect(request.userPrompt).toContain("# Reader Calibration");
  });

  it("records selection_summary persona signals fire-and-forget", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(JSON.stringify(validPayload));

    const result = await summarizeSelection("paper-1", selection, { userId: "user-1" });

    expect(result.callout.bullets).toHaveLength(1);
    await vi.waitFor(() => expect(mockedRecord).toHaveBeenCalled());
    const args = mockedRecord.mock.calls.at(-1)![0];
    expect(args.interactionType).toBe("selection_summary");
    expect(args.userId).toBe("user-1");
    expect(args.paperId).toBe("paper-1");
    expect(args.chunkIds).toEqual(["chunk-1"]);
  });

  it("never fails the callout when persona recording rejects", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(JSON.stringify(validPayload));
    mockedRecord.mockRejectedValueOnce(new Error("persona store down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await summarizeSelection("paper-1", selection, { userId: "user-1" });
      expect(result.callout.bullets).toHaveLength(1);
      // Let the rejected fire-and-forget promise settle through its catch.
      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("failed to persist selection persona signals"),
          expect.any(Error),
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("trims concepts and drops empty ones before recording", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        ...validPayload,
        concepts: [
          { concept: "  attention  ", description: "  weighing tokens  ", domain: " ml " },
          { concept: "   ", description: "no name" },
          { concept: "softmax", description: null },
        ],
      }),
    );

    await summarizeSelection("paper-1", selection, { userId: "user-1" });

    await vi.waitFor(() => expect(mockedRecord).toHaveBeenCalled());
    const args = mockedRecord.mock.calls.at(-1)![0];
    expect(args.concepts).toEqual([
      { concept: "attention", description: "weighing tokens", domain: "ml" },
      { concept: "softmax", description: undefined, domain: undefined },
    ]);
  });
});
