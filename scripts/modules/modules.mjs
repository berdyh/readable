/**
 * Shared loader for the module manifests.
 *
 * Discovery walks the repo rather than reading a central list, so adding a
 * module is one directory with one manifest — there is no registry to forget
 * to update.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".bare", "out", "build", "coverage",
  "graphify-out", ".vercel", ".clerk", ".gstack", ".codex", ".vscode", "tmp",
]);

function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, hits);
    else if (name === "module.manifest.json") hits.push(full);
  }
  return hits;
}

export function loadModules() {
  const files = walk(REPO_ROOT);
  const modules = files.map((f) => {
    const mod = JSON.parse(readFileSync(f, "utf8"));
    const narrativePath = join(dirname(f), "module.narrative.md");
    mod.narrative = existsSync(narrativePath)
      ? readFileSync(narrativePath, "utf8")
      : "";
    mod.manifestPath = relative(REPO_ROOT, f);
    return mod;
  });
  modules.sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(modules.map((m) => [m.id, m]));
  return { modules, byId };
}

/**
 * File → module mapping: the module whose `owns` path is the deepest match.
 * Deepest-wins is what lets a parent claim a whole subtree as a catch-all while
 * children still own their own directories, without every file being
 * double-owned.
 */
export function ownerOf(relPath, modules) {
  let best = null;
  let bestLen = -1;
  for (const m of modules) {
    for (const owned of m.owns ?? []) {
      const prefix = owned === "." ? "" : owned;
      if (prefix === "" || relPath === prefix || relPath.startsWith(prefix + "/")) {
        if (prefix.length > bestLen) { bestLen = prefix.length; best = m; }
      }
    }
  }
  return best;
}
