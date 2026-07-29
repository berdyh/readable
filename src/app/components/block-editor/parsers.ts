/**
 * Parser utilities to convert API responses into blocks
 */

import { v4 as uuidv4 } from "uuid";
import type { Block } from "./types";
import type { SummaryResult } from "@/server/summarize/types";
import type {
  SelectionSummaryResult,
  SelectionFiguresResult,
  SelectionCitationsResult,
  InlineArxivIngestResult,
} from "@/server/editor/types";

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
      content: "Paper Summary",
      metadata: {
        locked: true, // Generated blocks are locked by default
      },
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
          section: section.section_id,
          page: section.page_span?.start,
          locked: true, // Generated blocks are locked by default
        },
      });

      // Section summary paragraph
      if (section.summary) {
        blocks.push({
          id: uuidv4(),
          type: "paragraph",
          content: section.summary,
          metadata: {
            locked: true, // Generated blocks are locked by default
          },
        });
      }

      // Key points as bullet list
      if (section.key_points && section.key_points.length > 0) {
        for (const point of section.key_points) {
          blocks.push({
            id: uuidv4(),
            type: "bullet_list",
            content: point,
            metadata: {
              locked: true, // Generated blocks are locked by default
            },
          });
        }
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
        metadata: {
          locked: true, // Generated blocks are locked by default
        },
      });

    for (const finding of summary.key_findings) {
      const findingText = `${finding.statement}\n\nEvidence: ${finding.evidence}`;
      // Parse page anchor if available (format: "(page 4)" -> 4)
      const pageAnchor = finding.page_anchors?.[0];
      let pageNumber: number | undefined;
      if (pageAnchor) {
        const match = pageAnchor.match(/\(page\s+(\d+)\)/);
        if (match) {
          pageNumber = parseInt(match[1], 10);
        }
      }
      blocks.push({
        id: uuidv4(),
        type: "callout",
        content: findingText,
        metadata: {
          type: "info",
          page: pageNumber,
          locked: true, // Generated blocks are locked by default
        },
      });
    }
  }

  // Parse figures
  if (summary.figures && summary.figures.length > 0) {
      blocks.push({
        id: uuidv4(),
        type: "heading_2",
        content: "Figures",
        metadata: {
          locked: true, // Generated blocks are locked by default
        },
      });

    for (const figure of summary.figures) {
      // Parse page number from page_anchor format: "(page 4)" -> 4
      let pageNumber: number | undefined;
      if (figure.page_anchor) {
        const match = figure.page_anchor.match(/\(page\s+(\d+)\)/);
        if (match) {
          pageNumber = parseInt(match[1], 10);
        }
      }
      
      blocks.push({
        id: uuidv4(),
        type: "figure",
        content: figure.caption || figure.insight || "",
        metadata: {
          figureId: figure.figure_id,
          page: pageNumber,
          caption: figure.caption,
          insight: figure.insight,
          locked: true, // Generated blocks are locked by default
        },
      });
    }
  }

  return blocks;
}

/**
 * Parse SelectionFiguresResult from /api/editor/selection/figures into blocks
 */
export function parseFiguresToBlocks(result: SelectionFiguresResult): Block[] {
  const blocks: Block[] = [];

  if (result.figures && result.figures.length > 0) {
    for (const figure of result.figures) {
      blocks.push({
        id: uuidv4(),
        type: "figure",
        content: figure.caption || "",
        metadata: {
          figureId: figure.figureId,
          imageUrl: figure.imageUrl,
          page: figure.pageNumber,
          caption: figure.caption,
          locked: true, // Generated blocks are locked by default
        },
      });
    }
  }

  return blocks;
}

/**
 * Parse SelectionCitationsResult from /api/editor/selection/citations into blocks
 */
export function parseCitationsToBlocks(result: SelectionCitationsResult): Block[] {
  const blocks: Block[] = [];

  if (result.citations && result.citations.length > 0) {
    for (const citation of result.citations) {
      const citationText = citation.title 
        ? `${citation.title}${citation.authors ? ` - ${citation.authors.join(", ")}` : ""}${citation.year ? ` (${citation.year})` : ""}`
        : citation.citationId;
      
      blocks.push({
        id: uuidv4(),
        type: "paragraph",
        content: citationText,
        metadata: {
          citationId: citation.citationId,
          title: citation.title,
          authors: citation.authors,
          year: citation.year,
          url: citation.url || citation.doi || citation.arxivId,
          source: citation.source,
          locked: true, // Generated blocks are locked by default
        },
      });
    }
  }

  return blocks;
}

/**
 * Parse SelectionSummaryResult from /api/editor/selection/summary into blocks
 */
export function parseSelectionSummaryToBlocks(result: SelectionSummaryResult): Block[] {
  const blocks: Block[] = [];
  const { callout } = result;

  // Add callout with bullets
  if (callout.bullets && callout.bullets.length > 0) {
    const bulletsText = callout.bullets.map((b) => `• ${b.text}`).join("\n");
    blocks.push({
      id: uuidv4(),
      type: "callout",
      content: bulletsText,
      metadata: {
        type: "info",
        locked: true, // Generated blocks are locked by default
      },
    });
  }

  // Add "deeper" insights as additional paragraphs
  if (callout.deeper && callout.deeper.length > 0) {
    for (const insight of callout.deeper) {
      blocks.push({
        id: uuidv4(),
        type: "paragraph",
        content: insight,
        metadata: {
          locked: true, // Generated blocks are locked by default
        },
      });
    }
  }

  return blocks;
}

/**
 * Parse plain text summary into blocks (for simple string responses)
 */
export function parseTextSummaryToBlocks(
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
        locked: true, // Generated blocks are locked by default
      },
    });
  }

  // Remaining paragraphs as regular blocks
  for (const paragraph of paragraphs.slice(1)) {
    blocks.push({
      id: uuidv4(),
      type: "paragraph",
      content: paragraph,
      metadata: {
        ...metadata,
        locked: true, // Generated blocks are locked by default
      },
    });
  }

  return blocks;
}

/**
 * Parse InlineArxivIngestResult from /api/editor/ingest/arxiv into blocks
 * This displays the full HTML content of an arxiv paper
 */
export function parseArxivHtmlToBlocks(result: InlineArxivIngestResult): Block[] {
  const blocks: Block[] = [];

  // Add paper metadata as header
  if (result.title) {
    blocks.push({
      id: uuidv4(),
      type: "heading_1",
      content: result.title,
      metadata: {
        locked: true,
      },
    });
  }

  // Add authors and metadata
  if (result.authors && result.authors.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "paragraph",
      content: `**Authors:** ${result.authors.join(", ")}`,
      metadata: {
        locked: true,
      },
    });
  }

  if (result.publishedAt) {
    const dateStr = new Date(result.publishedAt).toLocaleDateString();
    blocks.push({
      id: uuidv4(),
      type: "paragraph",
      content: `**Published:** ${dateStr}`,
      metadata: {
        locked: true,
      },
    });
  }

  if (result.categories && result.categories.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "paragraph",
      content: `**Categories:** ${result.categories.join(", ")}`,
      metadata: {
        locked: true,
      },
    });
  }

  // Add source link
  blocks.push({
    id: uuidv4(),
    type: "paragraph",
    content: `**Source:** [arXiv:${result.arxivId}](${result.sourceUrl})`,
    metadata: {
      locked: true,
    },
  });

  // Add divider before content
  if (result.sections.length > 0 || result.figures.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "divider",
      content: "",
    });
  }

  // Parse sections
  if (result.sections && result.sections.length > 0) {
    for (const section of result.sections) {
      // Section heading - convert level to heading type
      let headingType: "heading_1" | "heading_2" | "heading_3" = "heading_2";
      if (section.level === 1) {
        headingType = "heading_1";
      } else if (section.level === 2) {
        headingType = "heading_2";
      } else {
        headingType = "heading_3";
      }

      blocks.push({
        id: uuidv4(),
        type: headingType,
        content: section.title,
        metadata: {
          section: section.id,
          locked: true,
        },
      });

      // Section paragraphs
      for (const paragraph of section.paragraphs) {
        if (paragraph.trim()) {
          blocks.push({
            id: uuidv4(),
            type: "paragraph",
            content: paragraph,
            metadata: {
              section: section.id,
              locked: true,
            },
          });
        }
      }

      // Add divider between sections (except last)
      if (section !== result.sections[result.sections.length - 1]) {
        blocks.push({
          id: uuidv4(),
          type: "divider",
          content: "",
        });
      }
    }
  }

  // Parse figures
  if (result.figures && result.figures.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: "divider",
      content: "",
    });

    blocks.push({
      id: uuidv4(),
      type: "heading_2",
      content: "Figures",
      metadata: {
        locked: true,
      },
    });

    for (const figure of result.figures) {
      blocks.push({
        id: uuidv4(),
        type: "figure",
        content: figure.caption || "",
        metadata: {
          figureId: figure.id,
          caption: figure.caption,
          imageUrl: figure.imageUrl,
          label: figure.label,
          locked: true,
        },
      });
    }
  }

  return blocks;
}

