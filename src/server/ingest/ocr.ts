import { getIngestEnvironment, type IngestEnvironmentConfig } from './config';
import type {
  PdfCaptionMatch,
  PdfAnalysis,
  PdfExtractionResult,
  PdfImageMetadata,
  PdfPageText,
  PdfVisualKind,
} from './types';
import { fetchWithTimeout, safeJsonParse } from './utils';

interface DeepSeekOcrApiResponse {
  pages?: Array<{
    page?: number;
    pageNumber?: number;
    text?: string;
  }>;
  text?: string;
  figures?: Array<{
    page?: number;
    pageNumber?: number;
    number?: string;
    caption?: string;
    text?: string;
  }>;
  tables?: Array<{
    page?: number;
    pageNumber?: number;
    number?: string;
    caption?: string;
    text?: string;
  }>;
}

const DEFAULT_OCR_ENDPOINT = '/v1/ocr';
const RUNPOD_BASE_URL = 'https://api.runpod.ai/v2';

function normalizeOcrText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePageEntries(
  payload: DeepSeekOcrApiResponse,
): PdfPageText[] | undefined {
  if (!payload.pages) {
    return undefined;
  }

  const pages: PdfPageText[] = [];

  payload.pages.forEach((page, index) => {
    const text = page.text ? normalizeOcrText(page.text) : '';
    if (!text) {
      return;
    }

    const pageNumber =
      page.pageNumber ??
      page.page ??
      (Number.isFinite(page.page) ? Number(page.page) : undefined) ??
      index + 1;

    pages.push({
      pageNumber,
      text,
      figures: [],
      tables: [],
      images: [],
    });
  });

  return pages;
}

function fallbackFromCombinedText(
  payload: DeepSeekOcrApiResponse,
): PdfPageText[] | undefined {
  if (!payload.text) {
    return undefined;
  }

  const normalized = normalizeOcrText(payload.text);
  if (!normalized) {
    return undefined;
  }

  return [
    {
      pageNumber: 1,
      text: normalized,
      figures: [],
      tables: [],
      images: [],
    },
  ];
}

function normalizeReferenceFromOcr(kind: PdfVisualKind, label: string): string {
  return `${kind}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function mapCaptionsFromPayload(
  list: DeepSeekOcrApiResponse['figures'] | DeepSeekOcrApiResponse['tables'],
  kind: PdfVisualKind,
): PdfCaptionMatch[] {
  if (!list?.length) {
    return [];
  }

  const labelPrefix = kind === 'figure' ? 'Figure' : 'Table';

  const matches: PdfCaptionMatch[] = [];

  list.forEach((entry, index) => {
    const pageNumber =
      entry?.pageNumber ??
      entry?.page ??
      (Number.isFinite(entry?.page) ? Number(entry?.page) : undefined) ??
      index + 1;
    const captionSource = entry?.caption ?? entry?.text ?? entry?.number ?? '';
    const caption = captionSource ? normalizeOcrText(captionSource) : '';

    if (!caption) {
      return;
    }

    const number = entry?.number?.trim();
    const normalizedLabel = normalizeReferenceFromOcr(
      kind,
      number ?? `${pageNumber}-${index + 1}`,
    );
    const slug = normalizedLabel.split(':')[1] ?? `${pageNumber}-${index + 1}`;
    const id = `${kind}-${slug}`;

    matches.push({
      id,
      kind,
      label: number ? `${labelPrefix} ${number}` : labelPrefix,
      number,
      caption,
      pageNumber,
      normalizedLabel,
    });
  });

  return matches;
}

function createAnalysisFromPages(
  pages: PdfPageText[],
  tool: 'pdfjs-dist' | 'deepseek-ocr',
): PdfAnalysis {
  const sampleLimit = Math.min(pages.length, 3);
  let sampledTextLength = 0;
  let sampledImageCount = 0;

  for (let index = 0; index < sampleLimit; index += 1) {
    sampledTextLength += pages[index].text.length;
    sampledImageCount += pages[index].images.length;
  }

  const avgTextPerPage =
    sampleLimit > 0 ? sampledTextLength / sampleLimit : 0;
  const avgImagesPerPage =
    sampleLimit > 0 ? sampledImageCount / sampleLimit : 0;

  const confidence: 'low' | 'medium' | 'high' =
    avgTextPerPage > 2000 ? 'high' : avgTextPerPage > 1000 ? 'medium' : 'low';

  return {
    sampledPages: sampleLimit,
    sampledTextLength,
    sampledImageCount,
    avgTextPerPage,
    avgImagesPerPage,
    isLikelyScanned: tool === 'deepseek-ocr' || avgTextPerPage < 500,
    recommendedTool: tool,
    confidence,
  };
}

function buildExtractionResult(
  pages: PdfPageText[],
  figures: PdfCaptionMatch[],
  tables: PdfCaptionMatch[],
  images: PdfImageMetadata[],
  tool: 'pdfjs-dist' | 'deepseek-ocr',
): PdfExtractionResult {
  return {
    pages,
    combinedText: pages.map((page) => page.text).join('\n\n'),
    figures,
    tables,
    images,
    analysis: createAnalysisFromPages(pages, tool),
  };
}

export async function runDeepSeekOcr(
  pdfPayload: ArrayBuffer,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): Promise<PdfExtractionResult | undefined> {
  const hasDirectEndpoint = Boolean(environment.deepSeekOcrUrl);
  const hasRunpodEndpoint =
    Boolean(environment.runpodEndpointId) && Boolean(environment.runpodApiKey);

  if (!hasDirectEndpoint && !hasRunpodEndpoint) {
    return undefined;
  }

  if (hasDirectEndpoint && environment.deepSeekOcrUrl) {
    const base = environment.deepSeekOcrUrl;
    const endpoint = /\/v\d+\/ocr$/i.test(base)
      ? base
      : `${base.replace(/\/+$/, '')}${DEFAULT_OCR_ENDPOINT}`;

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([pdfPayload], { type: 'application/pdf' }),
      'paper.pdf',
    );

    const response = await fetchWithTimeout(
      endpoint,
      environment.ocrTimeoutMs,
      {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `DeepSeek OCR request failed (${response.status} ${response.statusText})`,
      );
    }

    const bodyText = await response.text();
    const payload = safeJsonParse<DeepSeekOcrApiResponse>(bodyText);

    if (!payload) {
      throw new Error('DeepSeek OCR response was not valid JSON.');
    }

    const pages =
      normalizePageEntries(payload) ?? fallbackFromCombinedText(payload);

    if (!pages || pages.length === 0) {
      return undefined;
    }

    return buildExtractionResult(pages, [], [], [], 'deepseek-ocr');
  }

  if (hasRunpodEndpoint && environment.runpodEndpointId) {
    const endpoint = `${RUNPOD_BASE_URL}/${environment.runpodEndpointId}/runsync`;
    const base64Payload = Buffer.from(pdfPayload).toString('base64');

    const response = await fetchWithTimeout(endpoint, environment.ocrTimeoutMs, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${environment.runpodApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          pdf_base64: base64Payload,
          task: 'extract_all',
          output_format: 'json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `RunPod DeepSeek OCR request failed (${response.status} ${response.statusText})`,
      );
    }

    const bodyText = await response.text();
    const raw = safeJsonParse<{
      output?: DeepSeekOcrApiResponse;
      status?: string;
      message?: string;
      error?: string;
    }>(bodyText);

    if (!raw) {
      throw new Error('RunPod DeepSeek OCR response was not valid JSON.');
    }

    if (raw.error) {
      throw new Error(`RunPod DeepSeek OCR error: ${raw.error}`);
    }

    const output = raw.output ?? (raw as unknown as DeepSeekOcrApiResponse);

    const pages =
      normalizePageEntries(output) ?? fallbackFromCombinedText(output);

    if (!pages || pages.length === 0) {
      return undefined;
    }

    const figures = mapCaptionsFromPayload(output.figures, 'figure');
    const tables = mapCaptionsFromPayload(output.tables, 'table');

    return buildExtractionResult(pages, figures, tables, [], 'deepseek-ocr');
  }

  return undefined;
}
