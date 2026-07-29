/**
 * Public surface of the chat module.
 *
 * This module owns the chat wire contract. `src/app/components/chat/model/types.ts`
 * derives the client shapes from `./types` rather than redeclaring them — see the
 * `Assert<IsAssignable<…>>` checks there.
 */
export { InvalidChatPayloadError, parseChatMessage, toApiMessage } from "./messages";

export type * from "./types";
