# ADR 0010: A simple postback URL with a token in the path, next to the signed one

Date: 2026-11-12. Status: accepted.

## Context

Conversions (sign-ups and first deposits) reach Sendex through a postback the brand's tracker calls. Until now the call had to carry `sig`, an HMAC-SHA256 the tracker computes per call over its parameters (ADR 0004). Affiliate platforms and most trackers cannot compute anything: they call a fixed address with macros filled in. SMS Edge's own conversion postback is such an address, `http://edgepxl.com/postback.php?type=lead&key={{{dynamic}}}` (SMS Edge help, "Integrating a conversion pixel"), and the team answered on 2026-11-12 that their postbacks are set up that way by Alex. With only the signed URL, a tracker that cannot sign would never deliver a lead or a sale.

## Decision

- **A second endpoint, `GET|POST /postback/:orgKey/:token`,** takes the same parameters without `sig`. The token in the path authenticates the caller.
- **The token is derived, not stored:** the hex HMAC-SHA256 of the constant `sendex:postback-token:v1` under the organisation's postback secret (`derivePostbackToken` in `packages/core`). No migration; rotating the secret in Settings changes the token and stops the old address at once; the token does not reveal the secret, so holding the simple URL does not let anyone forge the signed one. It is verified in constant time (`crypto.subtle.verify`).
- **`key` is accepted as another name for `dynamic_id`** on both endpoints, so a postback configured for SMS Edge only needs its address changed. `dynamic_id` wins when both are sent; the parameters are stored as sent.
- **Everything after the check is shared** with the signed endpoint: the per-organisation rate limit, validation, the event key (so the same conversion through either URL counts once), the queue. A wrong token answers 401 and is counted in the log like a wrong signature.
- **The signed URL stays** for trackers that can sign, and Settings › Postbacks shows both.

## Consequences

- A token in a URL is weaker than a per-call signature: anyone who sees the full address (a tracker's settings page, a proxy log, a screenshot) can report conversions until the secret is rotated, and the parameters are not tamper-proof. What limits the damage: the token is 256 bits, the dynamic id of a message is an unguessable value that must match a real message to be attributed, duplicates are ignored, calls are rate limited per organisation, and an owner can rotate.
- The simple URL is what SMS Edge and other platforms offer, so setup with affiliate networks needs no developer on the brand's side.
- If a brand ever needs stronger guarantees it uses the signed URL; nothing ties an organisation to one of the two.
