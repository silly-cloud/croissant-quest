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
| `DATABASE_URL` | yes | - | Postgres connection string |
| `ANTHROPIC_API_KEY` | no | - | Only read here, never logged or returned. Without it the coach answers `{fallback:true, reason:"no_key"}` and makes no network call |
| `PORT` | no | `3001` | |
| `WEB_ORIGIN` | no | `http://localhost:3000` | The only CORS origin (credentials enabled) |

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

Identity (ADR 0004): `progress` and `coach` routes use `DeviceGuard`; the first request without a `cq_device` cookie creates a user and sets
an httpOnly, SameSite=Lax cookie (Secure when `NODE_ENV=production`). A client should make one request (e.g. GET progress) before firing parallel ones,
otherwise each cookie-less request creates its own user.

Saves (ADR 0002): the PUT merges the stored state with the body (`mergeStates`: counters take the larger value; wrong/log/feel/calib follow the newer `ts`),
caps `log` at 120 and `feelLog` at 20, and bumps `version` with a conditional `UPDATE ... WHERE version = n` inside a transaction. Of two writers with the same
`If-Match`, exactly one wins; the other gets 409 and the server copy to merge and retry.

Coach (ADR 0005): one overall deadline of 30 s per call (retries included), up to 2 retries with exponential backoff on network/429/5xx, 10 calls per minute per device
(`429` + `Retry-After`; in memory, so per API process). Every generated question is validated (shared `Question` schema, `___`, answer in options, known tag,
not a bank copy, no duplicates, no markup); fewer than 4 valid -> `{fallback:true, reason:"invalid"}`.

Errors: validation failures are `400 {statusCode, error, message, issues}`; unexpected errors are `500 {statusCode, error, message}` with no stack trace.

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
