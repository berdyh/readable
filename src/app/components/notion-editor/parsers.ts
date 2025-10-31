/**
 * Parser utilities to convert API responses into blocks
 */

import { v4 as uuidv4 } from "uuid";
import type { Block } from "./types";

// Types matching backend API responses
interface SummarySection {
  id: string;
  title: string;
  paragraphs: string[];
  pageSpan: [number, number];
  referencedFigureIds?: string[];
}

interface SummaryResult {
  sections?: SummarySection[];
  key_findings?: string[];
  figures?: Array<{
    id: string;
    caption?: string;
    pageNumber?: number;
    imageUrl?: string;
  }>;
}

interface FigureData {
  id: string;
  caption?: string;
  pageNumber?: number;
  imageUrl?: string;
}

interface CitationData {
  id: string;
  author?: string;
  title?: string;
  url?: string;
  pageNumber?: number;
}

/**
 * Parse SummaryResult from /api/summarize into blocks
 */
export function parseSummaryToBlocks(summary: SummaryResult): Block[] {
  const blocks: Block[] = [];

  // Add title block
  if (summary.sections && summary.sections.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "heading_1",
      content: "Summary",
    });
  }

  // Parse sections
  if (summary.sections) {
    for (const section of summary.sections) {
      // Section heading
      blocks.push({
        id: uuidv4(),
        type: "heading_2",
        content: section.title,
        metadata: {
          section: section.id,
          page: section.pageSpan[0],
        },
      });

      // Section paragraphs
      for (const paragraph of section.paragraphs) {
        blocks.push({
          id: uuidv4(),
          type: "paragraph",
          content: paragraph,
        });
      }

      // Add divider between sections
      if (section !== summary.sections[summary.sections.length - 1]) {
        blocks.push({
          id: uuidv4(),
          type: "divider",
          content: "",
        });
      }
    }
  }

  // Parse key findings as callout blocks
  if (summary.key_findings && summary.key_findings.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "heading_2",
      content: "Key Findings",
    });

    for (const finding of summary.key_findings) {
      blocks.push({
        id: uuidv4(),
        type: "callout",
        content: finding,
        metadata: {
          type: "info",
        },
      });
    }
  }

  return blocks;
}

/**
 * Convert figure data to FigureBlock
 */
export function parseFigureToBlock(figure: FigureData): Block {
  return {
    id: uuidv4(),
    type: "figure",
    content: figure.caption || "",
    metadata: {
      figureId: figure.id,
      imageUrl: figure.imageUrl,
      page: figure.pageNumber,
      caption: figure.caption,
    },
  };
}

/**
 * Convert citation data to CitationBlock
 */
export function parseCitationToBlock(citation: CitationData): Block {
  return {
    id: uuidv4(),
    type: "citation",
    content: citation.title || "",
    metadata: {
      citationId: citation.id,
      author: citation.author,
      title: citation.title,
      url: citation.url,
      page: citation.pageNumber,
    },
  };
}

/**
 * Parse selection summary response into blocks
 */
export function parseSelectionSummaryToBlocks(
  summaryText: string,
  metadata?: { page?: number; section?: string },
): Block[] {
  // Split summary into paragraphs
  const paragraphs = summaryText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks: Block[] = [];

  // First paragraph as callout
  if (paragraphs.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "callout",
      content: paragraphs[0],
      metadata: {
        type: "info",
        ...metadata,
      },
    });
  }

  // Remaining paragraphs as regular blocks
  for (const paragraph of paragraphs.slice(1)) {
    blocks.push({
      id: uuidv4(),
      type: "paragraph",
      content: paragraph,
      metadata,
    });
  }

  return blocks;
}

