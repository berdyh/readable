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

  it("round-trips numbered list blocks with native ordered list semantics", () => {
    const markdown = "1. first item";
    const html = markdownToHtml(markdown, "number_list");

    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first item</li>");
    expect(htmlToMarkdown(html, "number_list")).toBe(markdown);
  });

  it("round-trips task list blocks without hidden checkbox html", () => {
    const markdown = "[x] done task";
    const html = markdownToHtml(markdown, "to_do_list");

    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).not.toContain("data-markdown-checkbox");
    expect(htmlToMarkdown(html, "to_do_list")).toBe(markdown);
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
