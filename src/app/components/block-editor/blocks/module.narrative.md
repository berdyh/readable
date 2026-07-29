Blocks produced by API calls carry `metadata.locked` and are read-only until
explicitly unlocked — a slash command run inside a locked block inserts its result *after* it
rather than overwriting generated content. See `../LOCKED_BLOCKS.md`.
