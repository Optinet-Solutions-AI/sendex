import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

export interface RunningWorker {
  baseUrl: string;
  secret: string;
  /** Everything the worker printed, for the failure message. */
  output: () => string;
  stop(): Promise<void>;
}

export interface StartWorkerOptions {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Dispatcher poll in ms; the default of 5 s makes the flow spec slow. */
  lapPollMs?: number;
  timeoutMs?: number;
}

const INTERNAL_SECRET = "e2e-internal-secret";

/**
 * Start the real worker (`apps/worker`, `tsx src/index.ts`) against the local Postgres and
 * Redis for the full-flow spec, and wait for `/health`. Without a running worker nothing
 * is sent and no click is counted, so the spec starts and stops its own instead of adding it
 * to Playwright's global `webServer` list (the other specs must not have a dispatcher running
 * beside them: it would send the laps they expect to stay queued).
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const chunks: string[] = [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: options.redisUrl,
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    WORKER_PORT: String(options.port),
    LAP_POLL_MS: String(options.lapPollMs ?? 1_000),
    LINKS_BASE_URL: "http://localhost:8787",
    SENDEX_VERSION: "e2e",
  };
  // No carrier in the flow spec: routes 405 and 403 are `platform`, served by the FakeProvider.
  env.SMPP_HOST = undefined;
  const child: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@sendex/worker", "exec", "tsx", "src/index.ts"],
    {
      cwd: repoRoot,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => chunks.push(d.toString()));

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const output = () => chunks.join("");
  if (!healthy) {
    await stop(child);
    throw new Error(`worker did not become healthy on ${baseUrl}:\n${output()}`);
  }
  return { baseUrl, secret: INTERNAL_SECRET, output, stop: () => stop(child) };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    if (process.platform === "win32") {
      // `shell: true` wraps the worker in cmd.exe: kill the whole tree.
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
    setTimeout(resolve, 10_000).unref();
  });
}
