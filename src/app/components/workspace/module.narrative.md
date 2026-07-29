`ReaderWorkspace` composes `ThreePassBar` + `BlockEditor` + `SkillsPanel`

- `PdfPanel`. The pass, paper, and status hooks live beside it rather than in a shared hooks
  directory, because they are meaningless outside this surface.
