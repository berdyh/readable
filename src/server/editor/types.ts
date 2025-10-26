import type { AnswerCitation, QuestionSelection } from '@/server/qa/types';

export interface SelectionCommandContext {
  paperId: string;
  selection: QuestionSelection;
  userId?: string;
  personaId?: string;
}

export interface SelectionSummaryBullet {
  text: string;
  citationIds: string[];
}

export interface SelectionCalloutResult {
  bullets: SelectionSummaryBullet[];
  deeper: string[];
  citations: AnswerCitation[];
}

export interface SelectionSummaryResult {
  callout: SelectionCalloutResult;
}

export interface SelectionFiguresResult {
  figures: Array<{
    figureId: string;
    caption: string;
    pageNumber?: number;
    imageUrl?: string;
  }>;
}

export interface SelectionCitationsResult {
  citations: Array<{
    citationId: string;
    title?: string;
    authors?: string[];
    year?: number;
    source?: string;
    doi?: string;
    url?: string;
    arxivId?: string;
    abstract?: string;
  }>;
}

export interface InlineSectionBlock {
  id: string;
  title: string;
  level: number;
  paragraphs: string[];
}

export interface InlineFigureBlock {
  id: string;
  label?: string;
  caption: string;
  imageUrl?: string;
}

export interface InlineArxivIngestResult {
  arxivId: string;
  title?: string;
  authors?: string[];
  publishedAt?: string;
  categories?: string[];
  sections: InlineSectionBlock[];
  figures: InlineFigureBlock[];
  sourceUrl: string;
}
