/**
 * Public surface of the chat sidecar module.
 *
 * Everything outside `chat/` imports from here. Internals (`model/`, `api/`,
 * `hooks/`, `primitives/`, `sidecar/`, `inline/`) are private to the module —
 * the one exception is `block-editor/intents.ts` + `block-editor/navigation.ts`,
 * the DOM CustomEvent seam the editor owns and chat subscribes to.
 */
export { ChatButton } from "./sidecar/ChatButton";
export { ChatSidePanel, type ChatSidePanelProps } from "./sidecar/ChatSidePanel";
export { InlineChatPanel, type InlineChatPanelProps } from "./inline/InlineChatPanel";
export type { AnswerTrustMetadata } from "./primitives/answer-card";
export type { Source } from "./primitives/sources";
export type { ChatMessage, ChatTab } from "./model/types";
