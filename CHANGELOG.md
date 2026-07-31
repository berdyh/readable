# Changelog

All notable changes to Readable are recorded here. Versions are `MAJOR.MINOR.PATCH.MICRO`.

## [0.2.0.0] - 2026-07-31

### Added

- **Summaries teach instead of compress.** Every section of a paper summary now opens with the
  question the authors were answering, states the claim in plain language, explains the
  mechanism with a concrete example before the general form, points at the evidence in the
  paper, and defines the terms it introduces. Figure takeaways say what a figure _proves_,
  not what it contains.
- **Explanations adapt to what you already know.** Concepts you have met before are no longer
  re-explained; concepts that are new to you are fully taught. Readable builds this picture
  from what you actually read — with different weight for "appeared in a summary you saw",
  "you asked about it", and "you had it explained" — and it fades over time if you do not
  come back to a topic.
- **Every explanation says where it came from.** Answers and summaries carry an honest label:
  the paper's own cited text, or the model's general knowledge. Chat shows it as a trust chip,
  and the server refuses to let anything claim `cited_text` unless a retrieved passage backed it.
- **Cited works are used for learning, not decoration.** When a prerequisite is unfamiliar,
  Readable pulls in the cited paper's own text — but only when it is worth it: obscure or very
  recent work, papers already in your library, or when you explicitly ask about a source.
  Otherwise the model explains from its own knowledge and says so.
- **A knowledge graph behind the reading.** Concepts and their prerequisites are recorded as
  you read, so explanations can eventually be ordered by what you need to understand first.
- **`pnpm eval` — an explanation-quality gate.** Fixture papers and reader profiles are scored
  by a pinned judge across six dimensions (coverage, hook, plain language, mechanism
  concreteness, evidence grounding, glossary quality) with per-dimension thresholds, a
  variance check across runs, and a latency budget.
- **Local coding agents work as an LLM backend.** Codex CLI and Claude Code are detected by
  asking the CLI itself whether it is signed in, and the agent you pick in chat is now also
  used by `/summary` and `/explain`.

### Fixed

- **Summaries no longer skip the back half of a paper.** Chunks were ordered lexicographically,
  so section 10 sorted before section 2 and everything past the first ten sections — training,
  results, conclusions — never reached the model. Ingest now records reading order, and the
  prompt guarantees every section is represented before deepening any of them.
- **Silent empty answers from the model provider are caught.** One upstream was truncating the
  prompt and replying `{}` with an HTTP 200 that no failover path noticed; that now fails
  loudly, routes around the provider, and tolerates payloads that arrive double-encoded.
- **Citation lookups stopped hammering Semantic Scholar.** Enrichment happens once at ingest in
  batches, is stored, and is never re-fetched while you read; rate-limit responses back off,
  identical lookups share one request, and a failed lookup never overwrites good data.
- **Clicking a citation no longer reports failure after succeeding.** The editor replied to the
  chat's navigation request before anyone was listening, so a revealed block still showed as
  unavailable.
- **Paper metadata comes from our own database** instead of re-fetching arXiv on every summary,
  and "(page ?)" no longer appears for papers ingested from HTML, which have no page numbers.

### Changed

- Local coding-agent detection asks the CLI rather than parsing its credential files, so it
  keeps working when those formats change — including macOS Keychain logins that no file check
  could see. Token refreshes performed mid-call are now kept instead of discarded.
- The reading surface renders the teaching contract on the skim pass and the paper's own text
  on the deeper passes; what you were shown is recorded only when it actually rendered.
