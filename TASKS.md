# 15) Documentation & ops

Use this checklist to complete the documentation tasks from `PLAN.md`.

## Pre-requisites

- [ ] Make atomic commits per task with scope in the message (example: `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`).
- [ ] Reference the originating `PLAN.md` section in each commit.
- [ ] Gather external references from `PLAN.md` footnotes (arXiv, Kontext, Weaviate) for cross-linking.

## README

- [ ] Document local setup and dependency installation with `pnpm`.
- [ ] Describe required environment variables and how to copy `.env.local.example`.
- [ ] Explain how to run, build, lint, and test the project.
- [ ] Outline model and pipeline switches (OpenAI model, OCR toggles).
- [ ] Link to the arXiv API terms: https://info.arxiv.org/help/api/index.html.

## API.md

- [ ] Describe `/api/ingest` request and response JSON.
- [ ] Document `/api/summarize` payload structure and response schema.
- [ ] Document `/api/qa` request fields and answer format.
- [ ] Capture common headers and error handling conventions.

## PRIVACY.md

- [ ] State that personas are stored in Weaviate as the source of truth.
- [ ] Clarify that Kontext returns only a derived system prompt.
- [ ] Confirm that no raw mailbox or document content is persisted by Readable.
- [ ] Enumerate external services invoked during ingest and generation.

## TASKS.md upkeep

- [ ] Update this checklist as tasks are completed or requirements change.

## Accept criteria

- [ ] A new developer can follow the docs to get a working environment.
- [ ] Documentation references the relevant external resources.

## Commit

- [ ] `docs: add README, API.md, PRIVACY.md, TASKS.md`
