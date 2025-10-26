const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  organization?: string;
  project?: string;
  timeoutMs: number;
}

function requireEnvVar(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required ${purpose}`);
  }
  return value.trim();
}

function getOpenAiConfig(): OpenAiConfig {
  const apiKey = requireEnvVar(
    'OPENAI_API_KEY',
    'to summarize papers. Set it in your environment.',
  );
  const baseUrl = requireEnvVar(
    'OPENAI_API_BASE_URL',
    'to summarize papers. Update .env.local if needed.',
  );
  const model = requireEnvVar(
    'OPENAI_SUMMARY_MODEL',
    'to summarize papers. Update .env.local if needed.',
  );

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    organization: process.env.OPENAI_ORGANIZATION,
    project: process.env.OPENAI_PROJECT,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export interface OpenAiSummaryParams {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
}

export async function generateJsonSummary(
  params: OpenAiSummaryParams,
): Promise<string> {
  const config = getOpenAiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };

    if (config.organization) {
      headers['OpenAI-Organization'] = config.organization;
    }

    if (config.project) {
      headers['OpenAI-Project'] = config.project;
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: params.temperature ?? 0.3,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'paper_summary',
            schema: params.schema,
            strict: true,
          },
        },
        messages: [
          {
            role: 'system',
            content: params.systemPrompt,
          },
          {
            role: 'user',
            content: params.userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response
        .text()
        .catch(() => 'Unable to read response body.');
      throw new Error(
        `OpenAI request failed with status ${response.status}: ${body}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const choices = payload.choices as Array<
      {
        message?: { content?: string };
        finish_reason?: string;
      } | undefined
    >;

    const firstChoice = choices?.[0];
    const finishReason = firstChoice?.finish_reason;

    if (finishReason && finishReason !== 'stop') {
      throw new Error(`OpenAI response finished with reason: ${finishReason}`);
    }

    const content = firstChoice?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenAI response did not include content.');
    }

    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}
