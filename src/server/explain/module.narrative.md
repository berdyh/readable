# explain

The mechanism library behind the explanation flows. Summarize, QA, and
selection each compose these pieces under their **own** policy and voice
(QA answers first and lets an explicit ask override "already known";
selection stays tight and local; summarize builds the full teaching
artifact) — the shared machinery lives here exactly once.

What it owns:

- **Persona split** — `loadPersonaSplit()` reads the mastery ledger and
  derives known / seen / new at read time (weighted typed signals ×
  exponential decay; constants exported and unit-tested). It never
  throws and never blocks: anonymous readers, empty ledgers, and store
  failures all degrade to the uncalibrated default.
- **Concept keys** — conservative normalization (case / whitespace /
  trailing plural only, no fuzzy matching) with a domain facet
  (`"{domain}:{key}"`) so homonyms from different fields never merge.
- **Source labels** — the `model_knowledge | cited_text` contract:
  schema fragment, prompt instructions, and server-side validation that
  downgrades `cited_text` claims lacking retrieved passages.
- **Citation router** — four explicit retrieval triggers
  (source-specific ask, obscure-or-recent, already-ingested,
  self-reported-unfamiliar via glossary familiarity). Citation abstracts
  are router metadata only — they never become explanation prose.
- **Rendering primitives** — the routed-citation grounding block and
  prompt truncation helpers.
