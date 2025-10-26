import '@ungap/with-resolvers';

import type {
  PDFDocumentProxy,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';

import type {
  PdfCaptionMatch,
  PdfExtractionResult,
  PdfImageMetadata,
  PdfPageText,
  PdfAnalysis,
  PdfVisualKind,
} from './types';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsModulePromise: Promise<PdfJsModule> | undefined;

function isTextItem(item: unknown): item is TextItem {
  return (
    !!item &&
    typeof item === 'object' &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string'
  );
}

function normalizePageText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCaption(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeReference(kind: PdfVisualKind, raw: string): string {
  return `${kind}:${raw.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function createCaptionRegex(kind: PdfVisualKind): RegExp {
  if (kind === 'figure') {
    return /(?:Figure|Fig\.?)\s+(\d+(?:[A-Za-z\-]*)?)[\s:.\-]*([\s\S]+?)(?=\n{2,}|(?:Figure|Fig\.?)\s+\d+|Table\s+\d+|$)/gi;
  }

  return /Table\s+(\d+(?:[A-Za-z\-]*)?)[\s:.\-]*([\s\S]+?)(?=\n{2,}|(?:Figure|Fig\.?)\s+\d+|Table\s+\d+|$)/gi;
}

function generateCaptionId(
  kind: PdfVisualKind,
  pageNumber: number,
  normalizedLabel: string,
  index: number,
): string {
  const slug = normalizedLabel.split(':')[1];
  if (slug) {
    return `${kind}-${slug}`;
  }

  return `${kind}-p${pageNumber}-${index + 1}`;
}

function buildCaptionMatches(
  text: string,
  kind: PdfVisualKind,
  pageNumber: number,
): PdfCaptionMatch[] {
  const regex = createCaptionRegex(kind);
  const labelPrefix = kind === 'figure' ? 'Figure' : 'Table';
  const matches: PdfCaptionMatch[] = [];

  let execResult: RegExpExecArray | null;
  while ((execResult = regex.exec(text)) !== null) {
    const number = execResult[1]?.trim();
    const caption = normalizeCaption(execResult[2] ?? '');

    if (!caption) {
      continue;
    }

    const normalizedLabel = normalizeReference(
      kind,
      number ?? `${pageNumber}-${matches.length + 1}`,
    );
    const id = generateCaptionId(kind, pageNumber, normalizedLabel, matches.length);
    const label = number ? `${labelPrefix} ${number}` : labelPrefix;

    matches.push({
      id,
      kind,
      label,
      number,
      caption,
      pageNumber,
      normalizedLabel,
    });
  }

  return matches;
}

function buildPageText(items: unknown[]): string {
  const parts: string[] = [];

  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }

    const value = item.str;
    if (!value) {
      continue;
    }

    parts.push(value);
    if (item.hasEOL) {
      parts.push('\n');
    } else {
      parts.push(' ');
    }
  }

  return normalizePageText(parts.join(''));
}

async function extractImageMetadata(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  pdfjs: PdfJsModule,
  pageNumber: number,
): Promise<PdfImageMetadata[]> {
  const operatorList = await page.getOperatorList();
  const images: PdfImageMetadata[] = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];

    if (fn === pdfjs.OPS.paintImageXObject) {
      const args = operatorList.argsArray[index];
      const imageName = args?.[0];
      let width: number | undefined;
      let height: number | undefined;

      try {
        if (
          imageName &&
          typeof page.objs?.has === 'function' &&
          page.objs.has(imageName)
        ) {
          const imageData = page.objs.get(imageName) as
            | { width?: number; height?: number }
            | undefined;
          width = imageData?.width;
          height = imageData?.height;
        }
      } catch (error) {
        console.warn(`[pdf] Failed to resolve image metadata for ${imageName}`, error);
      }

      images.push({
        pageNumber,
        name: typeof imageName === 'string' ? imageName : undefined,
        width,
        height,
        type: 'xObject',
      });
    } else if (fn === pdfjs.OPS.paintInlineImageXObject) {
      const args = operatorList.argsArray[index];
      const inlineImage = args?.[0] as { width?: number; height?: number } | undefined;
      images.push({
        pageNumber,
        type: 'inline',
        width: inlineImage?.width,
        height: inlineImage?.height,
      });
    }
  }

  return images;
}

async function readPageData(
  document: PDFDocumentProxy,
  pdfjs: PdfJsModule,
  pageNumber: number,
): Promise<PdfPageText | undefined> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = buildPageText(content.items);

  if (!text) {
    return undefined;
  }

  const figures = buildCaptionMatches(text, 'figure', pageNumber);
  const tables = buildCaptionMatches(text, 'table', pageNumber);
  const images = await extractImageMetadata(page, pdfjs, pageNumber);

  return {
    pageNumber,
    text,
    figures,
    tables,
    images,
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((module) => {
        module.GlobalWorkerOptions.workerSrc =
          'pdfjs-dist/legacy/build/pdf.worker.mjs';
        return module;
      })
      .catch((error) => {
        pdfjsModulePromise = undefined;
        throw error;
      });
  }

  return pdfjsModulePromise;
}

export async function extractPdfText(
  payload: ArrayBuffer,
): Promise<PdfExtractionResult> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(payload) });
  const document = await loadingTask.promise;

  const pages: PdfPageText[] = [];
  const combinedParts: string[] = [];
  const figures: PdfCaptionMatch[] = [];
  const tables: PdfCaptionMatch[] = [];
  const images: PdfImageMetadata[] = [];
  const sampleLimit = Math.min(document.numPages, 3);
  let sampledTextLength = 0;
  let sampledImageCount = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pageData = await readPageData(document, pdfjs, pageNumber);
      if (!pageData) {
        continue;
      }

      pages.push(pageData);
      combinedParts.push(pageData.text);
      figures.push(...pageData.figures);
      tables.push(...pageData.tables);
      images.push(...pageData.images);

       if (pageNumber <= sampleLimit) {
         sampledTextLength += pageData.text.length;
         sampledImageCount += pageData.images.length;
       }
    }
  } finally {
    await document.destroy();
  }

  const avgTextPerPage =
    sampleLimit > 0 ? sampledTextLength / sampleLimit : 0;
  const avgImagesPerPage =
    sampleLimit > 0 ? sampledImageCount / sampleLimit : 0;
  const isLikelyScanned =
    avgTextPerPage < 500 ||
    avgImagesPerPage >= 0.8 ||
    (avgTextPerPage < 1000 && avgImagesPerPage >= 0.5);
  const confidence: 'low' | 'medium' | 'high' =
    avgTextPerPage > 2000 ? 'high' : avgTextPerPage > 1000 ? 'medium' : 'low';

  const analysis: PdfAnalysis = {
    sampledPages: sampleLimit,
    sampledTextLength,
    sampledImageCount,
    avgTextPerPage,
    avgImagesPerPage,
    isLikelyScanned,
    recommendedTool: isLikelyScanned ? 'deepseek-ocr' : 'pdfjs-dist',
    confidence,
  } as const;

  return {
    pages,
    combinedText: combinedParts.join('\n\n').trim(),
    figures,
    tables,
    images,
    analysis,
  };
}

export function shouldUseOcr(
  analysis: PdfAnalysis | undefined,
  combinedTextLength: number,
  threshold: number,
): boolean {
  if (!analysis) {
    return combinedTextLength < threshold;
  }

  if (analysis.isLikelyScanned) {
    if (analysis.confidence === 'high') {
      return true;
    }
    if (analysis.confidence === 'medium') {
      return combinedTextLength < threshold * 2;
    }
    return combinedTextLength < threshold;
  }

  return combinedTextLength < threshold;
}
