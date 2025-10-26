export interface ArxivMetadata {
  id: string;
  title?: string;
  abstract?: string;
  publishedAt?: string;
  updatedAt?: string;
  authors: string[];
  pdfUrl?: string;
  primaryCategory?: string;
  categories: string[];
}

export interface SectionParagraph {
  id: string;
  text: string;
  citations: string[];
  figureIds: string[];
  pageNumber?: number;
}

export interface PaperSection {
  id: string;
  title: string;
  level: number;
  paragraphs: SectionParagraph[];
  pageStart?: number;
  pageEnd?: number;
}

export interface PaperReference {
  id: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  doi?: string;
  url?: string;
  chunkIds?: string[];
}

export interface PaperFigure {
  id: string;
  label?: string;
  caption: string;
  pageNumber?: number;
  imageUrl?: string;
  chunkIds?: string[];
}

export interface ParsedTeiResult {
  sections: PaperSection[];
  references: PaperReference[];
  figures: PaperFigure[];
  pageCount?: number;
}

export interface HtmlParseResult {
  sections: PaperSection[];
  figures: PaperFigure[];
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
  figures: PdfCaptionMatch[];
  tables: PdfCaptionMatch[];
  images: PdfImageMetadata[];
}

export interface PdfExtractionResult {
  pages: PdfPageText[];
  combinedText: string;
  figures: PdfCaptionMatch[];
  tables: PdfCaptionMatch[];
  images: PdfImageMetadata[];
  analysis: PdfAnalysis;
}

export interface IngestResult {
  paperId: string;
  title?: string;
  abstract?: string;
  authors: string[];
  pages?: number;
  sections: PaperSection[];
  refs: PaperReference[];
  figures: PaperFigure[];
}

export interface IngestRequest {
  arxivId: string;
  contactEmail?: string;
  forceOcr?: boolean;
}

export type PdfVisualKind = 'figure' | 'table';

export interface PdfCaptionMatch {
  id: string;
  kind: PdfVisualKind;
  label: string;
  number?: string;
  caption: string;
  pageNumber: number;
  normalizedLabel: string;
}

export interface PdfImageMetadata {
  pageNumber: number;
  name?: string;
  type: 'xObject' | 'inline';
  width?: number;
  height?: number;
}

export interface PdfAnalysis {
  sampledPages: number;
  sampledTextLength: number;
  sampledImageCount: number;
  avgTextPerPage: number;
  avgImagesPerPage: number;
  isLikelyScanned: boolean;
  recommendedTool: 'pdfjs-dist' | 'deepseek-ocr';
  confidence: 'low' | 'medium' | 'high';
}
