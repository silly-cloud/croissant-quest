# Lane 2 review: apps/api + shared state/contract (read-only agent, @ f133384)

Verdict from the reviewer: not safe for a public host as it was. Progress compare-and-swap, cookie/CORS basics, no raw SQL and 5xx redaction were checked and found sound.
Disposition (fix agent a4254acf, branch to be merged after I re-run all gates):

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Must | coach rate limit bypassed by dropping the cookie (a new User per request, limiter keyed on it) | fix: coach never creates users, IP key + global ceiling, explicit trust-proxy hops |
| 2 | Must | `crowns`/`seen` keys unbounded, save row grows without limit | fix: key allow-lists and caps in `normState` |
| 3 | Must | streak can never reset (max-merge; same bug as legacy) | fix: take `streak` + `last` together from the later `last`; ADR 0006 |
| 4 | Should | client-chosen `ts` can freeze last-writer fields | fix: clamp to now+5 min |
| 5 | Should | newer-ts copy replaces `wrong`/`log`/... wholesale | partly: `log` becomes a union; `wrong`/feel/calib stay newer-wins on purpose (a union would resurrect cleared mistakes); ADR 0006 |
| 6 | Should | parallel cookieless calls create orphan users | fix: users only created by `GET /v1/progress`; `PUT` without a device => 401 |
| 7, 8, 12, 19 | Should/Nice | trailing-slash `WEB_ORIGIN`, `Secure` cookie from NODE_ENV only, `Retry-After` not exposed, CORS after body parser | fix |
| 9, 10 | Should | coach validation misses non-choice bank copies and accepts wrong answers for a tag, double blanks, case-duplicate options | fix |
| 11 | Should | `gave` interpolated raw into the explain prompt; output not gated | fix |
| 13 | Should | wrong answers to coach questions are dropped on save | skip by design (retry queue is bank-only), documented |
| 14, 15, 16, 21 | Should/Nice | NaN from inherited key names, counters unbounded, limiter sweep O(n), surrogate-splitting truncation | fix |
| 17, 18, 20, 22 | Nice | hash the device token, refresh the cookie, 2 vs 3 queries per PUT, honour upstream retry-after | follow-up tickets |
| 23-25 | Should | tests that cannot fail (key leak, markup in other fields, CAS) | fix: tests that bite |

Not checked by the reviewer: web rendering (decides how bad #11 is), real-Postgres concurrency, secrets in pg error logs, reverse-proxy behaviour, dependency CVEs.
