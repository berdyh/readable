# LLM Provider Abstraction Layer

This folder contains the unified LLM provider abstraction layer that supports multiple LLM providers (OpenAI, Anthropic, Gemini).

## Structure

```
llm/
├── providers/          # Provider implementations
│   ├── openai.ts      # OpenAI provider
│   ├── anthropic.ts   # Anthropic (Claude) provider
│   └── gemini.ts      # Google Gemini provider
├── types.ts           # Common types and interfaces
├── router.ts          # Provider router and convenience functions
├── index.ts           # Public API exports
└── README.md          # This file
```

## Usage

### Basic Usage

```typescript
import { generateJson, generateText } from '@/server/llm';

// Generate structured JSON response
const result = await generateJson({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarize this paper.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
    },
  },
}, {
  taskName: 'summary',
  temperature: 0.3,
});

// Generate plain text response
const text = await generateText({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Explain this concept.',
});
```

### Provider Selection

The default provider is determined by the `LLM_PROVIDER` environment variable:

```bash
# Use OpenAI (default)
LLM_PROVIDER=openai

# Use Anthropic
LLM_PROVIDER=anthropic

# Use Gemini
LLM_PROVIDER=gemini
```

You can also specify the provider programmatically:

```typescript
import { generateJson } from '@/server/llm';

const result = await generateJson(
  { systemPrompt: '...', userPrompt: '...', schema: {...} },
  { provider: 'anthropic' }
);
```

### Model Selection

Models are automatically selected based on task type and provider. See `src/server/llm-config/models.json` for the complete configuration.

**Default Models** (configured in `models.json`):
- **OpenAI**: `gpt-4o-mini` (cost-effective, excellent quality)
- **Anthropic**: 
  - Summarization: `claude-3-haiku-20240307` (most cost-effective)
  - Q&A: `claude-3-5-sonnet-20241022` (superior reasoning)
- **Gemini**: 
  - Summarization/Inline: `gemini-1.5-flash` (best price)
  - Q&A: `gemini-1.5-pro` (better reasoning)

**Override Models** (optional environment variables):

```bash
# Override specific task models
OPENAI_QA_MODEL=gpt-4o
ANTHROPIC_SUMMARY_MODEL=claude-3-5-sonnet-20241022
GEMINI_QA_MODEL=gemini-1.5-pro

# General provider defaults (fallback)
OPENAI_MODEL=gpt-4o
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
GEMINI_MODEL=gemini-1.5-pro
```

**Note**: Model selection is configured in `src/server/llm-config/models.json`. Only override via environment variables if you need different models than the recommended defaults.

## Adding a New Provider

1. Create a new provider file in `providers/`:
   ```typescript
   export class NewProvider implements LlmProviderInterface {
     // Implement required methods
   }
   ```

2. Add the provider type to `types.ts`:
   ```typescript
   export type LlmProvider = 'openai' | 'anthropic' | 'gemini' | 'newprovider';
   ```

3. Add the provider to the router in `router.ts`:
   ```typescript
   case 'newprovider':
     return new NewProvider(config, taskType);
   ```

## Provider Interface

All providers must implement the `LlmProviderInterface`:

```typescript
interface LlmProviderInterface {
  generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string>;
  generateText(request: LlmRequest): Promise<string>;
  getProviderName(): LlmProvider;
}
```

## Migration from Old Code

The old OpenAI-specific functions have been replaced:

- `generateJsonSummary()` → `generateJson(..., { taskName: 'summary' })`
- `generateQaResponse()` → `generateJson(..., { taskName: 'qa' })`

The new functions maintain backward compatibility with the same request/response structure.

