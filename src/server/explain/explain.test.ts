import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConceptLedgerEntry } from "@/server/db";

const mocks = vi.hoisted(() => ({
  fetchConceptLedgerForUser: vi.fn<(userId: string) => Promise<ConceptLedgerEntry[]>>(),
}));

vi.mock("@/server/db", () => ({
  fetchConceptLedgerForUser: mocks.fetchConceptLedgerForUser,
}));

import { buildConceptKey, normalizeConceptName, splitConceptKey } from "./conceptKey";
import {
  DECAY_HALF_LIFE_DAYS,
  MASTERY_THRESHOLD,
  MAX_GROUNDING_TERMS_PER_RESPONSE,
  MAX_RENDERED_CONCEPT_NAME_LENGTH,
  OBSCURE_CITATION_COUNT_THRESHOLD,
  RECENT_YEAR_CUTOFF,
  RECENT_YEAR_CUTOFF_MAX_LAG_YEARS,
  SIGNAL_WEIGHTS,
} from "./constants";
import { deriveConceptMastery, decayFactor, scoreLedgerEntry } from "./mastery";
import { loadPersonaSplit, renderPersonaBlock } from "./persona";
import { routeCitations, selectGroundingTerms } from "./citationRouter";
import { renderRoutedCitationContext } from "./render";
import { validateSourceLabel } from "./sourceLabels";

const ledgerEntry = (overrides: Partial<ConceptLedgerEntry>): ConceptLedgerEntry => ({
  userId: "user-1",
  conceptKey: "ml:attention mechanism",
  displayName: "Attention Mechanism",
  exposureCount: 1,
  distinctPaperIds: ["1706.03762"],
  lastSeenAt: new Date().toISOString(),
  signalCounts: {},
  ...overrides,
});

describe("concept keys", () => {
  it("normalizes case, whitespace, and trailing plural only", () => {
    expect(normalizeConceptName("  Attention   Mechanisms ")).toBe("attention mechanism");
    expect(normalizeConceptName("Loss")).toBe("loss"); // -ss never folded
    expect(normalizeConceptName("Bias")).toBe("bias"); // -as never folded
  });

  it("keeps -ss and -us words intact and does not fuzzy match", () => {
    expect(normalizeConceptName("consensus")).toBe("consensus");
    expect(normalizeConceptName("class")).toBe("class");
    // No stemming beyond the plural fold:
    expect(normalizeConceptName("normalization")).toBe("normalization");
    expect(normalizeConceptName("normalizing")).toBe("normalizing");
  });

  it("facets keys by domain so homonyms never merge", () => {
    const ml = buildConceptKey("Transformer", "ml");
    const ee = buildConceptKey("Transformer", "electrical engineering");
    expect(ml).toBe("ml:transformer");
    expect(ee).toBe("electrical engineering:transformer");
    expect(ml).not.toBe(ee);
  });

  it("defaults the domain facet and round-trips through splitConceptKey", () => {
    expect(buildConceptKey("Attention")).toBe("general:attention");
    expect(splitConceptKey("ml:attention mechanism")).toEqual({
      domain: "ml",
      name: "attention mechanism",
    });
  });

  it("returns undefined for empty names", () => {
    expect(buildConceptKey("   ")).toBeUndefined();
  });
});

describe("mastery derivation", () => {
  it("pins the reviewed signal weights", () => {
    expect(SIGNAL_WEIGHTS).toEqual({
      summary_exposure: 1,
      selection_explained: 2,
      qa_asked: 0,
      explicit_confirmed: 5,
    });
  });

  it("treats qa_asked as interest, not knowledge", () => {
    const entry = ledgerEntry({ signalCounts: { qa_asked: 50 } });
    expect(scoreLedgerEntry(entry, new Date())).toBe(0);
    expect(deriveConceptMastery([entry])[0].known).toBe(false);
  });

  it("derives known only above the mastery threshold (seen is not known)", () => {
    const seenOnce = ledgerEntry({ signalCounts: { summary_exposure: 1 } });
    const confirmed = ledgerEntry({
      conceptKey: "ml:softmax",
      signalCounts: { explicit_confirmed: 1 },
    });

    const [seen, known] = deriveConceptMastery([seenOnce, confirmed]);
    expect(seen.known).toBe(false);
    expect(seen.score).toBeCloseTo(1, 5);
    expect(known.known).toBe(true);
    expect(known.score).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
  });

  it("applies exponential decay with the configured half-life", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    const halfLifeAgo = new Date(
      now.getTime() - DECAY_HALF_LIFE_DAYS * 24 * 60 * 60_000,
    ).toISOString();

    expect(decayFactor(halfLifeAgo, now)).toBeCloseTo(0.5, 5);
    expect(decayFactor(now.toISOString(), now)).toBeCloseTo(1, 5);
    expect(decayFactor(undefined, now)).toBe(0);

    // 4 summary exposures seen a half-life ago decay to 2 — below threshold.
    const entry = ledgerEntry({
      signalCounts: { summary_exposure: 4 },
      lastSeenAt: halfLifeAgo,
    });
    const [derived] = deriveConceptMastery([entry], now);
    expect(derived.score).toBeCloseTo(2, 5);
    expect(derived.known).toBe(false);
  });
});

describe("persona split", () => {
  beforeEach(() => {
    mocks.fetchConceptLedgerForUser.mockReset();
  });

  it("returns the uncalibrated default for anonymous readers without touching the db", async () => {
    const split = await loadPersonaSplit(undefined);
    expect(split.uncalibrated).toBe(true);
    expect(mocks.fetchConceptLedgerForUser).not.toHaveBeenCalled();
  });

  it("degrades to uncalibrated when the persona store fails — never throws", async () => {
    mocks.fetchConceptLedgerForUser.mockRejectedValue(new Error("postgres down"));

    const split = await loadPersonaSplit("user-1");
    expect(split.uncalibrated).toBe(true);
    expect(split.known).toEqual([]);
  });

  it("splits known from merely-seen concepts", async () => {
    mocks.fetchConceptLedgerForUser.mockResolvedValue([
      ledgerEntry({ conceptKey: "ml:softmax", signalCounts: { explicit_confirmed: 1 } }),
      ledgerEntry({ conceptKey: "ml:layer normalization", signalCounts: { summary_exposure: 1 } }),
    ]);

    const split = await loadPersonaSplit("user-1");
    expect(split.uncalibrated).toBe(false);
    expect(split.known.map((entry) => entry.conceptKey)).toEqual(["ml:softmax"]);
    expect(split.seen.map((entry) => entry.conceptKey)).toEqual(["ml:layer normalization"]);
  });

  it("renders calibrated and uncalibrated persona blocks", async () => {
    const uncalibrated = renderPersonaBlock({ uncalibrated: true, known: [], seen: [] });
    expect(uncalibrated).toMatch(/new to this field/i);

    const calibrated = renderPersonaBlock({
      uncalibrated: false,
      known: [{ conceptKey: "ml:softmax", displayName: "Softmax", score: 5, known: true }],
      seen: [],
    });
    expect(calibrated).toContain("softmax");
    expect(calibrated).toMatch(/without re-explaining/i);
  });

  it("defensively caps rendered concept names at the render bound", async () => {
    const longName = "x".repeat(400);
    const block = renderPersonaBlock({
      uncalibrated: false,
      known: [
        {
          conceptKey: `ml:${longName}`,
          displayName: longName,
          score: 5,
          known: true,
        },
      ],
      seen: [],
    });

    expect(block).not.toContain(longName);
    expect(block).toContain(`${"x".repeat(MAX_RENDERED_CONCEPT_NAME_LENGTH - 1)}…`);
  });
});

describe("source labels", () => {
  it("keeps cited_text only when retrieved passages exist", () => {
    expect(validateSourceLabel("cited_text", true)).toBe("cited_text");
    expect(validateSourceLabel("cited_text", false)).toBe("model_knowledge");
  });

  it("coerces unknown labels to model_knowledge", () => {
    expect(validateSourceLabel("model_knowledge", true)).toBe("model_knowledge");
    expect(validateSourceLabel("hallucinated_source", true)).toBe("model_knowledge");
    expect(validateSourceLabel(undefined, false)).toBe("model_knowledge");
  });
});

describe("citation router trigger matrix", () => {
  const wellKnown = {
    citationId: "bib.bib1",
    title: "Adam: A Method for Stochastic Optimization",
    year: 2015,
    citationCount: 100_000,
    arxivId: "1412.6980",
  };

  it("does not retrieve for a plain conceptual question about famous work", () => {
    const [decision] = routeCitations({
      question: "Why does the optimizer converge faster here?",
      candidates: [wellKnown],
    });
    expect(decision.retrieve).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it("trigger 1a: generic source-ask phrasing routes supplied candidates", () => {
    const [decision] = routeCitations({
      question: "What does the cited paper say according to the authors?",
      candidates: [wellKnown],
    });
    expect(decision.retrieve).toBe(true);
    expect(decision.reasons).toContain("source_specific_ask");
  });

  it("trigger 1b: a bracket index or title mention routes that citation", () => {
    const byIndex = routeCitations({
      question: "What is [1] about?",
      candidates: [wellKnown],
    })[0];
    expect(byIndex.reasons).toContain("source_specific_ask");

    const byTitle = routeCitations({
      question: "How does stochastic optimization with Adam work?",
      candidates: [wellKnown],
    })[0];
    expect(byTitle.reasons).toContain("source_specific_ask");
  });

  it("trigger 2: obscure (low citation count) or recent (post-cutoff) work routes", () => {
    const obscure = routeCitations({
      candidates: [
        {
          citationId: "bib.bib2",
          title: "A Niche Result",
          citationCount: OBSCURE_CITATION_COUNT_THRESHOLD - 1,
          year: 2018,
        },
      ],
    })[0];
    expect(obscure.retrieve).toBe(true);
    expect(obscure.reasons).toEqual(["obscure_or_recent"]);

    const recent = routeCitations({
      candidates: [
        {
          citationId: "bib.bib3",
          title: "Brand New Work",
          citationCount: 10_000,
          year: RECENT_YEAR_CUTOFF,
        },
      ],
    })[0];
    expect(recent.retrieve).toBe(true);
    expect(recent.reasons).toEqual(["obscure_or_recent"]);

    // Unknown citation count alone is NOT obscure.
    const unknownCount = routeCitations({
      candidates: [{ citationId: "bib.bib4", title: "Untracked", year: 2010 }],
    })[0];
    expect(unknownCount.retrieve).toBe(false);
  });

  it("trigger 3: already-ingested cited papers route via library lookup", () => {
    const [decision] = routeCitations({
      candidates: [wellKnown],
      ingestedPaperIds: ["1412.6980v9"],
    });
    expect(decision.retrieve).toBe(true);
    expect(decision.reasons).toEqual(["already_ingested"]);
  });

  it("trigger 4: low-familiarity glossary terms are selected, bounded per response", () => {
    const terms = Array.from({ length: 10 }, (_, index) => ({
      term: `term-${index}`,
      familiarity: index % 2 === 0 ? ("low" as const) : ("high" as const),
    }));

    const selected = selectGroundingTerms(terms);
    expect(selected.length).toBeLessThanOrEqual(MAX_GROUNDING_TERMS_PER_RESPONSE);
    expect(selected).toEqual(["term-0", "term-2", "term-4", "term-6", "term-8"]);
  });

  it("accumulates multiple reasons on one citation", () => {
    const [decision] = routeCitations({
      question: "What does the cited paper say?",
      candidates: [{ ...wellKnown, citationCount: 5 }],
      ingestedPaperIds: ["1412.6980"],
    });
    expect(decision.reasons).toEqual([
      "source_specific_ask",
      "obscure_or_recent",
      "already_ingested",
    ]);
  });
});

/**
 * The recency cutoff is the one constant in this file whose correct
 * value changes on its own, because "recent" is measured against a
 * clock the constant cannot see. Left unattended it does not break —
 * it quietly widens the retrieval trigger by a year every January.
 *
 * So this suite deliberately reads the REAL current date rather than a
 * frozen one: a pinned `now` would go stale exactly the way the
 * constant does, and the test would keep passing while the value it
 * guards drifted. This is a test-only exception; the routing path
 * itself never reads the clock.
 */
describe("recency cutoff stays in step with the calendar", () => {
  it("sits within the allowed lag behind the real current year", () => {
    const currentYear = new Date().getFullYear();
    const lag = currentYear - RECENT_YEAR_CUTOFF;

    expect(
      lag,
      `RECENT_YEAR_CUTOFF is ${RECENT_YEAR_CUTOFF}, which is ${lag} years behind the current ` +
        `year (${currentYear}) — more than the ${RECENT_YEAR_CUTOFF_MAX_LAG_YEARS}-year lag ` +
        `allowed. Every year it sits still, the citation router calls a wider span of papers ` +
        `"recent" and pulls retrieval for more of them. Re-decide the cutoff in ` +
        `src/server/explain/constants.ts (usually: bump it toward the current year). Widening ` +
        `RECENT_YEAR_CUTOFF_MAX_LAG_YEARS to silence this is the bug, not the fix.`,
    ).toBeLessThanOrEqual(RECENT_YEAR_CUTOFF_MAX_LAG_YEARS);

    expect(
      lag,
      `RECENT_YEAR_CUTOFF is ${RECENT_YEAR_CUTOFF}, which is in the future relative to the ` +
        `current year (${currentYear}). No paper can be published in/after it, so the recency ` +
        `half of the obscure-or-recent trigger would never fire.`,
    ).toBeGreaterThanOrEqual(0);
  });

  it("still routes a paper from the cutoff year, and leaves the year before it alone", () => {
    // Pins the behaviour the lag assertion exists to protect, so a bump
    // to the constant cannot quietly invert the comparison.
    const atCutoff = routeCitations({
      candidates: [{ citationId: "bib.bib1", citationCount: 10_000, year: RECENT_YEAR_CUTOFF }],
    })[0];
    expect(atCutoff.reasons).toEqual(["obscure_or_recent"]);

    const beforeCutoff = routeCitations({
      candidates: [{ citationId: "bib.bib2", citationCount: 10_000, year: RECENT_YEAR_CUTOFF - 1 }],
    })[0];
    expect(beforeCutoff.retrieve).toBe(false);
  });
});

describe("renderRoutedCitationContext", () => {
  it("renders only routed citations and frames them as grounding material", () => {
    const candidates = [
      { citationId: "bib.bib1", title: "Routed Paper", year: 2025, abstract: "The abstract." },
      { citationId: "bib.bib2", title: "Unrouted Paper" },
    ];
    const decisions = [
      { citationId: "bib.bib1", retrieve: true, reasons: ["obscure_or_recent" as const] },
      { citationId: "bib.bib2", retrieve: false, reasons: [] },
    ];

    const block = renderRoutedCitationContext(candidates, decisions);
    expect(block).toContain("Routed Paper");
    expect(block).toContain("cited_text");
    expect(block).not.toContain("Unrouted Paper");
  });

  it("caps rendered citations by priority: ingested > obscure/recent > citation count", () => {
    const candidates = [
      { citationId: "bib.bib1", title: "Obscure Low", citationCount: 5 },
      { citationId: "bib.bib2", title: "Obscure High", citationCount: 150 },
      { citationId: "bib.bib3", title: "Ingested Paper", citationCount: 1 },
      { citationId: "bib.bib4", title: "Obscure Mid", citationCount: 50 },
    ];
    const decisions = [
      { citationId: "bib.bib1", retrieve: true, reasons: ["obscure_or_recent" as const] },
      { citationId: "bib.bib2", retrieve: true, reasons: ["obscure_or_recent" as const] },
      { citationId: "bib.bib3", retrieve: true, reasons: ["already_ingested" as const] },
      { citationId: "bib.bib4", retrieve: true, reasons: ["obscure_or_recent" as const] },
    ];

    const block = renderRoutedCitationContext(candidates, decisions, { max: 2 });
    expect(block).toContain("Ingested Paper");
    expect(block).toContain("Obscure High");
    expect(block).not.toContain("Obscure Mid");
    expect(block).not.toContain("Obscure Low");
  });

  it("keeps routed order untouched when under the cap", () => {
    const candidates = [
      { citationId: "bib.bib1", title: "First", citationCount: 1 },
      { citationId: "bib.bib2", title: "Second", citationCount: 100 },
    ];
    const decisions = [
      { citationId: "bib.bib1", retrieve: true, reasons: ["obscure_or_recent" as const] },
      { citationId: "bib.bib2", retrieve: true, reasons: ["obscure_or_recent" as const] },
    ];

    const block = renderRoutedCitationContext(candidates, decisions, { max: 5 })!;
    expect(block.indexOf("First")).toBeLessThan(block.indexOf("Second"));
  });

  it("returns undefined when nothing was routed", () => {
    expect(
      renderRoutedCitationContext(
        [{ citationId: "bib.bib1" }],
        [{ citationId: "bib.bib1", retrieve: false, reasons: [] }],
      ),
    ).toBeUndefined();
  });
});
