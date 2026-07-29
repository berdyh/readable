Collections are named per embedding provider+model and sized to that model's
native dimension. Switching `EMBEDDING_PROVIDER` therefore queries a *different* collection,
and previously ingested papers vanish until re-ingested — that isolation is deliberate, since
mixing dimensions in one collection silently corrupts search. Setting `QDRANT_COLLECTION`
pins one name and opts out.
