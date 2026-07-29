Never inline a prompt or a model id at a call site. Both live in JSON here so
they can be diffed and changed without touching logic.
