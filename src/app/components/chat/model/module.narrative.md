May not touch React, fetch, or the DOM.

Types are **derived** from `@/server/chat/types`, never redeclared, and the file closes with
`Assert<IsAssignable<…>>` checks. `TrustDisplayMetadata` is deliberately wider than either
wire shape because it renders live `/api/qa` answers, persisted rows, and older rows written
before the current shape existed.
