The per-lookup cache and the DOI/arXiv/title lookup ladder are internal —
callers get one `enrichCitation()` and should not care which of the three resolved it.

Enrichment is best-effort: a failed lookup must degrade the citation, never fail the answer
that carries it.
