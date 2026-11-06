import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types; its shape is checked by this test.
import { buildWorker, externalPackages } from "../scripts/build.mjs";

/**
 * The container runs `node dist/index.js` (D1-07). The workspace packages ship TypeScript
 * sources, so the bundle must inline them and keep only npm packages as imports.
 */
describe("worker bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "sendex-worker-build-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps npm dependencies external and resolvable from the worker itself", () => {
    const external: string[] = externalPackages();
    expect(external).toEqual(expect.arrayContaining(["bullmq", "postgres", "ioredis", "smpp"]));
    expect(external.some((name) => name.startsWith("@sendex/"))).toBe(false);
    const own = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const name of external) expect(own.dependencies).toHaveProperty(name);
  });

  it("produces one ESM file with no workspace or .ts imports", async () => {
    const outfile = join(dir, "index.js");
    await buildWorker({ outfile });
    const bundle = readFileSync(outfile, "utf8");
    const imports = [...bundle.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => s?.startsWith("@sendex/"))).toEqual([]);
    expect(imports.filter((s) => s?.endsWith(".ts"))).toEqual([]);
    expect(bundle).toContain("/health");
  }, 60_000);
});
