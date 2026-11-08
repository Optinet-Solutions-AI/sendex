# Track conversions

A click tells you someone opened your link. A conversion tells you they registered or paid. Sendex counts registrations as **leads** and deposits as **sales**, shows them on each campaign (leads, sales, CPL, CPS, per route, per sender id, per ad text) and lists every event in **Reports → Postback Logs**.

Conversions come back from the brand (or its tracker, such as Affise, Voluum or Scaleo) through a **postback**: an HTTP call to Sendex each time a contact converts. You set it up once per brand.

## 1. Put the dynamic id in your link

Every tracked link can carry `{{dynamic}}`, a unique id per message. Add it to the link's URL as whatever parameter the brand's tracker uses for a click id or sub id:

```
https://trk.brand.example/click?o=75&a=35&sub_id1={{dynamic}}
```

When a contact clicks, Sendex fills in the id and the brand stores it with the click. When that contact converts, the brand sends the same id back; that is how the conversion finds its message, campaign, lap, sender id and ad text.

## 2. Give the brand the postback URL and the secret

Open **Settings → Postbacks**. It shows your organisation's URL and secret:

```
https://<worker>/postback/<your-organisation>?type=lead&dynamic_id={{dynamic}}&sig=<signature>
https://<worker>/postback/<your-organisation>?type=sale&dynamic_id={{dynamic}}&value={{amount}}&sig=<signature>
```

Paste the URL into the brand's postback / conversion pixel settings, replacing `{{dynamic}}` with the tracker's macro for the id you passed in step 1 (for example `{sub_id1}` or `{clickid}`) and `{{amount}}` with its payout or deposit macro.

Parameters:

| Parameter    | Required | Meaning                                                                                          |
| ------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `type`       | yes      | `lead` (also `registration`) or `sale` (also `deposit`, `ftd`)                                   |
| `dynamic_id` | yes      | the `{{dynamic}}` value from the link                                                             |
| `value`      | no       | amount in EUR, e.g. `12.50`; shown as revenue and used for sales                                  |
| `event_key`  | no       | the tracker's own event id, when one contact can convert several times of the same type           |
| `sig`        | yes      | the signature (below)                                                                            |

Anything else the brand adds (sub ids, offer ids) is kept and shown in the log.

`GET` and `POST` both work; a `POST` may carry the parameters as a JSON object or a form body.

## 3. The signature

The call must be signed so nobody can count conversions you did not earn. The brand computes it per call:

1. Take every parameter except `sig`, sort them by name and join them as `name=value` with `&`, percent-encoding names and values (`encodeURIComponent`).
2. HMAC-SHA256 that string with the secret from Settings → Postbacks, hex-encoded in lower case.
3. Send it as `sig`.

Example for `type=lead` and `dynamic_id=7b1c3e2a-5d4f-4c6b-8a9e-0f1d2c3b4a59`:

```
string to sign: dynamic_id=7b1c3e2a-5d4f-4c6b-8a9e-0f1d2c3b4a59&type=lead
sig:            HMAC_SHA256(secret, string to sign) as hex
```

Settings → Postbacks shows a worked example with your real secret. Most trackers let you add a signed parameter with a small script; otherwise the brand's developer does it in a line of code in any language.

Sendex answers:

| Status | Body                                | Meaning                                                   |
| ------ | ----------------------------------- | --------------------------------------------------------- |
| 202    | `{ "accepted": true, "eventKey" }`  | stored; it appears in the log within seconds              |
| 200    | `{ "duplicate": true, "eventKey" }` | already received; nothing counted twice                   |
| 400    | `{ "error" }`                       | a parameter is missing or wrong                           |
| 401    | `{ "error": "invalid signature" }`  | wrong or missing `sig`                                    |
| 404    |                                     | unknown organisation in the URL                           |
| 429    |                                     | too many calls; retry later                               |

## Duplicates

A conversion is identified by your organisation, its type, the dynamic id and, when sent, `event_key`. If the brand's tracker retries a postback (they do, on timeouts) the second call is answered `duplicate` and nothing is counted again. A brand that sends distinct `event_key` values can report more than one deposit for the same message. Sendex stores and lists every one, but **Sales counts first deposits only** (as SMS Edge's "Sales (FTD)"): the first sale on a message is the sale, later ones (repeat deposits) add their value to revenue but not to Sales, CPS or the sale rate.

## Rotating the secret

An owner can press **Rotate secret** in Settings → Postbacks (it asks for a recent sign-in and is written to the audit log). Calls signed with the old secret are rejected immediately, so give the brand the new secret first and rotate at a quiet moment.

## Reading the results

- **Reports → Postback Logs**: every event with its key, type, campaign, parameters and time. Filter by type and period (today, 7, 30, 90 days or custom dates), search by event key or dynamic id, and **Export CSV**.
- **Campaign → Analytics**: leads, sales, lead rate, sale rate, CPL and CPS for the campaign, and the same per sender id and per ad text, so you can see which name and which text convert, not just which get clicks.
- **Campaign → Status → Laps**: leads, sales, CPL and CPS per lap (per route).

An event whose dynamic id matches no message (a typo in the macro, a test fired by the brand) is kept in the log as **unattributed** and counts nowhere; check the macro in step 1 if you see many.
