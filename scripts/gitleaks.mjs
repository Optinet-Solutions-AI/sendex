#!/usr/bin/env node
// Runs gitleaks on staged changes. Finds the binary on PATH or in the winget
// install folder (Windows), so the pre-commit hook works in any shell.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = ["git", "--pre-commit", "--staged", "--redact", "--no-banner"];

function candidates() {
  const list = ["gitleaks"];
  if (process.platform === "win32") {
    const base = join(homedir(), "AppData", "Local", "Microsoft", "WinGet");
    list.push(join(base, "Links", "gitleaks.exe"));
    const pkgs = join(base, "Packages");
    if (existsSync(pkgs)) {
      for (const d of readdirSync(pkgs)) {
        if (d.toLowerCase().startsWith("gitleaks")) list.push(join(pkgs, d, "gitleaks.exe"));
      }
    }
  }
  return list;
}

for (const bin of candidates()) {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") continue;
  process.exit(r.status ?? 1);
}

console.error(
  "gitleaks is not installed. Install it (winget install Gitleaks.Gitleaks, brew install gitleaks, or https://github.com/gitleaks/gitleaks/releases) and retry.",
);
process.exit(1);
