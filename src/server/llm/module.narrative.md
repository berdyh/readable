Two cooperating halves: `providers/` adapts each upstream API to one interface,
`routing/` decides which profile to try next.

Routing only engages when `LLM_ALLOWED_PROVIDERS` is set. Otherwise calls go straight to
`LLM_PROVIDER` on a legacy fast path — worth knowing before debugging why a failover ladder
appears not to run.
