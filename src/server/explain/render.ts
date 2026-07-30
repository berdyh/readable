import { truncateWithEllipsis } from "@/server/text";

import type { CitationCandidate, CitationRouteDecision } from "./citationRouter";

/**
 * Rendering primitives shared by the explanation flows. Each flow
 * composes these under its own policy and voice — this module never
 * decides what to include, only how it is formatted.
 */

const CITATION_ABSTRACT_TRUNCATE = 480;

export function truncateForPrompt(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return truncateWithEllipsis(text, maxLength);
}

/**
 * Renders the retrieved-citation block for routed citations. Only
 * citations the router decided to retrieve appear; the block is clearly
 * framed as grounding material so `cited_text` labels stay honest.
 */
export function renderRoutedCitationContext(
  candidates: CitationCandidate[],
  decisions: CitationRouteDecision[],
): string | undefined {
  const retrieveIds = new Set(
    decisions.filter((decision) => decision.retrieve).map((decision) => decision.citationId),
  );
  const routed = candidates.filter((candidate) => retrieveIds.has(candidate.citationId));

  if (routed.length === 0) {
    return undefined;
  }

  const lines = [
    "# Retrieved Cited Passages",
    "Content grounded in these passages may be labeled source=cited_text. Everything else must be labeled source=model_knowledge.",
  ];

  for (const candidate of routed) {
    const headerParts = [candidate.title ?? `Citation ${candidate.citationId}`];
    if (candidate.year) {
      headerParts.push(String(candidate.year));
    }
    if (candidate.arxivId) {
      headerParts.push(`arXiv:${candidate.arxivId}`);
    }
    lines.push(`- [${candidate.citationId}] ${headerParts.join(" · ")}`);

    if (candidate.abstract) {
      lines.push(
        `  abstract: ${truncateForPrompt(candidate.abstract.replace(/\s+/g, " ").trim(), CITATION_ABSTRACT_TRUNCATE)}`,
      );
    }
  }

  return lines.join("\n");
}
