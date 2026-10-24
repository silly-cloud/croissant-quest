# @cq/api

NestJS 12 + Prisma 7 + Postgres 16. Persists progress (versioned saves), serves the question bank and runs the coach.
All routes are under `/v1`. Request/response shapes come from `@cq/shared` (`contract.ts`).

## Run

```sh
cp .env.example .env          # edit DATABASE_URL if needed
pnpm install                  # from the repo root
pnpm --filter @cq/api generate        # prisma client -> src/generated (gitignored)
pnpm --filter @cq/api db:migrate      # prisma migrate deploy
pnpm --filter @cq/api dev             # http://localhost:3001/v1/health
pnpm --filter @cq/api build && pnpm --filter @cq/api start
```

## Environment

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | - | Postgres connection string. Also required by `prisma migrate`/`db:seed` (no fallback database; only `prisma generate` runs without it) |
| `ANTHROPIC_API_KEY` | no | - | Only read here, never logged or returned. Without it the coach answers `{fallback:true, reason:"no_key"}` and makes no network call |
| `PORT` | no | `3001` | |
| `WEB_ORIGIN` | no | `http://localhost:3000` | Must be http(s). The only CORS origin (credentials enabled) and the only accepted `Origin`/`Referer` on PUT/POST. Reduced to its origin, so a path or trailing slash is harmless |
| `COOKIE_SECURE` | no | `true` when `NODE_ENV=production`, else `false` | `true`/`false`; sets the `Secure` flag on the device cookie |
| `TRUST_PROXY_HOPS` | no | `0` | Number of reverse proxies whose `X-Forwarded-For` is trusted (`trust proxy` is set only when > 0, never to `true`). Behind one proxy use `1`; with `0` behind a proxy every client shares the proxy's IP |
| `COACH_GLOBAL_PER_MIN` | no | `120` | Ceiling on coach calls per minute across all clients |
| `COACH_GLOBAL_PER_DAY` | no | `500` | Ceiling on coach calls per day across all clients (ADR 0009) |
| `COACH_DEVICE_PER_DAY` | no | `50` | Coach calls per device per day (on top of 10/min per device) |
| `COACH_IP_PER_MIN` | no | `20` | Coach calls per client IP per minute, whatever cookie is presented |
| `DEVICE_CREATE_PER_IP_PER_HOUR` | no | `20` | New devices (User rows) one client IP may create per hour via `GET /v1/progress`; beyond it `429` + `Retry-After` |

The model id is in one place: `src/modules/coach/coach.config.ts`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/health` | `{ok:true, db:boolean}`, always 200 |
| GET | `/v1/questions` | `{questions, tags, tagNames, topics, rules, pron}` with `ETag`; `If-None-Match` -> 304 |
| GET | `/v1/progress` | `{state, version}`; empty state and version 0 if nothing saved |
| PUT | `/v1/progress` | body `{state}`, header `If-Match: <version>` (428 if missing, 400 if not a number). Stale -> 409 `{state, version}` (server copy). Success -> merged `{state, version}` |
| POST | `/v1/coach/round` | `{n?, focus?}` -> `{fallback:false, questions}` or `{fallback:true, reason}` (`no_key`, `timeout`, `error`, `invalid`) |
| POST | `/v1/coach/explain` | `{qid, gave}` -> `{fallback:false, text}` or `{fallback:true, reason}` |

Identity (ADR 0004, amended by 0006): only `GET /v1/progress` (`DeviceGuard`) creates a user: no or unknown `cq_device` cookie gets a new user and an httpOnly,
SameSite=Lax cookie (Secure per `COOKIE_SECURE`). The client must `GET /v1/progress` first and wait for it before any `PUT`; `PUT /v1/progress` without a valid cookie is
`401 {"error":"no_device"}` and creates nothing; so are both coach routes (ADR 0009). `/v1/questions` and `/v1/health` never touch users. Device creation is limited per client IP
(`DEVICE_CREATE_PER_IP_PER_HOUR`). A `cq_device` value that is not a 43-char base64url token (e.g. `%00`) counts as no cookie.

State-changing routes (`PUT /v1/progress`, `POST /v1/coach/*`) also require (ADR 0009): `Content-Type: application/json` (else `415`), and, when an `Origin` header is
present, `Origin == WEB_ORIGIN`; without `Origin`, a present `Referer` must be from `WEB_ORIGIN` (else `403 {"error":"bad_origin"}`). Browsers always send `Origin` on PUT/POST
`fetch`, so only non-browser clients (server-to-server, tests) can omit both, and they are allowed.
Same-site requirement: the cookie is SameSite=Lax, so the browser sends it on `fetch` only when web and API share a site (e.g. `app.example.com` and `api.example.com`, or a
same-origin proxy). A cross-site deployment would need `SameSite=None; Secure`, which this API does not do.

Saves (ADR 0002): the PUT merges the stored state with the body (`mergeStates`, ADR 0006: counters take the larger value; `streak`+`last` come together from the later `last`; `log` is the union by `(at,q)`; wrong/feel/feelLog/calib follow the newer `ts`),
bounds the document (known topic/question keys only, <= 1000 keys, counters <= 1e9, `ts` <= server time + 5 min, `last` a real `YYYY-MM-DD` no later than server-today (UTC) + 1 day, else dropped with its `streak`;
strings well-formed with no U+0000), caps stored `log` at 120 (`feelLog` at 20), and bumps `version` with a conditional `UPDATE ... WHERE version = n` inside a transaction. Of two writers with the same
`If-Match`, exactly one wins; the other gets 409 and the server copy to merge and retry.

Coach (ADR 0005, 0009): one overall deadline of 25 s per call (retries included; the web gives up at 30 s, so the server fallback arrives first), up to 2 retries with exponential backoff on network/429/5xx.
Quotas, all checked on every call and none reset by a new cookie: 10/min and `COACH_DEVICE_PER_DAY` per device, `COACH_IP_PER_MIN` per client IP, `COACH_GLOBAL_PER_MIN` and `COACH_GLOBAL_PER_DAY` overall
(`429` + `Retry-After`; a refused call spends no quota; in memory, so per API process). Every generated question is validated (shared `Question` schema, `___`, answer in options, known tag,
not a copy of any bank sentence or answer, exactly one `___`, answer in the closed set du/de la/de l'/des/de/d'/le/la/les/l' and consistent with the tag, 2-6 distinct options, no duplicates, no markup); fewer than 4 valid -> `{fallback:true, reason:"invalid"}`.

The client's retry queue holds bank questions only (generated `_ai` questions are never re-queued): this is intended.

Errors: validation failures are `400 {statusCode, error, message, issues}`; malformed JSON or a bad gzip body is a plain `400` that never echoes the body; text Postgres refuses is `400`;
unexpected errors are `500 {statusCode, error, message}` with no stack trace. No `X-Powered-By`; `/v1/progress` has no ETag (the version is the body's `version`); every response has `Vary: Origin`.

## Tests

```sh
pnpm --filter @cq/api test        # unit, no database
pnpm --filter @cq/api test:e2e    # supertest against real Postgres
pnpm --filter @cq/api lint
pnpm --filter @cq/api typecheck
pnpm --filter @cq/api db:seed     # validates the bank (nothing is inserted)
```

`test:e2e` needs a running Postgres whose role may create databases. It derives its URL from `DATABASE_URL` (default
`postgresql://cq:cq@localhost:5432/cq_dev`), swaps the database name for `cq_test`, creates it if missing and runs `prisma migrate deploy` there.
The dev database is never touched.

## Rollback

Migration `prisma/migrations/*_init` creates `User` and `Progress`. To undo it on a database:

```sh
psql "$DATABASE_URL" -c 'DROP TABLE "Progress"; DROP TABLE "User";'
pnpm --filter @cq/api exec prisma migrate resolve --rolled-back <migration_folder_name>
```

Then redeploy the previous API image. Saved progress is lost with the tables; take a `pg_dump -t '"Progress"' -t '"User"'` first if it matters.
For a later migration that goes wrong, fix forward with a new migration, or restore the dump and mark the failed one with `migrate resolve --rolled-back`.
