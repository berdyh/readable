import { describe, expect, it } from "vitest";

import { htmlToMarkdown, markdownToHtml } from "./markdown";

describe("markdown conversion", () => {
  it("round-trips bullet list blocks with native list semantics", () => {
    const markdown = "first item";
    const html = markdownToHtml(markdown, "bullet_list");

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>first item</li>");
    expect(htmlToMarkdown(html, "bullet_list")).toBe(markdown);
  });

  it("round-trips numbered list blocks", () => {
    const markdown = "first item";
    const html = markdownToHtml(markdown, "number_list");

    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first item</li>");
    expect(htmlToMarkdown(html, "number_list")).toBe(markdown);
  });

  it("renders todo markdown as plain text html for external checkbox UI", () => {
    const markdown = "[x] done task";
    const html = markdownToHtml(markdown, "to_do_list");

    expect(html).toBe("done task");
    expect(htmlToMarkdown("<p>done task</p>", "to_do_list")).toBe("done task");
  });

  it("preserves marker-like text inside todo content", () => {
    const markdown = "[ ] - follow-up";
    const html = markdownToHtml(markdown, "to_do_list");

    expect(html).toBe("- follow-up");
    expect(htmlToMarkdown("<p>- follow-up</p>", "to_do_list")).toBe("- follow-up");
  });

  it("normalizes cross-type list markers without nesting markers", () => {
    expect(markdownToHtml("- hello", "number_list")).toContain("<li>hello</li>");
    expect(markdownToHtml("1. hello", "bullet_list")).toContain("<li>hello</li>");
    expect(markdownToHtml("[x] hello", "bullet_list")).toContain("<li>hello</li>");
  });

  it("round-trips quote blocks", () => {
    const markdown = "quoted text";
    const html = markdownToHtml(markdown, "quote");

    expect(html).toContain("<blockquote>");
    expect(htmlToMarkdown(html, "quote")).toBe(markdown);
  });

  it("round-trips fenced code blocks", () => {
    const markdown = "```ts\nconst x = 1;\n```";
    const html = markdownToHtml(markdown, "code");

    expect(html).toContain('<code class="language-ts">');
    expect(htmlToMarkdown(html, "code")).toBe(markdown);
  });
});

describe("block-level markers are not stored in content", () => {
  it("keeps a heading's title bare, because the level is the block type", () => {
    const html = markdownToHtml("Paper Summary", "heading_1");

    expect(html).not.toContain("#");
    expect(htmlToMarkdown(html, "heading_1")).toBe("Paper Summary");
  });

  it("heals content written before the rule existed", () => {
    // Nothing persists blocks today, but a session that ran the old serializer
    // can still be holding `# Paper Summary` in memory — render it as a title,
    // and store it bare from then on.
    expect(markdownToHtml("## Introduction", "heading_2")).toBe("<p>Introduction</p>");
    expect(markdownToHtml("- key point", "bullet_list")).toContain("<li>key point</li>");
    expect(markdownToHtml("> quoted", "quote")).toContain("quoted");
    expect(htmlToMarkdown("<h2>Introduction</h2>", "heading_2")).toBe("Introduction");
  });

  it("stores what the reader typed into a heading, still bare", () => {
    // The markup TipTap emits for an edited heading block: a paragraph, since
    // the editor runs with `heading: false` and styles the level from the type.
    expect(htmlToMarkdown('<p class="m-0">Paper Summary — reader note</p>', "heading_1")).toBe(
      "Paper Summary — reader note",
    );
  });

  it("leaves a title that looks like markdown alone", () => {
    // Parsed inline, so `1.` stays a section number instead of becoming an
    // ordered list, and the un-escaped serializer keeps it that way.
    for (const title of ["1. Introduction", "3.1 Method", "A & B", "log_2 of x_i"]) {
      expect(htmlToMarkdown(markdownToHtml(title, "heading_2"), "heading_2")).toBe(title);
    }
  });
});

/**
 * The property whose absence produced the unlock-rewrites-content bug: handing
 * a block's stored content to TipTap and reading it straight back must return
 * the same string. TipTap emits an update on mount and again whenever it is
 * made editable, so any asymmetry here rewrites blocks nobody typed in — and
 * marks the document dirty, which then costs the reader real edits on the next
 * document swap.
 *
 * The content column is what `parsers.ts` actually writes for that type.
 */
const ROUND_TRIP_CASES: Array<{ type: string; content: string; note?: string }> = [
  { type: "heading_1", content: "Paper Summary" },
  { type: "heading_1", content: "Attention Is All You Need" },
  { type: "heading_2", content: "Introduction" },
  { type: "heading_2", content: "Key Findings" },
  { type: "heading_3", content: "New terms" },
  { type: "paragraph", content: "Plain sentence." },
  { type: "paragraph", content: "*Why does attention work at all?*" },
  { type: "paragraph", content: "**Evidence:** Table 2 reports the gain." },
  {
    type: "paragraph",
    content: "**Source:** [arXiv:1706.03762](https://arxiv.org/abs/1706.03762)",
  },
  { type: "bullet_list", content: "A key point." },
  { type: "bullet_list", content: "**term** — a definition *(from cited text)*" },
  { type: "number_list", content: "A numbered point." },
  { type: "quote", content: "quoted text" },
  { type: "callout", content: "Statement\n\nEvidence: page 4" },
  { type: "code", content: "```ts\nconst x = 1;\n```" },
  { type: "figure", content: "Figure 1: the caption" },
  { type: "divider", content: "" },
];

describe("markdown round trip is idempotent", () => {
  for (const { type, content } of ROUND_TRIP_CASES) {
    it(`${type}: ${JSON.stringify(content)}`, () => {
      expect(htmlToMarkdown(markdownToHtml(content, type), type)).toBe(content);
    });
  }

  /**
   * Two documented exceptions, both because the markdown alone is not the whole
   * block state. Neither is a marker the block type already encodes, so neither
   * is the bug this suite exists to catch.
   */
  it("to_do_list loses its checkbox, which TipTapBlock re-attaches from the block", () => {
    // The checked state is not in the HTML — TodoBlock renders the checkbox
    // itself — so the serializer cannot recover it. TipTapBlock reads it back
    // off `block.content` and prepends it again before storing.
    expect(htmlToMarkdown(markdownToHtml("[x] done task", "to_do_list"), "to_do_list")).toBe(
      "done task",
    );
  });

  it("collapses single newlines, tracked separately from block markers", () => {
    // `parseSelectionSummaryToBlocks` joins its bullets with "\n", which marked
    // renders as a soft break and turndown reads back as a space. A real
    // round-trip loss, but one about line breaks rather than block markers.
    expect(htmlToMarkdown(markdownToHtml("• first\n• second", "callout"), "callout")).toBe(
      "• first • second",
    );
  });
});
