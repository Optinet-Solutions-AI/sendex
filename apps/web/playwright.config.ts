import { defineConfig, devices } from "@playwright/test";

/** Set `PLAYWRIGHT_PORT` (or `PORT`) to run the e2e server somewhere other than 3000. */
const port = Number.parseInt(
  (process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? "3000").trim() || "3000",
  10,
);
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
  // One worker on CI; two locally so the dev server is not compiling six routes at once.
  workers: isCI ? 1 : 2,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  // `next dev` compiles each route on first hit, so a first server action can take longer
  // than Playwright's 5 s default before the page moves on.
  expect: { timeout: 15_000 },
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
