#!/usr/bin/env node
/**
 * `pnpm dev:demo`: the dashboard on http://localhost:3000 against the LOCAL database, signed in
 * as the demo owner (the development auth stub, so no Clerk sign-in), with the demo activity
 * seeded (D5-02). For trying screens that are not on main yet.
 *
 * It applies the migrations of the branch you are on, runs the demo seed and the activity
 * seed, then starts the web app. It refuses a database that is not on this machine.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DATABASE = "postgresql://sendex:sendex@127.0.0.1:5432/sendex";
const LOCAL_REDIS = "redis://127.0.0.1:6379";

/** A value from the shell, else from the root .env, else the default. */
function setting(name, fallback) {
  if (process.env[name]) return process.env[name];
  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = new RegExp(`^${name}=(.*)$`).exec(line);
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return fallback;
}

function isLocal(url) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const databaseUrl = setting("DATABASE_URL", LOCAL_DATABASE);
if (!isLocal(databaseUrl)) {
  console.error("dev:demo only runs against a local database. DATABASE_URL points somewhere else.");
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DATABASE_DIRECT_URL: databaseUrl,
  REDIS_URL: setting("REDIS_URL", LOCAL_REDIS),
  INTERNAL_API_SECRET: setting("INTERNAL_API_SECRET", "dev-internal-secret"),
  // The development auth stub: every request is the seeded owner of "External".
  SENDEX_DEV_AUTH: "1",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  CLERK_SECRET_KEY: "",
  // The demo data has Spanish and Polish lists as well as UK ones.
  NEXT_PUBLIC_OPEN_COUNTRIES: process.env.NEXT_PUBLIC_OPEN_COUNTRIES ?? "all",
};

function step(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync("pnpm", args, { cwd: root, env, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(
      `\n${label} failed. Is the local database running? In PowerShell:\n  wsl -d Ubuntu -u root -- systemctl start postgresql redis-server`,
    );
    process.exit(result.status ?? 1);
  }
}

step("Applying migrations to the local database", ["db:migrate"]);
step("Seeding demo data and demo activity", ["db:seed:activity"]);

console.log("\n> Starting the dashboard on http://localhost:3000 (Ctrl+C to stop)\n");
const web = spawn("pnpm", ["--filter", "@sendex/web", "dev"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: true,
});
web.on("exit", (code) => process.exit(code ?? 0));
