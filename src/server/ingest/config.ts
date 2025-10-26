export interface IngestEnvironmentConfig {
  arxivApiBaseUrl: string;
  ar5ivBaseUrl: string;
  grobidUrl?: string;
  deepSeekOcrUrl?: string;
  runpodApiKey?: string;
  runpodEndpointId?: string;
  fetchTimeoutMs: number;
  pdfFetchTimeoutMs: number;
  grobidTimeoutMs: number;
  ocrTimeoutMs: number;
  defaultContactEmail?: string;
  enableOcrFallback: boolean;
}

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_GROBID_TIMEOUT_MS = 60_000;
const DEFAULT_OCR_TIMEOUT_MS = 90_000;

function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.replace(/\/+$/, '');
}

export function getIngestEnvironment(): IngestEnvironmentConfig {
  return {
    arxivApiBaseUrl:
      process.env.ARXIV_API_BASE_URL ?? 'https://export.arxiv.org/api/query',
    ar5ivBaseUrl: process.env.AR5IV_BASE_URL ?? 'https://ar5iv.org/html',
    grobidUrl: normalizeBaseUrl(process.env.GROBID_URL),
    deepSeekOcrUrl: normalizeBaseUrl(process.env.DEEPSEEK_OCR_URL),
    runpodApiKey: process.env.RUNPOD_API_KEY,
    runpodEndpointId: process.env.RUNPOD_ENDPOINT_ID,
    fetchTimeoutMs: Number(
      process.env.INGEST_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS,
    ),
    pdfFetchTimeoutMs: Number(
      process.env.INGEST_PDF_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS,
    ),
    grobidTimeoutMs: Number(
      process.env.INGEST_GROBID_TIMEOUT_MS ?? DEFAULT_GROBID_TIMEOUT_MS,
    ),
    ocrTimeoutMs: Number(
      process.env.INGEST_OCR_TIMEOUT_MS ?? DEFAULT_OCR_TIMEOUT_MS,
    ),
    defaultContactEmail: process.env.ARXIV_CONTACT_EMAIL,
    enableOcrFallback:
      (process.env.ENABLE_OCR_FALLBACK ?? 'true').toLowerCase() !== 'false',
  };
}

export function buildArxivMetadataUrl(
  arxivId: string,
  contactEmail?: string,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): string {
  const params = new URLSearchParams({
    id_list: arxivId,
  });

  const email = contactEmail ?? environment.defaultContactEmail;

  if (email) {
    params.set('mailto', email);
  }

  return `${environment.arxivApiBaseUrl}?${params.toString()}`;
}

export function buildAr5ivHtmlUrl(
  arxivId: string,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): string {
  return `${environment.ar5ivBaseUrl}/${arxivId}`;
}

export function buildArxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}.pdf`;
}
