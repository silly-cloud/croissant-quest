# 0009 Coach abuse limits, device creation limit, same-origin writes
Status: accepted. Amends 0004 and 0006 (identity) and 0005 (coach limits). Fixes audit D-api-1, H-1, H-2, H-3, K-7, K-8.

Problem: a device cookie was free (any cookieless `GET /v1/progress` minted a User), the coach accepted anonymous callers, and the
per-device limit was keyed on that cookie. One IP minting 14 cookies spent the whole global budget and locked everyone out; any web page
could make its visitors spend it with a cross-site `text/plain` POST (no preflight).

Decisions:
- Coach routes require an established device (a `cq_device` cookie that maps to a User). No cookie or an unknown one: `401 {error:"no_device"}`.
  A cookie that is not a 43-char base64url token (e.g. `%00`) counts as none, never a 500.
- Coach quotas, all checked on every call, so minting cookies resets none of the IP or global ones. A call is counted only if every quota allows it
  (a refusal spends nothing). Refused: `429` + `Retry-After`.

  | Quota | Default | Env |
  | --- | --- | --- |
  | per device per minute | 10 | `coach.config.ts` `rateLimit` |
  | per device per day | 50 | `COACH_DEVICE_PER_DAY` |
  | per client IP per minute | 20 | `COACH_IP_PER_MIN` |
  | all clients per minute | 120 | `COACH_GLOBAL_PER_MIN` |
  | all clients per day | 500 | `COACH_GLOBAL_PER_DAY` |
- Device creation on `GET /v1/progress` is limited per client IP: `DEVICE_CREATE_PER_IP_PER_HOUR` (default 20). Beyond it: `429` + `Retry-After`,
  no User row, no cookie. Existing devices are unaffected.
- State-changing routes (`PUT /v1/progress`, `POST /v1/coach/*`): if `Origin` is present it must equal `WEB_ORIGIN`; if absent, a present `Referer`
  must have `WEB_ORIGIN` as its origin; else `403 {error:"bad_origin"}`. Requests with neither header are allowed: browsers always send `Origin`
  on PUT/POST `fetch` (and on any cross-site POST), so only non-browser clients (server-to-server, tests) omit both, and those are bound by the quotas anyway.
- The same routes require `Content-Type: application/json`, else `415`. A cross-site page then needs a CORS preflight, which only `WEB_ORIGIN` passes.
- Cookie flags unchanged: httpOnly, SameSite=Lax, Secure per `COOKIE_SECURE`.
- The rate limiter refuses new keys at its size cap (10 000 keys per limiter) instead of evicting old ones, so flooding keys cannot unblock a key.
  Cost: under a flood of more than 10 000 distinct keys in one window, new clients are refused until windows expire.

Web client consequences: send `Content-Type: application/json` on every PUT/POST; `GET /v1/progress` (and wait for it) before any coach call;
treat coach `401`/`429` like a fallback (play a local round).

Still per process: every limiter is an in-memory `Map` in one API process. Several instances multiply every quota by the instance count, and a
restart resets them. A multi-instance deploy needs a shared store (e.g. Redis or a Postgres counter table) before it relies on these numbers.
IP quotas see the real client only with a correct `TRUST_PROXY_HOPS` and an API port that is not reachable around the proxy.

The hosted demo runs with no `ANTHROPIC_API_KEY`: every coach call answers `{fallback:true, reason:"no_key"}` with no upstream call. These limits are
what makes setting a key on an internet-reachable deploy defensible; the daily global budget is the hard ceiling on spend per process.
