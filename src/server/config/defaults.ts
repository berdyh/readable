/**
 * Default configuration values for the application.
 * These values are used when environment variables are not provided.
 * 
 * Timeouts are in milliseconds.
 * URLs can be overridden via environment variables if needed.
 */

export const DEFAULT_TIMEOUTS = {
  // LLM Provider timeouts (60 seconds for LLM operations)
  openai: 60_000,
  anthropic: 60_000,
  gemini: 60_000,
  
  // Kontext.dev timeout (8 seconds for quick persona prompt fetch)
  kontext: 8_000,
  
  // Weaviate timeout (20 seconds for database operations)
  weaviate: 20_000,
  
  // Ingestion timeouts
  ingest: {
    fetch: 20_000,      // General HTTP fetches (arXiv, ar5iv)
    pdf: 20_000,        // PDF downloads
    grobid: 60_000,     // GROBID parsing (can be slow for large papers)
    ocr: 90_000,        // OCR processing (slowest operation)
  },
} as const;

export const DEFAULT_URLS = {
  // LLM Provider base URLs
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  
  // Kontext.dev
  kontext: 'https://api.kontext.dev',
  kontextPath: '/v1/context/get',
  
  // arXiv services
  arxiv: 'https://export.arxiv.org/api/query',
  ar5iv: 'https://ar5iv.org/html',
  
  // RunPod (for OCR)
  runpod: 'https://api.runpod.ai/v2',
} as const;

/**
 * Get timeout value with environment variable override
 */
export function getTimeout(
  service: keyof typeof DEFAULT_TIMEOUTS | 'ingest.fetch' | 'ingest.pdf' | 'ingest.grobid' | 'ingest.ocr',
  envVarName: string,
): number {
  let defaultValue: number;
  
  if (service.startsWith('ingest.')) {
    const ingestKey = service.split('.')[1] as keyof typeof DEFAULT_TIMEOUTS.ingest;
    defaultValue = DEFAULT_TIMEOUTS.ingest[ingestKey];
  } else {
    const directKey = service as Exclude<keyof typeof DEFAULT_TIMEOUTS, 'ingest'>;
    defaultValue = DEFAULT_TIMEOUTS[directKey] as number;
  }
  
  const envValue = process.env[envVarName];
  return envValue ? Number(envValue) : defaultValue;
}

/**
 * Get URL with environment variable override
 */
export function getUrl(
  service: keyof typeof DEFAULT_URLS,
  envVarName: string,
): string {
  const defaultValue = DEFAULT_URLS[service];
  const envValue = process.env[envVarName];
  return envValue ? envValue.replace(/\/+$/, '') : defaultValue;
}

