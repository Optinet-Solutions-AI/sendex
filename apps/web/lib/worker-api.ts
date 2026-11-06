import { type EmergencyStopState, emergencyStopStateSchema } from "@sendex/core";

/**
 * Server-side client for the worker's `/internal/*` routes (docs/engineering/sending-engine.md).
 * The web app never talks to Redis or a carrier itself: the emergency stop flag lives in the
 * worker's Redis, so the settings switch and the header banner go through here. Only server
 * code may import this module (it holds the shared secret).
 */

export interface WorkerApiConfig {
  /** Origin of the worker, no trailing slash. */
  baseUrl: string;
  /** `INTERNAL_API_SECRET`; null disables every call. */
  secret: string | null;
  fetchImpl?: typeof fetch;
  /** Abort after this long. Default 5 s; the header banner uses a shorter one. */
  timeoutMs?: number;
}

type Env = Record<string, string | undefined>;

/** `WORKER_INTERNAL_URL` (private network) over `WORKER_PUBLIC_URL`, defaulting to localhost. */
export function workerApiConfig(env: Env = process.env): WorkerApiConfig {
  const base = env.WORKER_INTERNAL_URL || env.WORKER_PUBLIC_URL || "http://localhost:4000";
  const secret = env.INTERNAL_API_SECRET?.trim() || null;
  return { baseUrl: base.replace(/\/+$/, ""), secret };
}

export class WorkerApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkerApiError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function call(path: string, init: RequestInit, config: WorkerApiConfig): Promise<unknown> {
  if (!config.secret) {
    throw new WorkerApiError(503, "INTERNAL_API_SECRET is not set; the worker cannot be reached");
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "x-internal-secret": config.secret,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `worker answered ${response.status}`;
    throw new WorkerApiError(response.status, message);
  }
  return body;
}

function parseState(body: unknown): EmergencyStopState {
  const parsed = emergencyStopStateSchema.safeParse(body);
  if (!parsed.success) throw new WorkerApiError(502, "worker gave an unexpected answer");
  return parsed.data;
}

const path = (organisationId: string) =>
  `/internal/emergency-stop?organisationId=${encodeURIComponent(organisationId)}`;

export async function readEmergencyStop(
  organisationId: string,
  config: WorkerApiConfig = workerApiConfig(),
): Promise<EmergencyStopState> {
  return parseState(await call(path(organisationId), { method: "GET" }, config));
}

export async function raiseEmergencyStop(
  organisationId: string,
  input: { reason: string; byUserId: string },
  config: WorkerApiConfig = workerApiConfig(),
): Promise<EmergencyStopState> {
  return parseState(
    await call(
      "/internal/emergency-stop",
      { method: "POST", body: JSON.stringify({ organisationId, ...input }) },
      config,
    ),
  );
}

export async function clearEmergencyStopFlag(
  organisationId: string,
  config: WorkerApiConfig = workerApiConfig(),
): Promise<EmergencyStopState> {
  return parseState(await call(path(organisationId), { method: "DELETE" }, config));
}
