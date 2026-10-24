# Croissant Quest NestJS + Next.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Port the single-file game to a pnpm monorepo (Next.js web, NestJS API, Postgres) with identical behaviour and audit items 11-21 fixed.
**Architecture:** Pure rules live in `packages/shared` (zod schemas, judge, merge, pron, retirement/crown rules); the 246-question bank is JSON in `packages/content`; the API owns persistence (Prisma/Postgres, versioned saves) and the coach; the web app plays rounds locally and saves through `/v1/progress`.
**Tech Stack:** pnpm workspaces, TypeScript, Vitest, zod, NestJS 10, Prisma + Postgres 16, supertest, Next.js (App Router), Playwright + axe, Docker, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-10-24-nest-next-rebuild-design.md`; ADRs in `docs/adr/`; baseline `croissant-quest.html` @ audit-fixes (dffd29b); legacy tests `tests-legacy/`.

## Global Constraints
- `qid(q)` = `q.t+"|"+q.k+"|"+(q.s||q.en||"")+"|"+q.a` (unchanged, saves must still load).
- `SEEN_CAP = 3`. Model id only in `apps/api/src/modules/coach/coach.config.ts` (`claude-sonnet-5-5`, tier "default").
- Dark fill `#1B7F5E` (white on it 4.95:1); light fill `#0E5B43`.
- Merge: counters (xp, cro, rounds, crowns, seen) take the larger value; `wrong`, `log`, `feel`, `calib`, `feelLog` come from the newer `ts`.
- Corrected French: after `pas` only un/une/des/du/de la/de l' become `de`; `jouer du/de la` is not a partitive.
- No secrets in git; `ANTHROPIC_API_KEY` only in the API env. No PR/publish/merge without the owner's yes.

## Review Focus
1. Two tabs saving at once → one gets 409, retries with merge, no counter goes down (api e2e concurrency test).
2. Quit mid-round, then new round → stale timers never act (web unit/Playwright).
3. Coach down / key missing → button still starts a local round (api + web test).
4. Old save with missing/odd fields (`__proto__`, arrays, strings) → `normState` yields a valid state (shared test).
5. Aspirate-h sentence (`des haricots`) → no liaison; mute-h (`des hommes`) → liaison (shared test).

---

## Lane 0: audit + clean (done on this branch before porting)
### Task 0.1: Legacy tests moved and green
- [ ] `git mv tests tests-legacy`; run `node tests-legacy/C-behave.js tests-legacy/fixes.js` → 69 pass (paths adjusted).
### Task 0.2: Dead code removal
- [ ] Delete duplicate `W` keys, `.opt.sel`, `.verdict.ok`, stray `.acc` rule from `croissant-quest.html`; rerun legacy tests; commit.

## Lane 1: packages/shared + packages/content
### Task 1.1: Workspace scaffold
**Files:** `package.json`, `pnpm-workspace.yaml`, `packages/config/{tsconfig.base.json,eslint.config.mjs}`, `packages/{shared,content}/package.json`.
- [ ] Vitest runs an empty suite via `pnpm -r test`.
### Task 1.2: Content extraction
**Produces:** `packages/content/data/{bank.json,rules.json,tags.json,pron.json,topics.json}`; `Question` zod schema in shared.
- [ ] Script `scripts/extract-content.mjs` evaluates the legacy script in a vm and writes JSON; test: 246 questions, all validate, every `choice` has its answer in `o`, no duplicate qid.
- [ ] Test: the 12 formerly missing exception `why` fields exist.
### Task 1.3: Pure logic
**Produces (packages/shared/src):** `qid(q)`, `norm(s)`, `deaccent(s)`, `knit(s)`, `fullOf(q)`, `judge(q,picked)`, `ALT`, `pron(sentence)→{e,g,h}`, `normState(v)→State`, `mergeStates(a,b)→State`, `tagStats(S)`, `weakTag(S)`, `ruleSplit(S)`, `myRate(S)`, `pickQuestions(bank,S,topic,mode,rng)`, `endRoundScore(...)`.
- [ ] Port tests from `tests-legacy/*.js` one file at a time as Vitest (names preserved); run red then green.
- [ ] New tests: weighted review pick (item 18), Review Focus 4 and 5.
- [ ] Push.

## Lane 2: apps/api
### Task 2.1: Nest app + config + health
**Produces:** `GET /v1/health → {ok:true}`; zod env (`DATABASE_URL`, `ANTHROPIC_API_KEY?`, `PORT`).
### Task 2.2: Prisma schema + migration + seed
**Files:** `prisma/schema.prisma` (`User`, `Progress{userId,state Json,ts BigInt,version Int,xp Int,streak Int}`), `prisma/seed.ts` (validates bank).
### Task 2.3: Progress module
**Produces:** `GET /v1/progress → {state,version}`; `PUT /v1/progress` with `If-Match`; 409 returns `{state,version}`; device cookie guard.
- [ ] e2e (real Postgres): create, read, update, stale `If-Match` → 409, two parallel PUTs → exactly one 200, merged result never lowers a counter.
### Task 2.4: Questions module
- [ ] `GET /v1/questions` returns the validated bank; test ETag.
### Task 2.5: Coach module
**Produces:** `POST /v1/coach/round {n}`, `POST /v1/coach/explain`; `CoachClient` interface (fake in tests).
- [ ] Tests: timeout, retry, invalid JSON, copy-of-bank rejected, unknown tag rejected, missing key → `{fallback:true}`, rate limit → 429.
- [ ] Push.

## Lane 3: apps/web
### Task 3.1: Next scaffold, tokens, layout (`<html lang="en">`, `lang="fr"` on French text), rewrites `/v1/*` → API.
### Task 3.2: Game state hook + API client (load, merge on 409, offline localStorage, sync-failure banner).
### Task 3.3: Map + Sheet (`<dialog>`: focus move, trap, Escape, restore) + Hud (44 px targets).
### Task 3.4: Round (six question kinds), WhyCard, boss card, proof mode, timers owned by the round (cancelled on Quit).
### Task 3.5: Results (short) + feel meter + report + Drill/Weak/Fresh buttons (never dead; guard double press, 30 s coach timeout).
### Task 3.6: Playwright smoke (play a round, quit, results) + axe (no serious/critical violations, light and dark).
- [ ] Push.

## Lane 4: infra
### Task 4.1: Dockerfiles, `infra/docker-compose.yml` (postgres:16 healthcheck + volume), `.env.example`.
### Task 4.2: `.github/workflows/ci.yml` (lint, typecheck, unit, bank validation, api e2e with Postgres service, web e2e, build). README run-in-5-minutes.
### Task 4.3: Remove `croissant-quest.html` only after Lane 1-3 tests pass; write `docs/AUDIT-REPORT-2.md`, final SKILLS-MAP, PR body.
- [ ] Push.
