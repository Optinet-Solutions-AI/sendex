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
  // One worker: the specs share one database and seed rows side by side, and `next dev`
  // compiles every route on first hit. The suite takes about two minutes serially.
  workers: 1,
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
      // The specs create Spanish, German and Maltese data through the UI; every other
      // country stays closed so e2e/open-countries.spec.ts has one to check (D4-19).
      NEXT_PUBLIC_OPEN_COUNTRIES: "GB,ES,DE,MT",
    },
  },
});
