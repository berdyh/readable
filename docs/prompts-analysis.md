# Prompts Analysis for Summarization Backend

This document lists all prompts used in the summarization backend.

## 1. Paper Summarization Prompt (`src/server/summarize/index.ts`)

### System Prompt (BASE_SYSTEM_PROMPT)
```typescript
BASE_SYSTEM_PROMPT = "You are Readable's persona-aware research assistant. Your job is to guide a reader through a technical paper by explaining the reasoning first and the results second. Always surface: what the authors are trying to achieve, why the approach makes sense, how evidence supports claims, and what limitations or open questions remain. Keep the tone professional, helpful, and grounded in the supplied material—never invent citations or facts."
```

**Location**: Line 15 in `src/server/summarize/index.ts`

### User Prompt Structure
The user prompt is built from:
1. **Metadata Block**: Title, authors, primary category, published date, abstract
2. **Section Outline**: Up to 10 sections with:
   - Section ID, title, page span
   - Referenced figure IDs
   - Key paragraphs (up to 3 per section, truncated to 360 chars)
3. **Figure Context**: Up to 6 figures with:
   - Figure ID, caption (truncated to 280 chars), page number
   - Referenced section IDs
   - Supporting paragraphs (truncated to 320 chars)
4. **Task Requirements**:
   - Return JSON with keys: sections[], key_findings[], figures[]
   - Always produce at least three sections
   - Lead each section with authors' reasoning/goal, then methods, then results
   - key_findings[] should cite supporting_sections using IDs (e.g., S1)
   - figures[] must explain why the figure matters
   - Do not invent IDs or page numbers
   - Keep explanations concise but information-dense

**Function**: `buildUserPrompt()` (Line 274)

### Persona Prompt Merging
- Fetches from Kontext API (optional)
- If persona prompt exists: `${personaPrompt}\n\n---\n${BASE_SYSTEM_PROMPT}`
- If not: Uses `BASE_SYSTEM_PROMPT` only

**Function**: `mergeSystemPrompt()` (Line 306)

## 2. Selection Summary Prompt (`src/server/editor/selection.ts`)

### System Prompt (BASE_SUMMARY_SYSTEM_PROMPT)
```typescript
BASE_SUMMARY_SYSTEM_PROMPT = "You are Readable's inline summarizer. Given a reader's highlighted passage and the retrieved chunks from the paper, produce:
- A tight list of 3-5 bullet insights grounded in the evidence.
- A short 'deeper dive' section (1-3 paragraphs) that expands on the nuance.
Use only the supplied evidence chunks and cite them by chunk_id."
```

**Location**: Line 19 in `src/server/editor/selection.ts`

### User Prompt Structure
The user prompt includes:
1. **Paper ID**
2. **Selected Text**: The highlighted passage
3. **Evidence Chunks**: Retrieved chunks with:
   - Chunk ID, section, page number
   - Full text (truncated to 420 chars)
   - Citations referenced in chunk

**Function**: `buildSelectionUserPrompt()` (Line 113)

### Persona Prompt Merging
- Fetches from Kontext API with taskId: `'inline_research_summary'`
- Format: `${BASE_SUMMARY_SYSTEM_PROMPT}\n\nPersona guidance:\n${personaPrompt}`

## 3. QA Response Prompt (`src/server/qa/index.ts`)

### System Prompt
The QA system prompt is built dynamically and includes:
1. Base instruction to answer questions based on evidence chunks
2. Optional persona guidance from Kontext API

**Location**: `buildQaSystemPrompt()` function

### User Prompt Structure
Includes:
1. **Question**
2. **Evidence Chunks**: Retrieved chunks with full context
3. **Relevant Citations**: Top 4 citations with enrichment from arXiv
4. **Relevant Figures**: Figures referenced in chunks
5. **Instructions**: To cite chunks and use evidence

**Function**: `buildQaUserPrompt()` (Line 127)

## 4. Kontext API Integration (`src/server/summarize/kontext.ts`)

### Request Structure
Fetches persona-aware system prompts from Kontext API:
- **Task IDs used**:
  - `'summarize_research_paper'` - For full paper summaries
  - `'inline_research_summary'` - For selection summaries
- **Parameters**: `taskId`, `paperId`, `userId`, `personaId`
- **Returns**: System prompt string or undefined (falls back gracefully)

**Default timeout**: 8 seconds
**Base URL**: `https://api.kontext.dev`

## Summary

### Prompt Locations:
1. **Paper Summarization**: `src/server/summarize/index.ts` (Lines 15, 274, 306)
2. **Selection Summary**: `src/server/editor/selection.ts` (Lines 19, 113, 347)
3. **QA Responses**: `src/server/qa/index.ts` (Line 127)

### Common Patterns:
- All prompts use structured JSON schemas for responses
- Persona prompts are optional and merge with base prompts
- Evidence chunks are always included with citations
- Page numbers and section IDs are emphasized for grounding
- Truncation limits ensure prompts don't exceed token limits

