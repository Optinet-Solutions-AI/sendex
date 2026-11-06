// Bundle the worker for the container image. The workspace packages (@sendex/core, db,
// providers, redis-utils) export TypeScript sources and have no build of their own, so a plain
// `tsc` output would import `.ts` files at runtime. esbuild inlines them into one ESM file and
// leaves every npm dependency external (resolved from node_modules in the image).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, "..");
const repoRoot = resolve(workerDir, "..", "..");

const WORKSPACE_PACKAGES = ["core", "db", "providers", "redis-utils"];

function dependenciesOf(packageJsonPath) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return Object.keys(pkg.dependencies ?? {});
}

/**
 * Every npm dependency the bundle may reach, direct or through a workspace package. Each one
 * must also be a dependency of the worker itself: pnpm gives a package only its own
 * dependencies, so an import the bundle leaves external resolves from `apps/worker` alone.
 */
export function externalPackages() {
  const own = new Set(dependenciesOf(resolve(workerDir, "package.json")));
  const names = new Set(own);
  for (const name of WORKSPACE_PACKAGES) {
    for (const dep of dependenciesOf(resolve(repoRoot, "packages", name, "package.json"))) {
      names.add(dep);
    }
  }
  const external = [...names].filter((name) => !name.startsWith("@sendex/")).sort();
  const unresolvable = external.filter((name) => !own.has(name));
  if (unresolvable.length > 0) {
    throw new Error(
      `apps/worker/package.json must list ${unresolvable.join(", ")} (used by a workspace package) so node can resolve them from dist/index.js`,
    );
  }
  return external;
}

export async function buildWorker({ outfile = resolve(workerDir, "dist", "index.js") } = {}) {
  await build({
    entryPoints: [resolve(workerDir, "src", "index.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    external: externalPackages(),
    logLevel: "warning",
  });
  return outfile;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outfile = await buildWorker();
  console.log(`built ${outfile}`);
}
