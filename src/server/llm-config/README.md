# LLM Configuration (Prompts & Models)

This folder contains all LLM-related configuration: system/user prompts and model selections for each provider and task type.

## Structure

- `prompts.json` - JSON file containing all prompts and configuration limits
- `models.json` - JSON file containing recommended models for each provider and task
- `index.ts` - TypeScript utilities to load prompts
- `models.ts` - TypeScript utilities to load model configurations

## Usage

### Prompts

```typescript
import { getSystemPrompt, getPromptLimits, getPaperSummaryRequirements } from '@/server/llm-config';

// Get a system prompt for a specific task
const prompt = getSystemPrompt('paper_summary', personaPrompt);

// Get prompt limits
const limits = getPromptLimits();
const maxParagraphs = limits.paragraph; // 3

// Get requirements for paper summary
const requirements = getPaperSummaryRequirements();
```

### Models

```typescript
import { getModel, getModelConfig } from '@/server/llm-config';

// Get recommended model for a provider and task
const model = getModel('openai', 'qa'); // Returns 'gpt-4o-mini'
const anthropicModel = getModel('anthropic', 'paper_summary'); // Returns 'claude-3-haiku-20240307'

// Get full model configuration with rationale and pricing
const config = getModelConfig('gemini', 'qa');
console.log(config.model); // 'gemini-1.5-pro'
console.log(config.rationale); // Explanation of why this model was chosen
```

## Task Types

- `paper_summary` - Full paper summarization
- `selection_summary` / `inline_summary` - Inline selection summaries
- `qa` / `question` - Question answering

## Model Selection Strategy

Models are chosen based on:
1. **Cost-effectiveness** - Lower cost for high-volume tasks (summarization)
2. **Quality** - Better models for complex reasoning (Q&A)
3. **Context window** - Sufficient tokens for paper-length content

### Default Models by Provider

#### OpenAI
- **Summarization**: `gpt-4o-mini` - Best cost/quality balance ($0.15/$0.6 per 1M tokens)
- **Q&A**: `gpt-4o-mini` - Good reasoning at low cost
- **Inline Summary**: `gpt-4o-mini` - Fast and efficient

#### Anthropic
- **Summarization**: `claude-3-haiku-20240307` - Most cost-effective ($0.25/$1.25 per 1M tokens)
- **Q&A**: `claude-3-5-sonnet-20241022` - Superior reasoning for complex questions ($3/$15 per 1M tokens)
- **Inline Summary**: `claude-3-haiku-20240307` - Ultra-fast and cheap

#### Gemini
- **Summarization**: `gemini-1.5-flash` - Best price ($0.075/$0.3 per 1M tokens), 1M context window
- **Q&A**: `gemini-1.5-pro` - Better reasoning quality ($1.25/$5 per 1M tokens)
- **Inline Summary**: `gemini-1.5-flash` - Fastest and cheapest

## Overriding Models

You can override models via environment variables:

```bash
# Provider-specific overrides
OPENAI_QA_MODEL=gpt-4o
ANTHROPIC_SUMMARY_MODEL=claude-3-5-sonnet-20241022
GEMINI_QA_MODEL=gemini-1.5-flash

# General provider defaults (fallback)
OPENAI_MODEL=gpt-4o
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
GEMINI_MODEL=gemini-1.5-pro
```

## Environment Variables

**Only API keys should be stored in `.env`:**

```bash
# LLM Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Optional: API Base URLs (for custom endpoints)
OPENAI_API_BASE_URL=https://api.openai.com/v1
ANTHROPIC_API_BASE_URL=https://api.anthropic.com
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Optional: Organization/Project (OpenAI only)
OPENAI_ORGANIZATION=org-...
OPENAI_PROJECT=proj-...

# Model selection is handled in models.json (override with env vars above)
```

## Customization

1. **Prompts**: Edit `prompts.json` to modify system prompts or add new task types
2. **Models**: Edit `models.json` to change recommended models or update pricing
3. **Overrides**: Use environment variables for runtime model selection

## Adding New Providers

1. Add provider config to `models.json`
2. Update `models.ts` types
3. Update `getModel()` function to handle new provider
