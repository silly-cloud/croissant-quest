# Runbook (synced with the repo, 2026-10-24). Supersedes the older kickoff prompts.

Branch `claude/nest-next-rebuild`, PR https://github.com/silly-cloud/croissant-quest/pull/3. Rules: unchanged (see PLAN.md Global Constraints, AGENTS.md).
Do not open/merge a PR, publish the artifact, delete branches, or remove `croissant-quest.html` before the parity gate without the owner's yes.

## State
| Lane | State | Evidence |
|---|---|---|
| 0 audit + cleanup | DONE, pushed | AUDIT-REPORT-2; `tests-legacy` 49 + 20 pass |
| 1 shared + content | DONE, pushed, reviewed (ponytail-review) | shared 47 tests, content 5 |
| contract | DONE (`packages/shared/src/contract.ts`, + `QuestionsResponse`) | typecheck clean |
| 2 api | DONE, reviewed, review fixes merged (171b8c8) and re-verified by me | api unit 34, e2e 43 (real Postgres), shared 54; follow-ups 17/18/20/22 open (tickets) |
| 3 web | IN PROGRESS: one write agent in its own worktree (started from 080abcf, folder `apps/web` only) | report pending |
| 4 infra | PARTLY: `infra/docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`, AGENTS.md, GLOSSARY done. TODO: Dockerfiles, README run-in-5-minutes, CI parity check, HTML removal (after parity gate), final reports | compose/CI not yet run |

Deviations from the older prompt, recorded: Lane 2 and 3 started in parallel before GATE A (Gate A is therefore applied late, to the Lane 3 diff and to the contract); worktrees live in `.claude/worktrees/` (git-ignored) instead of `../wt-*`.

## Order of remaining work
1. Lane 3 returns -> I re-run its gates (typecheck, lint, test, build, e2e) -> merge -> push -> reviewer (read-only) -> fix or log findings.
2. Lane 2 review findings -> fix (surgical-patch) -> push.
3. Lane 4: Dockerfiles (api: tsup bundle; web: Next standalone), README, run every CI step locally and paste output; say plainly CI has not run on GitHub.
4. Parity gate: ported tests vs `tests-legacy` (69): same names/counts or each difference explained. Then remove the HTML (owner yes first).
5. `ponytail-debt`, `verify-and-stop` (full gate: frozen install, lint, typecheck, test, api e2e, web e2e + axe, docker compose if a daemon exists), `mattpocock-pr` PR body, final status. Stop at "ready to open PR".

## Gates the owner types (I stop and print `GATE <n>: please type /<skill>`)
| Gate | When | Commands |
|---|---|---|
| A (late) | now/next, on the contract and the Lane 3 diff | `/mattpocock-grill-with-docs`, `/pstack-interrogate`, `/pstack-sharpen`, `/pstack-blast-radius` |
| B | check the round/save state machine the web agent built | `/pstack-statechart`, `/pstack-architect` |
| C | tickets for open audit items not in PLAN.md | `/mattpocock-to-tickets`, `/mattpocock-triage` (+ `/mattpocock-wayfinder`) |
| D | after Lane 3 merge (and re-run on Lane 2 if wanted) | `/pstack-typescript-best-practices`, `/pstack-no-comments`, `/pstack-unslop`, `/pstack-show-me-your-work` |
| E | before removing the HTML | `/pstack-correct` or `/mattpocock-wait-what`, `/pstack-swarm` or `/pstack-arena` (concurrent saves, coach fallback) |
| F | before the PR body | `/mattpocock-improve-codebase-architecture`, `/mattpocock-retro`, `/pstack-reflect` |
Anytime: `/mattpocock-handoff` (heavy context), `/pstack-recall`, `/pstack-how`, `/pstack-why`. First gate due: **A**, then **D** when Lane 3 returns.

## Skills I invoke myself (still to do)
`ponytail` (while building), `ponytail-debt`, optional `ponytail-gain`, `superpowers-verification-before-completion` (each lane), `-requesting-code-review`, `-test-driven-development`,
`-finishing-a-development-branch`, `mattpocock-code-review` / `-domain-modeling` / `-pr` / `-writing-for-agents` / `-tdd`, `caveman-review`, `caveman-commit`, `lean-build`, `migration`, `safe-refactor`, `surgical-patch`, `verify-and-stop`.
Owner approved `mattpocock-git-guardrails-claude-code` (blocks force-push/reset --hard, plain push stays allowed) and `mattpocock-setup-pre-commit` (Husky + lint-staged, typecheck on commit, unit tests on push). MERGED (files). Guardrails hook is active for Claude sessions via .claude/settings.json. Husky is NOT yet enabled in this clone (`HUSKY=0` installs): enable with a plain `pnpm install` once the web and api-fix agents have merged, so their commits are not blocked by someone else's type error.
