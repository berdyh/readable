/**
 * Chat data shapes shared by the sidecar, the inline panel, the hooks and the
 * API glue. Pure types only — no React, no fetch, no DOM.
 *
 * The wire shapes are owned by the server: `@/server/chat/types` is the same
 * module `/api/chat/history` validates against, and `@/server/qa/types` is what
 * `/api/qa` returns. The client view model below is *derived* from them rather
 * than redeclared, so a change on the server breaks this build instead of
 * failing at runtime. The assertions at the bottom of the file cover the parts
 * the derivation cannot express on its own.
 *
 * Type-only imports from `@/server/*` — the established client/server rule.
 */
import type {
  ChatCitation,
  ChatMessage as WireChatMessage,
  ChatMessageMetadata as WireChatMessageMetadata,
  ChatTrustMetadata,
} from "@/server/chat/types";
import type {
  AnswerCitation,
  AnswerResult,
  AnswerTrustMetadata as QaTrustMetadata,
} from "@/server/qa/types";

import type { TrustDisplayMetadata } from "../primitives/answer-card";
import type { Source } from "../primitives/sources";

export type { ChatCitation, WireChatMessage };

export type ChatRole = WireChatMessage["role"];

/**
 * Wider than the wire's metadata, whose `trust` is required and strict. A
 * message composed in the browser carries whatever `/api/qa` returned; the
 * server sanitizes it on the way in, so the client does not have to prove it
 * satisfies the persisted shape.
 */
export interface ChatMessageMetadata {
  version: 1;
  trust?: TrustDisplayMetadata;
}

/**
 * The client view of a message: the wire message plus two fields that only
 * exist in the browser, with `citations` narrowed to what the UI can render.
 * `id`, `role`, `content`, `reasoning` and `createdAt` are inherited, so the
 * wire owns them.
 */
export interface ChatMessage extends Omit<WireChatMessage, "citations" | "metadata"> {
  /** Narrowed: `sources.tsx` needs a chunk id or a title/url to render a row. */
  citations?: Source[];
  metadata?: ChatMessageMetadata;
  /** Client-only: `metadata.trust` lifted to the top level for rendering. */
  trust?: TrustDisplayMetadata;
  /** Client-only: this message failed to send. */
  status?: "error";
}

/** One saved conversation, rendered as a tab in the sidecar's tab strip. */
export interface ChatTab {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string | null;
}

/** `POST /api/chat/session` response. */
export interface ChatSessionResponse {
  session: {
    id: string;
    paperId: string;
    createdAt: string;
  };
}

/**
 * `GET /api/chat/history` response. Both shapes are accepted for compatibility.
 * Messages arrive in wire form — run them through `fromWireMessage()` before
 * rendering.
 */
export interface ChatHistoryResponse {
  sessions?: Array<{
    sessionId: string;
    messages: WireChatMessage[];
    createdAt: number;
    updatedAt: number;
  }>;
  messages?: WireChatMessage[];
}

/** `POST /api/qa` response, narrowed to what the chat surface consumes. */
export interface ChatAnswerResponse {
  answer: string;
  cites?: Source[];
  reasoning?: string;
  trust?: TrustDisplayMetadata;
  /**
   * Server-validated source label; folded into `trust` for display.
   * Derived, not redeclared — adding a label server-side breaks this build
   * rather than silently rendering nothing.
   */
  source?: AnswerResult["source"];
}

/**
 * Lifts the answer-level source label into the trust display block so
 * the trust strip is the single place that renders provenance.
 */
export function withSourceLabel(
  trust: TrustDisplayMetadata | undefined,
  source: ChatAnswerResponse["source"],
): TrustDisplayMetadata | undefined {
  if (!source) {
    return trust;
  }
  return { ...(trust ?? {}), source };
}

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDraftTab(): ChatTab {
  return {
    id: createLocalId("chat"),
    title: "New chat",
    messages: [],
    sessionId: null,
  };
}

export function titleFromQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 42 ? `${compact.slice(0, 39)}…` : compact;
}

/**
 * A persisted citation only has to carry *some* metadata to pass server
 * validation, but the UI needs either a chunk id (to navigate into the paper) or
 * a title/url (to show a row). A citation with neither — a bare quote, say — is
 * dropped rather than rendered as a blank row.
 */
export function toSource(citation: ChatCitation): Source | undefined {
  if (citation.chunkId) {
    return { chunkId: citation.chunkId, page: citation.page, quote: citation.quote };
  }

  const label = citation.title ?? citation.url;
  if (!label) {
    return undefined;
  }

  return {
    id: citation.id ?? citation.url ?? label,
    title: label,
    url: citation.url,
    page: citation.page,
  };
}

/**
 * Wire → view. Narrows citations to the renderable ones and lifts
 * `metadata.trust` to the top level so rendering has a single source of truth
 * (older persisted messages carried trust under `metadata` only).
 */
export function fromWireMessage(message: WireChatMessage): ChatMessage {
  const { citations, ...rest } = message;
  const renderable = citations?.map(toSource).filter((source): source is Source => Boolean(source));

  // Dropping unrenderable citations is correct — it prevents a blank source row.
  // But it is silent, so a server change that started emitting quote-only
  // citations in volume would look like "answers stopped having sources" with
  // nothing pointing here. Count what was discarded so the cause is visible.
  const dropped = (citations?.length ?? 0) - (renderable?.length ?? 0);
  if (dropped > 0) {
    reportDroppedCitations(dropped, citations?.length ?? 0);
  }

  return {
    ...rest,
    citations: renderable?.length ? renderable : undefined,
    trust: message.metadata?.trust,
  };
}

/**
 * Warns once per session rather than once per message: a paper whose answers all
 * carry quote-only citations would otherwise flood the console and train the
 * reader to ignore it.
 *
 * Deliberately console-only and count-only — no citation text, ids, or user
 * content leave the client, so this stays safe to keep on in production.
 */
let droppedCitationWarningIssued = false;

function reportDroppedCitations(dropped: number, total: number): void {
  if (droppedCitationWarningIssued) return;
  droppedCitationWarningIssued = true;
  console.warn(
    `[chat] Dropped ${dropped} of ${total} citation(s) with neither a chunk id nor a title/url; ` +
      `they cannot be rendered as a source row. Further occurrences this session are not logged.`,
  );
}

/** Test seam — the warning latch is module state and would leak between cases. */
export function _resetDroppedCitationWarningForTests(): void {
  droppedCitationWarningIssued = false;
}

/** Mirror `trust` down into `metadata` so the persisted row round-trips. */
export function toPersistedMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    metadata:
      message.metadata ??
      (message.role === "assistant" && message.trust
        ? { version: 1 as const, trust: message.trust }
        : undefined),
  };
}

/*
 * Compile-time links between the client view model and the wire. `Assert<…>`
 * fails to typecheck when its argument is `false`, so a drift here is a build
 * error rather than a blank row or a lost field at runtime.
 */
type Assert<T extends true> = T;
type IsAssignable<A, B> = [A] extends [B] ? true : false;

/** Anything the UI can render, the history endpoint will accept. */
export type SourceFitsWire = Assert<IsAssignable<Source, ChatCitation>>;
/** Anything the history endpoint returns, the trust strip can render. */
export type WireTrustRenders = Assert<IsAssignable<ChatTrustMetadata, TrustDisplayMetadata>>;
export type WireMetadataRenders = Assert<
  IsAssignable<WireChatMessageMetadata, ChatMessageMetadata>
>;
/** So can a fresh answer straight from `/api/qa`. */
export type QaTrustRenders = Assert<IsAssignable<QaTrustMetadata, TrustDisplayMetadata>>;
export type QaCitationRenders = Assert<IsAssignable<AnswerCitation, Source>>;
