import { describe, expect, it } from "vitest";

import {
  blocksAreEquivalent,
  decideDocumentBlocks,
  recordDocumentBaseline,
  recordDocumentEdit,
  type DocumentEntries,
} from "./documentState";
import type { Block } from "./types";

const SUMMARY_KEY = "arxiv:1706.03762:summary";
const PAPER_KEY = "arxiv:1706.03762:paper";
const PLACEHOLDER_KEY = "arxiv:1706.03762:placeholder";

function block(id: string, content: string): Block {
  return { id, type: "paragraph", content };
}

const INCOMING = [block("fresh-1", "Incoming baseline.")];
const EDITED = [block("edited-1", "Reader wrote this.")];

/**
 * The two axes that decide whether a reader's edit survives: is there an entry
 * for the key we are about to render, and has that entry been touched. Every
 * combination is spelled out because the failure mode of getting one wrong is
 * silent — content simply disappears, and only for one pass toggle.
 */
describe("decideDocumentBlocks", () => {
  const cases: Array<{
    name: string;
    entries: () => DocumentEntries;
    key: string;
    expected: { action: "adopt" | "restore"; blocks: Block[] };
  }> = [
    {
      name: "adopts when the key has never been seen",
      entries: () => new Map(),
      key: PAPER_KEY,
      expected: { action: "adopt", blocks: INCOMING },
    },
    {
      name: "adopts when the same key is clean (new baseline replaces the old one)",
      entries: () => {
        const entries: DocumentEntries = new Map();
        recordDocumentBaseline(entries, PLACEHOLDER_KEY, [block("p", "Loading…")]);
        return entries;
      },
      key: PLACEHOLDER_KEY,
      expected: { action: "adopt", blocks: INCOMING },
    },
    {
      name: "restores when the same key is dirty",
      entries: () => {
        const entries: DocumentEntries = new Map();
        recordDocumentEdit(entries, PAPER_KEY, EDITED);
        return entries;
      },
      key: PAPER_KEY,
      expected: { action: "restore", blocks: EDITED },
    },
    {
      name: "adopts when a different key is dirty",
      entries: () => {
        const entries: DocumentEntries = new Map();
        recordDocumentEdit(entries, PAPER_KEY, EDITED);
        return entries;
      },
      key: SUMMARY_KEY,
      expected: { action: "adopt", blocks: INCOMING },
    },
    {
      name: "adopts when a different key is clean",
      entries: () => {
        const entries: DocumentEntries = new Map();
        recordDocumentBaseline(entries, PAPER_KEY, [block("h", "Paper HTML.")]);
        return entries;
      },
      key: SUMMARY_KEY,
      expected: { action: "adopt", blocks: INCOMING },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(decideDocumentBlocks(testCase.entries(), testCase.key, INCOMING)).toEqual(
        testCase.expected,
      );
    });
  }

  it("keeps each document's edits independent, so toggling back and forth restores both", () => {
    const entries: DocumentEntries = new Map();

    // Skim renders the summary, the reader edits it.
    recordDocumentBaseline(entries, SUMMARY_KEY, [block("s1", "Paper Summary")]);
    recordDocumentEdit(entries, SUMMARY_KEY, [block("s1", "Paper Summary — my note")]);

    // Read renders the paper HTML for the first time, and gets edited too.
    expect(decideDocumentBlocks(entries, PAPER_KEY, INCOMING).action).toBe("adopt");
    recordDocumentBaseline(entries, PAPER_KEY, INCOMING);
    recordDocumentEdit(entries, PAPER_KEY, EDITED);

    // Back to skim: the summary edit is what comes back, not the fresh parse.
    expect(decideDocumentBlocks(entries, SUMMARY_KEY, [block("s9", "Paper Summary")])).toEqual({
      action: "restore",
      blocks: [block("s1", "Paper Summary — my note")],
    });
    expect(decideDocumentBlocks(entries, PAPER_KEY, INCOMING)).toEqual({
      action: "restore",
      blocks: EDITED,
    });
  });

  it("lets a later edit supersede an earlier one under the same key", () => {
    const entries: DocumentEntries = new Map();
    recordDocumentEdit(entries, PAPER_KEY, [block("a", "first")]);
    recordDocumentEdit(entries, PAPER_KEY, [block("a", "second")]);

    expect(decideDocumentBlocks(entries, PAPER_KEY, INCOMING)).toEqual({
      action: "restore",
      blocks: [block("a", "second")],
    });
  });

  it("re-baselining a dirty key drops its edits", () => {
    // Not a path the store takes today, but the semantics must be explicit:
    // a baseline is a declaration that nothing local is worth keeping.
    const entries: DocumentEntries = new Map();
    recordDocumentEdit(entries, PAPER_KEY, EDITED);
    recordDocumentBaseline(entries, PAPER_KEY, INCOMING);

    expect(decideDocumentBlocks(entries, PAPER_KEY, INCOMING).action).toBe("adopt");
  });
});

/**
 * What separates "the reader changed something" from "a write happened". TipTap
 * emits an update as soon as it mounts, so treating every write as an edit
 * would make an untouched document dirty — and a dirty document refuses to be
 * replaced by real content.
 */
describe("blocksAreEquivalent", () => {
  it("treats an identical rewrite as no change", () => {
    const before = [block("a", "one"), block("b", "two")];
    const after = [block("a", "one"), block("b", "two")];

    expect(blocksAreEquivalent(before, after)).toBe(true);
    expect(blocksAreEquivalent(before, before)).toBe(true);
  });

  it("notices content, type, id, length and order changes", () => {
    const before = [block("a", "one"), block("b", "two")];

    expect(blocksAreEquivalent(before, [block("a", "one!"), block("b", "two")])).toBe(false);
    expect(blocksAreEquivalent(before, [block("a", "one"), block("z", "two")])).toBe(false);
    expect(blocksAreEquivalent(before, [block("b", "two"), block("a", "one")])).toBe(false);
    expect(blocksAreEquivalent(before, [block("a", "one")])).toBe(false);
    expect(
      blocksAreEquivalent(before, [
        { id: "a", type: "heading_1", content: "one" },
        block("b", "two"),
      ]),
    ).toBe(false);
  });

  it("notices metadata changes, including the lock toggle", () => {
    const locked = [{ ...block("a", "one"), metadata: { locked: true } }];
    const unlocked = [{ ...block("a", "one"), metadata: { locked: false } }];
    const bare = [block("a", "one")];

    expect(blocksAreEquivalent(locked, unlocked)).toBe(false);
    expect(blocksAreEquivalent(locked, bare)).toBe(false);
    expect(blocksAreEquivalent(bare, [{ ...block("a", "one"), metadata: {} }])).toBe(true);
    expect(
      blocksAreEquivalent(locked, [{ ...block("a", "one"), metadata: { locked: true } }]),
    ).toBe(true);
  });
});
