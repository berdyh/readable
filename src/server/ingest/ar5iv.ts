import { load, type Cheerio, type CheerioAPI } from 'cheerio';

import type { HtmlParseResult, PaperFigure, PaperSection, SectionParagraph } from './types';
import { normalizeWhitespace } from './utils';

const HEADING_SELECTOR = '> h1, > h2, > h3, > h4, > h5, > h6, > header > h1, > header > h2, > header > h3, > header > h4, > header > h5, > header > h6';

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
  $section: Cheerio<unknown>,
  sectionId: string,
  $: CheerioAPI,
): SectionParagraph[] {
  const paragraphs: SectionParagraph[] = [];

  $section.find('> p, > div.ltx_para > p').each((index, element) => {
    const $paragraph = $(element);
    const text = normalizeWhitespace($paragraph.text());
    if (!text) {
      return;
    }

    const citations = new Set<string>();
    const figureIds = new Set<string>();

    $paragraph.find('a[href], a[data-bibtex-key]').each((_, refElement) => {
      const $ref = $(refElement);
        const target =
          $ref.attr('data-bibtex-key') ??
          $ref.attr('href') ??
          $ref.attr('data-target');
        if (target?.startsWith('#')) {
          const cleaned = target.slice(1);
          if (cleaned.toLowerCase().startsWith('fig') || cleaned.match(/(fig|sec|tab|equation)/i)) {
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

function extractFigures($root: CheerioAPI): PaperFigure[] {
  const figures: PaperFigure[] = [];

  $root('figure, div.ltx_figure, div.figure').each((index, element) => {
    const $figure = $root(element);
    const id = $figure.attr('id') ?? `figure-${index + 1}`;
    const label =
      normalizeWhitespace(
        $figure.find('.ltx_tag, .figure-label, .ltx_figcaption_label').first().text(),
      ) || undefined;
    const caption =
      normalizeWhitespace(
        $figure.find('figcaption, .ltx_caption, .figure-caption, .ltx_figcaption').first().text(),
      ) || '';

    if (!caption) {
      return;
    }

    figures.push({
      id,
      label,
      caption,
    });
  });

  return figures;
}

export function parseAr5ivHtml(html: string): HtmlParseResult {
  const $ = load(html);
  const $root = $('article#document, article#ltx_document, body');
  const sections: PaperSection[] = [];

  $root.find('section').each((index, element) => {
    const $section = $(element);
    const sectionId = $section.attr('id') ?? `section-${index + 1}`;
    const $heading = $section.find(HEADING_SELECTOR).first();
    const title = normalizeWhitespace($heading.text());
    if (!title) {
      return;
    }

    const level = resolveSectionLevel($heading.prop('tagName')?.toLowerCase(), $section.attr('data-depth'));

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
    figures: extractFigures($),
  };
}
