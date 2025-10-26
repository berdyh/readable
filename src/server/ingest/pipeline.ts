import type { WeaviateClient } from 'weaviate-ts-client';

import {
  getWeaviateClient,
  upsertCitations,
  upsertFigures,
  upsertPaperChunks,
} from '@/server/weaviate';
import type { Citation, Figure, PaperChunk } from '@/server/weaviate';
import { buildPaperChunkUuid } from '@/server/weaviate/ids';

import { fetchAr5ivHtml, fetchArxivMetadata, fetchArxivPdf } from './arxiv';
import { parseAr5ivHtml } from './ar5iv';
import { getIngestEnvironment, type IngestEnvironmentConfig } from './config';
import { fetchGrobidTei, parseGrobidTei } from './grobid';
import { runDeepSeekOcr } from './ocr';
import { extractPdfText, shouldUseOcr } from './pdf';
import type {
  HtmlParseResult,
  IngestRequest,
  IngestResult,
  PaperFigure,
  PaperReference,
  PaperSection,
  ParsedTeiResult,
  PdfCaptionMatch,
  PdfExtractionResult,
  PdfVisualKind,
} from './types';

interface BuildChunkResult {
  chunks: PaperChunk[];
  citationToChunks: Map<string, string[]>;
  figureToChunks: Map<string, string[]>;
}

interface IngestOptions {
  weaviateClient?: WeaviateClient;
  environmentOverrides?: Partial<IngestEnvironmentConfig>;
}

const MIN_TEXT_THRESHOLD_FOR_PDF =
  Number(process.env.INGEST_PDF_TEXT_THRESHOLD ?? 1_000);

function mergeEnvironment(
  overrides?: Partial<IngestEnvironmentConfig>,
): IngestEnvironmentConfig {
  if (!overrides) {
    return getIngestEnvironment();
  }

  const base = getIngestEnvironment();
  return {
    ...base,
    ...overrides,
  };
}

function normalizeReferenceKey(kind: PdfVisualKind, raw: string): string {
  return `${kind}:${raw.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function createReferenceRegex(kind: PdfVisualKind): RegExp {
  if (kind === 'figure') {
    return /(?:Figure|Fig\.?)\s+([A-Za-z0-9.\-]+)/gi;
  }

  return /Table\s+([A-Za-z0-9.\-]+)/gi;
}

function collectFigureIdsFromParagraph(
  text: string,
  lookup: Map<string, string> | undefined,
): string[] {
  if (!lookup || lookup.size === 0) {
    return [];
  }

  const ids = new Set<string>();
  const figureRegex = createReferenceRegex('figure');
  const tableRegex = createReferenceRegex('table');

  let match: RegExpExecArray | null;

  while ((match = figureRegex.exec(text)) !== null) {
    const normalized = normalizeReferenceKey('figure', match[1]);
    const id = lookup.get(normalized);
    if (id) {
      ids.add(id);
    }
  }

  while ((match = tableRegex.exec(text)) !== null) {
    const normalized = normalizeReferenceKey('table', match[1]);
    const id = lookup.get(normalized);
    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

function buildFigureLookup(
  extraction: PdfExtractionResult | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();

  if (!extraction) {
    return lookup;
  }

  const push = (item: PdfCaptionMatch) => {
    lookup.set(item.normalizedLabel, item.id);
  };

  extraction.figures.forEach(push);
  extraction.tables.forEach(push);

  return lookup;
}

function collectNormalizedFigureKeys(figure: PaperFigure): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  const push = (kind: PdfVisualKind, raw?: string | null) => {
    if (!raw) {
      return;
    }
    const key = normalizeReferenceKey(kind, raw);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };

  const { label, id, caption } = figure;

  if (label) {
    const figureMatch = label.match(/(?:Figure|Fig\.?)\s*([A-Za-z0-9.\-]+)/i);
    const tableMatch = label.match(/Table\s*([A-Za-z0-9.\-]+)/i);
    if (figureMatch?.[1]) {
      push('figure', figureMatch[1]);
    }
    if (tableMatch?.[1]) {
      push('table', tableMatch[1]);
    }
    if (!figureMatch && !tableMatch && /^[A-Za-z0-9.\-]+$/.test(label)) {
      push('figure', label);
    }
  }

  if (id) {
    const figureIdMatch = id.match(/(?:fig|figure)[^0-9a-z]*([0-9a-z.\-]+)/i);
    const tableIdMatch = id.match(/(?:tab|table)[^0-9a-z]*([0-9a-z.\-]+)/i);
    if (figureIdMatch?.[1]) {
      push('figure', figureIdMatch[1]);
    }
    if (tableIdMatch?.[1]) {
      push('table', tableIdMatch[1]);
    }
  }

  if (caption) {
    const trimmed = caption.trim();
    const match = trimmed.match(/^(Figure|Fig\.?|Table)\s+([A-Za-z0-9.\-]+)/i);
    if (match?.[2]) {
      const prefix = match[1].toLowerCase();
      push(prefix.startsWith('table') ? 'table' : 'figure', match[2]);
    }
  }

  return keys;
}

function buildCaptionMatchIndex(
  extraction: PdfExtractionResult | undefined,
): {
  matches: PdfCaptionMatch[];
  byId: Map<string, PdfCaptionMatch>;
  byNormalized: Map<string, PdfCaptionMatch>;
  byLabel: Map<string, PdfCaptionMatch>;
} {
  if (!extraction) {
    return {
      matches: [],
      byId: new Map(),
      byNormalized: new Map(),
      byLabel: new Map(),
    };
  }

  const matches: PdfCaptionMatch[] = [
    ...extraction.figures,
    ...extraction.tables,
  ];

  const byId = new Map<string, PdfCaptionMatch>();
  const byNormalized = new Map<string, PdfCaptionMatch>();
  const byLabel = new Map<string, PdfCaptionMatch>();

  matches.forEach((match) => {
    byId.set(match.id, match);
    byNormalized.set(match.normalizedLabel, match);
    if (match.label) {
      byLabel.set(match.label.toLowerCase(), match);
    }
  });

  return { matches, byId, byNormalized, byLabel };
}

function enrichFiguresWithPdfData(
  figures: PaperFigure[],
  extraction: PdfExtractionResult | undefined,
): PaperFigure[] {
  const index = buildCaptionMatchIndex(extraction);

  if (!figures.length || index.matches.length === 0) {
    return figures;
  }

  return figures.map((figure) => {
    if (figure.pageNumber) {
      return figure;
    }

    let match = index.byId.get(figure.id);

    if (!match) {
      const candidateKeys = collectNormalizedFigureKeys(figure);
      for (const key of candidateKeys) {
        const entry = index.byNormalized.get(key);
        if (entry) {
          match = entry;
          break;
        }
      }
    }

    if (!match && figure.label) {
      match = index.byLabel.get(figure.label.toLowerCase());
    }

    if (!match && figure.caption) {
      const normalizedCaption = figure.caption
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      match = index.matches.find((candidate) => {
        const candidateCaption = candidate.caption
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

        return (
          candidateCaption.startsWith(normalizedCaption) ||
          normalizedCaption.startsWith(candidateCaption)
        );
      });
    }

    if (!match) {
      return figure;
    }

    return {
      ...figure,
      pageNumber: figure.pageNumber ?? match.pageNumber,
      label: figure.label ?? match.label,
      caption: figure.caption || match.caption,
    };
  });
}

function buildSectionsFromPdf(
  extraction: PdfExtractionResult | undefined,
  label: string,
  figureLookup: Map<string, string> | undefined,
): PaperSection[] {
  if (!extraction || extraction.pages.length === 0) {
    return [];
  }

  return extraction.pages.map((page) => {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `page${page.pageNumber}-p${index + 1}`,
        text,
        citations: [],
        figureIds: collectFigureIdsFromParagraph(text, figureLookup),
        pageNumber: page.pageNumber,
      }));

    return {
      id: `page-${page.pageNumber}`,
      title: `${label} Page ${page.pageNumber}`,
      level: 1,
      paragraphs,
      pageStart: page.pageNumber,
      pageEnd: page.pageNumber,
    };
  });
}

function selectSections(
  teiResult: ParsedTeiResult | undefined,
  htmlResult: HtmlParseResult | undefined,
  pdfFallback: PaperSection[],
): PaperSection[] {
  if (teiResult?.sections.length) {
    return teiResult.sections;
  }

  if (htmlResult?.sections.length) {
    return htmlResult.sections;
  }

  return pdfFallback;
}

function selectFigures(
  teiResult: ParsedTeiResult | undefined,
  htmlResult: HtmlParseResult | undefined,
  pdfExtraction: PdfExtractionResult | undefined,
): PaperFigure[] {
  if (teiResult?.figures.length) {
    return teiResult.figures;
  }

  if (htmlResult?.figures.length) {
    return htmlResult.figures;
  }

  if (pdfExtraction?.figures.length || pdfExtraction?.tables.length) {
    const fromCaptionMatch = (item: PdfCaptionMatch): PaperFigure => ({
      id: item.id,
      label: item.label,
      caption: item.caption,
      pageNumber: item.pageNumber,
      chunkIds: [],
    });

    return [
      ...pdfExtraction.figures.map(fromCaptionMatch),
      ...pdfExtraction.tables.map(fromCaptionMatch),
    ];
  }

  return [];
}

function selectReferences(
  teiResult: ParsedTeiResult | undefined,
): PaperReference[] {
  return teiResult?.references ?? [];
}

function buildChunks(
  paperId: string,
  sections: PaperSection[],
): BuildChunkResult {
  const chunks: PaperChunk[] = [];
  const citationToChunks = new Map<string, Set<string>>();
  const figureToChunks = new Map<string, Set<string>>();

  sections.forEach((section) => {
    section.paragraphs.forEach((paragraph, index) => {
      const chunkId = paragraph.id || `${section.id}-p${index + 1}`;
      chunks.push({
        paperId,
        chunkId,
        text: paragraph.text,
        section: section.title,
        pageNumber: paragraph.pageNumber ?? section.pageStart,
        citations: paragraph.citations,
        figureIds: paragraph.figureIds,
      });

      paragraph.citations.forEach((citationId) => {
        const entry =
          citationToChunks.get(citationId) ?? new Set<string>();
        entry.add(chunkId);
        citationToChunks.set(citationId, entry);
      });

      paragraph.figureIds.forEach((figureId) => {
        const entry = figureToChunks.get(figureId) ?? new Set<string>();
        entry.add(chunkId);
        figureToChunks.set(figureId, entry);
      });
    });
  });

  const citationMap = new Map<string, string[]>();
  citationToChunks.forEach((value, key) => {
    citationMap.set(key, Array.from(value));
  });

  const figureMap = new Map<string, string[]>();
  figureToChunks.forEach((value, key) => {
    figureMap.set(key, Array.from(value));
  });

  return { chunks, citationToChunks: citationMap, figureToChunks: figureMap };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeChunkReferenceIds(
  paperId: string,
  candidates: Array<string | undefined>,
): string[] | undefined {
  const ids = new Set<string>();

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) {
      continue;
    }

    if (UUID_PATTERN.test(value)) {
      ids.add(value);
    } else {
      ids.add(buildPaperChunkUuid(paperId, value));
    }
  }

  if (ids.size === 0) {
    return undefined;
  }

  return Array.from(ids);
}

function attachChunkRefsToFigures(
  figures: PaperFigure[],
  mapping: Map<string, string[]>,
  paperId: string,
): PaperFigure[] {
  return figures.map((figure) => {
    const combined = [
      ...(figure.chunkIds ?? []),
      ...(mapping.get(figure.id) ?? []),
    ];
    const normalized = normalizeChunkReferenceIds(paperId, combined);

    if (!normalized) {
      return {
        ...figure,
        chunkIds: undefined,
      };
    }

    return {
      ...figure,
      chunkIds: normalized,
    };
  });
}

function attachChunkRefsToReferences(
  references: PaperReference[],
  mapping: Map<string, string[]>,
  paperId: string,
): PaperReference[] {
  return references.map((reference) => {
    const combined = [
      ...(reference.chunkIds ?? []),
      ...(mapping.get(reference.id) ?? []),
    ];
    const normalized = normalizeChunkReferenceIds(paperId, combined);

    if (!normalized) {
      return {
        ...reference,
        chunkIds: undefined,
      };
    }

    return {
      ...reference,
      chunkIds: normalized,
    };
  });
}

function toWeaviateFigures(
  paperId: string,
  figures: PaperFigure[],
): Figure[] {
  return figures.map((figure) => ({
    paperId,
    figureId: figure.id,
    caption: figure.caption,
    pageNumber: figure.pageNumber,
    imageUrl: figure.imageUrl,
    chunkIds: figure.chunkIds,
  }));
}

function toWeaviateCitations(
  paperId: string,
  references: PaperReference[],
): Citation[] {
  return references.map((reference) => ({
    paperId,
    citationId: reference.id,
    title: reference.title ?? '',
    authors: reference.authors,
    year: reference.year,
    source: reference.source,
    doi: reference.doi,
    url: reference.url,
    chunkIds: reference.chunkIds,
  }));
}

export async function ingestPaper(
  request: IngestRequest,
  options?: IngestOptions,
): Promise<IngestResult> {
  const environment = mergeEnvironment(options?.environmentOverrides);
  const client = options?.weaviateClient ?? getWeaviateClient();
  const arxivId = request.arxivId;

  const [metadata, htmlPayload, pdfPayload] = await Promise.all([
    fetchArxivMetadata(arxivId, request.contactEmail, environment),
    (async () => {
      try {
        return await fetchAr5ivHtml(arxivId, environment);
      } catch (error) {
        console.warn(`[ingest] Failed to fetch ar5iv HTML for ${arxivId}`, error);
        return undefined;
      }
    })(),
    (async () => {
      try {
        return await fetchArxivPdf(arxivId, environment, request.contactEmail);
      } catch (error) {
        console.warn(`[ingest] Failed to download PDF for ${arxivId}`, error);
        return undefined;
      }
    })(),
  ]);

  if (!metadata) {
    throw new Error(`Unable to fetch arXiv metadata for ${arxivId}.`);
  }

  const ar5ivImageBase = (() => {
    try {
      return new URL(environment.ar5ivBaseUrl).origin;
    } catch {
      return undefined;
    }
  })();

  const htmlResult =
    htmlPayload && htmlPayload.length > 0
      ? parseAr5ivHtml(htmlPayload, { imageBaseUrl: ar5ivImageBase })
      : undefined;

  let teiResult: ParsedTeiResult | undefined;
  if (pdfPayload) {
    try {
      const teiXml = await fetchGrobidTei(pdfPayload, environment);
      if (teiXml) {
        teiResult = parseGrobidTei(teiXml);
      }
    } catch (error) {
      console.warn(`[ingest] GROBID processing failed for ${arxivId}`, error);
    }
  }

  let pdfExtraction: PdfExtractionResult | undefined;
  if (pdfPayload) {
    try {
      pdfExtraction = await extractPdfText(pdfPayload);
    } catch (error) {
      console.warn(`[ingest] PDF text extraction failed for ${arxivId}`, error);
    }
  }

  let ocrExtraction: PdfExtractionResult | undefined;
  const allowOcrFallback = environment.enableOcrFallback || request.forceOcr;
  const shouldAttemptOcr =
    Boolean(pdfPayload) &&
    (request.forceOcr ||
      (!pdfExtraction && allowOcrFallback) ||
      (allowOcrFallback &&
        shouldUseOcr(
          pdfExtraction?.analysis,
          pdfExtraction?.combinedText.length ?? 0,
          MIN_TEXT_THRESHOLD_FOR_PDF,
        )));

  if (shouldAttemptOcr && pdfPayload) {
    try {
      ocrExtraction = await runDeepSeekOcr(pdfPayload, environment);
    } catch (error) {
      console.warn(`[ingest] DeepSeek OCR failed for ${arxivId}`, error);
    }
  }

  const fallbackExtraction = ocrExtraction ?? pdfExtraction;
  const figureLookup = buildFigureLookup(fallbackExtraction);

  const pdfFallbackSections = buildSectionsFromPdf(
    fallbackExtraction,
    ocrExtraction ? 'OCR' : 'PDF',
    figureLookup,
  );

  const sections = selectSections(teiResult, htmlResult, pdfFallbackSections);

  if (!sections.length) {
    throw new Error(
      `Unable to extract meaningful sections for arXiv paper ${arxivId}.`,
    );
  }

  const extractedFigures = selectFigures(
    teiResult,
    htmlResult,
    fallbackExtraction,
  );
  const figures = enrichFiguresWithPdfData(extractedFigures, fallbackExtraction);
  const references = selectReferences(teiResult);

  const { chunks, citationToChunks, figureToChunks } = buildChunks(
    metadata.id,
    sections,
  );

  if (!chunks.length) {
    throw new Error(
      `No chunkable paragraphs were produced for arXiv paper ${arxivId}.`,
    );
  }

  const figuresWithChunks = attachChunkRefsToFigures(
    figures,
    figureToChunks,
    metadata.id,
  );
  const referencesWithChunks = attachChunkRefsToReferences(
    references,
    citationToChunks,
    metadata.id,
  );

  await upsertPaperChunks(chunks, client);

  if (figuresWithChunks.length) {
    await upsertFigures(toWeaviateFigures(metadata.id, figuresWithChunks), client);
  }

  if (referencesWithChunks.length) {
    await upsertCitations(
      toWeaviateCitations(metadata.id, referencesWithChunks),
      client,
    );
  }

  const pages =
    teiResult?.pageCount ??
    fallbackExtraction?.pages.length;

  return {
    paperId: metadata.id,
    title: metadata.title,
    abstract: metadata.abstract,
    authors: metadata.authors,
    pages,
    sections,
    refs: referencesWithChunks,
    figures: figuresWithChunks,
  };
}
