import { defineConfig, devices } from "@playwright/test";

/** Set `PORT` to run the e2e server somewhere other than 3000 (e.g. next to another dev server). */
const port = process.env.PORT?.trim() || "3000";
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);

/**
 * End-to-end tests for the dashboard. The web server runs under the development auth stub
 * (`SENDEX_DEV_AUTH=1`, see docs/engineering/auth.md) so no Clerk session is needed; it still
 * needs `DATABASE_URL` pointing at a Postgres with the core tables and the demo seed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `${baseURL}/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      SENDEX_DEV_AUTH: "1",
      // Force the stub even when the developer's shell has Clerk keys set.
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "",
    },
  },
});
