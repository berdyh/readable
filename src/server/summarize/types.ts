import type { ExplanationSource } from "@/server/explain";

export interface PageSpan {
  start?: number;
  end?: number;
}

/** Alias, not a copy: server/explain owns the label vocabulary. */
export type SummarySource = ExplanationSource;

/** Glossary entry for a term the section introduces. */
export interface SummaryTerm {
  term: string;
  definition: string;
  /** Model-reported familiarity; "low" terms may be grounded in cited text. */
  familiarity?: "high" | "low";
  /** Set to "cited_text" when the grounding pass rewrote the definition. */
  source?: SummarySource;
}

/**
 * A summary section following the explanation contract. `summary` and
 * `reasoning` are kept populated (claim / mechanism respectively) so
 * older persisted summaries and older clients keep parsing; the
 * contract fields are optional for the same reason.
 */
export interface SummarySection {
  section_id: string;
  title: string;
  summary: string;
  reasoning: string;
  /** Motivating question or problem that opens the section. */
  hook?: string;
  /** Evidence pointer (section/figure IDs and what they support). */
  evidence?: string;
  /** Glossary of new terms introduced by this section. */
  new_terms?: SummaryTerm[];
  /** Server-validated source label. */
  source?: SummarySource;
  key_points?: string[];
  page_anchor?: string;
  page_span?: PageSpan;
}

export interface SummaryKeyFinding {
  statement: string;
  evidence: string;
  page_anchors: string[];
  supporting_sections?: string[];
  related_figures?: string[];
}

export interface SummaryFigure {
  figure_id: string;
  caption?: string;
  /** Declarative takeaway — what the figure proves or shows. */
  insight: string;
  page_anchor?: string;
}

/** Concept the reader is exposed to by this summary (drives the graph). */
export interface SummaryConcept {
  concept: string;
  domain?: string;
  description?: string;
  /** Normalized domain-faceted key ("{domain}:{name}"). */
  concept_key?: string;
}

export interface SummaryResult {
  sections: SummarySection[];
  key_findings: SummaryKeyFinding[];
  figures: SummaryFigure[];
  /**
   * Concepts for render-gated exposure recording on the client. Optional:
   * older persisted summaries lack it.
   */
  concepts?: SummaryConcept[];
}
