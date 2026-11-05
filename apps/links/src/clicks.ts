import { classifyDevice, type DeviceClass } from "@sendex/core/links";

/**
 * One recorded redirect, in the shape the worker's `ClickIngestJob` accepts
 * (`shortCode`, `clickedAt`, `ip`, `userAgent`) plus what the edge knows for free:
 * Cloudflare's country and network (`asn`) and the device class of the user agent.
 */
export interface ClickRecord {
  shortCode: string;
  /** ISO 8601, the moment the redirect was served. */
  clickedAt: string;
  ip: string;
  userAgent: string;
  /** ISO 3166-1 alpha-2 from `request.cf.country`. */
  country?: string;
  device: DeviceClass;
  /** `request.cf.asOrganization`: the network name, usually the mobile operator. */
  asn?: string;
}

/** Where to deliver clicks when no Cloudflare Queue is bound. */
export interface ClickTarget {
  workerUrl: string;
  secret: string;
}

/** Cloudflare attaches `cf` to the incoming request; absent under `app.request()` in tests. */
type RequestWithCf = Request & { cf?: Record<string, unknown> | undefined };

function cfString(request: RequestWithCf, key: string): string | undefined {
  const value = request.cf?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function clientIp(request: Request): string {
  const connecting = request.headers.get("cf-connecting-ip");
  if (connecting) return connecting;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** Build the click record for a served redirect. Pure apart from reading the request. */
export function buildClickRecord(shortCode: string, request: Request, now: Date): ClickRecord {
  const userAgent = request.headers.get("user-agent") ?? "";
  const country = cfString(request, "country");
  const asn = cfString(request, "asOrganization");
  return {
    shortCode,
    clickedAt: now.toISOString(),
    ip: clientIp(request),
    userAgent,
    ...(country === undefined ? {} : { country }),
    device: classifyDevice(userAgent),
    ...(asn === undefined ? {} : { asn }),
  };
}

/** POST a batch to the worker's `/internal/clicks`; rejects on a non-2xx answer. */
export async function postClicks(target: ClickTarget, clicks: readonly ClickRecord[]) {
  if (clicks.length === 0) return;
  const res = await fetch(`${target.workerUrl}/internal/clicks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": target.secret },
    body: JSON.stringify({ clicks }),
  });
  if (!res.ok) throw new Error(`click ingest answered ${res.status}`);
}

/**
 * Cloudflare Queue consumer: forward a batch of click records to the worker in one request.
 * The whole batch is acked on success and retried on failure (the ingest insert is
 * idempotent enough: a retried click is a duplicate row, not a lost one).
 */
export async function forwardClickBatch(
  batch: MessageBatch<ClickRecord>,
  target: ClickTarget,
): Promise<void> {
  try {
    await postClicks(
      target,
      batch.messages.map((m) => m.body),
    );
    batch.ackAll();
  } catch (err) {
    console.error("click batch forward failed", err instanceof Error ? err.message : err);
    batch.retryAll();
  }
}
