This is a route-only root. It owns no code of its own — every source file
belongs to `server`, `web`, or `scripts`.

The repo is a single Next.js app rather than a monorepo. `STANDARD.md` prescribes
`apps/` + `packages/` tiers; that was deliberately not adopted, because there is
exactly one deployable and Next.js pins routes to `src/app/**`. Moving to workspace
packages would be a large invasive change that buys no boundary the ESLint import
zones in `eslint.config.mjs` do not already give.

Those zones are the enforcement mechanism. Before they existed the module surfaces
held by discipline alone, which is what `docs/open-issues.md` recorded as the
"module boundaries are unenforced" risk.
