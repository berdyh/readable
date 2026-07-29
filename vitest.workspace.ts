import path from "node:path";

import { defineWorkspace } from "vitest/config";

const alias = { "@": path.resolve(__dirname, "./src") };

/**
 * Two projects, split by file extension rather than by directory.
 *
 * `node` is the original suite and stays exactly as it was: fast, no DOM, and
 * the right environment for everything that is pure logic. Keeping it separate
 * matters — running the whole suite under jsdom would slow every server test
 * down for the benefit of a handful of component tests.
 *
 * `dom` is new. Before it existed nothing rendered, so any bug that only
 * appears once React runs was invisible to `pnpm verify`. That constraint is
 * why blockNavigation.ts was deliberately kept pure and testable; the split
 * keeps that property while making the rendering half reachable too.
 *
 * `.test.ts` → node, `.test.tsx` → dom. The globs cannot overlap, so a file
 * never runs twice or lands in the wrong environment by accident.
 */
export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: "node",
      environment: "node",
      globals: true,
      include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      clearMocks: true,
    },
  },
  {
    resolve: { alias },
    test: {
      name: "dom",
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.tsx"],
      setupFiles: ["./vitest.setup.dom.ts"],
      clearMocks: true,
    },
  },
]);
