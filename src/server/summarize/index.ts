import { loadPaperSummaryContext, type PaperSummaryContext } from "./context";
import { generateJson } from "@/server/llm";
import { recordConceptGraph, recordPersonaSignals } from "@/server/persona";
import { fetchPaperCitationsByPaperId, listIngestedPaperIds, type Citation } from "@/server/db";
import {
  SOURCE_LABEL_INSTRUCTIONS,
  SOURCE_LABEL_SCHEMA,
  buildConceptKey,
  loadPersonaSplit,
  renderPersonaBlock,
  renderRoutedCitationContext,
  routeCitations,
  selectGroundingTerms,
  validateSourceLabel,
  type CitationCandidate,
  type PersonaSplit,
} from "@/server/explain";
import type {
  PageSpan,
  SummaryConcept,
  SummaryFigure,
  SummaryKeyFinding,
  SummaryResult,
  SummarySection,
  SummaryTerm,
} from "./types";

import { getSystemPrompt, getPaperSummaryRequirements, getPromptLimits } from "@/server/llm-config";
import { truncateWithEllipsis } from "@/server/text";

const PROMPT_LIMITS = getPromptLimits();
const PROMPT_FIGURE_LIMIT = PROMPT_LIMITS.figure;

/**
 * The explanation contract (decision 1A): every section is a teaching
 * unit — hook → plain-language claim → mechanism (analogy when new) →
 * evidence pointer → glossary of new terms with self-reported
 * familiarity — plus a validated source label. Output stays 3–6
 * aggregated sections; the output budget lives in the task requirements
 * (prompt) and the maxLength bounds here.
 */
const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["sections", "key_findings", "figures", "concepts"],
  properties: {
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "section_id",
          "title",
          "hook",
          "claim",
          "mechanism",
          "evidence",
          "new_terms",
          "source",
        ],
        properties: {
          section_id: { type: "string" },
          title: { type: "string" },
          hook: {
            type: "string",
            maxLength: 400,
            description:
              "The motivating question or problem this section answers, in 1-2 sentences.",
          },
          claim: {
            type: "string",
            maxLength: 900,
            description: "The section's core claim in plain language a newcomer can follow.",
          },
          mechanism: {
            type: "string",
            maxLength: 2000,
            description:
              "How it actually works. Concrete example or analogy FIRST for anything new to the reader, then the general form.",
          },
          evidence: {
            type: "string",
            maxLength: 600,
            description:
              "What in the paper supports the claim — reference section IDs (S3) and figure IDs (F2).",
          },
          new_terms: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["term", "definition", "familiarity"],
              properties: {
                term: { type: "string", minLength: 1, maxLength: 80 },
                definition: { type: "string", maxLength: 320 },
                familiarity: {
                  type: "string",
                  enum: ["high", "low"],
                  description:
                    'Your honest familiarity with this term/work: "low" if you are not confident you know it well.',
                },
              },
            },
          },
          source: SOURCE_LABEL_SCHEMA,
        },
      },
    },
    key_findings: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "evidence", "supporting_sections", "related_figures"],
        properties: {
          statement: { type: "string" },
          evidence: { type: "string" },
          supporting_sections: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string" },
          },
          related_figures: {
            type: "array",
            maxItems: 3,
            items: { type: "string" },
          },
        },
      },
    },
    figures: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["figure_id", "caption_summary", "insight"],
        properties: {
          figure_id: { type: "string" },
          caption_summary: { type: "string" },
          insight: {
            type: "string",
            description: "Declarative takeaway: what the figure PROVES or shows.",
          },
        },
      },
    },
    concepts: {
      type: "array",
      maxItems: 8,
      description:
        'Concepts the reader was exposed to. Names are terse domain phrases (e.g. "attention mechanism") — never people or paper titles. Drawn only from the paper.',
      items: {
        type: "object",
        additionalProperties: false,
        // description is nullable so non-strict providers can omit it
        // without violating the contract. The parser drops nulls.
        required: ["concept", "domain", "description", "depends_on", "confidence"],
        properties: {
          concept: { type: "string", minLength: 1, maxLength: 80 },
          domain: {
            type: "string",
            maxLength: 40,
            description: 'Short field name, e.g. "ml", "nlp", "statistics".',
          },
          description: { type: ["string", "null"], maxLength: 240 },
          depends_on: {
            type: "array",
            maxItems: 4,
            items: { type: "string", maxLength: 80 },
            description: "Prerequisite concept names a reader should know first.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence in the depends_on edges.",
          },
        },
      },
    },
  },
};

/** Bounded second-pass grounding call (router trigger 4). */
const TERM_GROUNDING_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["terms"],
  properties: {
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition", "depends_on"],
        properties: {
          term: { type: "string", minLength: 1, maxLength: 80 },
          definition: {
            type: ["string", "null"],
            maxLength: 320,
            description:
              "Grounded plain-language definition, or null when the passages do not cover the term.",
          },
          depends_on: {
            type: "array",
            maxItems: 3,
            items: { type: "string", maxLength: 80 },
          },
        },
      },
    },
  },
};

interface LlmTerm {
  term: string;
  definition: string;
  familiarity?: "high" | "low";
}

interface LlmSection {
  section_id: string;
  title: string;
  hook?: string;
  claim: string;
  mechanism: string;
  evidence?: string;
  new_terms: LlmTerm[];
  source?: string;
}

interface LlmKeyFinding {
  statement: string;
  evidence: string;
  supporting_sections: string[];
  related_figures: string[];
}

interface LlmFigure {
  figure_id: string;
  caption_summary: string;
  insight: string;
}

interface LlmConcept {
  concept: string;
  domain?: string;
  description?: string;
  depends_on?: string[];
  confidence?: number;
}

interface LlmSummaryPayload {
  sections: LlmSection[];
  key_findings: LlmKeyFinding[];
  figures: LlmFigure[];
  concepts: LlmConcept[];
}

interface SummarizeOptions {
  userId?: string;
  /** Pin the LLM call to a specific local coding agent (the chat picker's choice). */
  localAgent?: string;
}

function truncateText(text: string, maxLength = PROMPT_LIMITS.text_truncate): string {
  if (text.length <= maxLength) {
    return text;
  }

  return truncateWithEllipsis(text, maxLength);
}

/**
 * Renders a page span only when real page data exists. The ar5iv ingest
 * path stores no page numbers, and rendering "(page ?)" on every section
 * taught the model to echo unusable anchors — so unknown pages are now
 * simply omitted.
 */
function formatPageSpan(span: PageSpan | undefined): string | undefined {
  const start = span?.start;
  const end = span?.end;

  if (typeof start === "number" && typeof end === "number") {
    if (start === end) {
      return `page ${start}`;
    }
    return `pages ${start}-${end}`;
  }

  if (typeof start === "number") {
    return `page ${start}`;
  }

  if (typeof end === "number") {
    return `page ${end}`;
  }

  return undefined;
}

function formatPageAnchorFromSpan(span: PageSpan | undefined): string | undefined {
  const page = span?.start ?? span?.end;
  if (typeof page === "number" && Number.isFinite(page) && page > 0) {
    return `(page ${page})`;
  }
  return undefined;
}

function formatPageAnchor(page?: number): string | undefined {
  if (typeof page === "number" && Number.isFinite(page) && page > 0) {
    return `(page ${page})`;
  }
  return undefined;
}

function buildSectionOutlinePrompt(
  sections: Array<{
    id: string;
    title: string;
    pageSpan?: PageSpan;
    paragraphs: string[];
    referencedFigureIds: string[];
  }>,
): string {
  // No section cap and no per-section paragraph cap: the coverage +
  // deepening fill in context.ts already selected content under the char
  // budget. Slicing here is what used to drop the paper's back half.
  return sections
    .map((section) => {
      const pageLabel = formatPageSpan(section.pageSpan);
      const header = `- [${section.id}] ${section.title}${pageLabel ? ` (${pageLabel})` : ""}`;
      const figuresLine = section.referencedFigureIds.length
        ? `    Figures: ${section.referencedFigureIds.join(", ")}`
        : undefined;

      const highlights = section.paragraphs.map(
        (paragraph, index) => `    Para ${index + 1}: ${paragraph}`,
      );

      return [header, figuresLine, ...highlights].filter(Boolean).join("\n");
    })
    .join("\n");
}

function buildFigureContextPrompt(
  figures: Array<{
    id: string;
    caption?: string;
    pageNumber?: number;
    referencedSectionIds: string[];
  }>,
): string {
  if (!figures.length) {
    return "No figures were extracted for this paper.";
  }

  // Captions + section references only. The old "Context N" lines were
  // verbatim copies of section paragraphs already present in the outline.
  return figures
    .slice(0, PROMPT_FIGURE_LIMIT)
    .map((figure) => {
      const pageAnchor = formatPageAnchor(figure.pageNumber);
      const header = `- [${figure.id}] ${truncateText(
        figure.caption ?? "No caption available",
        PROMPT_LIMITS.figure_caption_truncate,
      )}${pageAnchor ? ` ${pageAnchor}` : ""}`;
      const sectionsLine = figure.referencedSectionIds.length
        ? `    Sections: ${figure.referencedSectionIds.join(", ")}`
        : undefined;

      return [header, sectionsLine].filter(Boolean).join("\n");
    })
    .join("\n");
}

function buildMetadataPrompt(metadata?: {
  title?: string;
  authors?: string[];
  abstract?: string;
  primaryCategory?: string;
  publishedAt?: string;
  updatedAt?: string;
}): string {
  if (!metadata) {
    return "Paper metadata unavailable (fallback to section content).";
  }

  const parts: string[] = [];

  if (metadata.title) {
    parts.push(`Title: ${metadata.title}`);
  }
  if (metadata.authors?.length) {
    parts.push(`Authors: ${metadata.authors.join(", ")}`);
  }
  if (metadata.primaryCategory) {
    parts.push(`Primary field: ${metadata.primaryCategory}`);
  }
  if (metadata.publishedAt) {
    parts.push(`Published: ${metadata.publishedAt}`);
  }
  if (metadata.updatedAt && metadata.updatedAt !== metadata.publishedAt) {
    parts.push(`Updated: ${metadata.updatedAt}`);
  }
  if (metadata.abstract) {
    parts.push(`Abstract: ${truncateText(metadata.abstract, PROMPT_LIMITS.abstract_truncate)}`);
  }

  return parts.join("\n");
}

interface SummaryPromptBlocks {
  personaBlock: string;
  citationBlock?: string;
}

function buildUserPrompt(
  context: Awaited<ReturnType<typeof loadPaperSummaryContext>>,
  blocks: SummaryPromptBlocks,
): string {
  const metadataBlock = buildMetadataPrompt(context.metadata);
  const sectionOutline = buildSectionOutlinePrompt(context.sections);
  const figureOutline = buildFigureContextPrompt(context.figures);

  const requirements = getPaperSummaryRequirements();

  return [
    `Paper ID: ${context.paperId}`,
    "",
    blocks.personaBlock,
    "",
    "# Metadata",
    metadataBlock,
    "",
    "# Section Outline",
    ...(context.coverage.truncationNote ? [`(${context.coverage.truncationNote})`] : []),
    sectionOutline,
    "",
    "# Figure Context",
    figureOutline,
    ...(blocks.citationBlock ? ["", blocks.citationBlock] : []),
    "",
    "# Source Rules",
    SOURCE_LABEL_INSTRUCTIONS,
    "",
    "# Task Requirements",
    requirements.map((line) => `- ${line}`).join("\n"),
  ].join("\n");
}

function extractJsonPayload(content: string): unknown {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1] : trimmed;
  return JSON.parse(jsonText);
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function coerceTerms(input: unknown): LlmTerm[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const terms: LlmTerm[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const term = coerceString(record.term);
    const definition = coerceString(record.definition);
    if (!term || !definition) {
      continue;
    }
    const familiarity = record.familiarity === "low" ? "low" : "high";
    terms.push({ term, definition, familiarity });
  }
  return terms.slice(0, 5);
}

function coerceSections(input: unknown): LlmSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const sections: LlmSection[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const sectionId = coerceString(record.section_id);
    // Contract fields with legacy aliases: older persisted payloads (and
    // models that regress to the old shape) used summary/reasoning.
    const claim = coerceString(record.claim) ?? coerceString(record.summary);
    const mechanism = coerceString(record.mechanism) ?? coerceString(record.reasoning);

    if (!sectionId || !claim || !mechanism) {
      continue;
    }

    const title = coerceString(record.title) ?? sectionId;

    sections.push({
      section_id: sectionId,
      title,
      hook: coerceString(record.hook),
      claim,
      mechanism,
      evidence: coerceString(record.evidence),
      new_terms: coerceTerms(record.new_terms),
      source: coerceString(record.source),
    });
  }

  return sections;
}

function coerceKeyFindings(input: unknown): LlmKeyFinding[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const findings: LlmKeyFinding[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const statement = coerceString(record.statement);
    const evidence = coerceString(record.evidence);

    const supportingSectionsRaw = record.supporting_sections;
    const supportingSections = Array.isArray(supportingSectionsRaw)
      ? supportingSectionsRaw
          .map((item) => (typeof item === "string" ? item.trim() : undefined))
          .filter((item): item is string => Boolean(item))
          .slice(0, 4)
      : [];

    if (!statement || !evidence || !supportingSections.length) {
      continue;
    }

    const relatedFiguresRaw = record.related_figures;
    const relatedFigures = Array.isArray(relatedFiguresRaw)
      ? relatedFiguresRaw
          .map((item) => (typeof item === "string" ? item.trim() : undefined))
          .filter((item): item is string => Boolean(item))
          .slice(0, 3)
      : [];

    findings.push({
      statement,
      evidence,
      supporting_sections: supportingSections,
      related_figures: relatedFigures,
    });
  }

  return findings;
}

function coerceFigures(input: unknown): LlmFigure[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const figures: LlmFigure[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const figureId = coerceString(record.figure_id);
    const insight = coerceString(record.insight);

    if (!figureId || !insight) {
      continue;
    }

    const caption = coerceString(record.caption_summary) ?? "";

    figures.push({
      figure_id: figureId,
      caption_summary: caption,
      insight,
    });
  }

  return figures;
}

function coerceConcepts(input: unknown): LlmConcept[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const concepts: LlmConcept[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const concept = coerceString(record.concept);
    if (!concept) continue;

    const dependsOnRaw = record.depends_on;
    const dependsOn = Array.isArray(dependsOnRaw)
      ? dependsOnRaw
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 4)
      : [];

    concepts.push({
      concept,
      domain: coerceString(record.domain),
      description: coerceString(record.description),
      depends_on: dependsOn,
      confidence:
        typeof record.confidence === "number" && Number.isFinite(record.confidence)
          ? Math.min(1, Math.max(0, record.confidence))
          : undefined,
    });
  }
  return concepts.slice(0, 8);
}

function parseModelSummary(rawContent: string): LlmSummaryPayload {
  const payload = extractJsonPayload(rawContent) as Record<string, unknown>;
  const sections = coerceSections(payload.sections);
  const keyFindings = coerceKeyFindings(payload.key_findings);
  const figures = coerceFigures(payload.figures);
  const concepts = coerceConcepts(payload.concepts);

  if (sections.length < 1) {
    throw new Error("Model response did not include any sections.");
  }

  return {
    sections,
    key_findings: keyFindings,
    figures,
    concepts,
  };
}

function postProcessSummary(
  llmSummary: LlmSummaryPayload,
  context: Awaited<ReturnType<typeof loadPaperSummaryContext>>,
  hasRetrievedCitationEvidence: boolean,
): SummaryResult {
  const sectionOrder = new Map<string, number>();
  const sectionContext = new Map(
    context.sections.map((section, index) => {
      sectionOrder.set(section.id, index);
      return [section.id, section];
    }),
  );

  const figureContext = new Map(context.figures.map((figure) => [figure.id, figure]));

  const sections: SummarySection[] = llmSummary.sections
    .map((section) => {
      const source = sectionContext.get(section.section_id);
      const pageSpan = source?.pageSpan;

      const newTerms: SummaryTerm[] = section.new_terms.map((term) => ({
        term: term.term,
        definition: term.definition,
        familiarity: term.familiarity,
      }));

      return {
        section_id: section.section_id,
        title: section.title || source?.title || section.section_id,
        // summary/reasoning stay populated (claim/mechanism) so older
        // clients and persisted summaries keep rendering.
        summary: section.claim,
        reasoning: section.mechanism,
        hook: section.hook,
        evidence: section.evidence,
        new_terms: newTerms.length ? newTerms : undefined,
        // Server-validated: cited_text survives only when retrieved
        // citation passages were actually supplied to the model.
        source: validateSourceLabel(section.source, hasRetrievedCitationEvidence),
        key_points: undefined,
        page_span: pageSpan,
        page_anchor: formatPageAnchorFromSpan(pageSpan),
      };
    })
    .sort((a, b) => {
      const indexA = sectionOrder.get(a.section_id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = sectionOrder.get(b.section_id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });

  if (sections.length < 3 && context.sections.length >= 3) {
    throw new Error("Model response returned fewer than three sections.");
  }

  const keyFindings: SummaryKeyFinding[] = llmSummary.key_findings.map((finding) => {
    const anchorSet = new Set<string>();

    finding.supporting_sections.forEach((sectionId) => {
      const span = sectionContext.get(sectionId)?.pageSpan;
      const anchor = formatPageAnchorFromSpan(span);
      if (anchor) {
        anchorSet.add(anchor);
      }
    });

    (finding.related_figures ?? []).forEach((figureId) => {
      const pageAnchor = formatPageAnchor(figureContext.get(figureId)?.pageNumber);
      if (pageAnchor) {
        anchorSet.add(pageAnchor);
      }
    });

    return {
      statement: finding.statement,
      evidence: finding.evidence,
      supporting_sections: finding.supporting_sections,
      related_figures: finding.related_figures,
      page_anchors: Array.from(anchorSet),
    };
  });

  const mappedFigures: SummaryFigure[] = [];

  llmSummary.figures.forEach((figure) => {
    const source = figureContext.get(figure.figure_id);

    if (!source) {
      return;
    }

    mappedFigures.push({
      figure_id: figure.figure_id,
      caption: figure.caption_summary || source.caption,
      insight: figure.insight,
      page_anchor: formatPageAnchor(source.pageNumber),
    });
  });

  let figures: SummaryFigure[] = mappedFigures;

  if (!figures.length && context.figures.length) {
    const fallback = context.figures[0];
    figures = [
      {
        figure_id: fallback.id,
        caption: fallback.caption,
        insight: "Figure referenced in the paper; review the caption for context.",
        page_anchor: formatPageAnchor(fallback.pageNumber),
      },
    ];
  }

  const concepts: SummaryConcept[] = llmSummary.concepts.map((concept) => ({
    concept: concept.concept,
    domain: concept.domain,
    description: concept.description,
    concept_key: buildConceptKey(concept.concept, concept.domain),
  }));

  return {
    sections,
    key_findings: keyFindings,
    figures,
    concepts: concepts.length ? concepts : undefined,
  };
}

/** Loads citation candidates from Postgres only (S2 hygiene). */
async function loadCitationCandidates(paperId: string): Promise<CitationCandidate[]> {
  try {
    const citations: Citation[] = await fetchPaperCitationsByPaperId(paperId);
    return citations.map((citation) => ({
      citationId: citation.citationId,
      title: citation.title,
      year: citation.year,
      citationCount: citation.citationCount,
      arxivId: citation.arxivId,
      abstract: citation.abstract,
    }));
  } catch (error) {
    console.warn(`[summarize] Failed to load citations for ${paperId}:`, error);
    return [];
  }
}

async function loadIngestedIdsSafe(): Promise<string[]> {
  try {
    return await listIngestedPaperIds();
  } catch {
    return [];
  }
}

interface GroundedTerm {
  term: string;
  definition?: string;
  dependsOn: string[];
}

function parseGroundingPayload(raw: string): GroundedTerm[] {
  const payload = extractJsonPayload(raw) as { terms?: unknown };
  if (!Array.isArray(payload.terms)) {
    return [];
  }

  const terms: GroundedTerm[] = [];
  for (const entry of payload.terms) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const term = coerceString(record.term);
    if (!term) continue;
    const dependsOn = Array.isArray(record.depends_on)
      ? record.depends_on
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    terms.push({ term, definition: coerceString(record.definition), dependsOn });
  }
  return terms;
}

/**
 * Router trigger 4: ONE bounded second-pass grounding call for the
 * low-familiarity glossary terms, batched per response. Grounded
 * definitions are relabeled cited_text; prerequisite pairs from the
 * grounding become citation-derived edges. Best-effort — any failure
 * keeps the original definitions.
 */
async function groundLowFamiliarityTerms(
  result: SummaryResult,
  candidates: CitationCandidate[],
  primaryDomain: string | undefined,
  options: SummarizeOptions,
): Promise<void> {
  const allTerms = result.sections.flatMap((section) => section.new_terms ?? []);
  const groundingTerms = selectGroundingTerms(
    allTerms.map((term) => ({ term: term.term, familiarity: term.familiarity ?? "high" })),
  );
  if (groundingTerms.length === 0) {
    return;
  }

  const withAbstracts = candidates.filter((candidate) => candidate.abstract);
  if (withAbstracts.length === 0) {
    return;
  }

  const passages = withAbstracts
    .slice(0, 8)
    .map(
      (candidate) =>
        `- [${candidate.citationId}] ${candidate.title ?? "Untitled"}${candidate.year ? ` (${candidate.year})` : ""}\n  ${truncateText((candidate.abstract ?? "").replace(/\s+/g, " "), 480)}`,
    )
    .join("\n");

  const userPrompt = [
    `Terms to ground: ${groundingTerms.join("; ")}`,
    "",
    "# Retrieved passages from cited papers",
    passages,
  ].join("\n");

  try {
    const raw = await generateJson(
      {
        systemPrompt: getSystemPrompt("term_grounding"),
        userPrompt,
        schema: TERM_GROUNDING_SCHEMA,
      },
      {
        taskName: "term_grounding",
        temperature: 0.1,
        localAgent: options.localAgent,
      },
    );

    const grounded = parseGroundingPayload(raw);
    if (grounded.length === 0) {
      return;
    }

    const byTerm = new Map(grounded.map((term) => [term.term.toLowerCase(), term]));

    for (const section of result.sections) {
      for (const term of section.new_terms ?? []) {
        const match = byTerm.get(term.term.toLowerCase());
        if (match?.definition) {
          term.definition = match.definition;
          term.source = "cited_text";
        }
      }
    }

    // Citation-derived edges: prerequisites extracted from cited text.
    const withEdges = grounded.filter((term) => term.definition && term.dependsOn.length > 0);
    if (withEdges.length > 0) {
      void recordConceptGraph(
        withEdges.map((term) => ({
          concept: term.term,
          domain: primaryDomain,
          dependsOn: term.dependsOn,
        })),
        "citation",
      ).catch((error) => {
        console.warn("[summarize] failed to record citation-derived edges:", error);
      });
    }
  } catch (error) {
    console.warn("[summarize] term grounding pass failed; keeping model definitions:", error);
  }
}

export interface SummarizeFromContextOptions extends SummarizeOptions {
  /** Pre-built persona split (eval fixtures); loaded from the ledger when omitted. */
  personaSplit?: PersonaSplit;
  /** Pre-built citation candidates (eval fixtures); loaded from Postgres when omitted. */
  citationCandidates?: CitationCandidate[];
  /** Library paper ids for the router's ingested-lookup trigger. */
  ingestedPaperIds?: string[];
  /** Skip graph/interaction recording entirely (eval harness). */
  skipRecording?: boolean;
}

/**
 * The LLM half of summarize, split from the Postgres half so the eval
 * harness can drive it from fixtures without a database. Production
 * traffic goes through `summarizePaper`, which loads everything.
 */
export async function summarizePaperFromContext(
  context: PaperSummaryContext,
  options: SummarizeFromContextOptions = {},
): Promise<SummaryResult> {
  const paperId = context.paperId;
  const [personaSplit, citationCandidates, ingestedIds] = await Promise.all([
    options.personaSplit ?? loadPersonaSplit(options.userId),
    options.citationCandidates ?? loadCitationCandidates(paperId),
    options.ingestedPaperIds ?? loadIngestedIdsSafe(),
  ]);

  // Citation router (no question in the summarize flow): retrieval fires
  // for obscure/recent or already-ingested cited work. Abstracts are
  // router metadata — they enter the prompt only inside the clearly
  // framed grounding block below, never as explanation text.
  const decisions = routeCitations({
    candidates: citationCandidates,
    ingestedPaperIds: ingestedIds,
  });
  const citationBlock = renderRoutedCitationContext(citationCandidates, decisions);

  const systemPrompt = getSystemPrompt("paper_summary");
  const userPrompt = buildUserPrompt(context, {
    personaBlock: renderPersonaBlock(personaSplit),
    citationBlock,
  });

  const rawContent = await generateJson(
    {
      systemPrompt,
      userPrompt,
      schema: SUMMARY_SCHEMA,
    },
    {
      taskName: "summary",
      localAgent: options.localAgent,
    },
  );

  const llmSummary = parseModelSummary(rawContent);
  const result = postProcessSummary(llmSummary, context, Boolean(citationBlock));

  const primaryDomain = llmSummary.concepts.find((concept) => concept.domain)?.domain;
  await groundLowFamiliarityTerms(result, citationCandidates, primaryDomain, options);

  if (options.skipRecording) {
    return result;
  }

  // Graph + interaction recording is fire-and-forget; never block the
  // summary on it. NOTE skipLedger: an auto-generated summary is not
  // reader exposure — the reader surface records summary_exposure only
  // when the contract content actually renders (render-gated).
  void recordPersonaSignals({
    userId: options.userId,
    paperId,
    interactionType: "summarize",
    prompt: `Summarize paper ${paperId}`,
    response: result.sections.map((section) => section.summary).join("\n"),
    chunkIds: [],
    concepts: llmSummary.concepts.map((concept) => ({
      concept: concept.concept,
      description: concept.description,
      domain: concept.domain,
      dependsOn: concept.depends_on,
      confidence: concept.confidence,
    })),
    skipLedger: true,
  }).catch((error) => {
    console.warn("[summarize] failed to persist persona signals:", error);
  });

  return result;
}

export async function summarizePaper(
  paperId: string,
  options: SummarizeOptions = {},
): Promise<SummaryResult> {
  const context = await loadPaperSummaryContext(paperId);
  return summarizePaperFromContext(context, options);
}

export type {
  SummaryResult,
  SummarySection,
  SummaryKeyFinding,
  SummaryFigure,
  SummaryConcept,
  SummaryTerm,
  SummarySource,
} from "./types";
export type { PaperSummaryContext } from "./context";
export type { SummarizeOptions };
