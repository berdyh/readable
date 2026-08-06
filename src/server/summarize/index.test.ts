import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaperSummaryContext } from "./context";

const mocks = vi.hoisted(() => ({
  generateJson: vi.fn<(request: unknown, options?: { taskName?: string }) => Promise<string>>(),
  loadPaperSummaryContext: vi.fn<() => Promise<PaperSummaryContext>>(),
  fetchPaperCitationsByPaperId: vi.fn(async (): Promise<unknown[]> => []),
  filterIngestedPaperIds: vi.fn(async (): Promise<string[]> => []),
  recordPersonaSignals: vi.fn(async (_args: unknown) => undefined),
  recordConceptGraph: vi.fn(async (_concepts: unknown, _paperId: string, _source?: unknown) => []),
  fetchConceptLedgerForUser: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/server/llm", () => ({
  generateJson: mocks.generateJson,
}));

vi.mock("./context", () => ({
  loadPaperSummaryContext: mocks.loadPaperSummaryContext,
}));

vi.mock("@/server/db", () => ({
  fetchPaperCitationsByPaperId: mocks.fetchPaperCitationsByPaperId,
  filterIngestedPaperIds: mocks.filterIngestedPaperIds,
  fetchConceptLedgerForUser: mocks.fetchConceptLedgerForUser,
}));

vi.mock("@/server/persona", () => ({
  recordPersonaSignals: mocks.recordPersonaSignals,
  recordConceptGraph: mocks.recordConceptGraph,
}));

import { summarizePaper, summarizePaperFromContext } from "./index";

const PAPER_ID = "1706.03762";

const baseContext: PaperSummaryContext = {
  paperId: PAPER_ID,
  metadata: { title: "Attention Is All You Need" },
  sections: [
    {
      id: "S1",
      title: "Introduction",
      paragraphs: ["a"],
      referencedFigureIds: [],
    },
    {
      id: "S2",
      title: "Architecture",
      paragraphs: ["b"],
      referencedFigureIds: ["F1"],
    },
    {
      id: "S3",
      title: "Results",
      paragraphs: ["c"],
      referencedFigureIds: [],
    },
  ],
  figures: [
    { id: "F1", caption: "Architecture diagram", pageNumber: 3, referencedSectionIds: ["S2"] },
  ],
  coverage: { totalParagraphs: 3, includedParagraphs: 3, charBudget: 40000, truncated: false },
};

const contractSection = (id: string, title: string, source = "model_knowledge") => ({
  section_id: id,
  title,
  hook: `Why does ${title} matter?`,
  claim: `${title} claim in plain language.`,
  mechanism: `${title} works like a concrete analogy.`,
  evidence: `Supported by ${id}.`,
  new_terms: [],
  source,
});

const contractPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    sections: [
      contractSection("S1", "Introduction"),
      contractSection("S2", "Architecture"),
      contractSection("S3", "Results"),
    ],
    key_findings: [
      {
        statement: "Finding",
        evidence: "Evidence",
        supporting_sections: ["S3"],
        related_figures: ["F1"],
      },
    ],
    figures: [{ figure_id: "F1", caption_summary: "Arch", insight: "The figure proves X." }],
    concepts: [
      {
        concept: "attention mechanism",
        domain: "ml",
        description: "Weighting of inputs",
        depends_on: ["dot product"],
        confidence: 0.9,
      },
    ],
    ...overrides,
  });

beforeEach(() => {
  mocks.generateJson.mockReset();
  mocks.loadPaperSummaryContext.mockResolvedValue(baseContext);
  mocks.fetchPaperCitationsByPaperId.mockResolvedValue([]);
  mocks.filterIngestedPaperIds.mockResolvedValue([]);
  mocks.recordPersonaSignals.mockClear();
  mocks.recordConceptGraph.mockClear();
  mocks.fetchConceptLedgerForUser.mockResolvedValue([]);
});

describe("summarizePaper — explanation contract", () => {
  it("maps contract fields onto the wire shape (claim→summary, mechanism→reasoning)", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    const result = await summarizePaper(PAPER_ID);

    expect(result.sections).toHaveLength(3);
    const [intro] = result.sections;
    expect(intro.hook).toBe("Why does Introduction matter?");
    expect(intro.summary).toBe("Introduction claim in plain language.");
    expect(intro.reasoning).toBe("Introduction works like a concrete analogy.");
    expect(intro.evidence).toBe("Supported by S1.");
    expect(result.concepts?.[0]).toMatchObject({
      concept: "attention mechanism",
      domain: "ml",
      concept_key: "ml:attention mechanism",
    });
  });

  it("still parses legacy summary/reasoning payloads (old persisted shape)", async () => {
    mocks.generateJson.mockResolvedValue(
      JSON.stringify({
        sections: [
          { section_id: "S1", title: "Introduction", summary: "Old claim", reasoning: "Old why" },
          { section_id: "S2", title: "Architecture", summary: "s", reasoning: "r" },
          { section_id: "S3", title: "Results", summary: "s", reasoning: "r" },
        ],
        key_findings: [
          { statement: "f", evidence: "e", supporting_sections: ["S1"], related_figures: [] },
        ],
        figures: [{ figure_id: "F1", caption_summary: "", insight: "i" }],
        concepts: [],
      }),
    );

    const result = await summarizePaper(PAPER_ID);

    expect(result.sections[0].summary).toBe("Old claim");
    expect(result.sections[0].reasoning).toBe("Old why");
    expect(result.sections[0].hook).toBeUndefined();
  });

  it("downgrades cited_text labels when no citation passages were supplied", async () => {
    mocks.generateJson.mockResolvedValue(
      contractPayload({
        sections: [
          contractSection("S1", "Introduction", "cited_text"),
          contractSection("S2", "Architecture"),
          contractSection("S3", "Results"),
        ],
      }),
    );

    const result = await summarizePaper(PAPER_ID);

    expect(result.sections[0].source).toBe("model_knowledge");
  });

  it("keeps cited_text when the router actually routed citation passages", async () => {
    mocks.fetchPaperCitationsByPaperId.mockResolvedValue([
      {
        citationId: "bib.bib1",
        title: "Obscure Cited Work",
        year: 2019,
        citationCount: 3,
        abstract: "An abstract.",
      },
    ]);
    mocks.generateJson.mockResolvedValue(
      contractPayload({
        sections: [
          contractSection("S1", "Introduction", "cited_text"),
          contractSection("S2", "Architecture"),
          contractSection("S3", "Results"),
        ],
      }),
    );

    const result = await summarizePaper(PAPER_ID);

    expect(result.sections[0].source).toBe("cited_text");
    // The routed citation block made it into the prompt.
    const request = mocks.generateJson.mock.calls[0][0] as { userPrompt: string };
    expect(request.userPrompt).toContain("Retrieved Cited Passages");
    expect(request.userPrompt).toContain("Obscure Cited Work");
  });

  it("injects the persona calibration block into the prompt", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    await summarizePaper(PAPER_ID);

    const request = mocks.generateJson.mock.calls[0][0] as { userPrompt: string };
    expect(request.userPrompt).toContain("# Reader Calibration");
  });

  it("runs ONE bounded grounding pass for low-familiarity terms and relabels them cited_text", async () => {
    mocks.fetchPaperCitationsByPaperId.mockResolvedValue([
      {
        citationId: "bib.bib1",
        title: "Cited Source",
        year: 2019,
        citationCount: 3,
        abstract: "Explains the flux capacitor in detail.",
      },
    ]);

    mocks.generateJson.mockImplementation(async (_request, options) => {
      if (options?.taskName === "term_grounding") {
        return JSON.stringify({
          terms: [
            {
              term: "flux capacitor",
              definition: "A grounded definition from cited text.",
              depends_on: ["capacitance"],
            },
          ],
        });
      }
      return contractPayload({
        sections: [
          {
            ...contractSection("S1", "Introduction"),
            new_terms: [
              { term: "flux capacitor", definition: "model guess", familiarity: "low" },
              { term: "softmax", definition: "well known", familiarity: "high" },
            ],
          },
          contractSection("S2", "Architecture"),
          contractSection("S3", "Results"),
        ],
      });
    });

    const result = await summarizePaper(PAPER_ID);

    // Exactly two LLM calls: the summary + one batched grounding pass.
    expect(mocks.generateJson).toHaveBeenCalledTimes(2);

    const terms = result.sections[0].new_terms ?? [];
    const grounded = terms.find((term) => term.term === "flux capacitor");
    const familiar = terms.find((term) => term.term === "softmax");
    expect(grounded?.definition).toBe("A grounded definition from cited text.");
    expect(grounded?.source).toBe("cited_text");
    expect(familiar?.source).toBeUndefined();

    // Citation-derived edges recorded from the grounding prerequisites.
    // Attributed to the paper being summarized: its bibliography supplied
    // the passages these prerequisites were read out of.
    expect(mocks.recordConceptGraph).toHaveBeenCalledWith(
      [expect.objectContaining({ concept: "flux capacitor", dependsOn: ["capacitance"] })],
      PAPER_ID,
      "citation",
    );
  });

  it("skips the grounding pass when no term is low-familiarity", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    await summarizePaper(PAPER_ID);

    expect(mocks.generateJson).toHaveBeenCalledTimes(1);
  });

  it("records the concept graph but skips the exposure ledger (render-gated)", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    await summarizePaper(PAPER_ID, { userId: "user-1" });
    await vi.waitFor(() => {
      expect(mocks.recordPersonaSignals).toHaveBeenCalled();
    });

    const args = mocks.recordPersonaSignals.mock.calls[0][0] as { skipLedger?: boolean };
    expect(args.skipLedger).toBe(true);
  });

  it("passes the localAgent pin through to generateJson", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    await summarizePaper(PAPER_ID, { localAgent: "claude-code" });

    const options = mocks.generateJson.mock.calls[0][1] as { localAgent?: string };
    expect(options.localAgent).toBe("claude-code");
  });

  it("exposes parsed concepts (with depends_on) through the eval-only onConcepts hook", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());
    const seen: Array<{ concept: string; domain?: string; dependsOn?: string[] }[]> = [];

    await summarizePaperFromContext(baseContext, {
      skipRecording: true,
      onConcepts: (concepts) => {
        seen.push(concepts);
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { concept: "attention mechanism", domain: "ml", dependsOn: ["dot product"] },
    ]);
  });

  it("leaves localAgent undefined when no pin was supplied", async () => {
    mocks.generateJson.mockResolvedValue(contractPayload());

    await summarizePaper(PAPER_ID);

    const options = mocks.generateJson.mock.calls[0][1] as { localAgent?: string };
    expect(options.localAgent).toBeUndefined();
  });
});

describe("summarizePaper — degenerate model output tolerance", () => {
  it("unwraps a double-encoded single-key envelope", async () => {
    // Observed live (deepseek, json_object mode): the entire valid payload
    // arrives stringified inside {".json": "..."} . The parser must unwrap
    // one level instead of reporting "no sections".
    mocks.generateJson.mockResolvedValueOnce(JSON.stringify({ ".json": contractPayload() }));

    const result = await summarizePaper(PAPER_ID);

    expect(result.sections).toHaveLength(3);
    // The wire keeps the legacy field name: claim maps onto `summary`.
    expect(result.sections[0].summary).toContain("Introduction claim");
  });

  it("does not unwrap when the envelope value is not JSON", async () => {
    mocks.generateJson.mockResolvedValueOnce(JSON.stringify({ note: "not a payload" }));

    await expect(summarizePaper(PAPER_ID)).rejects.toThrow(/did not include any sections/);
  });
});
