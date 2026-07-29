Exists because five call sites across `summarize`, `qa`, `editor` and `persona`
each wrote their own `text.slice(0, n)`, and every one of them could split a
surrogate pair.

That is not a theoretical concern for this app. arXiv papers are full of
non-BMP characters — `𝑁` (U+1D441) appears throughout the Attention Is All You
Need chunks — and a split pair produced an opaque upstream 400
(`unexpected end of hex escape`) that read as a model fault for as long as it
went uninvestigated.

Kept as its own module rather than folded into `llm-config` because `persona`
needs it for a _database_ write, not a prompt: Postgres rejects a lone
surrogate in a text column just as firmly as a JSON parser does.
