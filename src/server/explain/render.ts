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
export interface RenderRoutedCitationOptions {
  /**
   * Cap on rendered citations. When more were routed, the block keeps
   * the highest-priority ones: already_ingested > obscure_or_recent,
   * then citationCount descending.
   */
  max?: number;
}

function routePriority(decision: CitationRouteDecision | undefined): number {
  if (decision?.reasons.includes("already_ingested")) {
    return 0;
  }
  if (decision?.reasons.includes("obscure_or_recent")) {
    return 1;
  }
  return 2;
}

export function renderRoutedCitationContext(
  candidates: CitationCandidate[],
  decisions: CitationRouteDecision[],
  options: RenderRoutedCitationOptions = {},
): string | undefined {
  const decisionById = new Map(decisions.map((decision) => [decision.citationId, decision]));
  let routed = candidates.filter(
    (candidate) => decisionById.get(candidate.citationId)?.retrieve === true,
  );

  if (typeof options.max === "number" && routed.length > options.max) {
    routed = routed
      .slice()
      .sort((a, b) => {
        const byPriority =
          routePriority(decisionById.get(a.citationId)) -
          routePriority(decisionById.get(b.citationId));
        if (byPriority !== 0) {
          return byPriority;
        }
        return (b.citationCount ?? -1) - (a.citationCount ?? -1);
      })
      .slice(0, options.max);
  }

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
