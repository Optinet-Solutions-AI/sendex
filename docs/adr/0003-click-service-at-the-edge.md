# ADR 0003: Short links and click capture run on Cloudflare Workers

Date: 2026-11-06. Status: accepted.

## Context

Every SMS carries a short link on a throwaway domain (`.click`, `.sbs`). Clicks arrive in bursts right after a send, from phones across Europe, and the link domains are the most exposed public surface of the platform. The redirect must be fast, must record the click before redirecting, and must survive abuse.

## Decision

`apps/links` is a Hono application on Cloudflare Workers. Short codes resolve through KV; each click is recorded (time, IP, country, user agent, device class, operator) and pushed through a Cloudflare Queue to the worker, which batches it into Postgres. Cloudflare's WAF, bot protection and rate limiting sit in front. Domains are registered and rotated in Cloudflare DNS.

## Consequences

- Redirect latency stays under 50 ms at the edge, independent of the worker's load.
- Clicks are counted even if the worker is briefly down; the queue buffers them.
- The web app and worker never serve public link traffic.
