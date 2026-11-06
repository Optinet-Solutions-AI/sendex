import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // PGlite (WASM Postgres) takes several seconds to boot and migrate on CI runners.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
