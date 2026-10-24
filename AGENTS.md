# AGENTS.md

Croissant Quest: a French A1 partitive-articles game. pnpm monorepo, Node 22.

- `apps/web` Next.js UI. `apps/api` NestJS + Prisma + Postgres. `packages/shared` pure rules and the HTTP contract (zod). `packages/content` the question bank as validated JSON.
- `apps/web` and `apps/api` never import each other; they share only `packages/*`. Change the contract in `packages/shared/src/contract.ts` first.
- Rules live in `packages/shared`, not in components. Tests: `pnpm test` (unit), `pnpm --filter @cq/api test:e2e` (needs `DATABASE_URL`), `pnpm --filter @cq/web test:e2e`.
- `qid(q)` is the key of saved progress: never change its format or reword an existing bank question without a migration.
- Do not reintroduce wrong French rules: after `pas` only un/une/des/du/de la/de l' become `de` (le/la/les stay); `jouer du/de la` is not a partitive; a final `-re` does not decide gender.
- Model IDs live only in `apps/api/src/modules/coach/coach.config.ts`. No secrets in git; `.env.example` only.
- `croissant-quest.html` and `tests-legacy/` are the pre-rebuild reference until the port is verified.
