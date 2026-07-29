import { describe, expect, it } from "vitest";

import { htmlToMarkdown, markdownToHtml } from "./markdown";

describe("markdown conversion", () => {
  it("round-trips bullet list blocks with native list semantics", () => {
    const markdown = "- first item";
    const html = markdownToHtml(markdown, "bullet_list");

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>first item</li>");
    expect(htmlToMarkdown(html, "bullet_list")).toBe(markdown);
  });

  it("round-trips numbered list blocks while preserving numeric marker", () => {
    const markdown = "3. first item";
    const html = markdownToHtml(markdown, "number_list");

    expect(html).toContain('<ol start="3">');
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
    const markdown = "> quoted text";
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
