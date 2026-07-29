Not deployed and never imported by the app. Everything here talks to real
services, which is exactly why none of it is part of `pnpm verify` — that gate must stay
deterministic and offline.
