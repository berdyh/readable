`ReaderWorkspace` composes `ThreePassBar` + `BlockEditor` + `SkillsPanel`

- `PdfPanel`. The pass, paper, and status hooks live beside it rather than in a shared hooks
  directory, because they are meaningless outside this surface.

`usePaperContent` returns `initialBlocks` together with a `documentKey` naming the source those
blocks were parsed from — `:summary`, `:paper`, or `:placeholder`. They are produced by one memo
so they can never disagree. The editor stores reader edits under that key, which is what makes
switching passes non-destructive; keying placeholders apart from both real documents is what
guarantees real content always replaces a placeholder.
