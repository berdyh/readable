import { describe, expect, it } from "vitest";

import type { SummaryResult } from "@/server/summarize/types";

import { parseSummaryToBlocks } from "./parsers";

/** A summary persisted before the explanation contract existed. */
const legacySummary: SummaryResult = {
  sections: [
    {
      section_id: "S1",
      title: "Introduction",
      summary: "Legacy claim text.",
      reasoning: "Legacy reasoning text.",
      key_points: ["Point one", "Point two"],
      page_span: { start: 1, end: 2 },
      page_anchor: "(page 1)",
    },
    {
      section_id: "S2",
      title: "Results",
      summary: "Legacy results.",
      reasoning: "Legacy results reasoning.",
    },
  ],
  key_findings: [
    {
      statement: "Finding",
      evidence: "Evidence",
      page_anchors: ["(page 3)"],
      supporting_sections: ["S2"],
    },
  ],
  figures: [
    {
      figure_id: "F1",
      caption: "A figure",
      insight: "The figure proves X.",
      page_anchor: "(page 3)",
    },
  ],
};

const contractSummary: SummaryResult = {
  sections: [
    {
      section_id: "S1",
      title: "Introduction",
      summary: "Plain-language claim.",
      reasoning: "Mechanism with analogy.",
      hook: "Why can attention replace recurrence?",
      evidence: "Supported by S1 and F1.",
      new_terms: [
        {
          term: "self-attention",
          definition: "Each token weighs the others.",
          familiarity: "high",
        },
        {
          term: "flux capacitor",
          definition: "Grounded definition.",
          familiarity: "low",
          source: "cited_text",
        },
      ],
      source: "model_knowledge",
    },
    {
      section_id: "S2",
      title: "Results",
      summary: "Results claim.",
      reasoning: "Results mechanism.",
      hook: "Did it actually work?",
      source: "model_knowledge",
    },
    {
      section_id: "S3",
      title: "Conclusion",
      summary: "Conclusion claim.",
      reasoning: "Conclusion mechanism.",
      hook: "What does this change?",
      source: "cited_text",
    },
  ],
  key_findings: [
    {
      statement: "Finding",
      evidence: "Evidence",
      page_anchors: [],
      supporting_sections: ["S2"],
    },
  ],
  figures: [{ figure_id: "F1", caption: "A figure", insight: "Declarative takeaway." }],
  concepts: [
    { concept: "attention mechanism", domain: "ml", concept_key: "ml:attention mechanism" },
  ],
};

describe("parseSummaryToBlocks", () => {
  it("renders legacy summaries exactly as before the contract (regression)", () => {
    const blocks = parseSummaryToBlocks(legacySummary);
    const shapes = blocks.map((block) => `${block.type}:${block.content}`);

    expect(shapes).toEqual([
      "heading_1:Paper Summary",
      "heading_2:Introduction",
      "paragraph:Legacy claim text.",
      "bullet_list:Point one",
      "bullet_list:Point two",
      "divider:",
      "heading_2:Results",
      "paragraph:Legacy results.",
      "heading_2:Key Findings",
      "callout:Finding\n\nEvidence: Evidence",
      "heading_2:Figures",
      "figure:A figure",
    ]);
  });

  it("tolerates summaries with entirely missing optional fields", () => {
    const minimal: SummaryResult = {
      sections: [{ section_id: "S1", title: "Only Section", summary: "Claim.", reasoning: "Why." }],
      key_findings: [],
      figures: [],
    };

    const blocks = parseSummaryToBlocks(minimal);
    expect(blocks.map((block) => block.type)).toEqual(["heading_1", "heading_2", "paragraph"]);
  });

  it("renders the explanation contract: hook, mechanism, evidence, glossary, source labels", () => {
    const blocks = parseSummaryToBlocks(contractSummary);
    const contents = blocks.map((block) => block.content);

    // Hook renders as an italic lead-in before the claim.
    expect(contents).toContain("*Why can attention replace recurrence?*");
    // Claim then mechanism, in order.
    const claimIndex = contents.indexOf("Plain-language claim.");
    const mechanismIndex = contents.indexOf("Mechanism with analogy.");
    expect(claimIndex).toBeGreaterThan(-1);
    expect(mechanismIndex).toBe(claimIndex + 1);
    // Evidence pointer.
    expect(contents).toContain("**Evidence:** Supported by S1 and F1.");
    // Glossary terms, with cited-text provenance marked.
    expect(contents).toContain("**self-attention** — Each token weighs the others.");
    expect(contents).toContain("**flux capacitor** — Grounded definition. *(from cited text)*");

    // Source labels ride on section heading metadata for chip rendering.
    const headings = blocks.filter((block) => block.type === "heading_2");
    expect(headings[0]?.metadata?.sourceLabel).toBe("model_knowledge");
    expect(headings[2]?.metadata?.sourceLabel).toBe("cited_text");
  });

  it("renders the mechanism when the section is contract-shaped even without a hook", () => {
    const noHook: SummaryResult = {
      sections: [
        {
          section_id: "S1",
          title: "Introduction",
          summary: "Claim.",
          reasoning: "Mechanism without a hook.",
          evidence: "Supported by S1.",
        },
      ],
      key_findings: [],
      figures: [],
    };

    const contents = parseSummaryToBlocks(noHook).map((block) => block.content);
    expect(contents).toContain("Mechanism without a hook.");
  });

  it("still hides reasoning for legacy (non-contract) sections", () => {
    const contents = parseSummaryToBlocks(legacySummary).map((block) => block.content);
    expect(contents).not.toContain("Legacy reasoning text.");
    expect(contents).not.toContain("Legacy results reasoning.");
  });

  it("escapes markdown metacharacters in hook and term wrappers", () => {
    const hostile: SummaryResult = {
      sections: [
        {
          section_id: "S1",
          title: "Introduction",
          summary: "Claim.",
          reasoning: "Mechanism.",
          hook: "  Why does a*b differ from a_b?  ",
          new_terms: [
            { term: "gradient *descent*", definition: "Following the slope.", familiarity: "high" },
          ],
          source: "model_knowledge",
        },
      ],
      key_findings: [],
      figures: [],
    };

    const contents = parseSummaryToBlocks(hostile).map((block) => block.content);
    expect(contents).toContain("*Why does a\\*b differ from a\\_b?*");
    expect(contents).toContain("**gradient \\*descent\\*** — Following the slope.");
  });

  it("separates the glossary from key points with a New terms heading", () => {
    const withBoth: SummaryResult = {
      sections: [
        {
          section_id: "S1",
          title: "Introduction",
          summary: "Claim.",
          reasoning: "Mechanism.",
          new_terms: [{ term: "softmax", definition: "Normalizes scores.", familiarity: "high" }],
          key_points: ["A key point"],
          source: "model_knowledge",
        },
      ],
      key_findings: [],
      figures: [],
    };

    const blocks = parseSummaryToBlocks(withBoth);
    const shapes = blocks.map((block) => `${block.type}:${block.content}`);
    const headingIndex = shapes.indexOf("heading_3:New terms");
    const termIndex = shapes.findIndex((shape) => shape.includes("softmax"));
    const keyPointIndex = shapes.indexOf("bullet_list:A key point");

    expect(headingIndex).toBeGreaterThan(-1);
    expect(termIndex).toBe(headingIndex + 1);
    expect(keyPointIndex).toBeGreaterThan(termIndex);
  });

  it("keeps every generated block locked", () => {
    const blocks = parseSummaryToBlocks(contractSummary).filter(
      (block) => block.type !== "divider",
    );
    for (const block of blocks) {
      expect(block.metadata?.locked, `${block.type}: ${block.content}`).toBe(true);
    }
  });
});
