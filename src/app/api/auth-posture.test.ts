import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * There is no route-level auth middleware. `src/proxy.ts` runs bare
 * `clerkMiddleware()`, which makes auth available to handlers but protects
 * nothing on its own — so a route under `src/app/api/` is **public until its
 * handler calls `requireAuthenticatedUserId()`**.
 *
 * That means the safe default is the insecure one. This test does not decide
 * which routes should be public; it just refuses to let a route become public
 * by omission. A new route either calls the guard, or it gets an entry here with
 * a reason someone had to write down.
 */
const API_ROOT = join(__dirname);

/** Routes that are public on purpose, each with the reason it is safe. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "health/route.ts": "Liveness probe. Returns no user or paper data.",
  "editor/ingest/arxiv/route.ts":
    "Public read-only arXiv ingest backing the editor's /arxiv command. Fetches a public preprint and returns its text; no user scope.",
  "editor/selection/citations/route.ts":
    "Returns citation metadata for a selection of public paper text. Paper text is anonymously readable by design; only LLM-generated output is gated.",
  "editor/selection/figures/route.ts":
    "Returns figure metadata for a selection of public paper text. Same rule as citations.",
  "skills/[userId]/route.ts": "Retired endpoint. Returns 410 Gone without reading anything.",
};

function routeFiles(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routeFiles(full, hits);
    else if (name === "route.ts" || name === "route.tsx") hits.push(full);
  }
  return hits;
}

describe("API auth posture", () => {
  const routes = routeFiles(API_ROOT);

  it("finds the route handlers", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((f) => [relative(API_ROOT, f), f]))(
    "%s either guards itself or is public by design",
    (rel, full) => {
      const source = readFileSync(full, "utf8");
      const guards = source.includes("requireAuthenticatedUserId");
      const declaredPublic = Object.prototype.hasOwnProperty.call(PUBLIC_BY_DESIGN, rel);

      if (guards && declaredPublic) {
        throw new Error(
          `${rel} calls requireAuthenticatedUserId() but is also listed in PUBLIC_BY_DESIGN. ` +
            `Remove the entry — a stale exemption is worse than none, because it reads as a ` +
            `decision that nobody has to revisit.`,
        );
      }

      expect(
        guards || declaredPublic,
        `${rel} never calls requireAuthenticatedUserId(), so it is reachable by anyone.\n` +
          `If that is intended, add it to PUBLIC_BY_DESIGN in this file with the reason it is safe.\n` +
          `If it is not, call requireAuthenticatedUserId() in the handler.`,
      ).toBe(true);
    },
  );
});
