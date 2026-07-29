There **is** a Next.js middleware — `src/proxy.ts`, which Next 16 renamed from
`middleware.ts`. It runs bare `clerkMiddleware()`, which makes auth available to
handlers but **protects nothing on its own**: it matches no route to a
requirement, so every route stays reachable until its handler acts.

So protection really is per-handler: a route is **public until its handler calls
`requireAuthenticatedUserId()`**. That is deliberate — reads of public paper text
are meant to work signed out — but it means the safe default is the insecure one,
and a new route under `src/app/api/` needs an explicit decision.

This module owns `proxy.ts` because that file is the auth wiring, even though it
sits at `src/` root where Next.js requires it.
