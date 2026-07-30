import { loadQuestionEvidence } from "./context";
import { generateJson } from "@/server/llm";
import { recordPersonaSignals } from "@/server/persona";
import { listIngestedPaperIds } from "@/server/db";
import {
  SOURCE_LABEL_INSTRUCTIONS,
  SOURCE_LABEL_SCHEMA,
  loadPersonaSplit,
  renderPersonaBlock,
  renderRoutedCitationContext,
  routeCitations,
  validateSourceLabel,
  type CitationCandidate,
} from "@/server/explain";
import type {
  AnswerCitation,
  AnswerResult,
  AnswerTrustMetadata,
  QaChunkContext,
  QaRetrievalDiagnostics,
  QuestionEvidenceContext,
  QuestionOptions,
} from "./types";

import { getSystemPrompt } from "@/server/llm-config";
import { truncateSafely, truncateWithEllipsis } from "@/server/text";

const QA_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citations", "concepts", "source"],
  properties: {
    answer: {
      type: "string",
      minLength: 1,
    },
    source: SOURCE_LABEL_SCHEMA,
    citations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chunk_id", "page", "quote"],
        properties: {
          chunk_id: { type: "string", minLength: 1 },
          page: { type: "integer", minimum: 1 },
          quote: { type: "string" },
        },
      },
    },
    concepts: {
      type: "array",
      maxItems: 6,
      description:
        'Concepts the reader was exposed to while answering. Names should be terse domain phrases (e.g. "attention mechanism", "Bayesian inference"). Drawn only from the paper or its cited prerequisites — do not invent.',
      items: {
        type: "object",
        additionalProperties: false,
        // Both fields are required so OpenAI's strict json_schema mode
        // accepts the schema, but description is nullable — non-strict
        // providers (Anthropic / Gemini / OpenRouter free) often omit
        // descriptions when none is meaningful. The parser drops nulls.
        required: ["concept", "description"],
        properties: {
          concept: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 240 },
        },
      },
    },
  },
};

interface LlmCitationPayload {
  chunk_id: string;
  page: number;
  quote: string;
}

interface LlmConceptPayload {
  concept: string;
  description?: string;
}

interface LlmQaPayload {
  answer?: string;
  citations?: LlmCitationPayload[];
  concepts?: LlmConceptPayload[];
  source?: string;
}

function truncateText(text: string, maxLength = 600): string {
  if (text.length <= maxLength) {
    return text;
  }

  return truncateWithEllipsis(text, maxLength);
}

/** Page label rendered only when real page data exists — never "page ?". */
function formatPage(page?: number): string | undefined {
  if (typeof page === "number" && Number.isFinite(page) && page > 0) {
    return `page ${page}`;
  }
  return undefined;
}

function formatChunk(chunk: QaChunkContext, index: number, label: string): string {
  const meta = [
    formatPage(chunk.pageNumber),
    chunk.section ? `section: ${chunk.section}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const header = `${label} ${index + 1}: chunk_id=${chunk.chunkId}${meta ? ` (${meta})` : ""}`;
  const body = truncateText(chunk.text.replace(/\s+/g, " ").trim(), 700);
  return `${header}\n${body}`;
}

/**
 * Extract citations from LLM response, ignoring LLM-provided page numbers.
 * We only extract chunkId and quote here - page numbers will come from chunk data.
 */
function formatCitations(
  citations: LlmCitationPayload[],
): Array<{ chunkId: string; quote?: string }> {
  const results: Array<{ chunkId: string; quote?: string }> = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    if (!citation || typeof citation.chunk_id !== "string") {
      continue;
    }

    const chunkId = citation.chunk_id.trim();
    if (!chunkId || seen.has(chunkId)) {
      continue;
    }

    const quote =
      typeof citation.quote === "string" && citation.quote.trim()
        ? citation.quote.trim()
        : undefined;

    results.push({
      chunkId,
      quote,
    });
    seen.add(chunkId);
  }

  return results;
}

/**
 * Enrich citations with page numbers from chunk data.
 * Always uses chunk page numbers - never trusts LLM-provided page numbers.
 */
function enrichCitationsWithChunkData(
  citations: Array<{ chunkId: string; quote?: string }>,
  evidence: QuestionEvidenceContext,
): {
  citations: AnswerCitation[];
  invalidCitationCount: number;
} {
  const enriched: AnswerCitation[] = [];
  let invalidCitationCount = 0;

  for (const citation of citations) {
    // Find the chunk in evidence to get the actual page number
    const chunk =
      evidence.hits.find((hit) => hit.chunkId === citation.chunkId) ??
      evidence.expandedWindow.find((hit) => hit.chunkId === citation.chunkId);

    if (!chunk) {
      invalidCitationCount += 1;
      continue;
    }

    // Always use chunk page number if available, otherwise undefined
    const page =
      typeof chunk.pageNumber === "number" && chunk.pageNumber >= 1 ? chunk.pageNumber : undefined;

    // Use chunk text as quote if no quote provided
    const quote = citation.quote || truncateSafely(chunk.text, 240).trim() || undefined;

    enriched.push({
      chunkId: citation.chunkId,
      page,
      quote,
      sourceAvailable: true,
    });
  }

  return {
    citations: enriched,
    invalidCitationCount,
  };
}

function buildTrustMetadata(
  citations: AnswerCitation[],
  invalidCitationCount: number,
  evidence: QuestionEvidenceContext,
): AnswerTrustMetadata {
  const hasEvidence = evidence.hits.length > 0 || evidence.expandedWindow.length > 0;
  const warnings: string[] = [];
  const retrieval: QaRetrievalDiagnostics = evidence.retrieval ?? {
    vector: { status: "skipped", hitCount: 0, reason: "legacy_evidence_context" },
    text: {
      status: hasEvidence ? "ok" : "empty",
      hitCount: evidence.hits.length + evidence.expandedWindow.length,
    },
  };

  if (invalidCitationCount > 0) {
    warnings.push("Some model citations did not match current paper evidence.");
  }

  if (retrieval.vector.status !== "ok") {
    warnings.push("Vector retrieval was degraded; answer used available text evidence.");
  }

  const status = citations.length > 0 ? "sourced" : hasEvidence ? "uncited" : "refused";

  if (status === "uncited") {
    warnings.push("The answer used retrieved evidence but has no valid source citation.");
  }

  if (status === "refused") {
    warnings.push("No matching paper evidence was retrieved for this question.");
  }

  return {
    status,
    hasEvidence,
    validCitationCount: citations.length,
    invalidCitationCount,
    warnings,
    retrieval,
  };
}

interface QaPromptBlocks {
  personaBlock: string;
  citationBlock?: string;
}

function buildQaUserPrompt(
  question: string,
  evidence: QuestionEvidenceContext,
  blocks: QaPromptBlocks,
): string {
  const lines: string[] = [];

  lines.push(`Paper ID: ${evidence.paperId}`);
  lines.push(`Question: ${question.trim()}`);
  lines.push("");
  lines.push(blocks.personaBlock);
  lines.push(
    "Policy: an explicit question always overrides the known list — if the user asks about something they supposedly know, explain it fully.",
  );

  if (evidence.selection) {
    const parts: string[] = [];
    if (evidence.selection.text) {
      parts.push(`“${truncateText(evidence.selection.text, 360)}”`);
    }
    if (typeof evidence.selection.page === "number") {
      parts.push(`page ${evidence.selection.page}`);
    }
    if (evidence.selection.section) {
      parts.push(`section ${evidence.selection.section}`);
    }
    if (parts.length) {
      lines.push(`User selection context: ${parts.join(" · ")}`);
    }
  }

  if (evidence.hits.length) {
    lines.push("\nPrimary evidence chunks:");
    evidence.hits.slice(0, 6).forEach((chunk, index) => {
      lines.push(formatChunk(chunk, index, "Hit"));
    });
  } else {
    lines.push("\nNo direct evidence chunks retrieved.");
  }

  if (evidence.expandedWindow.length) {
    lines.push("\nNeighboring context:");
    evidence.expandedWindow.slice(0, 6).forEach((chunk, index) => {
      lines.push(formatChunk(chunk, index, "Window"));
    });
  }

  if (evidence.figures.length) {
    lines.push("\nReferenced figures:");
    evidence.figures.forEach((figure) => {
      const caption = truncateText(figure.caption, 360);
      const page = formatPage(figure.pageNumber);
      lines.push(`- ${figure.figureId}${page ? ` (${page})` : ""}: ${caption}`);
    });
  }

  // Routed citations only (the four-trigger router decided). The old
  // always-on "cited background" dump is gone — citation metadata is
  // router metadata, not default prompt filler.
  if (blocks.citationBlock) {
    lines.push("");
    lines.push(blocks.citationBlock);
  }

  lines.push("");
  lines.push(`Source rules: ${SOURCE_LABEL_INSTRUCTIONS}`);

  lines.push(
    '\nInstructions: Use the evidence above to answer the question. Reference specific chunk_ids and include page numbers in the answer (e.g., "(page 4)") only when the evidence shows a real page number. If the evidence is insufficient, respond that the paper does not address the question. After answering, list up to 6 *concepts* (terse domain phrases — never names of people, never paper titles) that the reader was exposed to while resolving this question. Return JSON that matches the provided schema.',
  );

  return lines.join("\n");
}

function parseLlmPayload(raw: string): LlmQaPayload {
  try {
    return JSON.parse(raw) as LlmQaPayload;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : "Unknown parsing error.";
    throw new Error(`Failed to parse OpenAI QA response JSON: ${reason}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function loadIngestedIdsSafe(): Promise<string[]> {
  try {
    return await listIngestedPaperIds();
  } catch {
    return [];
  }
}

export async function answerPaperQuestion(
  paperId: string,
  question: string,
  options: QuestionOptions = {},
): Promise<AnswerResult> {
  const [evidence, personaSplit, ingestedIds] = await Promise.all([
    loadQuestionEvidence(paperId, question, options),
    loadPersonaSplit(options.userId),
    loadIngestedIdsSafe(),
  ]);

  const citationCandidates: CitationCandidate[] = evidence.citations.map((citation) => ({
    citationId: citation.citationId,
    title: citation.title,
    year: citation.year,
    citationCount: citation.citationCount,
    arxivId: citation.arxivId,
    abstract: citation.abstract,
  }));

  const decisions = routeCitations({
    question,
    candidates: citationCandidates,
    ingestedPaperIds: ingestedIds,
  });
  const citationBlock = renderRoutedCitationContext(citationCandidates, decisions);

  const systemPrompt = getSystemPrompt("qa");
  const userPrompt = buildQaUserPrompt(question, evidence, {
    personaBlock: renderPersonaBlock(personaSplit),
    citationBlock,
  });

  const raw = await generateJson(
    {
      systemPrompt,
      userPrompt,
      schema: QA_RESPONSE_SCHEMA,
    },
    {
      taskName: "qa",
      temperature: 0.2,
      localAgent: options.localAgent,
    },
  );

  const payload = parseLlmPayload(raw);

  const answer = payload.answer?.trim();
  if (!answer) {
    throw new Error("OpenAI QA response missing answer text.");
  }

  const citationsPayload = Array.isArray(payload.citations) ? payload.citations : [];

  // Extract citations (chunkId and quote only - ignoring LLM page numbers)
  const rawCitations = formatCitations(citationsPayload);

  // Always enrich with actual page numbers from chunk data. Unknown model
  // citation IDs are dropped instead of fabricated into source rows.
  const { citations, invalidCitationCount } = enrichCitationsWithChunkData(rawCitations, evidence);
  const trust = buildTrustMetadata(citations, invalidCitationCount, evidence);

  // Persona writes — fire and forget so we never block the answer on
  // disk I/O. A failure here is just a missed skill update.
  void recordPersonaSignals({
    userId: options.userId,
    paperId,
    interactionType: "qa",
    prompt: question,
    response: answer,
    chunkIds: citations.map((c) => c.chunkId),
    concepts: payload.concepts ?? [],
  }).catch((error) => {
    console.warn("[qa] failed to persist persona signals:", error);
  });

  return {
    answer,
    cites: citations,
    trust,
    // Server-validated: cited_text survives only when the router actually
    // supplied retrieved citation passages for this answer.
    source: validateSourceLabel(payload.source, Boolean(citationBlock)),
  };
}

/**
 * Public surface of the qa module.
 *
 * `answerPaperQuestion()` above is the main entry point. These two are also
 * public because the editor's selection actions and the `/api/qa` route need to
 * parse a selection and load evidence without answering a question.
 */
export { loadQuestionEvidence } from "./context";
export { parseQuestionSelection } from "./selection";
export type * from "./types";
