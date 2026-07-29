A framework-forced layer, not a real boundary — see the stub below.

Handlers must stay thin: authenticate, validate, delegate, shape the response. There is no
`middleware.ts`; every protected route calls `requireAuthenticatedUserId()` itself, so a
new route is **public until its handler opts in**.
