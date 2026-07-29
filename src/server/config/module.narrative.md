Never hardcode a timeout or a base URL at a call site.

There is no automatic `{SERVICE}_TIMEOUT_MS` convention — the env var name is an explicit
argument, so adding a knob means naming it here.
