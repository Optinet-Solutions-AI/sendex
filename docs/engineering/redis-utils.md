# Redis utilities

`packages/redis-utils` (`@sendex/redis-utils`) holds the small Redis-backed primitives that
more than one service needs: a leader lock, a sliding-window rate limiter with a Hono
middleware, and the per-organisation emergency stop flag. It depends only on `ioredis` and
`hono`, takes the client as an argument (never creates one) and ships a fake Redis for unit
tests. Every utility is typed against `RedisLike`, the five-command slice of ioredis it uses,
so a `Redis`, a `Cluster` or the fake all fit.

Cards: D2-16 (leader lock), D2-19 (rate limiting), D2-10 (emergency stop).

```ts
import { Redis } from "ioredis";
import { createLeaderLock, createRateLimiter, createStopFlagCache } from "@sendex/redis-utils";

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
```

## Keys

| Key | Type | TTL | Written by |
| --- | --- | --- | --- |
| `sendex:leader:<name>` (caller chooses) | string = holder id | `ttlMs` (default 15 s), renewed | `createLeaderLock` |
| `<prefix>:<preset>:<identity>` e.g. `sendex:rl:login:203.0.113.9` | sorted set of request timestamps | `windowMs`, refreshed on every hit | `createRateLimiter` |
| `sendex:stop:<organisationId>` | string = JSON `{ reason, byUserId, stoppedAt }` | none | `setEmergencyStop` |

Nothing else in Sendex may write these keys by hand. BullMQ keys (`bull:*`) live beside them
in the same Redis.

## Scripts

All three scripts are in `src/scripts.ts` and run with `EVAL`, so each decision is atomic on
the server. The fake Redis recognises them by text and runs the same logic in JS, which is why
the scripts live in one place.

| Script | Keys / args | Effect |
| --- | --- | --- |
| `LEADER_RENEW_SCRIPT` | `key`, `holderId`, `ttlMs` | `PEXPIRE` only when `GET key == holderId`; returns 1 or 0 |
| `LEADER_RELEASE_SCRIPT` | `key`, `holderId` | `DEL` only when `GET key == holderId`; returns 1 or 0 |
| `RATE_LIMIT_SCRIPT` | `key`, `now`, `windowMs`, `max`, `member` | `ZREMRANGEBYSCORE` entries older than the window, `ZCARD`, `ZADD now member` only when under `max`, `PEXPIRE windowMs`; returns `{ allowed, count, resetMs }` |

A denied request does not consume budget: a client hammering a full window gets back in as
soon as the oldest allowed request ages out, rather than being locked out for as long as it
keeps retrying.

## Leader lock (D2-16)

```ts
const lock = createLeaderLock(redis, {
  key: "sendex:leader:smpp:23telecom",
  holderId: `${os.hostname()}:${process.pid}`,
  ttlMs: 15_000, // default
  renewEveryMs: 5_000, // default
});

lock.onLost((event) => log.warn({ event }, "lost SMPP leadership"));
if (await lock.acquire()) {
  // bind, keep the session while lock.isLeader()
}
await lock.release(); // on shutdown
```

- `acquire()` is `SET key holderId NX PX ttlMs`. `true` starts an unref'd renewal timer;
  `false` means someone else holds it, try again later (there is no built-in retry loop so the
  caller controls the cadence, typically every `renewEveryMs`).
- Renewal runs `LEADER_RENEW_SCRIPT` every `renewEveryMs`. If it returns 0 (key expired or
  taken) or Redis throws, the lock marks itself lost, stops the timer and calls every `onLost`
  listener once with `{ key, holderId, cause: "expired" | "error", error? }`.
- `release()` stops the timer and runs `LEADER_RELEASE_SCRIPT`, so a stale holder can never
  delete the new holder's key. Safe to call when not the leader.
- Keep `renewEveryMs` well under `ttlMs` (default 1:3). A GC pause or Redis hiccup longer than
  `ttlMs - renewEveryMs` loses the lock.

### How the worker will use it (SMPP binds)

23Telecom allows a fixed number of binds per account. With several Fly.io machines, only one
may hold the SMPP session for a route. The SMPP provider adapter (D2-06) will:

1. Create one lock per route, key `sendex:leader:smpp:<routeId>`, holder id = machine id.
2. Loop `acquire()` every 5 s until it wins, then bind and start pulling from the `send` queue
   for that route.
3. On `onLost`, unbind immediately and go back to step 2. Messages already handed to the
   carrier are reconciled by delivery receipts; nothing is re-sent because the send ledger entry
   (idempotency key) already exists.
4. On `SIGTERM`, `release()` before closing the bind so the next machine takes over within one
   renew interval instead of one TTL.

## Rate limiter (D2-19)

```ts
const limiter = createRateLimiter(redis, { prefix: "sendex:rl" });
const result = await limiter.limit({ key: "send:org_123", ...RATE_LIMITS.send });
// { allowed, remaining, resetMs, limit }
limiter.headers(result); // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset[, Retry-After]
```

`resetMs` is the time until the oldest counted request leaves the window, i.e. until one slot
frees. Headers express it in whole seconds (rounded up); `Retry-After` is only present when
denied and is at least 1.

### Presets (`RATE_LIMITS`)

| Name | Limit | Window | Key on |
| --- | --- | --- | --- |
| `login` | 10 | 1 min | client IP |
| `upload` | 20 | 1 hour | organisation |
| `send` | 60 | 1 min | organisation |
| `publicApi` | 600 | 1 min | API token |
| `postback` | 1 000 | 1 min | organisation |

The `scope` field documents what to key on; the caller still supplies the identity. Keys are
namespaced by preset name (`login:<ip>`, `send:<org>`), so one limiter instance serves all
presets.

### Hono middleware (worker public API and postbacks)

```ts
import { rateLimit } from "@sendex/redis-utils";

app.use("/v1/*", rateLimit(limiter, { preset: "publicApi", keyFrom: (c) => c.get("tokenId") }));
app.use("/postback/:org", rateLimit(limiter, { preset: "postback", keyFrom: (c) => c.req.param("org") }));
```

The middleware sets the `RateLimit-*` headers on every response and answers
`429 { "error": "rate_limited", "retryAfterMs": <resetMs> }` with `Retry-After` when denied,
without running the handler. `preset` accepts a name or a `RateLimitPreset` object for one-off
limits. It takes anything with `limit()` (`RateLimiterLike`), so tests pass a fake.

### How the web app uses it (server actions)

The web app does not run Hono; server actions call `limit()` directly and throw a typed error
the form maps to a message:

```ts
"use server";
const result = await limiter.limit({ key: `upload:${organisationId}`, ...RATE_LIMITS.upload });
if (!result.allowed) {
  return { error: "rate_limited", retryAfterMs: result.resetMs };
}
```

`login` keys on the IP from `headers().get("x-forwarded-for")` (first entry; Vercel sets it)
and runs before the credential check so a failed password still counts. `upload` and `send`
key on the organisation id from the session. Only the worker uses the Hono middleware.

## Emergency stop flag (D2-10)

```ts
await setEmergencyStop(redis, organisationId, { reason: "carrier complaint", byUserId });
await isEmergencyStopped(redis, organisationId); // true
await getEmergencyStop(redis, organisationId); // { reason, byUserId, stoppedAt }
await clearEmergencyStop(redis, organisationId); // true when a flag was cleared
```

- The key is `sendex:stop:<organisationId>` with no TTL: a stop stays until an operator clears
  it, including across worker restarts.
- Any value under the key counts as stopped, even one that is not the expected JSON
  (`getEmergencyStop` then returns a record with `reason: "unknown (unparseable flag: ...)"`).
  Fail safe over fail open.
- Setting and clearing are admin actions in the web app (the stop button on the campaign
  monitor and the organisation page). Audit who did it from `byUserId` and `stoppedAt`.

### How the send loop uses it

`createStopFlagCache(redis, { ttlMs: 2000 })` keeps one Redis read per organisation per two
seconds, which is what the send handler (D2-04) checks before every batch:

```ts
const stopFlags = createStopFlagCache(redis, { ttlMs: 2_000 });

async function sendLap(job: SendLapJob) {
  for (const batch of batches) {
    if (await stopFlags.isStopped(job.organisationId)) {
      return pauseLap(job, "emergency_stop");
    }
    await provider.send(batch);
  }
}
```

A stop therefore takes effect within two seconds plus one batch. The cache does not swallow
Redis errors: if Redis is unreachable the handler fails and BullMQ retries, which is the right
outcome because the queue itself is on the same Redis. Call `invalidate(organisationId)` after
`setEmergencyStop` in the same process to skip the wait.

## Testing

```
pnpm --filter @sendex/redis-utils test                                   # unit (fake Redis)
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @sendex/redis-utils test  # plus integration
```

Unit tests use `createFakeRedis({ now })` from the package: it implements `SET` (with
`PX ... NX`), `GET`, `DEL` and `EVAL` of the three scripts, with expiry driven by the injected
clock and a `calls` log for asserting what was sent. The `*.integration.test.ts` suites run
against a real server when `REDIS_URL` is set and reachable and skip otherwise, like
`apps/worker/src/queues.integration.test.ts`. They use unique key prefixes so they can share a
server with other runs.
