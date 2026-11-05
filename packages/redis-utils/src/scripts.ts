/**
 * Lua scripts shared by the utilities and by the fake Redis used in unit tests. Each runs
 * atomically on the server, which is what makes the compare-and-extend / compare-and-delete
 * and the sliding window safe under concurrency.
 */

/**
 * Extend the lock only when it is still held by this holder.
 * KEYS[1] = lock key, ARGV[1] = holder id, ARGV[2] = ttl in ms. Returns 1 when extended, 0 otherwise.
 */
export const LEADER_RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`.trim();

/**
 * Delete the lock only when it is still held by this holder.
 * KEYS[1] = lock key, ARGV[1] = holder id. Returns 1 when deleted, 0 otherwise.
 */
export const LEADER_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`.trim();

/**
 * Sliding-window counter over a sorted set of request timestamps.
 * KEYS[1] = window key, ARGV[1] = now (ms), ARGV[2] = window (ms), ARGV[3] = max, ARGV[4] = member.
 * Drops entries older than the window, adds the request only when under the limit (a denied
 * request does not consume budget), refreshes the key TTL and returns
 * `{ allowed (0|1), count in window, ms until the oldest entry leaves the window }`.
 */
export const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
local allowed = 0
if count < max then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end
redis.call('PEXPIRE', key, window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = window
if oldest[2] then
  reset = tonumber(oldest[2]) + window - now
end
return {allowed, count, reset}
`.trim();
