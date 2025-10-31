import { upsertKontextPrompt } from '@/server/weaviate/upsert';
import type { KontextPrompt } from '@/server/weaviate/types';

const DEFAULT_BASE_URL = 'https://api.kontext.dev';
const DEFAULT_PATH = '/v1/context/get';
const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE_TTL_HOURS = 24; // Cache prompts for 24 hours

interface KontextConfig {
  apiKey?: string;
  baseUrl: string;
  path: string;
  timeoutMs: number;
}

function getKontextConfig(): KontextConfig {
  return {
    apiKey: process.env.KONTEXT_API_KEY,
    baseUrl: (process.env.KONTEXT_API_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    path: process.env.KONTEXT_SYSTEM_PROMPT_PATH ?? DEFAULT_PATH,
    timeoutMs: Number(process.env.KONTEXT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export interface KontextPromptRequest {
  taskId: string;
  paperId?: string;
  userId?: string;
  personaId?: string;
}

export async function fetchKontextSystemPrompt(
  request: KontextPromptRequest,
): Promise<string | undefined> {
  const config = getKontextConfig();

  if (!config.apiKey) {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const url = `${config.baseUrl}${config.path}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        task: request.taskId,
        paperId: request.paperId,
        personaId: request.personaId,
        userId: request.userId,
        include: ['systemPrompt'],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[summarize] Kontext request failed (${response.status})`,
        await response.text().catch(() => 'Unable to read error body.'),
      );
      return undefined;
    }

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const systemPrompt =
      typeof data.systemPrompt === 'string'
        ? data.systemPrompt
        : typeof data.system_prompt === 'string'
        ? data.system_prompt
        : undefined;

    const trimmedPrompt = systemPrompt?.trim();

    // Save prompt to Weaviate if we got one
    if (trimmedPrompt) {
      try {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

        const kontextPrompt: KontextPrompt = {
          userId: request.userId,
          personaId: request.personaId,
          taskId: request.taskId,
          paperId: request.paperId,
          systemPrompt: trimmedPrompt,
          fetchedAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
        };

        // Save asynchronously - don't block on save errors
        upsertKontextPrompt(kontextPrompt).catch((error) => {
          console.warn('[kontext] Failed to save prompt to Weaviate:', error);
        });
      } catch (error) {
        console.warn('[kontext] Error preparing prompt for storage:', error);
      }
    }

    return trimmedPrompt || undefined;
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') {
      console.warn('[summarize] Kontext request threw', error);
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
