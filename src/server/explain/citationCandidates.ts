import { filterIngestedPaperIds } from "@/server/db";

import type { CitationCandidate } from "./citationRouter";

/**
 * Shared plumbing between the explanation flows: both summarize and QA
 * turn citation rows into router candidates and both ask which of those
 * cited works are already in the library. Keeping one copy here means a
 * new router-relevant field is added once, not once per flow.
 */

/**
 * Citation row → router candidate. Structurally typed rather than tied to
 * `Citation`, because QA passes its own retrieval-shaped citation context
 * and only these fields are router-relevant in either flow.
 */
export interface CitationCandidateSource {
  citationId: string;
  title?: string;
  year?: number;
  citationCount?: number;
  arxivId?: string;
  abstract?: string;
}

export function toCitationCandidate(citation: CitationCandidateSource): CitationCandidate {
  return {
    citationId: citation.citationId,
    title: citation.title,
    year: citation.year,
    citationCount: citation.citationCount,
    arxivId: citation.arxivId,
    abstract: citation.abstract,
  };
}

/**
 * Which of these candidates' cited works are already ingested?
 *
 * Membership query rather than a full library scan, and never throws —
 * the ingested-lookup trigger is an upgrade to the routing decision, so a
 * database hiccup degrades to "not ingested" instead of failing the
 * explanation the reader asked for.
 */
export async function loadIngestedIdsSafe(candidates: CitationCandidate[]): Promise<string[]> {
  const arxivIds = candidates
    .map((candidate) => candidate.arxivId?.trim())
    .filter((id): id is string => Boolean(id));
  if (arxivIds.length === 0) {
    return [];
  }
  try {
    return await filterIngestedPaperIds(arxivIds);
  } catch {
    return [];
  }
}
