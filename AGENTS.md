# AGENTS.md

Croissant Quest: a French A1 partitive-articles game. pnpm monorepo, Node 22.

- `apps/web` Next.js UI. `apps/api` NestJS + Prisma + Postgres. `packages/shared` pure rules and the HTTP contract (zod). `packages/content` the question bank as validated JSON.
- `apps/web` and `apps/api` never import each other; they share only `packages/*`. Change the contract in `packages/shared/src/contract.ts` first.
- Rules live in `packages/shared`, not in components. Tests: `pnpm test` (unit), `pnpm --filter @cq/api test:e2e` (needs `DATABASE_URL`), `pnpm --filter @cq/web test:e2e`.
- `qid(q)` is the key of saved progress: never change its format or reword an existing bank question without a migration.
- Do not reintroduce wrong French rules: after `pas` only un/une/des/du/de la/de l' become `de` (le/la/les stay); `jouer du/de la` is not a partitive; a final `-re` does not decide gender.
- Model IDs live only in `apps/api/src/modules/coach/coach.config.ts`. No secrets in git; `.env.example` only.
- `croissant-quest.html` and `tests-legacy/` are the pre-rebuild reference until the port is verified.

## Rules for agents (owner-approved 2026-10-24; enforced where noted)

**Banned, no exceptions:** force-push in any form, `reset --hard`, `clean -f`, `branch -D`, deleting branches or tags, rewriting history, `--no-verify` (hook: `.claude/hooks/`, see ADR 0007/0008); publishing or overwriting the live artifact; committing secrets; putting `ANTHROPIC_API_KEY` anywhere but the server's `infra/.env` (never in git, chat or logs); the coach abuse limits of ADR 0009 must stay on wherever a key is set; pushing to any repo other than silly-cloud/croissant-quest; claiming a test passed without pasted output; calling a skill "invoked" when it was only followed from its SKILL.md.
**Allowed with conditions:** push to `claude/*` branches (never to `main` directly); merge PR #3 into `main` only when the release gate in docs/RUNBOOK.md is fully green with evidence (local gate, CI green on GitHub, no open Critical/High, parity shown, legacy HTML removed, Docker verified or recorded unavailable, clean secret scan), by merge or squash commit.
**Invariants:** `qid` format; `SEEN_CAP = 3` (packages/shared/src/state.ts); model id only in apps/api/src/modules/coach/coach.config.ts; corrected French rules; web and api share code only through packages/*.
Pointers: docs/RUNBOOK.md (state, gate), docs/adr/, docs/GLOSSARY.md, docs/audit/ (latest audit and fix plan), docs/GITHUB-SETTINGS.md.
