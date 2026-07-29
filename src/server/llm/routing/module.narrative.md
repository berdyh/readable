Pattern adapted from OpenClaw (MIT). The load-bearing decision is
advance-vs-fail-fast: `auth_permanent` and `format` failures stop the ladder immediately
rather than burning every remaining profile on an error that will recur identically.

Auth and cooldown state persists to `~/.readable/agents/<id>/` — outside the repo, so it
survives reinstalls and is invisible to tests unless stubbed.
