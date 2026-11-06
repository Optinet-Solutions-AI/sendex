import type { RedisLike } from "./redis-like.js";

/** Who stopped sending for an organisation, and why. Stored as JSON with no TTL. */
export interface EmergencyStop {
  reason: string;
  byUserId: string;
  /** ISO-8601 timestamp. */
  stoppedAt: string;
}

export interface SetEmergencyStopInput {
  reason: string;
  byUserId: string;
  /** Defaults to now. */
  stoppedAt?: string;
}

export function emergencyStopKey(organisationId: string): string {
  return `sendex:stop:${organisationId}`;
}

export async function setEmergencyStop(
  redis: RedisLike,
  organisationId: string,
  input: SetEmergencyStopInput,
): Promise<EmergencyStop> {
  const stop: EmergencyStop = {
    reason: input.reason,
    byUserId: input.byUserId,
    stoppedAt: input.stoppedAt ?? new Date().toISOString(),
  };
  await redis.set(emergencyStopKey(organisationId), JSON.stringify(stop));
  return stop;
}

/** Resolves `true` when a flag was set and is now cleared. */
export async function clearEmergencyStop(
  redis: RedisLike,
  organisationId: string,
): Promise<boolean> {
  return (await redis.del(emergencyStopKey(organisationId))) > 0;
}

/** Any value under the key counts as stopped, even one this module did not write (fail safe). */
export async function isEmergencyStopped(
  redis: RedisLike,
  organisationId: string,
): Promise<boolean> {
  return (await redis.get(emergencyStopKey(organisationId))) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStop(raw: string): EmergencyStop {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (
    isRecord(parsed) &&
    typeof parsed.reason === "string" &&
    typeof parsed.byUserId === "string" &&
    typeof parsed.stoppedAt === "string"
  ) {
    return { reason: parsed.reason, byUserId: parsed.byUserId, stoppedAt: parsed.stoppedAt };
  }
  return {
    reason: `unknown (unparseable flag: ${raw})`,
    byUserId: "unknown",
    stoppedAt: "unknown",
  };
}

/** The stop record, or `null` when the organisation is not stopped. */
export async function getEmergencyStop(
  redis: RedisLike,
  organisationId: string,
): Promise<EmergencyStop | null> {
  const raw = await redis.get(emergencyStopKey(organisationId));
  return raw === null ? null : parseStop(raw);
}

export interface StopFlagCacheOptions {
  /** How long a read is trusted before Redis is asked again. Default 2 000 ms. */
  ttlMs?: number;
  /** Clock in ms; defaults to `Date.now`. Injected by tests. */
  now?: () => number;
}

export interface StopFlagCache {
  readonly ttlMs: number;
  /** Cached `isEmergencyStopped`; at most one Redis read per organisation per `ttlMs`. */
  isStopped(organisationId: string): Promise<boolean>;
  /** Forget one organisation's cached answer, or all of them. */
  invalidate(organisationId?: string): void;
}

export const DEFAULT_STOP_FLAG_CACHE_TTL_MS = 2_000;

/**
 * For hot paths such as the send loop, which checks the flag for every batch. A raised flag is
 * seen within `ttlMs`. Redis errors propagate and nothing is cached for that read.
 */
export function createStopFlagCache(
  redis: RedisLike,
  options: StopFlagCacheOptions = {},
): StopFlagCache {
  const ttlMs = options.ttlMs ?? DEFAULT_STOP_FLAG_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, { stopped: boolean; freshUntil: number }>();

  return {
    ttlMs,
    async isStopped(organisationId) {
      const cached = entries.get(organisationId);
      if (cached && cached.freshUntil > now()) return cached.stopped;
      const stopped = await isEmergencyStopped(redis, organisationId);
      entries.set(organisationId, { stopped, freshUntil: now() + ttlMs });
      return stopped;
    },
    invalidate(organisationId) {
      if (organisationId === undefined) entries.clear();
      else entries.delete(organisationId);
    },
  };
}
