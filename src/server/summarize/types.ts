export interface PageSpan {
  start?: number;
  end?: number;
}

export interface SummarySection {
  section_id: string;
  title: string;
  summary: string;
  reasoning: string;
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
  insight: string;
  page_anchor?: string;
}

export interface SummaryResult {
  sections: SummarySection[];
  key_findings: SummaryKeyFinding[];
  figures: SummaryFigure[];
}
