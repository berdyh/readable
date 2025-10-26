# API Reference

Readable ships three REST endpoints under the Next.js App Router. All routes expect and return JSON.

| Endpoint         | Method | Purpose                                                                                                   |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `/api/ingest`    | `POST` | Fetches an arXiv paper, parses structure, persists it to Weaviate, and returns the parsed representation. |
| `/api/summarize` | `POST` | Generates a persona-aware structured summary for an ingested paper.                                       |
| `/api/qa`        | `POST` | Answers a question about an ingested paper using hybrid retrieval.                                        |

Common headers:

- `Content-Type: application/json`
- `Authorization: Bearer <token>` if your deployment sits behind auth (not enforced by default in this repo).

All endpoints return error objects in the shape `{ "error": "message" }` with appropriate HTTP status codes.

## POST /api/ingest

### Request body

```json
{
  "arxivId": "2401.01234",
  "contactEmail": "ops@example.com",
  "forceOcr": false
}
```

Field notes:

- `arxivId` _(string, required)_ - arXiv identifier without the `arXiv:` prefix.
- `contactEmail` _(string, optional)_ - identifies your integration to arXiv when direct PDF downloads occur.
- `forceOcr` _(boolean, optional)_ - bypass HTML/TEI parsing and use OCR-centric ingestion.

### Success response

`201 Created`

```json
{
  "paperId": "2401.01234",
  "title": "Example Paper Title",
  "abstract": "Short abstract...",
  "authors": ["Doe, Jane", "Smith, Alan"],
  "pages": 12,
  "sections": [
    {
      "id": "1",
      "title": "Introduction",
      "level": 1,
      "paragraphs": [
        {
          "id": "1.1",
          "text": "Paragraph text",
          "citations": ["ref-1"],
          "figureIds": ["fig-1"],
          "pageNumber": 1
        }
      ],
      "pageStart": 1,
      "pageEnd": 2
    }
  ],
  "refs": [
    {
      "id": "ref-1",
      "title": "Cited work",
      "authors": ["C. Author"],
      "year": 2023,
      "doi": "10.1234/example"
    }
  ],
  "figures": [
    {
      "id": "fig-1",
      "label": "Figure 1",
      "caption": "Figure caption",
      "pageNumber": 3,
      "imageUrl": "https://storage/paper/fig-1.png"
    }
  ]
}
```

### Error responses

- `400 Bad Request` for malformed JSON or missing `arxivId`.
- `502 Bad Gateway` for downstream ingestion failures (HTML/PDF fetch, OCR, or Weaviate write).

## POST /api/summarize

### Request body

```json
{
  "paperId": "2401.01234",
  "userId": "user-123",
  "personaId": "persona-abc"
}
```

Field notes:

- `paperId` _(string, required)_ - identifier returned by `/api/ingest`.
- `userId` _(string, optional)_ - ties the request to a user account for prompt logging.
- `personaId` _(string, optional)_ - explicit persona node stored in Weaviate. The backend also attempts to fetch a Kontext system prompt when configured.

### Success response

`200 OK`

```json
{
  "sections": [
    {
      "section_id": "1",
      "title": "Problem setup",
      "summary": "Concise overview...",
      "reasoning": "Explains motivations...",
      "key_points": ["Key insight one", "Key insight two"],
      "page_anchor": "(page 2)"
    }
  ],
  "key_findings": [
    {
      "statement": "Main claim",
      "evidence": "Backed by experiment",
      "supporting_sections": ["1"],
      "related_figures": ["fig-1"]
    }
  ],
  "figures": [
    {
      "figure_id": "fig-1",
      "caption": "Figure caption",
      "insight": "Why it matters",
      "page_anchor": "(page 4)"
    }
  ]
}
```

### Error responses

- `400 Bad Request` when `paperId` is missing.
- `404 Not Found` when no ingested content exists for the supplied `paperId`.
- `500 Internal Server Error` if OpenAI credentials are missing.
- `502 Bad Gateway` for unexpected LLM or retrieval issues.

## POST /api/qa

### Request body

```json
{
  "paperId": "2401.01234",
  "question": "What is the main contribution?",
  "userId": "user-123",
  "personaId": "persona-abc",
  "selection": {
    "text": "Selected quote",
    "page": 5,
    "section": "3.2 Results"
  }
}
```

Field notes:

- `paperId` _(string, required)_ - identifier returned by `/api/ingest`.
- `question` _(string, required)_ - natural-language query.
- `userId` _(string, optional)_ - associates the interaction with a user.
- `personaId` _(string, optional)_ - overrides persona lookup.
- `selection` _(object, optional)_ - focuses retrieval on a user-selected span; any of `text`, `page`, or `section` may be provided.

### Success response

`200 OK`

```json
{
  "answer": "The paper introduces...",
  "cites": [
    {
      "chunkId": "chunk-123",
      "page": 5,
      "quote": "Grounded quote from the paper."
    }
  ]
}
```

### Error responses

- `400 Bad Request` when required fields are missing or invalid.
- `500 Internal Server Error` when OpenAI credentials are absent.
- `502 Bad Gateway` for LLM errors or retrieval failures.
