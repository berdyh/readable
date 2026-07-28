# API Route Inventory

Every HTTP surface the app exposes, derived from the handlers under
`src/app/api/**/route.ts`. Verify against those files — they are the source of truth.

For how to exercise these endpoints, see [`API_TESTING.md`](./API_TESTING.md).

## Authentication model

There is **no `middleware.ts`**. Protection is applied per handler by calling
`requireAuthenticatedUserId()` from `src/server/auth/user.ts`, which throws
`AuthenticationRequiredError`; each handler catches it with
`isAuthenticationRequiredError()` and returns `401` with `AUTH_REQUIRED_MESSAGE`.

The consequence is that **auth is opt-in per route**. A new route is public until
its handler calls `requireAuthenticatedUserId()`. Adding a route does not
automatically place it behind Clerk.

Anonymous reads of public paper text are intentionally allowed; anything that
generates a summary, touches chat, or reads the user's persona is gated.

## Routes

| Route | Methods | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/health` | `GET` | public | Liveness probe. Returns `{ status, timestamp }`. No dependencies. |
| `/api/ingest` | `POST` | **required** | Ingest an arXiv paper into Postgres + Qdrant. |
| `/api/extract-research-paper` | `POST` | **required** | Extract text/figures/tables from an uploaded PDF (`multipart/form-data`). |
| `/api/summarize` | `POST` | **required** | Structured paper summary; upserts extracted `concepts` into `persona_concepts`. |
| `/api/qa` | `POST` | **required** | Grounded Q&A with citations. Also emits a `[qa] trust_counter` log line per call. |
| `/api/editor/selection/summary` | `POST` | **required** | Summarize a text selection into a callout with citations. |
| `/api/editor/selection/figures` | `POST` | public | Figures related to a text selection. |
| `/api/editor/selection/citations` | `POST` | public | Citations related to a text selection. |
| `/api/editor/ingest/arxiv` | `POST` | public | Inline arXiv ingestion from the editor. |
| `/api/chat/session` | `POST` | **required** | Create a per-paper chat session. |
| `/api/chat/history` | `GET`, `POST`, `DELETE` | **required** | Read / append / delete persisted chat messages. Ownership enforced via `ChatSessionOwnershipError` → `403`. |
| `/api/skills` | `GET` | **required** | The authenticated user's `persona_concepts` (max 200). |
| `/api/skills/[userId]` | `GET` | n/a | **Retired.** Always returns `410 Gone` pointing at `/api/skills`. Kept so old clients get a clear signal rather than a 404. |

Client consumers are deliberately not listed here: the component tree under
`src/app/components/` is refactored often and any such list goes stale within a
release. Use `rg '/api/<route>' src/app` to find current callers.

`/api/health` is not called by the frontend. It is kept on purpose for
load-balancer and deployment probes.

## Response invariants

These are contracts the handlers are required to uphold. Both were the subject of
past bug fixes (recorded in `archive/SCHEMA_FIX_VERIFICATION.md` and
`archive/BUG_FIX_UNKNOWN_CITATION.md`); the rules are restated here because they
still constrain `src/server/editor/selection.ts` today.

**Citations in `/api/editor/selection/summary` are always complete.**
`SELECTION_SUMMARY_SCHEMA` marks `chunk_id`, `page`, and `quote` as `required`,
with `page` an `integer` `minimum: 1` and `quote` a string of `minLength: 1`.
The LLM cannot be trusted to honour that, so `normalizeCitations()` validates and
**drops** citations that fail it rather than passing partial objects through, and
`createCitationFromChunk()` — used for citations the server synthesizes — defaults
`page` to `1` and always supplies a non-empty `quote`.

**A bullet never references a citation that does not exist.**
Bullets carry `citationIds`, and every id in that array must have a matching entry
in the citations map. The failure mode this guards against: the fallback path
(taken when the LLM returns no bullets) used to push a bullet with
`citationIds: ['unknown']` while only registering a real citation when
`evidence.hits[0]` existed — so with no evidence the bullet pointed at a citation
that was never created. The rule is to emit `citationIds: []` when there is no
chunk to cite, never a placeholder id.

## Testing

`pnpm test:api` runs offline route/auth/validation checks against a running dev
server; `pnpm test:api -- --live` additionally exercises the provider-backed
paths. See [`API_TESTING.md`](./API_TESTING.md) for the required environment.
