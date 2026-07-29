`local-coding-agent.ts` is the odd one: it shells out to a local CLI (Codex,
Claude Code) rather than calling an HTTP API, running it in an isolated temp `HOME`/`TMPDIR`
with app secrets stripped from the environment. Treat changes there as security-relevant.
