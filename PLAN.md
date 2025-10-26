## Project Plan: Personalized AI Paper Summarizer and Tutor

### Overview

This project aims to build a web application that helps users read and understand research papers (initially focusing on arXiv papers) with the assistance of AI. The app will fetch a paper by its arXiv ID and generate a **concise, plain-language summary** of the paper’s key points, including explanations of important figures, graphs, and charts. Uniquely, the summary and Q&A will be **personalized** to the user’s existing knowledge: the system will leverage the user’s own knowledge profile (via Kontext.dev) to tailor explanations and avoid redundant detail. The user can interactively ask follow-up questions through a chat interface(that is inspired by notion.ai's chat interface ui), or dive deeper into parts of the summary(where we can call tools like in notion.ai's "/" tool calling). The tool will dynamically identify prerequisite concepts for each section of the paper and either explain them or ask the user if they’re familiar, updating the user’s knowledge profile accordingly. The end goal is to make complex academic papers more accessible by presenting information at the right level for each user.

### Key Features and Goals

- **ArXiv Paper Ingestion**: Allow the user to input an arXiv ID (or URL) of a paper. The app will retrieve the paper’s content (title, abstract, and full text or PDF) and key metadata. We will use arXiv’s public data (and possibly PDF parsing using this model: [https://github.com/deepseek-ai/DeepSeek-OCR]) to get the abstract, sections (like table of contents or headings), and figures for analysis.
- **Multi-Pass Summarization**: Automatically generate a clear summary of the paper’s main contributions and findings. The summary should follow a “multiple passes” reading strategy inspired by best practices (e.g. first overview the title/abstract and figures, then delve deeper) – presenting the **high-level idea first**, then important details and results[https://news.ycombinator.com/item?id=45292648#:~:text=Shameless%20plug%20but%20I%20made,arXiv.org%20papers%20questions [1]][https://news.ycombinator.com/item?id=45292648#:~:text=I%20built%20it%20because%20it,it%20and%20give%20a%20prompt [2]]. It should highlight the answers to questions like: ''What problem does this paper address? What are the key methods or approaches? What are the main results? Why do they matter?'' The summary will also include explanations of important **figures, graphs, or tables** (e.g. summarizing what a chart shows and why it’s significant). All essential content will be visible (no hidden sections that require extra clicks), so the user gets a comprehensive but digestible overview in one go.
- **Personalized Context via Kontext.dev**: Integrate with **Kontext.dev** to adjust the summary and explanations to the user’s background. Users can optionally connect their data (e.g. authorize their Gmail or other sources through Kontext) to create a **persona** or profile of their knowledge. Kontext will extract structured facts about the user’s context and knowledge from those sources[https://docs.kontext.dev/documentation/welcome#:~:text=Kontext%20is%20the%20context%20layer,ensure%20full%20auditability%20and%20security [3]][https://docs.kontext.dev/documentation/welcome#:~:text=,enforces%20privacy%20when%20building%20context [4]]. For example, if the user’s emails or documents indicate they are a machine learning expert but not familiar with, say, quantum physics, the summary can presume ML knowledge but should carefully explain any quantum physics concepts. The app will use Kontext’s API (e.g. kontext.profile.getProfile) on each AI request to retrieve a **personalized context (systemPrompt)** for the LLM, ensuring outputs are tailored to the user’s known facts.
- **Interactive Prerequisite Q&A**: The system will dynamically handle prerequisite knowledge gaps. For each major topic or technical term in the paper, it will determine if the user likely knows it (by checking the Kontext profile or prior interactions). If the user **does not** have that prerequisite, the system can either:
  - Prompt the user with a quick question like ''“Are you familiar with [Concept X]?”'' at the moment it becomes relevant.
  - If the user says **yes**, we record that knowledge (and possibly update Kontext) and proceed without a redundant explanation. If **no**, the system will provide a brief, focused explanation of that concept before continuing. To explain that concept the system first will search for cited research papers on that topic in the current paper, if there is then grab the citet paper and create summary of it for expaining the topic. This way, the summary or explanation of the paper is augmented only as needed, and the user isn’t overwhelmed upfront with a barrage of questions or extraneous info. Each new piece of knowledge the user learns would be **added to their Kontext profile** dynamically (so the app remembers that the user now knows Concept X for future sessions).
- **Question-Answer Chat Widget**: After (or during) the summary, the user can ask questions about any part of the paper via a chat interface. They might click or highlight a portion of the summary (or even a section of the original paper text) and ask for more detail, clarification, or related information. The chat widget will provide answers using the paper’s content and the user’s context. It will reference specific sections or page numbers of the paper when relevant (e.g. “As shown in ''Figure 2 (page 5)'', …”) and those references will be clickable to scroll the paper viewer[https://news.ycombinator.com/item?id=45292648#:~:text=I%20built%20it%20because%20it,it%20and%20give%20a%20prompt [2]]. The Q&A will also utilize the user’s knowledge profile to tailor explanations. For example, if a question involves a concept not explained yet, the assistant might ask or explain it as per the user’s profile. On the summary the chat should be in the popup window when user highlights specific part and clicks on "Ask question" button. Each interaction in the chat will also update the user’s Kontext profile as they learn new concepts.
- **Modern Minimalist UI**: Design the interface to be clean and minimalistic, focusing on content. The interaction flow will be: **Home page** with input fields, then an **Analysis view** with the summary and Q&A. We want a look inspired by modern tools like Notion or AppFlowy – a neat two-pane layout or a single document-style page. After the user enters the paper ID (and optionally connects their persona), the paper’s PDF or content might briefly show (for context), then transition with a nice animation to a “Analyzing paper…” loading screen with background as following animation [https://loading.io/pattern/i-ng8xfb]. Once ready, the summary appears in a well-formatted way: possibly as a scrollable page of text broken into sections, with headings, bullet points for main findings, and inline images or figure thumbnails where applicable. The design should support a pop-up with possible tool callings or - similar to how Notion or AppFlowy might allow opening a contextual help or comment thread - you can take "page" section ui from AppFlowy's [https://github.com/AppFlowy-IO/AppFlowy] open source code. Overall, the UI should feel intuitive and not cluttered, using a consistent color scheme and typography (we can take cues from AppFlowy’s simplicity or Notion’s clear layout).

### Tech Stack and Components (rewritten)

- **Next.js 13+ (TypeScript)**
  - Start with `create-next-app` defaults. Use API routes for `/api/ingest`, `/api/summarize`, `/api/qa`. Keep SSR/edge optional; add config only when needed (e.g., PDF worker paths). PostHog client/server SDKs fit cleanly with the App Router. ([posthog.com][1])

- **LLM providers**
  - **OpenAI** as primary (config via env). Keep **Gemini** as a drop-in alternative, mirroring the asXiv repo pattern (Gemini key + model via env). If you later process PDFs natively with Gemini, use its document-understanding API. ([GitHub][2])

- **Paper ingestion & parsing (no manual copy/paste)**
  - Prefer **HTML when available**: use **ar5iv** (arXiv→HTML via LaTeXML) to cheaply extract sections, headings, captions. Fall back to PDF. ([ar5iv][3])
  - **PDF rendering & selection**: **PDF.js** for render/textLayer; **react-pdf-highlighter** (or extended forks) to capture highlight text + page/bboxes, show a context popup, and wire “Explain”/“Ask” actions—so highlights go straight to the side chat with page anchors. ([mozilla.github.io][4])
  - **Structure & references**: run **GROBID** (PDF→TEI) to recover sections, bibliography, figure captions for reliable chunking and citation graph. ([grobid.readthedocs.io][5])
  - **OCR fallback**: **DeepSeek-OCR** (open source; vLLM-compatible) for scanned PDFs, tables, and figure text. ([GitHub][6])
  - **Metadata**: pull title/abstract/authors from the official **arXiv API** when needed. ([info.arxiv.org][7])

- **RAG store & persona graph**
  - **Weaviate (Cloud)** as the single database for: `PaperChunk`, `Figure`, `Citation`, `PersonaConcept`, `Interaction`. Use **hybrid search** (BM25 + vectors) to ground answers in the selected span, section, and nearby context. Access via the official **TypeScript client**. ([docs.weaviate.io][8])
  - Embed with OpenAI or Weaviate’s built-in embeddings; store `(text, page, section, figIds, refIds, tags)` so highlights resolve to `(page N)` links automatically. ([docs.weaviate.io][8])

- **Prerequisites & cited-paper lookups**

- For unfamiliar terms, first try to explain from the current paper; if it cites a definition/tutorial, attempt to fetch that paper’s abstract via the **arXiv API** when an arXiv identifier is available. If it isn’t, fall back to the LLM’s research search capability to synthesize a 2–3 sentence explainer, then persist as a `PersonaConcept`.

- **Persona (Kontext.dev is optional)**
  - **Source of truth**: the persona graph in **Weaviate** (concepts learned, interactions).
  - **Optional enrichment**: when connected, call Kontext’s React/Next SDK to obtain a per-user `systemPrompt` (e.g., `getProfile({ userId, task, userQuery })`) and blend into prompts; periodically distill/import facts back into Weaviate. ([docs.kontext.dev][10])

- **Analytics & agent ergonomics**
  - **PostHog** for events (PaperAnalyzed, SelectionExplained, QuestionAsked, PersonaUpdated) with the Next.js guide; for agents, install the **PostHog MCP server** so they can query docs and telemetry via MCP during development. ([posthog.com][1])

- **UI affordances (supporting libs)**
  - Keep the main doc view minimal; for slash-commands in the summary pane (Notion-style “/”), you can add a TipTap slash menu when/if you introduce an editable block surface. (Optional; not required for MVP.) ([tiptap.dev][11])

[1]: https://posthog.com/docs/libraries/next-js?utm_source=chatgpt.com "Next.js - Docs"
[2]: https://github.com/montanaflynn/asxiv?utm_source=chatgpt.com "montanaflynn/asxiv: An AI-powered interface for exploring ..."
[3]: https://ar5iv.labs.arxiv.org/?utm_source=chatgpt.com "ar5iv – Articles from arXiv.org as responsive HTML5 web ..."
[4]: https://mozilla.github.io/pdf.js/examples/?utm_source=chatgpt.com "PDF.js - Examples"
[5]: https://grobid.readthedocs.io/en/latest/Introduction/?utm_source=chatgpt.com "Introduction - GROBID Documentation - Read the Docs"
[6]: https://github.com/deepseek-ai/DeepSeek-OCR/tree/main?utm_source=chatgpt.com "deepseek-ai:main"
[7]: https://info.arxiv.org/help/api/user-manual.html?utm_source=chatgpt.com "arXiv API User's Manual"
[8]: https://docs.weaviate.io/weaviate/search/hybrid?utm_source=chatgpt.com "Hybrid search | Weaviate Documentation"
[10]: https://docs.kontext.dev/documentation/getting-started-react?utm_source=chatgpt.com "React - Kontext SDK"
[11]: https://tiptap.dev/docs/ui-components/components/slash-dropdown-menu?utm_source=chatgpt.com "Slash Dropdown Menu - UI Components"
[12]: https://github.com/agentcooper/react-pdf-highlighter?utm_source=chatgpt.com "agentcooper/react-pdf-highlighter"
[13]: https://docs.weaviate.io/weaviate/concepts/search/hybrid-search?utm_source=chatgpt.com "Hybrid search | Weaviate Documentation"
[14]: https://posthog.com/docs/model-context-protocol?utm_source=chatgpt.com "Model Context Protocol (MCP) - Docs"

### System Architecture & Workflow

**Overall flow**

1. **Home (/**)\*\*

- Input: arXiv ID/URL. Optional **“Personalize with Kontext”**. If connected, fetch a `systemPrompt` for the user (kept server-side); if skipped, fall back to a lightweight persona (novice/intermediate/expert selector). Persona facts are stored in **Weaviate** as the source of truth; Kontext is an optional enricher you can call per request. ([docs.kontext.dev][1])
- Prompt the user once for a contact email (stored in local preferences) so future arXiv API calls can include it in headers/query per usage etiquette.

2. **Ingest (server, `/api/ingest`)**

- **Prefer HTML**: try **ar5iv** to get clean sections, math, captions; fall back to PDF. ([ar5iv][2])
- **PDF path**: render with **PDF.js**; extract selectable text via textLayer mapping (keep `(page, bbox)` for every span). Use **react-pdf-highlighter** (or its extended fork) to support highlight capture + popup UX. ([Stack Overflow][3])
- **Structure & citations**: run **GROBID** to produce TEI (sections, bibliography, figure captions) for robust chunking/linking; store figure captions and reference graph. Use OCR (**DeepSeek-OCR**) only for scanned/low-text PDFs. ([grobid.readthedocs.io][4])
- **Upsert to Weaviate**: split into `PaperChunk` (text, section, pageStart/End, refIds), `Figure`, `Citation`. Generate embeddings (OpenAI or Weaviate Embeddings) and enable **hybrid search** (BM25+vector). ([docs.weaviate.io][5])

3. **Analyze → Summarize (server, `/api/summarize`)**

- Build prompt: (a) persona context (Kontext `systemPrompt` if connected, else persona from Weaviate), (b) paper metadata (title/abstract/sections), (c) instructions to produce a **reasoning-first summary** with figure callouts and standardized page anchors `(page N)` for deep-linking. Return a **structured JSON** (`sections[]`, `key_findings[]`, `figures[]`), not just free text. ([docs.kontext.dev][1])
- Show **“Analyzing…”** screen while summarization runs; then persist the summary object and render.

4. **Render Summary (client)**

- Left: summary (all content visible; no hidden accordions). Right: collapsible PDF viewer. Clicking `(page N)` opens the PDF view and scrolls to the anchor. (Use the stored `(page, bbox)` map from ingestion.) ([GitHub][6])
- Notion-style **“/” actions** on selected text (Explain term, Compare to prior work, Show figure N, ELI5, Depth±). The selection popup is fed the exact text + `(page, section)` so the model can stay grounded.

5. **Prerequisite micro-checks (inline)**

- A lightweight LLM pass on the summary produces `prereqs[]` with evidence spans. Cross-check against `PersonaConcept` in Weaviate. If missing, show a **micro-question** at point-of-need (not a survey). If the user selects **“Need context”**, first try to explain from local chunks; if the concept is **cited**, attempt to retrieve that paper’s abstract via the **arXiv API** (when an arXiv ID is present); otherwise, use the LLM’s research search mode to craft a 2–3 sentence explainer and store it as a learned `PersonaConcept`.

6. **Q&A (server, `/api/qa`)**

- Source grounding = **Weaviate hybrid search** constrained by `paperId` + selection context (text, page, section). Attach nearby figures/captions and relevant references. Answer with inline citations and normalized `(page N)` anchors. Persist `Interaction` (question, spans used) and persona updates. ([docs.weaviate.io][8])

7. **Persona lifecycle**

- **Primary store**: Weaviate (`PersonaConcept`, `Interaction`).
- **Optional Kontext**: on request, call `getProfile({ userId, task, userQuery? })` to fetch a tailored `systemPrompt`; periodically distill back durable facts into Weaviate (no raw emails stored). ([docs.kontext.dev][1])

8. **Analytics & agent ergonomics**

- Track: `PaperAnalyzed`, `SelectionExplained`, `QuestionAsked`, `PersonaUpdated`, errors. Integrate via **PostHog** Next.js guide. For agent workflows, install the **PostHog MCP server** so agents can query docs/telemetry during development. ([posthog.com][9])

**Notes**

- **Citations/refs**: For cited-paper fetches, prefer the arXiv API when citations include arXiv identifiers. If metadata is missing, query the LLM’s research search capability directly and cache the synthesized summary for reuse.
- **ArXiv metadata**: supplement with arXiv API for title/abstract/authors if HTML/TEI is delayed. ([arXiv][11])
- **Highlight UX**: prefer pdf.js textLayer + `react-pdf-highlighter` for robust selection popups; avoid pure `react-pdf` textLayer mismatches. ([GitHub][6])

[1]: https://docs.kontext.dev/documentation/getting-started-react?utm_source=chatgpt.com "React - Kontext SDK"
[2]: https://ar5iv.labs.arxiv.org/?utm_source=chatgpt.com "ar5iv – Articles from arXiv.org as responsive HTML5 web ..."
[3]: https://stackoverflow.com/questions/33063213/pdf-js-with-text-selection?utm_source=chatgpt.com "pdf.js with text selection - javascript"
[4]: https://grobid.readthedocs.io/en/latest/Introduction/?utm_source=chatgpt.com "Introduction - GROBID Documentation - Read the Docs"
[5]: https://docs.weaviate.io/weaviate/model-providers/openai/embeddings?utm_source=chatgpt.com "Text Embeddings | Weaviate Documentation"
[6]: https://github.com/agentcooper/react-pdf-highlighter?utm_source=chatgpt.com "agentcooper/react-pdf-highlighter"
[8]: https://docs.weaviate.io/weaviate/concepts/search/hybrid-search?utm_source=chatgpt.com "Hybrid search | Weaviate Documentation"
[9]: https://posthog.com/docs/libraries/next-js?utm_source=chatgpt.com "Next.js - Docs"
[11]: https://arxiv.org/html/2402.08954v1?utm_source=chatgpt.com "HTML papers on arXiv: why it's important, and how we ..."

### Implementation Steps (Tasks Breakdown)

> Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

---

## 0) Repo bootstrap & env

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Clean Next.js 13+ TS app, basic folders, env scaffolding.
**PLAN.md refs**: “## 7) Tech stack & key choices”, “## 3) System architecture (high level)”.

**Steps**

- `pnpm create next-app --ts` (or reuse asXiv only for reference; start fresh for control).
- Add `src/` with `app` or `pages`, plus `/api` routes folder.
- Create `.env.local.example` with `OPENAI_API_KEY`, `WEAVIATE_URL`, `WEAVIATE_API_KEY`, `POSTHOG_KEY`, `KONTEXT_API_KEY`, `SEMANTIC_SCHOLAR_KEY` (post-MVP, optional).
- Add lint/format hooks.

**MCP tools**

- `mcp_servers.deepwiki`: skim **asXiv** structure & chat route idioms. ([GitHub][1])

**Accept**

- `pnpm dev` runs; app health page loads.
- Env example present and documented.

**Commit**
`chore(repo): scaffold Next.js TS app and env templates`

---

## 1) Weaviate setup & schema

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Cloud instance + TS client + classes (`PaperChunk`, `Figure`, `Citation`, `PersonaConcept`, `Interaction`) with **hybrid search** enabled.
**PLAN.md refs**: “## 5) RAG & prerequisite logic”, “## 7) Tech stack & key choices”, “## 14) Setup snippets”.

**Steps**

- Provision Weaviate (Cloud/SaaS).
- Install TS client and init client module. ([docs.weaviate.io][2])
- Define schema (vectorizer + BM25) and enable **hybrid search** (RRF). ([docs.weaviate.io][3])
- Add helper functions: upsert chunks, hybrid query by `paperId`, page window.

**MCP tools**

- `mcp_servers.deepwiki`: pull code snippets for hybrid queries & schema examples (if available).
- (Optional later) create a tiny **custom** Weaviate MCP wrapper that forwards GraphQL/REST; not required for MVP.

**Accept**

- `npm run test:weaviate` ping and schema create pass.
- Hybrid query returns results for seeded docs.

**Commit**
`feat(db): add Weaviate client and hybrid schema for chunks/figures/citations/persona`

---

## 2) Ingestion pipeline (HTML ➝ PDF ➝ TEI ➝ OCR)

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Robust ingestion with graceful fallbacks; persist to Weaviate.
**PLAN.md refs**: “## 4) Paper ingestion & parsing”, “## 9) APIs & env”, “## 15) MVP cut”.

**Steps**

1. **HTML first**: try **ar5iv** HTML for sections/math/captions; parse headings/paragraphs/captions. ([ar5iv][4])
2. **PDF path**: fetch arXiv PDF URL and run `pdfjs-dist` (server-side) to extract page text and detect figure/table captions via regex for now; capture image metadata via operator list. ([GitHub][5])
3. **Structure/refs**: run **GROBID** (docker) to get TEI (sections, bibliography, figure captions). Parse TEI into `PaperChunk`, `Citation`, `Figure`. ([GitHub][6])
4. **Hybrid detection**: sample the first three PDF pages (avg text per page + image density) to decide if the document is likely scanned; keep `pdfjs-dist` as default, routing to DeepSeek only when the heuristic (or force flag) says so.
5. **OCR fallback**: **DeepSeek-OCR** for scanned or image-heavy docs; prefer when text layer is thin. When we’re ready to host it, use RunPod Serverless (vLLM template → model `deepseek-ai/deepseek-ocr`, ≥24 GB VRAM), then drop the endpoint/API key into env to enable the fallback automatically. ([GitHub][7])
6. **Metadata**: fetch title/abstract/authors from arXiv API as fast path. ([info.arxiv.org][8])
7. **Contact email**: pull the user-provided contact email from local storage/session and include it in arXiv requests (query param or header) to respect usage etiquette.
8. **Upsert**: chunk by section with `(text, section, pageStart/End, refIds, figIds, tags)` and embed (OpenAI or Weaviate embeddings).
9. Return an internal `IngestResult { paperId, pages, sections[], refs[], figures[] }`.

**MCP tools**

- `mcp_servers.deepwiki`: examples of arXiv HTML use and PDF handling (check **asXiv**). ([GitHub][1])

**Accept**

- Given `arxivId`, endpoint `/api/ingest` returns structured `IngestResult` and data visible in Weaviate.

**Commit**
`feat(ingest): add ar5iv→PDF.js→GROBID→OCR pipeline and Weaviate upserts`

---

## 3) PDF viewer with highlights & deep-links

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Client viewer that supports highlight selection, popup actions, and `(page N)` deep-link scroll.
**PLAN.md refs**: “## 6) UI/UX notes”, “## 9) APIs & env”.

**Steps**

- Integrate **PDF.js** viewer; ensure textLayer overlay for selection mapping. ([mozilla.github.io][9])
- Use `react-pdf-highlighter` (or extended) for selection + popover; import CSS. ([GitHub][10])
- Implement a `scrollTo(page, bbox?)` method; register handler to clickable `(page N)` in summary/chat.
- Verify react-pdf v7 textLayer CSS if you choose react-pdf stack anywhere. ([Stack Overflow][11])

**MCP tools**

- `mcp_servers.deepwiki`: inspect patterns in **asXiv** for page-linking UX. ([GitHub][1])

**Accept**

- Clicking `(page 5)` in a dummy text jumps in viewer.
- Selecting text shows popup with **Explain** / **Ask** buttons.

**Commit**
`feat(ui): add PDF viewer with highlight popover and (page N) deep-link support`

---

## 4) Summarization endpoint `/api/summarize`

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Persona-aware, reasoning-first summary with figure callouts and normalized `(page N)` anchors.
**PLAN.md refs**: “## 3) System architecture (high level)”, “## 5) RAG & prerequisite logic”.

**Steps**

- Accept `{ paperId }`; load metadata, section outline, key captions (from Weaviate/ingest result).
- If connected, fetch Kontext `systemPrompt` for task `summarize_research_paper`. ([docs.kontext.dev][12])
- Compose prompt (system: role + persona; user: minimal instruction).
- Call OpenAI (default) or Gemini (env switch per asXiv pattern).
- Post-process to produce **structured JSON**: `{ sections[], key_findings[], figures[] }` and normalize `(page N)`.

**MCP tools**

- `mcp_servers.kontext`: test `get-context` flow and payload.
- `mcp_servers.deepwiki`: skim **asXiv** chat route pattern (model switching). ([GitHub][1])

**Accept**

- For a known paper, endpoint returns coherent JSON summary with at least 3 section blocks and figure notes including `(page N)`.

**Commit**
`feat(api): add persona-aware /api/summarize producing structured JSON`

---

## 5) Summary page & transitions

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Render full summary (no hidden sections), two-pane layout with collapsible PDF, animated “Analyzing…”.
**PLAN.md refs**: “## 6) UI/UX notes”, “## 2) Goals & success criteria”.

**Steps**

- Add “Start” → show loading pattern → render summary in left pane; right pane is hidden PDF viewer that opens on page-link click.
- Add Notion-like “/” actions on selected text (Explain term, Compare, ELI5, Depth±) that call `/api/qa`.

**MCP tools**

- `mcp_servers.deepwiki`: pull design cues/snippets as needed.

**Accept**

- Smooth transition; `(page N)` opens viewer and scrolls.

**Commit**
`feat(app): summary view with analyzing transition and two-pane PDF reveal`

---

## 6) Q&A endpoint `/api/qa` (RAG)

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Grounded answers using **Weaviate hybrid search** constrained by `paperId` and selection context.
**PLAN.md refs**: “## 5) RAG & prerequisite logic”, “## 6) UI/UX notes”.

**Steps**

- Input: `{ paperId, question, selection?: { text, page, section } }`.
- Hybrid search: keyword+vector within `paperId`; expand to neighboring pages/sections; attach figure captions. ([docs.weaviate.io][3])
- If missing prerequisite tied to a **citation**, try to pull the abstract via the arXiv API when an identifier is available; otherwise fall back to the LLM’s research search tool to synthesize a short abstract for grounding.
- Compose prompt with persona (Kontext optional), selected chunks, and ask for `(page N)` in references.
- Return `{ answer, cites: [{page, chunkId}] }`.

**MCP tools**

- `mcp_servers.kontext`: personalization on Q&A (task `qa_research_paper`).
- `mcp_servers.deepwiki`: check asXiv for context retrieval heuristics. ([GitHub][1])

**Accept**

- Ask “Explain self-attention” on 1706.03762: answer includes `(page N)` and quotes relevant chunk.

**Commit**
`feat(api): add /api/qa with Weaviate hybrid grounding and cited-ref enrichment`

---

## 7) Prerequisite micro-checks

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Inline missing-concept prompts and on-demand explainers; persist learned concepts.
**PLAN.md refs**: “## 5) RAG & prerequisite logic”.

**Steps**

- After `/api/summarize`, run a light LLM pass to extract `prereqs[]` with evidence spans.
- Cross-check Weaviate `PersonaConcept`.
- UI: dotted-underline terms → hover/Click shows **“Need context?”** → if yes, generate a 2–3 sentence explainer; if cited, prefer an arXiv abstract when available, otherwise rely on the LLM’s research search to synthesize the explainer.
- Persist `PersonaConcept{ name, firstSeenPaperId, learnedAt }`.

**MCP tools**

- `mcp_servers.kontext`: (optional) sync persona facts back to Kontext later.

**Accept**

- Terms not in persona show inline affordance; clicking yields a concise explainer; persona updated.

**Commit**
`feat(persona): inline prereq checks with explainers and concept persistence`

---

## 8) Kontext.dev integration (optional but supported)

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Connect sources, fetch `systemPrompt` per task, keep our Weaviate persona authoritative.
**PLAN.md refs**: “## 7) Tech stack & key choices”, “## 7) Persona lifecycle”.

**Steps**

- Add **Connect with Kontext** button (React SDK); obtain `userId` token. ([docs.kontext.dev][15])
- Server-only `Kontext` client to call **Get Context** before LLM calls. ([docs.kontext.dev][16])
- Do **not** store raw emails; distill facts to Weaviate `PersonaConcept`.

**MCP tools**

- `mcp_servers.kontext`: verify call shapes, test with dummy user.

**Accept**

- Toggling personalization changes tone/depth in summaries/answers.

**Commit**
`feat(kontext): optional persona enrichment via Kontext get-context`

---

## 9) Analytics (PostHog)

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Instrument key events; enable server+client capture.
**PLAN.md refs**: “## 8) Analytics & agent ergonomics”.

**Steps**

- Install `posthog-js` (client) + `posthog-node` (server); initialize per Next.js guide. ([posthog.com][17])
- Capture: `PaperAnalyzed`, `SelectionExplained`, `QuestionAsked`, `PersonaUpdated`, `Error`.
- (Dev) If you use a PostHog MCP, wire it for docs/telemetry during coding.

**MCP tools**

- `mcp_servers.posthog`: consult docs, verify events in dev.

**Accept**

- Events visible in PostHog; API routes also capture on server.

**Commit**
`feat(analytics): add PostHog client/server and key event capture`

---

## 10) UI polish & interactions

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Minimalist reading UX; slash menu; highlight→Ask; responsive basics.
**PLAN.md refs**: “## 6) UI/UX notes”.

**Steps**

- Summary typography; max-width column; headings & bullet lists.
- Slash “/” menu to trigger explain/compare/ELI5/depth± by sending to `/api/qa`.
- Highlight in summary → prefill question in Chat widget.
- PDF pane opens on demand; small-screen fallback is toggled layout.

**MCP tools**

- `mcp_servers.deepwiki`: pull small UI ideas/snippets.

**Accept**

- Smooth interaction; no hidden sections; highlight→Ask works.

**Commit**
`feat(ui): summary layout, slash actions, highlight→Ask wiring`

---

## 11) Cited-figure support (defer images if needed)

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: At least page-anchored figure callouts; optional canvas render of figure region.
**PLAN.md refs**: “## 4) Paper ingestion & parsing”, “## 6) UI/UX notes”.

**Steps**

- Ensure figures list includes page indices and captions (GROBID/HTML). ([GitHub][6])
- Provide “Show figure” button → scroll to page and outline region; optional render region to canvas for inline preview later.

**MCP tools**

- `mcp_servers.deepwiki`: look for code examples.

**Accept**

- Tapping a figure reference navigates to the right page reliably.

**Commit**
`feat(ux): figure callouts with (page N) navigation`

---

## 12) Caching & performance

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Avoid repeated parsing/embedding; faster re-visits.
**PLAN.md refs**: “## 7) Tech stack & key choices”.

**Steps**

- Cache `IngestResult` + chunk hashes (Redis/local for dev).
- Cache arXiv metadata responses and LLM research search snippets (TTL).
- Store last summary per `{paperId,userId}` to skip reruns unless invalidated.

**MCP tools**

- `mcp_servers.deepwiki`: check common cache patterns in similar repos.

**Accept**

- Re-analyzing same paper is 3–10× faster.

**Commit**
`perf(cache): cache ingest results and external lookups`

---

## 13) Error handling & UX fallbacks

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Graceful errors and retries.
**PLAN.md refs**: “## 12) Security & privacy”.

**Steps**

- Global error boundary for UI; retry CTA.
- API: timeouts, rate-limit backoff for arXiv and research-search calls; user-facing messages.

**MCP tools**

- `mcp_servers.posthog`: log errors and correlate with user actions.

**Accept**

- Simulate failures (arXiv down, API errors): UX remains informative.

**Commit**
`fix(ux): robust error states and rate-limit backoff`

---

## 14) Tests & scenarios

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: E2E sanity for 2–3 staple papers (e.g., 1706.03762).
**PLAN.md refs**: “## 15) MVP cut”.

**Steps**

- End-to-end: ingest→summarize→Q&A→page links→persona updates.
- Persona off vs on (Kontext) to validate tailoring. ([docs.kontext.dev][18])

**MCP tools**

- `mcp_servers.kontext`: fake profile runs.
- `mcp_servers.posthog`: verify events during tests.

**Accept**

- Test script passes; manual run shows coherent results.

**Commit**
`test(e2e): add flows for ingest, summary, qa, and persona toggle`

---

## 15) Documentation & ops

**Pre-requisites** Make **atomic commits** per task (include scope in message, e.g., `feat(api): add /api/ingest with ar5iv->PDF->GROBID pipeline`). Each task references where it maps back to your **PLAN.md** (searchable section headers) and lists **MCP tools** to use. You can access all links [{number}] in PLAN.md from last 40 lines.

**Goal**: Dev docs; API contracts; privacy notes.
**PLAN.md refs**: all referenced sections.

**Steps**

- `README`: setup, env, run, model switches; arXiv API & terms link. ([info.arxiv.org][19])
- `API.md`: `/api/ingest`, `/api/summarize`, `/api/qa` request/response JSON.
- `PRIVACY.md`: We store persona in Weaviate; Kontext returns only a system prompt; no raw mailbox storage. ([docs.kontext.dev][12])
- `TASKS.md`: copy this section into actionable checklists.

**MCP tools**

- `mcp_servers.deepwiki`: link external refs & snippets into docs.

**Accept**

- Fresh dev can follow docs to a working run.

**Commit**
`docs: add README, API.md, PRIVACY.md, TASKS.md`

---

## Quick reference to external docs used

- **asXiv repo**: structure & chat route patterns. ([GitHub][1])
- **ar5iv** (HTML from LaTeX): use when available; LaTeXML-based. ([ar5iv][4])
- **arXiv API**: metadata/abstracts. ([info.arxiv.org][8])
- **PDF.js** (viewer/textLayer) & dist package. ([mozilla.github.io][20])
- **react-pdf-highlighter** (popover, scroll to highlights). ([GitHub][10])
- **GROBID** (PDF→TEI, docker run). ([GitHub][6])
- **DeepSeek-OCR** (OCR fallback; vLLM support noted). ([GitHub][7])
- **Weaviate** (hybrid search; TS client). ([docs.weaviate.io][3])
- **OpenAI research tool** (reasoning models with web lookup fallback). ([openai.com][21])
- **PostHog** (Next.js integration). ([posthog.com][17])
- **Kontext.dev** (React + Get Context). ([docs.kontext.dev][15])

---

### Notes on logical workflow (tie-back)

- **Data path**: arXiv ➝ (HTML|PDF|OCR) ➝ TEI/sections ➝ Weaviate → LLM. (PLAN.md “## 4”, “## 5”). ([ar5iv][4])
- **UX path**: Home → Analyze (loading) → Summary (full) + PDF on demand → Highlight→Explain/Ask → Persona updates. (PLAN.md “## 6”, “## 3”).
- **Personalization**: Weaviate is the **source of truth**; Kontext is optional enrichment via `systemPrompt`. (PLAN.md “## 7”). ([docs.kontext.dev][12])

If you want, I can turn this into a `TASKS.md` with checkboxes and pre-written **Codex prompts** for each task including target MCP tool calls.

[1]: https://github.com/montanaflynn/asxiv?utm_source=chatgpt.com "montanaflynn/asxiv: An AI-powered interface for exploring ..."
[2]: https://docs.weaviate.io/weaviate/client-libraries/typescript?utm_source=chatgpt.com "JavaScript and TypeScript"
[3]: https://docs.weaviate.io/weaviate/concepts/search/hybrid-search?utm_source=chatgpt.com "Hybrid search | Weaviate Documentation"
[4]: https://ar5iv.labs.arxiv.org/?utm_source=chatgpt.com "ar5iv – Articles from arXiv.org as responsive HTML5 web ..."
[5]: https://github.com/mozilla/pdfjs-dist?utm_source=chatgpt.com "mozilla/pdfjs-dist: Generic build of PDF.js library."
[6]: https://github.com/kermitt2/grobid?utm_source=chatgpt.com "kermitt2/grobid: A machine learning software for extracting ..."
[7]: https://github.com/deepseek-ai/DeepSeek-OCR/tree/main?utm_source=chatgpt.com "deepseek-ai:main"
[8]: https://info.arxiv.org/help/api/user-manual.html?utm_source=chatgpt.com "arXiv API User's Manual"
[9]: https://mozilla.github.io/pdf.js/examples/?utm_source=chatgpt.com "PDF.js - Examples"
[10]: https://github.com/agentcooper/react-pdf-highlighter?utm_source=chatgpt.com "agentcooper/react-pdf-highlighter"

[11]: https://stackoverflow.com/questions/71702037/react-pdf-highlight-text-on-the-page-is-not-working?utm_source=chatgpt.com "React-pdf \"Highlight text on the page\" is not working"
[12]: https://docs.kontext.dev/api-reference/get-context?utm_source=chatgpt.com "Get Context - Kontext SDK"
[21]: https://platform.openai.com/docs/guides/reasoning/research?utm_source=chatgpt.com "Research mode - OpenAI Platform"
[15]: https://docs.kontext.dev/examples/react?utm_source=chatgpt.com "React - Kontext SDK"
[16]: https://docs.kontext.dev/documentation/getting-started-react?utm_source=chatgpt.com "React - Kontext SDK"
[17]: https://posthog.com/docs/libraries/next-js?utm_source=chatgpt.com "Next.js - Docs"
[18]: https://docs.kontext.dev/documentation/welcome?utm_source=chatgpt.com "Welcome to Kontext - Kontext SDK"
[19]: https://info.arxiv.org/help/api/index.html?utm_source=chatgpt.com "arXiv API Access"
[20]: https://mozilla.github.io/pdf.js/?utm_source=chatgpt.com "PDF.js - Home"
