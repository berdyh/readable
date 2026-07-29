import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Module boundary zones.
 *
 * These make the module surfaces declared in each `module.manifest.json`
 * mechanical rather than conventional. Before this rule existed, `chat/index.ts`
 * and the `src/server/*` indexes held by discipline alone.
 *
 * Only the `@/`-aliased form is restricted. Relative specifiers (`./papers`,
 * `../model/types`) are how a module reaches its own internals, and they never
 * match these patterns — so intra-module imports stay legal without needing a
 * per-module override.
 */
const moduleBoundaries = {
  patterns: [
    {
      group: [
        "@/server/*/*",
        // `types` is the documented exception: client components may import
        // server types (never values), and sibling server modules depend on
        // each other's type shapes without that being a boundary breach.
        "!@/server/*/types",
        // `llm/routing` is itself a module with its own public index.
        "!@/server/llm/routing",
      ],
      message:
        "Server module internals are private. Import from the module index instead (e.g. '@/server/qa', not '@/server/qa/context'). If the symbol is not exported there, add it to that module's index deliberately.",
    },
    {
      group: ["@/server/llm/routing/*", "!@/server/llm/routing/types"],
      message: "Routing internals are private. Import from '@/server/llm/routing' instead.",
    },
    {
      group: ["@/app/components/chat/*/**", "**/components/chat/*/**"],
      message:
        "chat/ internals are private. Import from 'chat/index.ts' instead. The only sanctioned cross-tree seam is the DOM CustomEvent contract in block-editor/intents.ts and block-editor/navigation.ts.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", moduleBoundaries],
    },
  },

  {
    // A leading underscore already meant "required by the signature, unused
    // here" throughout this codebase — in ProseMirror callbacks that take fixed
    // positional args, and in provider methods that must match
    // LlmProviderInterface. The rule just did not know the convention, so it
    // reported them as findings. Recognising it keeps the signature documented
    // instead of forcing params to be deleted.
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    // Tests may reach past a module's public surface. Isolating a pipeline by
    // mocking the specific internals it calls (see src/server/e2e/pipeline.test.ts,
    // which runs the real ingestPaper() against stubbed arxiv/pdf/ocr modules) is
    // a legitimate harness technique, not a boundary breach — forcing it through
    // the index would make that seam untestable.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "src/server/e2e/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
