import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import type {
  HtmlParseResult,
  PaperFigure,
  PaperReference,
  PaperSection,
  SectionParagraph,
} from "./types";
import { normalizeWhitespace } from "./utils";

const HEADING_SELECTOR =
  "> h1, > h2, > h3, > h4, > h5, > h6, > header > h1, > header > h2, > header > h3, > header > h4, > header > h5, > header > h6";
const DEFAULT_IMAGE_BASE = "https://ar5iv.org";

interface ParseAr5ivOptions {
  imageBaseUrl?: string;
}

function resolveSectionLevel(tagName?: string | null, depthAttr?: string): number {
  if (tagName && /^h\d$/i.test(tagName)) {
    const numeric = parseInt(tagName.slice(1), 10);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  if (depthAttr) {
    const numeric = parseInt(depthAttr, 10);
    if (Number.isFinite(numeric)) {
      return numeric + 1;
    }
  }

  return 1;
}

function extractParagraphs(
  $section: Cheerio<AnyNode>,
  sectionId: string,
  $: CheerioAPI,
): SectionParagraph[] {
  const paragraphs: SectionParagraph[] = [];

  $section.find("> p, > div.ltx_para > p").each((index, element) => {
    const $paragraph = $(element);
    const text = normalizeWhitespace($paragraph.text());
    if (!text) {
      return;
    }

    const citations = new Set<string>();
    const figureIds = new Set<string>();

    $paragraph.find("a[href], a[data-bibtex-key]").each((_, refElement) => {
      const $ref = $(refElement);
      const target = $ref.attr("data-bibtex-key") ?? $ref.attr("href") ?? $ref.attr("data-target");
      if (target?.startsWith("#")) {
        const cleaned = target.slice(1);
        if (
          cleaned.toLowerCase().startsWith("fig") ||
          cleaned.match(/(?:^|[._:-])f\d+/i) ||
          cleaned.match(/(fig|sec|tab|equation)/i)
        ) {
          figureIds.add(cleaned);
        } else {
          citations.add(cleaned);
        }
      } else if (target) {
        citations.add(target);
      }
    });

    paragraphs.push({
      id: `${sectionId}-p${index + 1}`,
      text,
      citations: Array.from(citations),
      figureIds: Array.from(figureIds),
    });
  });

  return paragraphs;
}

function resolveImageUrl(src: string | undefined, baseUrl: string | undefined): string | undefined {
  if (!src) {
    return undefined;
  }

  const trimmed = src.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  const base = baseUrl ?? DEFAULT_IMAGE_BASE;
  const directoryBase = base.endsWith("/") ? base : `${base}/`;
  try {
    return new URL(trimmed, directoryBase).toString();
  } catch {
    return `${base.replace(/\/+$/, "")}/${trimmed.replace(/^\/+/, "")}`;
  }
}

function extractFigures($root: CheerioAPI, imageBaseUrl: string): PaperFigure[] {
  const figures: PaperFigure[] = [];

  $root("figure, div.ltx_figure, div.figure").each((index, element) => {
    const $figure = $root(element);
    const id = $figure.attr("id") ?? `figure-${index + 1}`;
    const label =
      normalizeWhitespace(
        $figure.find(".ltx_tag, .figure-label, .ltx_figcaption_label").first().text(),
      ) || undefined;
    const caption =
      normalizeWhitespace(
        $figure.find("figcaption, .ltx_caption, .figure-caption, .ltx_figcaption").first().text(),
      ) || "";

    if (!caption) {
      return;
    }

    const $image = $figure.find("img").first();
    const imageSrc = $image.attr("data-src") ?? $image.attr("src") ?? $image.attr("data-original");
    const imageUrl = resolveImageUrl(imageSrc, imageBaseUrl);

    figures.push({
      id,
      label,
      caption,
      imageUrl,
    });
  });

  return figures;
}

const ARXIV_HREF_PATTERN =
  /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;
const ARXIV_TEXT_PATTERN = /arxiv[:\s]+(\d{4}\.\d{4,5})(?:v\d+)?/i;
const DOI_HREF_PATTERN = /doi\.org\/(10\.[^\s?#]+)/i;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;

function cleanupBibTitle(value: string): string | undefined {
  const cleaned = value.replace(/[.,;]+$/, "").trim();
  return cleaned.length >= 4 ? cleaned : undefined;
}

function splitBibAuthors(value: string): string[] | undefined {
  const authors = value
    .replace(/[.]+$/, "")
    .split(/,\s*|\s+and\s+/i)
    .map((author) => author.trim().replace(/^and\s+/i, ""))
    .filter((author) => author.length > 1 && author.length < 80)
    .slice(0, 12);
  return authors.length > 0 ? authors : undefined;
}

/**
 * Extracts bibliography entries from the ar5iv reference list
 * (`li.ltx_bibitem`). Entry ids ("bib.bib1") are the same anchors the
 * paragraph extractor records as citations, so downstream chunk↔citation
 * mapping lines up. Titles/years/arXiv ids/DOIs give Semantic Scholar
 * enrichment real lookup keys — without this, ingest persisted an empty
 * citation list on the ar5iv path (TEI parsing was removed).
 */
function extractBibliography($: CheerioAPI): PaperReference[] {
  const references: PaperReference[] = [];

  $("li.ltx_bibitem").each((index, element) => {
    const $item = $(element);
    const id = $item.attr("id") ?? `bib-${index + 1}`;

    const blocks = $item
      .find(".ltx_bibblock")
      .toArray()
      .map((block) => normalizeWhitespace($(block).text()))
      .filter(Boolean);

    const fullText = normalizeWhitespace($item.text());
    if (!fullText) {
      return;
    }

    let arxivId: string | undefined;
    let doi: string | undefined;
    let url: string | undefined;

    $item.find("a[href]").each((_, anchor) => {
      const href = $(anchor).attr("href") ?? "";
      if (!/^https?:\/\//i.test(href)) {
        return;
      }
      if (!arxivId) {
        const match = href.match(ARXIV_HREF_PATTERN);
        if (match?.[1]) {
          arxivId = match[1];
        }
      }
      if (!doi) {
        const match = href.match(DOI_HREF_PATTERN);
        if (match?.[1]) {
          doi = match[1];
        }
      }
      if (!url) {
        url = href;
      }
    });

    if (!arxivId) {
      const match = fullText.match(ARXIV_TEXT_PATTERN);
      if (match?.[1]) {
        arxivId = match[1];
      }
    }

    const yearMatch = fullText.match(YEAR_PATTERN);
    const year = yearMatch ? Number.parseInt(yearMatch[0], 10) : undefined;

    // ar5iv renders bibitems as bibblock spans: authors first, title
    // second. Conservative — when the shape doesn't match, leave the
    // title undefined rather than guessing wrong enrichment keys.
    const title = blocks.length >= 2 ? cleanupBibTitle(blocks[1]) : undefined;
    const authors = blocks.length >= 1 ? splitBibAuthors(blocks[0]) : undefined;

    references.push({
      id,
      title,
      authors,
      year,
      doi,
      arxivId,
      url: url ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined),
    });
  });

  return references;
}

export function parseAr5ivHtml(html: string, options?: ParseAr5ivOptions): HtmlParseResult {
  const $ = load(html);
  const $root = $("article#document, article#ltx_document, body");
  const sections: PaperSection[] = [];
  const imageBaseUrl = options?.imageBaseUrl ?? DEFAULT_IMAGE_BASE;

  $root.find("section").each((index, element) => {
    const $section = $(element) as Cheerio<AnyNode>;
    const sectionId = $section.attr("id") ?? `section-${index + 1}`;
    const $heading = $section.find(HEADING_SELECTOR).first();
    const title = normalizeWhitespace($heading.text());
    if (!title) {
      return;
    }

    const level = resolveSectionLevel(
      $heading.prop("tagName")?.toLowerCase(),
      $section.attr("data-depth"),
    );

    const paragraphs = extractParagraphs($section, sectionId, $);

    if (paragraphs.length === 0) {
      return;
    }

    sections.push({
      id: sectionId,
      title,
      level,
      paragraphs,
    });
  });

  return {
    sections,
    figures: extractFigures($, imageBaseUrl),
    references: extractBibliography($),
  };
}
