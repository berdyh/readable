export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBufferWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<ArrayBuffer> {
  const response = await fetchWithTimeout(url, timeoutMs, init);

  if (!response.ok) {
    throw new Error(
      `Request failed with status ${response.status}: ${response.statusText}`,
    );
  }

  return response.arrayBuffer();
}

export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs, init);

  if (!response.ok) {
    throw new Error(
      `Request failed with status ${response.status}: ${response.statusText}`,
    );
  }

  return response.text();
}

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function toStringArray(
  value: string | string[] | undefined | null,
): string[] {
  if (!value) {
    return [];
  }

  return ensureArray(value).map((item) => item.trim()).filter(Boolean);
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export type XmlNode = string | number | boolean | null | undefined | XmlNodeObject | XmlNode[];
type XmlNodeObject = {
  [key: string]: XmlNode;
};

export interface FlattenTeiResult {
  text: string;
  citations: string[];
  figureIds: string[];
}

export function flattenTeiNode(node: XmlNode): FlattenTeiResult {
  const citations = new Set<string>();
  const figureIds = new Set<string>();

  const parts: string[] = [];

  const walk = (current: XmlNode) => {
    if (current === null || current === undefined) {
      return;
    }

    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current));
      return;
    }

    if (typeof current === 'boolean') {
      parts.push(current ? 'true' : 'false');
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => walk(item));
      return;
    }

    for (const [key, value] of Object.entries(current)) {
      if (key === '@_target' && typeof value === 'string') {
        if ('@_type' in current) {
          const typeValue = (current as Record<string, XmlNode>)['@_type'];
          if (typeValue === 'bibr' && value.startsWith('#')) {
            citations.add(value.slice(1));
          }
          if (
            typeof typeValue === 'string' &&
            typeValue.toLowerCase().includes('figure') &&
            value.startsWith('#')
          ) {
            figureIds.add(value.slice(1));
          }
        }
      } else if (key === '#text') {
        walk(value);
      } else if (key.startsWith('@_')) {
        continue;
      } else {
        walk(value);
      }
    }
  };

  walk(node);

  return {
    text: normalizeWhitespace(parts.join(' ')),
    citations: Array.from(citations),
    figureIds: Array.from(figureIds),
  };
}

export function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Failed to parse JSON payload', error);
    return undefined;
  }
}
