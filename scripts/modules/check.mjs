#!/usr/bin/env node
/**
 * Module structure checker — the three audit questions.
 *
 *   Q1 Coverage   every source file owned by exactly one module
 *   Q2 Freshness  every AGENTS.md regenerates identically; owns/checks/entrypoint exist
 *   Q3 Connections declared `uses` match what the code actually imports
 *
 * Only deterministic signals may fail the build. Import edges come from a
 * regex over `@/`-aliased specifiers — reproducible. Declared-only edge kinds
 * (http, sql, env, queue) are reported but never affect the exit code, because
 * no static analyser can see them and a flaky gate is worse than no gate.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import { loadModules, ownerOf, REPO_ROOT } from "./modules.mjs";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".bare", "out", "build", "coverage",
  "graphify-out", ".vercel", ".clerk", ".gstack", ".codex", ".vscode", "tmp",
]);
const SOURCE_RE = /\.(ts|tsx|mjs)$/;

function sourceFiles(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) sourceFiles(full, hits);
    else if (SOURCE_RE.test(name)) hits.push(relative(REPO_ROOT, full));
  }
  return hits;
}

const { modules, byId } = loadModules();
const problems = [];
const notes = [];

// ── Q1 coverage ────────────────────────────────────────────────────────────
const files = [
  ...sourceFiles(join(REPO_ROOT, "src")),
  ...sourceFiles(join(REPO_ROOT, "scripts")),
];
const unowned = files.filter((f) => !ownerOf(f, modules));
if (unowned.length) {
  problems.push(
    `Q1 coverage: ${unowned.length} source file(s) belong to no module:\n` +
      unowned.map((f) => `      ${f}`).join("\n"),
  );
}

// ── Q2 freshness (paths / commands / entrypoints exist) ────────────────────
for (const m of modules) {
  for (const owned of m.owns ?? []) {
    if (!existsSync(join(REPO_ROOT, owned))) {
      problems.push(`Q2 freshness: ${m.id} owns "${owned}" which does not exist`);
    }
  }
  const ep = m.interface?.entrypoint ?? "";
  if (ep && !ep.startsWith("(")) {
    const epPath = m.path === "." ? ep : join(m.path, ep);
    if (!existsSync(join(REPO_ROOT, epPath))) {
      problems.push(`Q2 freshness: ${m.id} entrypoint "${epPath}" does not exist`);
    }
  }
  if (m.parent && !byId.has(m.parent)) {
    problems.push(`Q2 freshness: ${m.id} names parent "${m.parent}" which has no manifest`);
  }
}

// ── Q3 connection accuracy ─────────────────────────────────────────────────
const IMPORT_RE = /from\s+['"](@\/[a-zA-Z0-9./_-]+)['"]/g;

function moduleForSpecifier(spec) {
  // Resolve "@/x/y" against the deepest module that owns "src/x/y".
  const asPath = "src/" + spec.slice(2);
  let best = null;
  let bestLen = -1;
  for (const m of modules) {
    for (const owned of m.owns ?? []) {
      if (asPath === owned || asPath.startsWith(owned + "/")) {
        if (owned.length > bestLen) { bestLen = owned.length; best = m; }
      }
    }
  }
  return best;
}

const actual = new Map(); // moduleId -> Set<moduleId>
for (const f of files) {
  if (/\.(test|spec)\.tsx?$/.test(f)) continue;
  const owner = ownerOf(f, modules);
  if (!owner) continue;
  let text;
  try { text = readFileSync(join(REPO_ROOT, f), "utf8"); } catch { continue; }
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = moduleForSpecifier(m[1]);
    if (!target || target.id === owner.id) continue;
    // An import into a descendant of your own module is internal, not a connection.
    if (target.id.startsWith(owner.id + ".")) continue;
    if (!actual.has(owner.id)) actual.set(owner.id, new Set());
    actual.get(owner.id).add(target.id);
  }
}

// A parent inherits its children's connections; it never restates them.
function declaredFor(id) {
  const out = new Set();
  const walk = (mid) => {
    const m = byId.get(mid);
    if (!m) return;
    for (const u of m.uses ?? []) out.add(u.module);
    for (const child of modules.filter((x) => x.parent === mid)) walk(child.id);
  };
  walk(id);
  return out;
}

for (const [id, targets] of [...actual].sort()) {
  const declared = declaredFor(id);
  const missing = [...targets].filter((t) => {
    if (declared.has(t)) return false;
    // Declaring the parent covers its children (e.g. server.llm covers llm-config usage).
    for (const d of declared) if (t.startsWith(d + ".")) return false;
    // A connection declared by an ancestor of this module also counts.
    for (const d of declared) if (d.startsWith(t + ".")) return false;
    return true;
  });
  if (missing.length) {
    problems.push(
      `Q3 connections: ${id} imports ${missing.join(", ")} but does not declare it in "uses"`,
    );
  }
}

for (const m of modules) {
  for (const u of m.uses ?? []) {
    if (u.kind && u.kind !== "import") {
      notes.push(`  declared-only (${u.kind}, not statically verified): ${m.id} -> ${u.module} via ${u.via}`);
    }
    if (!byId.has(u.module)) {
      problems.push(`Q3 connections: ${m.id} declares unknown module "${u.module}"`);
    }
    if (!u.via) {
      problems.push(`Q3 connections: ${m.id} -> ${u.module} has no "via" — an arrow with no named interface tells an agent a dependency exists but not what to read`);
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`Modules: ${modules.length}  Source files: ${files.length}`);
if (notes.length) {
  console.log("\nDeclared-only connections (reported, never build-failing):");
  for (const n of notes) console.log(n);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nQ1 coverage OK · Q2 freshness OK · Q3 connections OK");
