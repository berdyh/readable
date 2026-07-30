import {
  MAX_GROUNDING_TERMS_PER_RESPONSE,
  OBSCURE_CITATION_COUNT_THRESHOLD,
  RECENT_YEAR_CUTOFF,
} from "./constants";

/**
 * Citation router — decides, per cited work, whether an explanation
 * flow should pull retrieved text into the prompt or let the model
 * explain from its own knowledge under the pedagogy prompt.
 *
 * Retrieval fires on four explicit triggers (plan decision 3A):
 *   1. source-specific ask   — the user's question is about the source
 *   2. obscure or recent     — citationCount < threshold OR year ≥ cutoff
 *   3. already ingested      — the cited paper is in our library
 *   4. self-reported unfamiliar — low-familiarity glossary terms get one
 *      bounded second-pass grounding call (batched per response)
 *
 * Citation abstracts and metadata are ROUTER METADATA ONLY — they inform
 * these decisions and grounding calls, never explanation prose directly.
 */

export interface CitationCandidate {
  citationId: string;
  title?: string;
  year?: number;
  citationCount?: number;
  arxivId?: string;
  abstract?: string;
}

export type CitationRouteReason =
  | "source_specific_ask"
  | "obscure_or_recent"
  | "already_ingested";

export interface CitationRouteDecision {
  citationId: string;
  retrieve: boolean;
  reasons: CitationRouteReason[];
}

const SOURCE_ASK_PATTERNS: RegExp[] = [
  /\baccording to\b/i,
  /\bas cited\b/i,
  /\bcited (?:paper|work|reference|study)\b/i,
  /\bthe (?:original|referenced) (?:paper|work|study)\b/i,
  /\bpaper by\b/i,
  /\bwhat does \S.* cite\b/i,
  /\bet al\.?\b/i,
  /\[\d{1,3}\]/,
  /\breference\s+\d{1,3}\b/i,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/** True when the question is explicitly about sources/citations. */
export function isSourceSpecificAsk(question: string | undefined): boolean {
  if (!question) {
    return false;
  }
  return SOURCE_ASK_PATTERNS.some((pattern) => pattern.test(question));
}

function significantTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Does the question mention this specific citation? Matched via a
 * bibliography index ("[12]" for bib.bib12) or ≥2 significant title
 * words appearing in the question (1 suffices for single-word titles).
 */
export function questionMentionsCitation(
  question: string | undefined,
  candidate: CitationCandidate,
): boolean {
  if (!question) {
    return false;
  }

  const indexMatch = candidate.citationId.match(/(\d{1,3})$/);
  if (indexMatch && question.includes(`[${indexMatch[1]}]`)) {
    return true;
  }

  if (candidate.title) {
    const words = significantTitleWords(candidate.title);
    if (words.length > 0) {
      const lowered = question.toLowerCase();
      const hits = words.filter((word) => lowered.includes(word)).length;
      const needed = Math.min(2, words.length);
      if (hits >= needed) {
        return true;
      }
    }
  }

  return false;
}

/** Trigger 2: little-cited or post-cutoff work the model may not know. */
export function isObscureOrRecent(candidate: CitationCandidate): boolean {
  if (
    typeof candidate.citationCount === "number" &&
    candidate.citationCount < OBSCURE_CITATION_COUNT_THRESHOLD
  ) {
    return true;
  }
  return typeof candidate.year === "number" && candidate.year >= RECENT_YEAR_CUTOFF;
}

function normalizeArxivId(value: string): string {
  return value.replace(/v\d+$/i, "").trim().toLowerCase();
}

export interface RouteCitationsInput {
  /** The user's question, when the flow has one (QA). */
  question?: string;
  candidates: CitationCandidate[];
  /** arXiv ids of papers already ingested into the library. */
  ingestedPaperIds?: string[];
}

export function routeCitations(input: RouteCitationsInput): CitationRouteDecision[] {
  const ingested = new Set((input.ingestedPaperIds ?? []).map(normalizeArxivId).filter(Boolean));
  const globalSourceAsk = isSourceSpecificAsk(input.question);

  return input.candidates.map((candidate) => {
    const reasons: CitationRouteReason[] = [];

    // Trigger 1 — a generic source-ask routes every supplied candidate;
    // a specific mention routes that citation even without ask phrasing.
    if (globalSourceAsk || questionMentionsCitation(input.question, candidate)) {
      reasons.push("source_specific_ask");
    }

    // Trigger 2 — obscure or post-cutoff work.
    if (isObscureOrRecent(candidate)) {
      reasons.push("obscure_or_recent");
    }

    // Trigger 3 — cited paper already in the library.
    if (candidate.arxivId && ingested.has(normalizeArxivId(candidate.arxivId))) {
      reasons.push("already_ingested");
    }

    return {
      citationId: candidate.citationId,
      retrieve: reasons.length > 0,
      reasons,
    };
  });
}

export interface GlossaryTermFamiliarity {
  term: string;
  /** Model self-reported familiarity with the term. */
  familiarity: "high" | "low";
}

/**
 * Trigger 4 — model self-reports unfamiliar. Selects the low-familiarity
 * glossary terms for the ONE bounded second-pass grounding call, capped
 * at `MAX_GROUNDING_TERMS_PER_RESPONSE` (batched per response, never per
 * item).
 */
export function selectGroundingTerms(terms: GlossaryTermFamiliarity[]): string[] {
  return terms
    .filter((term) => term.familiarity === "low" && term.term.trim().length > 0)
    .slice(0, MAX_GROUNDING_TERMS_PER_RESPONSE)
    .map((term) => term.term.trim());
}
