# Prompts

Every system prompt, user-prompt requirement, and context limit lives in
**`src/server/llm-config/prompts.json`** and is read through the accessors in
`src/server/llm-config/index.ts`. Per-task model choices live alongside it in
`models.json` / `models.ts`.

> **Rule:** never inline a prompt string or a model id at a call site. Add it to
> `prompts.json` / `models.json` and read it through the accessor.

There is no `src/server/prompts/` module. One existed as a duplicate of
`llm-config/` and has been deleted; if you find a reference to it, it is stale.

## Accessors

| Function                        | Returns                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `getSystemPrompt(task)`         | The base system prompt for `'paper_summary' \| 'selection_summary' \| 'qa'`.     |
| `getPaperSummaryRequirements()` | The `string[]` of task requirements injected into the paper-summary user prompt. |
| `getPromptLimits()`             | The truncation/count limits below.                                               |
| `getPromptsConfig()`            | The whole typed `PromptConfig` object.                                           |
| `getModel(task)`                | The model id for a task (from `models.json`).                                    |

## The three prompt tasks

### `paper_summary` — `src/server/summarize/index.ts`

- System prompt: `getSystemPrompt('paper_summary')`.
- User prompt: `buildUserPrompt()` assembles a metadata block (title, authors,
  primary category, published date, abstract), a section outline, figure context,
  and finally the requirement list from `getPaperSummaryRequirements()`.
- The requirements drive the output shape: JSON with `sections[]`,
  `key_findings[]`, `figures[]`; at least three sections; reasoning before
  results; `supporting_sections` cited by provided ID (e.g. `S1`); no invented IDs
  or page numbers.

### `selection_summary` — `src/server/editor/selection.ts`

- System prompt: `getSystemPrompt('selection_summary')` — 3–5 grounded bullets
  plus a short "deeper dive", citing evidence by `chunk_id`.
- User prompt: `buildSelectionUserPrompt(paperId, selection, evidence)` — the
  paper ID, the highlighted text, and the retrieved chunks (id, section, page,
  text truncated to `limits.text_truncate`, inline citations).
- The response schema forces complete citations; see the response invariants in
  [`API_ANALYSIS.md`](./API_ANALYSIS.md).

### `qa` — `src/server/qa/index.ts`

- System prompt: `getSystemPrompt('qa')` — answer only from supplied evidence,
  cite page numbers inline as `(page N)`, say so explicitly when the evidence
  does not contain the answer, and obey the JSON schema exactly.
- User prompt: `buildQaUserPrompt(question, evidence)` — the question, the
  retrieved evidence chunks, relevant citations (optionally enriched via Semantic
  Scholar) and figures.

## Limits

From `prompts.json` → `limits`, read via `getPromptLimits()`:

| Key                       | Value | Applies to                            |
| ------------------------- | ----- | ------------------------------------- |
| `section`                 | 10    | max sections in the summary outline   |
| `paragraph`               | 3     | max key paragraphs per section        |
| `figure`                  | 6     | max figures in figure context         |
| `paragraph_truncate`      | 360   | chars per outline paragraph           |
| `figure_caption_truncate` | 280   | chars per figure caption              |
| `figure_context_truncate` | 320   | chars per figure supporting paragraph |
| `abstract_truncate`       | 1200  | chars of abstract                     |
| `text_truncate`           | 420   | chars per evidence chunk              |

These exist to keep prompts inside the context window; change them in
`prompts.json`, not at the call site.

## Persona prefixes (currently inert)

Each task in `prompts.json` still carries a `persona_prefix` field, left over from
the removed Kontext.dev integration that fetched a persona-specific system prompt
and merged it with the base. **That integration is gone**, along with the
`kontext_prompts` cache table. `getSystemPrompt()` returns the base prompt as-is
and never reads `persona_prefix`.

Persona data is still collected — every Q&A and summarize response is required by
schema to return a `concepts[]` list, which `src/server/persona/record.ts` upserts
into `persona_concepts` — but it is not currently fed back into prompts.

## Common patterns

- All three tasks use a strict JSON response schema; free-form text is not accepted.
- Evidence chunks are always supplied with their IDs so answers can be grounded.
- Page numbers and section IDs are emphasized so the model cannot invent anchors.
- Truncation limits are centralized rather than hard-coded per call site.
