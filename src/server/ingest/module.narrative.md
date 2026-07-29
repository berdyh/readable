The extraction ladder is ordered by how much structure it preserves: ar5iv HTML
gives real sections and figures, PDF.js text is the fallback, and OCR is the last resort for
image-only PDFs.

Postgres records and Qdrant vectors are written inside one `replacePaperIngestData`
transaction, under a per-paper advisory lock, so a re-ingest cannot leave the two stores
disagreeing about which chunks exist.
