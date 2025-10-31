# Prompts Configuration

This folder contains all system and user prompts used throughout the Readable backend.

## Structure

- `prompts.json` - JSON file containing all prompts and configuration
- `index.ts` - TypeScript utilities to load and use prompts

## Usage

```typescript
import { getSystemPrompt, getPromptLimits, getPaperSummaryRequirements } from '@/server/prompts';

// Get a system prompt for a specific task
const prompt = getSystemPrompt('paper_summary', personaPrompt);

// Get prompt limits
const limits = getPromptLimits();
const maxParagraphs = limits.paragraph; // 3

// Get requirements for paper summary
const requirements = getPaperSummaryRequirements();
```

## Task Types

- `paper_summary` - Full paper summarization
- `selection_summary` - Inline selection summaries
- `qa` - Question answering

## Adding New Prompts

Edit `prompts.json` to add new prompts or modify existing ones. The structure supports:
- System prompts (base + persona merging)
- User prompt requirements
- Configuration limits (truncation, item counts, etc.)

