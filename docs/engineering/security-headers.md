# Security headers, CSP and CSRF

Every response from the dashboard carries a fixed set of security headers and a Content Security
Policy with a per-request nonce. They are set in the middleware (`apps/web/middleware.ts`) from
`securityHeaders()` in `apps/web/lib/security-headers.ts`, so the same code runs for all three
auth modes (`clerk`, `dev`, `unconfigured`; see `auth.md`) and on every route the middleware
matcher covers, including redirects and Clerk's own responses. `vercel.json` sets no headers of
its own any more, so there is one place to change them. ADR 0004 is the decision that puts this
in version one.

## The headers

| Header                      | Value                                              | What it prevents                                                                                      |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | see below                                          | Injected scripts (XSS), data exfiltration to other hosts, framing, form hijacking, base tag injection |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`     | Downgrade to plain HTTP; two years, subdomains, eligible for the browser preload list. Not in dev.    |
| `X-Content-Type-Options`    | `nosniff`                                          | Browsers guessing a content type and executing an upload as script                                    |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                  | Leaking full dashboard URLs (list names, search terms) to other sites                                 |
| `X-Frame-Options`           | `DENY`                                             | Clickjacking in browsers that predate `frame-ancestors`                                               |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`         | Any script, ours or injected, using those device APIs                                                 |
| `Cross-Origin-Opener-Policy`| `same-origin`                                      | Another origin keeping a handle on a dashboard window it opened (and Spectre-style cross-window reads) |

### Content Security Policy

The policy is built per request. In production with Clerk configured it is:

```
default-src 'self';
script-src 'self' 'nonce-<nonce>' 'strict-dynamic' https://*.clerk.accounts.dev https://clerk.com https://*.clerk.com https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://*.clerk.accounts.dev https://clerk.com https://*.clerk.com https://clerk-telemetry.com https://*.clerk-telemetry.com;
frame-src https://challenges.cloudflare.com;
worker-src 'self' blob:;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

- **Nonce and `'strict-dynamic'`.** Scripts run only when they carry this request's nonce or are
  loaded by a script that does. The host entries after `'strict-dynamic'` are ignored by current
  browsers (they are the fallback for CSP level 2 browsers), so an attacker who can inject markup
  still cannot run a script: they do not know the nonce. The nonce is 128 random bits from Web
  Crypto, generated in the middleware for every request.
- **How the nonce reaches the page.** The middleware forwards two request headers to the app:
  `x-nonce` and the policy itself as `content-security-policy`. Next's App Router takes the nonce
  for its own inline bootstrap scripts from the forwarded `content-security-policy` request
  header (not from `x-nonce`); Clerk's `<ClerkProvider>` reads `x-nonce` for the script tag that
  loads clerk-js. Any page that must render an inline `<script>` of its own reads it with
  `(await headers()).get("x-nonce")` and passes it as the `nonce` prop. Nothing in the app does
  that today.
- **Every page is rendered per request.** A nonce only works when the HTML is produced for the
  request that carries it, so the root layout (`apps/web/app/layout.tsx`) calls
  `await connection()` and nothing under it is prerendered at build time. Without that, `next
  build` prerenders the 404 page (`/_not-found`) as static HTML whose scripts have no nonce, and
  the production policy blocks all of them (observed before the call was added). The dashboard
  pages were already dynamic because they read the session on every request, so this costs
  nothing there; do not add `export const dynamic = "force-static"` or `generateStaticParams`
  to a page that renders scripts.
- **`style-src 'unsafe-inline'`.** Tailwind v4 and Next both emit inline `<style>` elements and
  Next does not nonce them, so inline styles are allowed. Styles cannot run code; the risk is
  cosmetic.
- **`img-src https:`.** Avatars come from Clerk's image CDN and campaign previews may embed
  customer images; any https image is allowed. `data:` is for inline SVG icons.
- **Clerk-only directives.** `frame-src` and `worker-src` exist only in `clerk` mode: Clerk's bot
  protection renders a Cloudflare Turnstile challenge in a frame, and clerk-js uses a blob
  worker. The telemetry hosts can go once `CLERK_TELEMETRY_DISABLED=1` is set in Vercel.
- **`dev` and `unconfigured` modes** load nothing from outside the app, so their `script-src`
  and `connect-src` are just `'self'` plus the nonce.

### What is relaxed in development, and why

`securityHeaders({ isDev: true })` is used when `NODE_ENV` is not `production`, which is what
`next dev` sets. It differs from production in exactly three places:

| Change                                   | Reason                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `script-src` gains `'unsafe-eval'`       | `next dev` evaluates hot updates and source maps with `eval`; without it every page is blank. |
| `connect-src` gains `ws:`                | Hot module reloading opens a websocket to the dev server.                                      |
| No `upgrade-insecure-requests`, no HSTS  | The dev server is plain `http://localhost`; HSTS would make the browser refuse it for a year. |

Nothing else needed relaxing: Next's own inline scripts carry the nonce in dev too, and the
Playwright smoke suite (`apps/web/e2e/smoke.spec.ts`, last test) asserts that the home page loads
with no CSP violations in the console. `next build` output runs under the strict production policy.

One known, harmless report in production: Zod 4 probes once per page load whether it may
JIT-compile parsers (`try { Function("") } catch { /* jitless */ }`), the policy refuses the
`eval`, Zod catches it and uses its ordinary parser. Pages that ship a Zod schema to the client
(lists, campaigns) therefore log one `script-src` violation each. To silence it call
`z.config({ jitless: true })` where `packages/core` sets up Zod; do not add `'unsafe-eval'`.

## Adding an allowed host

Say a new third-party script or API has to be loaded from `https://example.com`:

1. Add the host to the right directive in `contentSecurityPolicy()` in
   `apps/web/lib/security-headers.ts`: `script-src` for scripts, `connect-src` for `fetch`,
   websockets and XHR, `frame-src` for iframes, `img-src` or `font-src` for assets. Put it behind
   a condition if it only applies in one auth mode (the Clerk hosts are the example).
2. Update the expected directive list in `apps/web/lib/security-headers.test.ts`; the test is the
   record of what the policy allows and why.
3. Remember `'strict-dynamic'`: a script you load with a nonced `<Script nonce={nonce}>` tag is
   already trusted, as is anything that script loads. You only need a `script-src` host entry for
   the CSP2 fallback. Scripts added by other means (an inline `<script>` without a nonce) will be
   blocked whatever hosts are listed.
4. Add a line to the table above.

Do not add `'unsafe-inline'` to `script-src` or `https:` to `connect-src` to make something work;
that removes the protection. Nonce the script, or proxy the API through a route handler.

## Checking a deployment

After a deploy, run the preview or production URL through
[securityheaders.com](https://securityheaders.com) (it fetches the page and grades the response
headers). Expect an A or A+; every header in the table above should be listed as present. Also:

- `curl -sI https://<host>/` shows the raw headers. There should be exactly one
  `content-security-policy` and one `strict-transport-security` (Vercel adds the latter itself for
  `*.vercel.app` hosts; ours overrides it with the same value and `preload`).
- Open the dashboard with the browser console visible and click through lists and campaigns. A
  blocked resource shows as `Refused to load … because it violates the following Content
  Security Policy directive`; fix it by adding the host (above), not by loosening the directive.
- Submitting the production host to [hstspreload.org](https://hstspreload.org) is a one-way door:
  only do it once every subdomain of the apex serves HTTPS.

## CSRF

The dashboard changes state in two ways, and each is protected differently:

- **Server actions** (forms, the list upload, campaign creation, flushes). Next verifies that the
  `Origin` header of every action request matches the `Host` (or `X-Forwarded-Host` behind
  Vercel's proxy) and aborts the action otherwise, so a page on another site cannot submit a
  form to one of ours with the user's cookie. This is built into Next; nothing to add. If the app
  is ever served through a proxy that rewrites the host, list the public hosts in
  `experimental.serverActions.allowedOrigins` in `next.config.ts`.
- **Route handlers** (`route.ts` files) get no such check from Next. Any handler that accepts
  `POST`, `PUT`, `PATCH` or `DELETE` from the browser with a session cookie must call
  `assertSameOrigin(request)` from `apps/web/lib/csrf.ts` before `requireAction()`. It compares the
  `Origin` header (falling back to `Referer`) with `X-Forwarded-Host` / `Host` and throws
  `CsrfError` (status 403, code `cross_origin`) on a mismatch or when neither header is present;
  safe methods pass through. Answer it the same way as `AuthError`:

  ```ts
  try {
    assertSameOrigin(request);
    organisationId = (await requireAction("list.flush")).organisationId;
  } catch (error) {
    if (error instanceof CsrfError || error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  ```

  Today the only state-changing route handler is the Clerk webhook, which is called by Clerk's
  servers with a Svix signature and no cookie, so it must **not** use this check. The lists export
  (`app/(dashboard)/lists/export/route.ts`) is `GET` only and reads data, so it is not wired in
  either. The public API lives in the worker and authenticates with API keys, not cookies, so
  CSRF does not apply to it.

The policy's `form-action 'self'` is the third layer: even a form injected into a page can only
post back to the dashboard's own origin.
