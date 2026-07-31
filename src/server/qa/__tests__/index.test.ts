import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/qa/context", () => ({
  loadQuestionEvidence: vi.fn(),
}));

vi.mock("@/server/llm", () => ({
  generateJson: vi.fn(),
}));

vi.mock("@/server/persona", () => ({
  recordPersonaSignals: vi.fn().mockResolvedValue(undefined),
}));

import { answerPaperQuestion } from "@/server/qa";
import { loadQuestionEvidence } from "@/server/qa/context";
import { generateJson } from "@/server/llm";
import { recordPersonaSignals } from "@/server/persona";
import type { QuestionEvidenceContext } from "@/server/qa/types";

const mockEvidence = (
  overrides: Partial<QuestionEvidenceContext> = {},
): QuestionEvidenceContext => ({
  paperId: "paper-1",
  query: "test query",
  hits: [
    {
      id: "uuid-hit",
      chunkId: "chunk-1",
      text: "Transformer introduces self-attention mechanism.",
      section: "Introduction",
      pageNumber: 3,
      score: 0.92,
      distance: 0.08,
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
  ...overrides,
});

describe("answerPaperQuestion", () => {
  const mockedEvidence = vi.mocked(loadQuestionEvidence);
  const mockedGenerate = vi.mocked(generateJson);

  it("returns answer and cites from the language model payload", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: "Self-attention lets each token weigh others (page 3).",
        citations: [{ chunk_id: "chunk-1", page: 3, quote: "Self-attention mechanism" }],
      }),
    );

    const result = await answerPaperQuestion("paper-1", "What is self-attention?");

    expect(mockedEvidence).toHaveBeenCalledWith("paper-1", "What is self-attention?", {});
    expect(mockedGenerate).toHaveBeenCalledOnce();
    expect(result).toEqual({
      answer: "Self-attention lets each token weigh others (page 3).",
      cites: [
        {
          chunkId: "chunk-1",
          page: 3,
          quote: "Self-attention mechanism",
          sourceAvailable: true,
        },
      ],
      trust: {
        status: "sourced",
        hasEvidence: true,
        validCitationCount: 1,
        invalidCitationCount: 0,
        warnings: [],
        retrieval: {
          vector: { status: "ok", hitCount: 1 },
          text: { status: "ok", hitCount: 1 },
        },
      },
      // No routed citation passages were supplied, so any cited_text
      // claim would have been downgraded; absent labels default here.
      source: "model_knowledge",
    });
  });

  it("downgrades a cited_text label when no citation passages were routed", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: "An answer claiming cited text.",
        citations: [],
        source: "cited_text",
      }),
    );

    const result = await answerPaperQuestion("paper-1", "What is self-attention?");

    expect(result.source).toBe("model_knowledge");
  });

  it("keeps cited_text when the router routed citation passages into the prompt", async () => {
    mockedEvidence.mockResolvedValue(
      mockEvidence({
        citations: [
          {
            citationId: "bib.bib7",
            title: "An Obscure Cited Work",
            year: 2020,
            citationCount: 2,
            abstract: "Retrieved abstract text.",
          },
        ],
      }),
    );
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: "Grounded in the cited work.",
        citations: [],
        source: "cited_text",
      }),
    );

    const result = await answerPaperQuestion("paper-1", "What does the cited paper say?");

    expect(result.source).toBe("cited_text");
    const request = mockedGenerate.mock.calls.at(-1)?.[0] as { userPrompt: string };
    expect(request.userPrompt).toContain("Retrieved Cited Passages");
    expect(request.userPrompt).toContain("An Obscure Cited Work");
  });

  it("marks retrieved answers as uncited when citations array is empty", async () => {
    const evidence = mockEvidence({
      hits: [
        {
          id: "uuid-hit",
          chunkId: "chunk-2",
          text: "The encoder uses multi-head attention.",
          section: "Model",
          pageNumber: 4,
          score: 0.88,
          distance: 0.12,
          citations: [],
          figureIds: [],
        },
      ],
    });

    mockedEvidence.mockResolvedValue(evidence);
    mockedGenerate.mockResolvedValue(
      JSON.stringify({ answer: "The encoder stacks multi-head attention layers (page 4)." }),
    );

    const result = await answerPaperQuestion("paper-1", "How does the encoder operate?");

    expect(result.cites).toEqual([]);
    expect(result.trust.status).toBe("uncited");
    expect(result.trust.validCitationCount).toBe(0);
    expect(result.trust.warnings).toContain(
      "The answer used retrieved evidence but has no valid source citation.",
    );
  });

  it("drops citations that do not match current evidence", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: "The model uses self-attention.",
        citations: [{ chunk_id: "not-a-current-chunk", page: 3, quote: "Self-attention" }],
      }),
    );

    const result = await answerPaperQuestion("paper-1", "What does the model use?");

    expect(result.cites).toEqual([]);
    expect(result.trust).toMatchObject({
      status: "uncited",
      validCitationCount: 0,
      invalidCitationCount: 1,
    });
    expect(result.trust.warnings).toContain(
      "Some model citations did not match current paper evidence.",
    );
  });

  it("marks answers as refused when no paper evidence is retrieved", async () => {
    mockedEvidence.mockResolvedValue(
      mockEvidence({
        hits: [],
        expandedWindow: [],
        retrieval: {
          vector: { status: "search_failed", hitCount: 0, reason: "vector_search_failed" },
          text: { status: "empty", hitCount: 0 },
        },
      }),
    );
    mockedGenerate.mockResolvedValue(
      JSON.stringify({ answer: "The paper does not provide evidence for that question." }),
    );

    const result = await answerPaperQuestion("paper-1", "What about an unrelated claim?");

    expect(result.cites).toEqual([]);
    expect(result.trust.status).toBe("refused");
    expect(result.trust.hasEvidence).toBe(false);
    expect(result.trust.retrieval.vector.status).toBe("search_failed");
  });

  it("plumbs the model's concept domain through to persona recording", async () => {
    const mockedRecord = vi.mocked(recordPersonaSignals);
    mockedRecord.mockClear();
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: "Attention weighs tokens.",
        citations: [],
        concepts: [
          { concept: "attention", description: null, domain: "ml" },
          { concept: "softmax", description: "normalizes scores", domain: null },
        ],
      }),
    );

    await answerPaperQuestion("paper-1", "What is attention?", { userId: "user-1" });

    await vi.waitFor(() => expect(mockedRecord).toHaveBeenCalledOnce());
    const args = mockedRecord.mock.calls[0][0];
    expect(args.concepts).toEqual([
      { concept: "attention", description: undefined, domain: "ml" },
      { concept: "softmax", description: "normalizes scores", domain: undefined },
    ]);
  });

  it("does not duplicate the ask-overrides-known policy inline (system prompt owns it)", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(JSON.stringify({ answer: "An answer.", citations: [] }));

    await answerPaperQuestion("paper-1", "What is self-attention?");

    const request = mockedGenerate.mock.calls.at(-1)?.[0] as { userPrompt: string };
    expect(request.userPrompt).not.toContain("Policy: an explicit question always overrides");
  });

  it("throws when the OpenAI payload cannot be parsed", async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue("not-json");

    await expect(answerPaperQuestion("paper-1", "Explain positional encodings")).rejects.toThrow(
      /Failed to parse OpenAI QA response JSON/,
    );
  });
});
