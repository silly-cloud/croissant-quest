# Croissant Quest

A French A1 game for partitive articles (du / de la / de l' / des), with pronunciation in English phonetics, Gujarati and
Devanagari. pnpm monorepo, Node 22, MIT licensed.

| Folder | What it is |
|---|---|
| `apps/web` | **Frontend**: Next.js (App Router). Map, rounds, why-cards, results, settings. Calls the API only over HTTP (`/v1/*`, forwarded by Next). |
| `apps/api` | **Backend**: NestJS + Prisma + Postgres 16. Questions, progress (versioned saves), coach (Anthropic, optional), health. |
| `packages/shared` | Pure game rules and the HTTP contract (zod), used by both apps. |
| `packages/content` | The 246-question bank as validated JSON, rule text, pronunciation data. |
| `infra/` | `docker-compose.yml` (Postgres, API, web) and `.env.example`. |
| `tests-legacy/` | The original single-file game (v18) as a frozen fixture and its 69 tests; `scripts/parity-report.mjs` maps each to the port. |

## Run it in 5 minutes
Prerequisites: Node 22, `corepack enable` (pnpm 10), Postgres 16 (local or Docker).
```bash
pnpm install --frozen-lockfile
export DATABASE_URL=postgresql://cq:cq@localhost:5432/cq   # a database you own
pnpm --filter @cq/api db:migrate && pnpm --filter @cq/api db:seed
pnpm dev                                                    # api on :3001, web on :3000
```
Open http://localhost:3000. Without `ANTHROPIC_API_KEY` the coach falls back to local rounds; everything else works.

With Docker: `cp infra/.env.example infra/.env` (set `POSTGRES_PASSWORD`), then
`docker compose -f infra/docker-compose.yml --env-file infra/.env up --build`. Temporary public demos: `docs/DEMO-HOSTING.md`.

## Tests
```bash
pnpm lint && pnpm typecheck && pnpm test                    # unit tests, all packages
pnpm --filter @cq/api test:e2e                              # needs DATABASE_URL (creates its own cq_test)
pnpm --filter @cq/web test:e2e                              # Playwright + axe against a fake API
pnpm --filter @cq/web test:e2e:real                         # Playwright against the real API on Postgres
node tests-legacy/C-behave.js && node tests-legacy/fixes.js && node scripts/parity-report.mjs
```
CI (`.github/workflows/ci.yml`) runs all of the above.

## Docs
`AGENTS.md` (rules for contributors and agents), `docs/RUNBOOK.md` (state and release gate), `docs/adr/` (decisions),
`docs/GLOSSARY.md`, `docs/PARITY.md`, `docs/audit/` (latest audit and fix plan), `docs/GITHUB-SETTINGS.md`.

## License
MIT, see `LICENSE`.
