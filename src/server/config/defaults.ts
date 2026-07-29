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
  openrouter: 60_000,

  // Postgres statement timeout (20 seconds for relational queries)
  postgres: 20_000,

  // Qdrant request timeout (20 seconds for vector search)
  qdrant: 20_000,

  // Semantic Scholar API (citation enrichment)
  semanticScholar: 10_000,

  // Ingestion timeouts
  ingest: {
    fetch: 20_000, // General HTTP fetches (arXiv, ar5iv)
    pdf: 20_000, // PDF downloads
    ocr: 90_000, // OCR processing (slowest operation)
  },
} as const;

export const DEFAULT_URLS = {
  // LLM Provider base URLs
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",

  // arXiv services
  arxiv: "https://export.arxiv.org/api/query",
  ar5iv: "https://ar5iv.org/html",

  // Semantic Scholar
  semanticScholar: "https://api.semanticscholar.org/graph/v1",

  // RunPod (for OCR)
  runpod: "https://api.runpod.ai/v2",
} as const;

/**
 * Get timeout value with environment variable override
 */
export function getTimeout(
  service: keyof typeof DEFAULT_TIMEOUTS | "ingest.fetch" | "ingest.pdf" | "ingest.ocr",
  envVarName: string,
): number {
  let defaultValue: number;

  if (service.startsWith("ingest.")) {
    const ingestKey = service.split(".")[1] as keyof typeof DEFAULT_TIMEOUTS.ingest;
    defaultValue = DEFAULT_TIMEOUTS.ingest[ingestKey];
  } else {
    const directKey = service as Exclude<keyof typeof DEFAULT_TIMEOUTS, "ingest">;
    defaultValue = DEFAULT_TIMEOUTS[directKey] as number;
  }

  const envValue = process.env[envVarName];
  return envValue ? Number(envValue) : defaultValue;
}

/**
 * Get URL with environment variable override
 */
export function getUrl(service: keyof typeof DEFAULT_URLS, envVarName: string): string {
  const defaultValue = DEFAULT_URLS[service];
  const envValue = process.env[envVarName];
  return envValue ? envValue.replace(/\/+$/, "") : defaultValue;
}
