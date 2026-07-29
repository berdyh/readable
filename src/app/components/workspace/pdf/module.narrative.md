`canvas` is aliased to `src/shims/emptyCanvas.ts` in **both** the Turbopack
and webpack configs so `pdfjs-dist` does not pull in a native module. Keep both aliases in
sync when touching `next.config.ts` — dropping one breaks only the other bundler, which is
easy to miss locally.
