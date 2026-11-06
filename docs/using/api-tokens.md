# API tokens

Your own systems (a CRM, a tracker, a script) can read your lists and campaigns, create campaigns and queue sends through the Sendex API. Access is by **API token**: a secret string your system sends with every call. You create and revoke tokens under **Settings → API tokens**; only owners can.

## Create a token

1. Open **Settings → API tokens**.
2. Give the token a name that says what uses it (`CRM sync`, `Reporting script`).
3. Tick the scopes it needs:
   - **read**: list and read lists, campaigns and their live status.
   - **write**: create draft campaigns.
   - **send**: queue a campaign's sends (the same as pressing Send in the dashboard).
   A token with only `read` can never send; give each system the least it needs.
4. Press **Create token**. The token (`sdx_…`) is shown **once**. Copy it into your system's secret store now; Sendex keeps only a hash and cannot show it again. If you lose it, revoke it and create a new one.

## Use it

Send the token in the `Authorization` header of every call:

```sh
curl https://api.sendex.example/api/v1/campaigns \
  -H "Authorization: Bearer sdx_…"
```

The interactive reference, with every endpoint and example bodies, is at `/api/docs` on the API host (the settings page links to it). The main calls are:

| Call | Scope | What it does |
| --- | --- | --- |
| `GET /api/v1/me` | any | The organisation and token behind the call |
| `GET /api/v1/lists`, `GET /api/v1/lists/{id}` | read | Your lists and their counts |
| `GET /api/v1/campaigns`, `GET /api/v1/campaigns/{id}` | read | Campaigns with laps and counters |
| `GET /api/v1/campaigns/{id}/status` | read | Live progress (sent and failed so far) and totals |
| `POST /api/v1/campaigns` | write | Create a draft campaign |
| `POST /api/v1/campaigns/{id}/send` | send | Queue the laps on the routes you name |

A campaign created through the API is a draft: attach its lists, sender ids, texts and links in the dashboard before sending, exactly as with one created there. Sends through the API follow the same rules as the Send button (test laps of the campaign's test size per list and route, or everything with `sendAll`) and appear in the audit log with the token's name.

## Limits

Each token may make **600 calls per minute**. Past that, calls answer `429` with a `Retry-After` header saying how many seconds to wait. The `RateLimit-Remaining` header on every answer tells you how much of the window is left.

## Revoke a token

Press **Revoke** next to the token and confirm. From that moment every call with it answers `401`. Revoke a token as soon as it may have leaked (a shared screen, a commit, a departed contractor) and create a fresh one for the system that needs it. Revoked tokens stay in the list so you can see when they were created, last used and revoked; creating and revoking are both in the audit log.
