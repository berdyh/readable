#!/usr/bin/env node
/**
 * `pnpm eval` — quality gate for the explanation contract.
 *
 * Runs fixture papers (≥2 domains) × persona fixtures through the
 * summarize flow's LLM half (`summarizePaperFromContext`, no database),
 * scores each result with a pinned LLM judge (models.json `eval_judge`)
 * against per-dimension rubric thresholds, samples depends_on edge
 * validity, and asserts a latency budget. N runs per case; regression =
 * a MEAN below threshold, not vibes. NEVER part of `pnpm verify`.
 *
 * Modes:
 *   pnpm eval                      live run against real models
 *   pnpm eval -- --dry-run         no network: canned summaries +
 *                                  deterministic judge; exercises the
 *                                  scoring/threshold/baseline plumbing
 *   pnpm eval -- --update-baseline rewrite scripts/eval/baseline.json
 *   pnpm eval -- --runs N          override runs per case (default 3)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { generateJson } from "@/server/llm";
import { getPromptLimits, getSystemPrompt } from "@/server/llm-config";
import type { PersonaSplit } from "@/server/explain";
import type { PaperSummaryContext, SummaryResult } from "@/server/summarize";

const EVAL_DIR = path.join(__dirname, "eval");
const FIXTURES_DIR = path.join(EVAL_DIR, "fixtures");
const BASELINE_PATH = path.join(EVAL_DIR, "baseline.json");

/** Rubric dimensions — one per explanation-contract obligation. */
const DIMENSIONS = [
  "coverage",
  "hook",
  "plain_language",
  "mechanism_concreteness",
  "evidence_grounding",
  "glossary_quality",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** Per-dimension gate: the MEAN over runs must clear these. */
const THRESHOLDS: Record<Dimension, number> = {
  coverage: 0.7,
  hook: 0.7,
  plain_language: 0.7,
  mechanism_concreteness: 0.7,
  evidence_grounding: 0.7,
  glossary_quality: 0.7,
};
const EDGE_VALIDITY_THRESHOLD = 0.6;
const MAX_EDGE_SAMPLES = 6;
const DEFAULT_RUNS = 3;
const LATENCY_BUDGET_MS = Number(process.env.EVAL_LATENCY_BUDGET_MS ?? 120_000);
/** A dimension mean this far below the recorded baseline fails the gate. */
const BASELINE_DRIFT_TOLERANCE = 0.15;
/** Cross-run score variance above this prints a stability warning. */
const VARIANCE_WARN_THRESHOLD = 0.05;

const RUBRIC_DEFINITIONS: Record<Dimension, string> = {
  coverage:
    "Do the sections span the WHOLE paper — including training/experiments, results, and conclusion — rather than only the front half?",
  hook: "Does each section open with a genuine motivating question or problem (not a restated title)?",
  plain_language:
    "Are claims stated in plain language a smart newcomer could follow, with domain terms defined on first use?",
  mechanism_concreteness:
    "Does each mechanism explain HOW it works, concrete example or analogy first, before the general form?",
  evidence_grounding:
    "Are claims tied to evidence actually present in the source content (section/figure references that exist), with nothing invented?",
  glossary_quality:
    "Are the new_terms real domain terms from the paper with correct, plain definitions?",
};

interface FixtureSection {
  title: string;
  paragraphs: string[];
  figureIds?: string[];
}

interface Fixture {
  id: string;
  domain: string;
  paperId: string;
  metadata: { title: string; abstract: string; authors: string[] };
  sections: FixtureSection[];
  figures: Array<{ id: string; caption: string }>;
  citations: Array<{
    citationId: string;
    title?: string;
    year?: number;
    citationCount?: number;
    arxivId?: string;
    abstract?: string;
  }>;
  cannedSummary: {
    sections: Array<Record<string, unknown>>;
    key_findings: Array<Record<string, unknown>>;
    figures: Array<Record<string, unknown>>;
    concepts: Array<{
      concept: string;
      domain?: string;
      description?: string;
      depends_on?: string[];
      confidence?: number;
    }>;
  };
}

interface PersonaFixture {
  id: string;
  description: string;
  split: PersonaSplit;
}

interface CaseResult {
  scores: Record<Dimension, number>;
  edgeValidity: number | null;
  latencyMs: number;
}

interface Baseline {
  note: string;
  recordedAt: string | null;
  runsPerCase: number;
  cases: Record<string, CaseResult>;
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => loadJson<Fixture>(path.join(FIXTURES_DIR, name)));
}

function buildContext(fixture: Fixture): PaperSummaryContext {
  const totalParagraphs = fixture.sections.reduce(
    (count, section) => count + section.paragraphs.length,
    0,
  );
  return {
    paperId: fixture.paperId,
    metadata: fixture.metadata,
    sections: fixture.sections.map((section, index) => ({
      id: `S${index + 1}`,
      title: section.title,
      paragraphs: section.paragraphs,
      totalParagraphCount: section.paragraphs.length,
      referencedFigureIds: section.figureIds ?? [],
    })),
    figures: fixture.figures.map((figure) => ({
      id: figure.id,
      caption: figure.caption,
      referencedSectionIds: [],
    })),
    coverage: {
      totalParagraphs,
      includedParagraphs: totalParagraphs,
      // Same budget the production context builder reports, so eval
      // coverage numbers stay comparable with real traffic.
      charBudget: getPromptLimits().context_char_budget,
      truncated: false,
    },
  };
}

/** Dry-run path: map the canned payload straight onto the wire shape. */
function cannedToSummary(fixture: Fixture): SummaryResult {
  const canned = fixture.cannedSummary;
  return {
    sections: canned.sections.map((section) => ({
      section_id: String(section.section_id),
      title: String(section.title),
      summary: String(section.claim ?? section.summary ?? ""),
      reasoning: String(section.mechanism ?? section.reasoning ?? ""),
      hook: section.hook ? String(section.hook) : undefined,
      evidence: section.evidence ? String(section.evidence) : undefined,
      new_terms: Array.isArray(section.new_terms)
        ? (section.new_terms as SummaryResult["sections"][number]["new_terms"])
        : undefined,
      source: section.source === "cited_text" ? "cited_text" : "model_knowledge",
    })),
    key_findings: canned.key_findings.map((finding) => ({
      statement: String(finding.statement),
      evidence: String(finding.evidence),
      page_anchors: [],
      supporting_sections: (finding.supporting_sections as string[]) ?? [],
      related_figures: (finding.related_figures as string[]) ?? [],
    })),
    figures: canned.figures.map((figure) => ({
      figure_id: String(figure.figure_id),
      caption: String(figure.caption_summary ?? ""),
      insight: String(figure.insight ?? ""),
    })),
    concepts: canned.concepts.map((concept) => ({
      concept: concept.concept,
      domain: concept.domain,
      description: concept.description,
    })),
  };
}

function renderSummaryForJudge(summary: SummaryResult): string {
  return JSON.stringify(
    {
      sections: summary.sections.map((section) => ({
        title: section.title,
        hook: section.hook,
        claim: section.summary,
        mechanism: section.reasoning,
        evidence: section.evidence,
        new_terms: section.new_terms,
        source: section.source,
      })),
      key_findings: summary.key_findings,
      figures: summary.figures,
    },
    null,
    1,
  );
}

function renderSourceForJudge(fixture: Fixture): string {
  return fixture.sections
    .map((section, index) => `[S${index + 1}] ${section.title}\n${section.paragraphs.join("\n")}`)
    .join("\n\n");
}

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "rationales"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: [...DIMENSIONS],
      properties: Object.fromEntries(
        DIMENSIONS.map((dimension) => [dimension, { type: "number", minimum: 0, maximum: 1 }]),
      ),
    },
    rationales: {
      type: "object",
      additionalProperties: false,
      required: [...DIMENSIONS],
      properties: Object.fromEntries(
        DIMENSIONS.map((dimension) => [dimension, { type: "string", maxLength: 300 }]),
      ),
    },
  },
};

const EDGE_JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["edges"],
  properties: {
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "valid"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          valid: { type: "boolean" },
        },
      },
    },
  },
};

async function judgeWithLlm(
  fixture: Fixture,
  persona: PersonaFixture,
  summary: SummaryResult,
): Promise<Record<Dimension, number>> {
  const rubric = DIMENSIONS.map(
    (dimension) => `- ${dimension}: ${RUBRIC_DEFINITIONS[dimension]}`,
  ).join("\n");

  const userPrompt = [
    `Reader persona: ${persona.description}`,
    "",
    "# Rubric dimensions (score each 0.0-1.0)",
    rubric,
    "",
    "# Source paper content",
    renderSourceForJudge(fixture),
    "",
    "# Generated explanation to judge",
    renderSummaryForJudge(summary),
  ].join("\n");

  const raw = await generateJson(
    { systemPrompt: getSystemPrompt("eval_judge"), userPrompt, schema: JUDGE_SCHEMA },
    { taskName: "eval_judge", temperature: 0 },
  );

  const payload = JSON.parse(raw) as { scores: Record<string, number> };
  const scores = {} as Record<Dimension, number>;
  for (const dimension of DIMENSIONS) {
    const value = payload.scores?.[dimension];
    scores[dimension] = typeof value === "number" ? Math.min(1, Math.max(0, value)) : 0;
  }
  return scores;
}

interface Edge {
  from: string;
  to: string;
}

interface EdgeConcept {
  concept: string;
  dependsOn?: string[];
}

function sampleEdges(concepts: EdgeConcept[]): Edge[] {
  const edges: Edge[] = [];
  for (const concept of concepts) {
    for (const prerequisite of concept.dependsOn ?? []) {
      edges.push({ from: concept.concept, to: prerequisite });
    }
  }
  return edges.slice(0, MAX_EDGE_SAMPLES);
}

/** The canned payload's concepts, in the shape sampleEdges expects. */
function cannedEdgeConcepts(fixture: Fixture): EdgeConcept[] {
  return fixture.cannedSummary.concepts.map((concept) => ({
    concept: concept.concept,
    dependsOn: concept.depends_on,
  }));
}

async function judgeEdgesWithLlm(fixture: Fixture, edges: Edge[]): Promise<number | null> {
  if (edges.length === 0) {
    return null;
  }

  const userPrompt = [
    `Domain: ${fixture.domain}`,
    "For each edge, decide whether TO is genuinely a prerequisite concept a learner should understand before FROM. Mark valid=false for wrong direction, unrelated pairs, or non-concepts.",
    "",
    ...edges.map((edge) => `- from: "${edge.from}" depends_on to: "${edge.to}"`),
  ].join("\n");

  const raw = await generateJson(
    { systemPrompt: getSystemPrompt("eval_judge"), userPrompt, schema: EDGE_JUDGE_SCHEMA },
    { taskName: "eval_judge", temperature: 0 },
  );
  const payload = JSON.parse(raw) as { edges: Array<{ valid?: boolean }> };
  const verdicts = Array.isArray(payload.edges) ? payload.edges : [];
  if (verdicts.length === 0) {
    return null;
  }
  return verdicts.filter((edge) => edge.valid === true).length / verdicts.length;
}

/**
 * Deterministic dry-run judge: checks contract structure so the
 * plumbing (thresholds, means, variance, baseline) runs identically to
 * live mode without any network.
 */
function judgeDeterministically(
  fixture: Fixture,
  summary: SummaryResult,
): Record<Dimension, number> {
  const sections = summary.sections;
  const fraction = (hits: number, total: number) => (total === 0 ? 0 : hits / total);

  const backHalfTitles = fixture.sections
    .slice(Math.floor(fixture.sections.length / 2))
    .map((_, index) => `S${Math.floor(fixture.sections.length / 2) + index + 1}`);
  const referenced = new Set(
    sections.flatMap((section) => (section.evidence ?? "").match(/S\d+/g) ?? []),
  );
  const coverage = fraction(
    backHalfTitles.filter((id) => referenced.has(id)).length,
    backHalfTitles.length,
  );

  return {
    coverage: coverage > 0 ? 1 : 0,
    hook: fraction(
      sections.filter((section) => (section.hook ?? "").includes("?")).length,
      sections.length,
    ),
    plain_language: fraction(
      sections.filter((section) => section.summary.length > 20).length,
      sections.length,
    ),
    mechanism_concreteness: fraction(
      sections.filter((section) => section.reasoning.length > 60).length,
      sections.length,
    ),
    evidence_grounding: fraction(
      sections.filter((section) => /(S|F)\d+/.test(section.evidence ?? "")).length,
      sections.length,
    ),
    glossary_quality: fraction(
      sections.filter((section) =>
        (section.new_terms ?? []).every((term) => term.definition.length > 10),
      ).length,
      sections.length,
    ),
  };
}

function judgeEdgesDeterministically(edges: Edge[]): number | null {
  if (edges.length === 0) return null;
  const valid = edges.filter(
    (edge) => edge.to.trim().length > 2 && edge.to.toLowerCase() !== edge.from.toLowerCase(),
  );
  return valid.length / edges.length;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return mean(values.map((value) => (value - m) ** 2));
}

interface CliOptions {
  dryRun: boolean;
  updateBaseline: boolean;
  runs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, updateBaseline: false, runs: DEFAULT_RUNS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run" || arg === "--self-test") options.dryRun = true;
    else if (arg === "--update-baseline") options.updateBaseline = true;
    else if (arg === "--runs") {
      // A non-numeric value must fall back to the default, not become
      // NaN (NaN runs = zero iterations = every gate "passes" vacuously
      // while silently testing nothing).
      const parsed = Number(argv[index + 1]);
      options.runs = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : DEFAULT_RUNS;
    }
  }
  return options;
}

async function runCase(
  fixture: Fixture,
  persona: PersonaFixture,
  options: CliOptions,
): Promise<CaseResult> {
  const context = buildContext(fixture);
  const runScores: Array<Record<Dimension, number>> = [];
  const latencies: number[] = [];
  let edgeValidity: number | null = null;

  for (let run = 0; run < options.runs; run += 1) {
    const start = Date.now();

    let summary: SummaryResult;
    // Live mode judges the LIVE model's depends_on output, not the
    // fixture's canned edges; the summarize eval hook exposes the
    // parsed concepts. Dry-run keeps judging the canned edges.
    let liveConcepts: EdgeConcept[] = [];
    if (options.dryRun) {
      summary = cannedToSummary(fixture);
    } else {
      // Import lazily so --dry-run stays runnable without provider keys.
      const { summarizePaperFromContext } = await import("@/server/summarize");
      summary = await summarizePaperFromContext(context, {
        personaSplit: persona.split,
        citationCandidates: fixture.citations,
        ingestedPaperIds: [],
        skipRecording: true,
        onConcepts: (concepts) => {
          liveConcepts = concepts.map((concept) => ({
            concept: concept.concept,
            dependsOn: concept.dependsOn,
          }));
        },
      });
    }

    latencies.push(Date.now() - start);

    runScores.push(
      options.dryRun
        ? judgeDeterministically(fixture, summary)
        : await judgeWithLlm(fixture, persona, summary),
    );

    if (run === 0) {
      const edges = sampleEdges(options.dryRun ? cannedEdgeConcepts(fixture) : liveConcepts);
      edgeValidity = options.dryRun
        ? judgeEdgesDeterministically(edges)
        : await judgeEdgesWithLlm(fixture, edges);
    }
  }

  const scores = {} as Record<Dimension, number>;
  for (const dimension of DIMENSIONS) {
    const values = runScores.map((run) => run[dimension]);
    scores[dimension] = mean(values);
    const spread = variance(values);
    if (spread > VARIANCE_WARN_THRESHOLD) {
      console.warn(
        `  ! high variance on ${dimension}: ${spread.toFixed(3)} across ${values.length} runs`,
      );
    }
  }

  return { scores, edgeValidity, latencyMs: Math.round(mean(latencies)) };
}

function evaluateGates(caseId: string, result: CaseResult, failures: string[]): void {
  for (const dimension of DIMENSIONS) {
    if (result.scores[dimension] < THRESHOLDS[dimension]) {
      failures.push(
        `${caseId}: ${dimension} mean ${result.scores[dimension].toFixed(2)} < threshold ${THRESHOLDS[dimension]}`,
      );
    }
  }
  if (result.edgeValidity !== null && result.edgeValidity < EDGE_VALIDITY_THRESHOLD) {
    failures.push(
      `${caseId}: edge validity ${result.edgeValidity.toFixed(2)} < threshold ${EDGE_VALIDITY_THRESHOLD}`,
    );
  }
  if (result.latencyMs > LATENCY_BUDGET_MS) {
    failures.push(`${caseId}: mean latency ${result.latencyMs}ms > budget ${LATENCY_BUDGET_MS}ms`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures();
  const { personas } = loadJson<{ personas: PersonaFixture[] }>(
    path.join(EVAL_DIR, "personas.json"),
  );
  const baseline = loadJson<Baseline>(BASELINE_PATH);

  if (fixtures.length < 2) {
    throw new Error("Eval requires at least 2 fixture papers from different domains.");
  }
  const domains = new Set(fixtures.map((fixture) => fixture.domain));
  if (domains.size < 2) {
    throw new Error("Eval fixtures must span at least 2 domains.");
  }

  console.log(
    `eval-explanations: ${fixtures.length} fixtures × ${personas.length} personas × ${options.runs} runs` +
      `${options.dryRun ? " [dry-run: canned summaries + deterministic judge]" : " [live]"}`,
  );

  const failures: string[] = [];
  const results: Record<string, CaseResult> = {};

  for (const fixture of fixtures) {
    for (const persona of personas) {
      const caseId = `${fixture.id}/${persona.id}`;
      console.log(`\n▶ ${caseId}`);
      const result = await runCase(fixture, persona, options);
      results[caseId] = result;

      for (const dimension of DIMENSIONS) {
        const value = result.scores[dimension];
        const gate = value >= THRESHOLDS[dimension] ? "ok" : "FAIL";
        console.log(`  ${dimension.padEnd(24)} ${value.toFixed(2)}  ${gate}`);
      }
      console.log(
        `  ${"edge_validity".padEnd(24)} ${result.edgeValidity === null ? "n/a " : result.edgeValidity.toFixed(2)}`,
      );
      console.log(`  ${"latency_ms".padEnd(24)} ${result.latencyMs}`);

      evaluateGates(caseId, result, failures);

      const baselineCase = baseline.cases[caseId];
      if (baselineCase && baseline.recordedAt) {
        for (const dimension of DIMENSIONS) {
          const drop = baselineCase.scores[dimension] - result.scores[dimension];
          if (drop > BASELINE_DRIFT_TOLERANCE) {
            failures.push(
              `${caseId}: ${dimension} dropped ${drop.toFixed(2)} below the recorded baseline`,
            );
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} gate failure(s):`);
    for (const failure of failures) {
      console.error(`  ✗ ${failure}`);
    }
    if (options.updateBaseline) {
      console.error("Baseline NOT updated: a failing run must never become the baseline.");
    }
    process.exitCode = 1;
    return;
  }

  // Only a run that cleared every gate may become the new baseline.
  if (options.updateBaseline && !options.dryRun) {
    const next: Baseline = {
      ...baseline,
      recordedAt: new Date().toISOString(),
      runsPerCase: options.runs,
      cases: results,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nBaseline updated: ${path.relative(process.cwd(), BASELINE_PATH)}`);
  }

  console.log("\nAll eval gates passed.");
}

main().catch((error) => {
  console.error("eval-explanations failed:", error);
  process.exitCode = 1;
});
