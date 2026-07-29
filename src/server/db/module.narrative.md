`schema.ts` is the runtime source of truth — a template string applied by
`ensureSchema()` on first request. `schema.sql` is a mirrored copy kept only for reading;
change both together, which `schema.test.ts` enforces.

Chat ownership is a composite foreign key, not an app-level check, so a message belonging to
another user's session is physically impossible rather than merely rejected.
