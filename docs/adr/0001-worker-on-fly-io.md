# ADR 0001: The send worker runs on Fly.io, not on Vercel

Date: 2026-11-06. Status: accepted.

## Context

Sending SMS through 23Telecom uses SMPP, a long-lived TCP session with binds, windows and delivery receipts. Carriers whitelist the IP address that binds to them. Vercel functions cannot hold a socket open or present a fixed outbound IP. The team deploys the dashboard to Vercel already and has no operations staff.

## Decision

The worker (`apps/worker`) is a Node service in a Docker image on Fly.io, region Frankfurt, with a dedicated IPv4. It owns every carrier connection, the BullMQ send loop, scheduling, the public API and postback intake. The web app on Vercel never talks to a carrier; it enqueues work and reads results.

## Alternatives

- Railway: equally simple, but a static outbound IP needs the Pro plan.
- Hetzner VPS: cheapest and fully in our control, but someone has to patch and back it up; revisit when the worker runs several providers.
- AWS ECS or Lightsail: capable, but days of VPC, IAM and load balancer setup for one developer.

## Consequences

- One machine holds each provider bind, elected through a Redis leader lock; a second machine serves API traffic and takes over if the first dies.
- Fly secrets hold carrier credentials; the repo never does.
- A second region is a configuration change in `fly.toml`.
