# Rebuild Croissant Quest as NestJS + Next.js (design)

Size: project. Intent, layout, database and coach choices were fixed by the owner in the kickoff brief
and the approved plan (`/root/.claude/plans/croissant-quest-mutable-beaver.md`); the owner opted out of
further questions ("then start"). Anything below marked **(my call)** was not dictated.

## Why
The single HTML file mixes game rules, UI and persistence. The owner wants an API/web split with Postgres, tests and CI,
with identical behaviour, and the open audit items (11-21) fixed during the port.

## Goals
Same game: XP, hearts, crowns, boss card, proof mode, feel meter + calibration, SEEN_CAP 3, three pronunciation scripts,
light/dark. Server-side merge-safe saves. Server-side coach with a safe fallback. Accessible UI (dialog, live region, lang, 44px).

## Non-goals
Real auth (anonymous device cookie only). Multi-user social features. Rewriting the French content. Publishing the live artifact.

## Anti-goals
Losing existing progress (qid format must stay stable). Reintroducing the corrected French rules. Any secret in git.
A dead button when the coach is down.

## Approaches considered
1. **Pure logic in `packages/shared`, state on the server, thin web client (chosen).** Merge/judge/pron are shared TS with the legacy tests ported; the API owns persistence and the coach; the web app renders and plays rounds locally, saving through `PUT /v1/progress`.
2. Server-authoritative rounds (API decides every question and answer). More secure, but a round-trip per answer and a rewrite of behaviour: rejected, "same behaviour".
3. Keep logic only in the web app, API as dumb storage. Duplicates merge rules in two places when two devices write: rejected.

## Decisions (my call unless stated)
- Rounds are played in the browser (as today); the server validates and merges progress. **(my call)**
- Web ↔ API over HTTP; the web app proxies `/v1/*` through Next rewrites so the device cookie is first-party. **(my call)**
- No turbo/nx: pnpm `-r` scripts are enough (ADR 0003). **(my call)**
- Progress is one jsonb row plus indexed xp/streak (ADR 0002).
- Tests: Vitest for packages/api units, supertest for API e2e on real Postgres, Playwright + axe for web.

## Left to the builder
Component breakdown, CSS details, exact coach prompt wording (ported from `aiPrompt`), Prisma column types.
