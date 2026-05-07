# LLM Provider Abstraction Layer

This folder contains the LLM provider abstraction (`providers/`) plus the OpenClaw-pattern multi-provider routing layer (`routing/`). The two cooperate: each provider class knows how to talk to one upstream API; the routing layer picks WHICH provider to call (and which credential to use) based on configured fallbacks, env keys, CLI auth files, and per-profile cooldown state.

## Structure

```
llm/
├── providers/             # Provider implementations
│   ├── openai.ts         # OpenAI (api-key)
│   ├── anthropic.ts      # Anthropic Claude (api-key)
│   ├── gemini.ts         # Google Gemini API (api-key)
│   └── openrouter.ts     # OpenRouter (api-key; OpenAI-compatible)
├── routing/               # OpenClaw-pattern multi-provider routing
│   ├── types.ts          # FailoverReason, AuthProfile, ModelCandidate, ...
│   ├── env-keys.ts       # READABLE_LIVE_*_KEY → *_API_KEYS → *_API_KEY → *_API_KEY_*
│   ├── cli-detect.ts     # ~/.codex/auth.json, ~/.claude/.credentials.json, ~/.gemini/oauth_creds.json, gcloud ADC
│   ├── auth-profile-store.ts   # ~/.readable/agents/<id>/{auth-profiles,auth-state}.json
│   ├── auth-profile-order.ts   # round-robin: oauth > token > api_key, lastUsed asc, cooldowns last
│   ├── failover-classifier.ts  # HTTP/message → FailoverReason; advance-vs-fail-fast policy
│   ├── failover-error.ts       # FailoverError + coerceToFailoverError
│   ├── external-cli-sync.ts    # buildAuthProfileStore() + listAvailableProviders()
│   ├── fallback.ts             # runWithModelFallback() — sequential candidate loop with cooldown probes
│   ├── index.ts                # public facade
│   └── __tests__/              # 75 unit tests covering the pure layer
├── types.ts               # Common LLM types (LlmProvider, LlmRequest, LlmConfig)
├── router.ts              # generateJson / generateText entry points; engages routing when LLM_ALLOWED_PROVIDERS is set
├── index.ts               # Public API exports
└── README.md              # This file
```

## Usage

```typescript
import { generateJson, generateText } from '@/server/llm';

const result = await generateJson({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarize this paper.',
  schema: { type: 'object', properties: { summary: { type: 'string' } } },
}, { taskName: 'summary', temperature: 0.3 });

const text = await generateText({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Explain this concept.',
});
```

## Provider selection

Two paths, gated by `LLM_ALLOWED_PROVIDERS`:

### Single-provider fast path (legacy, default)

If `LLM_ALLOWED_PROVIDERS` is **unset**, the request goes straight to the provider named in `LLM_PROVIDER` (or `options.provider`). No fallback machinery, no auth-profile store touched. Existing single-provider deploys keep their behaviour bit-for-bit.

```bash
LLM_PROVIDER=openai            # openai | anthropic | gemini | openrouter
```

### Multi-provider routing (OpenClaw pattern)

Set `LLM_ALLOWED_PROVIDERS` to engage `runWithModelFallback`. The first entry is the primary; the rest are fallbacks tried in order on `auth | rate_limit | overloaded | billing | timeout | model_not_found | unknown`. The loop **fails fast** on `auth_permanent | format` (re-trying won't help).

```bash
LLM_PROVIDER=anthropic
LLM_ALLOWED_PROVIDERS=anthropic,openai,openrouter
```

Engaging routing layer's behaviour:

1. **Resolve candidates**: primary + deduplicated fallbacks; providers without any configured key are skipped.
2. **Resolve profile order** per provider: `oauth > token > api_key`, then `lastUsed` asc, then cooldowns moved to the end.
3. **Try in order**: on success, clear cooldown + record success + promote profile in `order`. On `FailoverError`, apply cooldown (1m → 5m → 25m → 1h cap; billing 5h → 24h cap), continue.
4. **Cooldown probes**: when all profiles for a provider are in cooldown but the most-recent reason is transient, allow one probe per provider per `MIN_PROBE_INTERVAL_MS=30s`.
5. **Persist** usage stats after every state change (`persistUsageWrites: true` is wired in `router.ts`) so a process restart doesn't lose the cooldowns.

Use `pnpm setup` for an interactive picker that detects everything you've authenticated and writes both vars correctly.

## Detection & credential precedence

Per provider, the routing layer collects credentials from three sources (highest priority first):

1. **`READABLE_LIVE_<PROV>_KEY`** — short-circuits, returns alone (use to override everything else for one process)
2. **CLI auth files** — `~/.codex/auth.json` (Codex), `~/.claude/.credentials.json` (Claude), `~/.gemini/oauth_creds.json` (Gemini), gcloud ADC at `~/.config/gcloud/application_default_credentials.json` (Vertex)
3. **`<PROV>_API_KEYS` (list) + `<PROV>_API_KEY` (primary) + `<PROV>_API_KEY_*` (numbered)** — all merge, deduped

Provider/model refs use slash form: `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20241022`, `openrouter/meta-llama/llama-3.3-70b-instruct:free`. The provider id may encode runtime variants (`openai-codex` for OAuth-billed Codex; the SDK adapter for that is not yet shipped).

## Default models

Configured in [`../llm-config/models.json`](../llm-config/models.json); see that folder's README for the full table. Quick summary:

| Provider | paper_summary | qa | selection_summary |
|---|---|---|---|
| OpenAI | `gpt-4o-mini` | `gpt-4o-mini` | `gpt-4o-mini` |
| Anthropic | `claude-3-haiku-20240307` | `claude-3-5-sonnet-20241022` | `claude-3-haiku-20240307` |
| Gemini | `gemini-1.5-flash` | `gemini-1.5-pro` | `gemini-1.5-flash` |
| OpenRouter (free tier) | `deepseek/deepseek-chat-v3.1:free` | `meta-llama/llama-3.3-70b-instruct:free` | `qwen/qwen3-235b-a22b:free` |

Override via env: `OPENAI_QA_MODEL`, `ANTHROPIC_PAPER_SUMMARY_MODEL`, `OPENROUTER_QA_MODEL`, etc. Or set a coarse default with `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `OPENROUTER_MODEL`.

## Adding a new provider

Two-layer change because of routing. Steps:

1. **Provider class**: create `providers/newprovider.ts` implementing `LlmProviderInterface`.
2. **Router union**: add `'newprovider'` to `LlmProvider` in `types.ts` and a `case 'newprovider':` in `router.ts`'s `createLlmProvider`.
3. **Models config**: add a `newprovider` block to `../llm-config/models.json` and widen the type in `../llm-config/models.ts`.
4. **Routing layer**: add `'newprovider'` to `RoutingProviderId` in `routing/types.ts` and to `PROVIDER_KEY_CONFIG` in `routing/env-keys.ts` so the priority chain knows the env-var prefix.
5. **CLI detection** (optional): if the provider authenticates via a CLI on disk, add a reader in `routing/cli-detect.ts` and wire it into `routing/external-cli-sync.ts`.
6. **Setup CLI**: add to `ROUTABLE_PROVIDERS` in `scripts/setup.ts` if it's selectable as a primary, plus `ENV_KEY_FOR_PROVIDER` and a `getInstallHint` entry.

## Provider interface

```typescript
interface LlmProviderInterface {
  generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string>;
  generateText(request: LlmRequest): Promise<string>;
  getProviderName(): LlmProvider;
}
```

OpenRouter notes: OpenRouter's HTTP shape is OpenAI-compatible at `/chat/completions`, but most free models reject `response_format: { type: 'json_schema', strict: true }`. The provider therefore uses `response_format: { type: 'json_object' }` and appends the schema to the system prompt as a hint; the existing defensive JSON parsers in QA / summarize handle the result. OpenRouter requires `HTTP-Referer` + `X-Title` headers for attribution — defaults are configurable via `OPENROUTER_HTTP_REFERER` / `OPENROUTER_X_TITLE`.

## Credit

The routing layer's pattern is adapted from [openclaw/openclaw](https://github.com/openclaw/openclaw) (MIT, © 2025 Peter Steinberger).
