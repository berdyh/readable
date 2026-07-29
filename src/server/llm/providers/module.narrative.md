`local-coding-agent.ts` is the odd one: it shells out to a local CLI (Codex,
Claude Code) rather than calling an HTTP API, running it in an isolated temp `HOME`/`TMPDIR`
with app secrets stripped from the environment. Because that also hides the agent's own
subscription credential, each invocation stages just that one file into the sandbox — never
the whole config tree, and never Claude's third-party MCP tokens. Treat changes there as
security-relevant.
