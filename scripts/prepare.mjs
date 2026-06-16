import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.env.VERCEL === "1" || process.env.CI === "true" || !existsSync(".git")) {
  console.log("[prepare] Skipping git hooks in CI/Vercel or outside a local git checkout.");
  process.exit(0);
}

const result = spawnSync("simple-git-hooks", {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
