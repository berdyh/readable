import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryResult } from "@/server/summarize/types";

const clerk = vi.hoisted(() => ({
  useUser: vi.fn(() => ({ isLoaded: true, isSignedIn: true })),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: clerk.useUser,
}));

import { Block } from "../block-editor/Block";
import { EditorProvider, useEditorStore } from "../block-editor/store";
import { usePaperContent } from "./usePaperContent";
import type { ThreePass } from "./usePassState";

/**
 * The workspace → editor seam, rendered.
 *
 * The reading surface swaps two different documents under one editor: the
 * summary artifact on skim, the paper HTML on read/deep. Each swap reparses
 * from scratch and every block gets a fresh uuid, so the incoming array shares
 * no id with what is on screen. Before the editor kept per-document state, the
 * store simply replaced its blocks on every swap and a reader's edits went
 * with them — the bug these tests pin down.
 *
 * The harness mirrors ReaderWorkspace's composition (usePaperContent feeding
 * EditorProvider, one Block per entry) rather than mounting ReaderWorkspace
 * itself, which would drag in the chat sidecar and its own network calls for
 * no added coverage of this seam.
 */

const PAPER_ID = "arxiv:1706.03762";

const contractSummary: SummaryResult = {
  sections: [
    {
      section_id: "S1",
      title: "Introduction",
      summary: "Claim.",
      reasoning: "Mechanism.",
      hook: "Why?",
      source: "model_knowledge",
    },
  ],
  key_findings: [],
  figures: [],
  concepts: [],
};

const htmlResult = {
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  sections: [{ id: "S1", title: "Introduction", level: 1, paragraphs: ["Paper HTML text."] }],
  figures: [],
  sourceUrl: "https://arxiv.org/abs/1706.03762",
};

interface Gate {
  wait: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { wait, open };
}

const fetchMock = vi.fn();

/**
 * Per-URL stubs. A gate lets a test decide exactly when a document arrives,
 * which is the only way to reproduce "content lands while the reader is
 * already editing". Each call builds its own Response: usePaperContent aborts
 * and refires the summary request when the HTML state changes, and a shared
 * Response would have its body consumed by the abandoned attempt.
 */
function stubFetch(held: { summary?: Gate; html?: Gate } = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/editor/ingest/arxiv")) {
      await held.html?.wait;
      return new Response(JSON.stringify(htmlResult), { status: 200 });
    }
    if (url.includes("/api/summarize")) {
      await held.summary?.wait;
      return new Response(JSON.stringify(contractSummary), { status: 200 });
    }
    if (url.includes("/api/persona/exposure")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

/**
 * Refreshed after every render, so it always closes over the current blocks.
 * A keystroke in Block.tsx lands as exactly this call —
 * `updateBlock(id, { content })` — which is why the edit is driven through the
 * store rather than typed into TipTap's contenteditable, something jsdom
 * models poorly.
 */
let editBlock: ((needle: string, suffix: string) => void) | null = null;

function EditableSurface() {
  const { state, updateBlock } = useEditorStore();

  // In an effect rather than during render: reassigning module state while
  // rendering is a side effect, and lint rightly rejects it.
  useEffect(() => {
    editBlock = (needle, suffix) => {
      const target = state.blocks.find((block) => block.content.includes(needle));
      if (!target) {
        throw new Error(
          `No block containing "${needle}". Rendered: ${state.blocks.length} blocks.`,
        );
      }
      updateBlock(target.id, { content: `${target.content}${suffix}` });
    };
  });

  return (
    <div>
      {state.blocks.map((block, index) => (
        <Block key={block.id} block={block} index={index} />
      ))}
    </div>
  );
}

function Harness({ initialPass = "skim" as ThreePass }) {
  const [pass, setPass] = useState<ThreePass>(initialPass);
  const { initialBlocks, documentKey } = usePaperContent({ paperId: PAPER_ID, pass });

  return (
    <div>
      <button type="button" onClick={() => setPass("skim")}>
        skim
      </button>
      <button type="button" onClick={() => setPass("read")}>
        read
      </button>
      <EditorProvider paperId={PAPER_ID} initialBlocks={initialBlocks} documentKey={documentKey}>
        <EditableSurface />
      </EditorProvider>
    </div>
  );
}

async function togglePass(label: "skim" | "read") {
  await act(async () => {
    screen.getByRole("button", { name: label }).click();
  });
}

async function edit(needle: string, suffix: string) {
  await act(async () => {
    editBlock?.(needle, suffix);
  });
}

beforeEach(() => {
  editBlock = null;
  fetchMock.mockReset();
  stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  clerk.useUser.mockReturnValue({ isLoaded: true, isSignedIn: true });
});

describe("pass toggling and reader edits", () => {
  it("keeps an edit made on skim after a round trip through read", async () => {
    // The reported repro, end to end.
    render(<Harness />);

    await screen.findByText("Paper Summary");
    await edit("Paper Summary", " — reader note");
    expect(await screen.findByText("Paper Summary — reader note")).toBeInTheDocument();

    await togglePass("read");
    expect(await screen.findByText("Paper HTML text.")).toBeInTheDocument();
    expect(screen.queryByText("Paper Summary — reader note")).not.toBeInTheDocument();

    await togglePass("skim");
    expect(await screen.findByText("Paper Summary — reader note")).toBeInTheDocument();
  });

  it("still shows a summary that arrives mid-edit, and keeps the paper edit", async () => {
    // Skim before the summary resolves renders the paper HTML, so an edit here
    // belongs to the paper document. When the summary lands the surface must
    // still switch to it — the dirty check protects edits, it must not suppress
    // arriving content — and the paper edit must survive underneath.
    const summary = gate();
    stubFetch({ summary });

    render(<Harness />);

    await screen.findByText("Paper HTML text.");
    await edit("Paper HTML text.", " — reader note");
    expect(await screen.findByText("Paper HTML text. — reader note")).toBeInTheDocument();

    await act(async () => {
      summary.open();
    });

    expect(await screen.findByText("Paper Summary")).toBeInTheDocument();
    expect(screen.queryByText("Paper HTML text. — reader note")).not.toBeInTheDocument();

    await togglePass("read");
    expect(await screen.findByText("Paper HTML text. — reader note")).toBeInTheDocument();
  });

  it("replaces a placeholder with real content when nothing was edited", async () => {
    // The guard against the dirty check over-firing: an untouched document must
    // still be replaced the moment a better one exists.
    const html = gate();
    stubFetch({ html });

    // Read rather than skim: on skim the summary would win the moment it
    // resolves, which makes the placeholder → paper HTML step a race. The
    // adoption being tested is the same either way.
    render(<Harness initialPass="read" />);

    expect(await screen.findByText(`Loading paper content for ${PAPER_ID}…`)).toBeInTheDocument();

    await act(async () => {
      html.open();
    });

    expect(await screen.findByText("Paper HTML text.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(`Loading paper content for ${PAPER_ID}…`)).not.toBeInTheDocument();
    });
  });
});
