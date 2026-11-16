import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** The repository root: this file is apps/web/e2e/helpers/demo.ts. */
const ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * Make sure the demo activity (D5-02) is in the local database: the KPI specs read its lists,
 * offers and campaigns. Runs `pnpm db:seed:activity`, which changes nothing when the rows are
 * already there and refuses a database that is not on this machine.
 */
export function ensureDemoActivity(): void {
  execSync("pnpm db:seed:activity", { cwd: ROOT, stdio: "pipe", env: process.env });
}
