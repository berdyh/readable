Everything here is server-only. Client components may import from `@/server/*`
**for types only, never values** — that exception is encoded in the ESLint zone rules,
which allow `@/server/*/types` and reject every other deep path.

This module directly owns five small directories that did not earn a manifest of their
own, because bundling them into a `common/` module would be a filing convention rather
than a boundary:

- `auth/` — resolves the authenticated user id; there is no middleware, so protection
  is per-handler and opt-in.
- `config/` — timeouts and base URLs behind `getTimeout()` / `getUrl()`.
- `persona/` — records which concepts a user has been exposed to.
- `external/` — Semantic Scholar citation enrichment.
- `e2e/` — one cross-module pipeline test that deliberately mocks module internals.
