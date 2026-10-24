# Runbook (synced with the repo, 2026-10-24). Supersedes the older kickoff prompts.

Branch `claude/nest-next-rebuild`, PR https://github.com/silly-cloud/croissant-quest/pull/3. Rules: unchanged (see PLAN.md Global Constraints, AGENTS.md).
Do not open/merge a PR, publish the artifact, delete branches, or remove `croissant-quest.html` before the parity gate without the owner's yes.

## Where things really are (2026-10-24, before the finish-and-host run)

- On the branch: packages/{shared,content,config}, apps/api (+ review fixes, 171b8c8), guardrails hook (active), Husky files (installed with HUSKY=0, not enabled), infra compose, CI file, ADRs 0001-0007, audit docs under docs/audit/.
- Finished but unmerged: apps/web on worktree-agent-af9d502963e0ce5f9 @ 3e83d84 (65 unit, 14 Playwright tests, run against a fake API only; based on 080abcf, before the API review fixes).
- Running: only the audit consolidator (writes to scratch). Lanes A-K and the API-fix agent have all returned.
- Open: no Dockerfiles; CI never run on GitHub and its web e2e step passes with zero projects; legacy HTML present; PR #3 not merged; main has no branch protection (protected:false).
- Audit (reproduced by me): hook fails open (empty/malformed stdin; jq missing) and has evasions (`git push "-f"`, `git -C . push -f`, `--mirror`); coach abuse via minted cookies (unlimited GET /v1/progress) and cross-site text/plain POST; `last` unvalidated (pins streak); two tabs lose increments and misses (max merge); SEEN_CAP untested; apps/web lacks a vitest devDependency (typecheck breaks after merge).
- Banned/allowed lists: see AGENTS.md (updated in this run).

## State

| Lane               | State                                                                                                                                                                                                                  | Evidence                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0 audit + cleanup  | DONE, pushed                                                                                                                                                                                                           | AUDIT-REPORT-2; `tests-legacy` 49 + 20 pass                                           |
| 1 shared + content | DONE, pushed, reviewed (ponytail-review)                                                                                                                                                                               | shared 47 tests, content 5                                                            |
| contract           | DONE (`packages/shared/src/contract.ts`, + `QuestionsResponse`)                                                                                                                                                        | typecheck clean                                                                       |
| 2 api              | DONE, reviewed, review fixes merged (171b8c8) and re-verified by me                                                                                                                                                    | api unit 34, e2e 43 (real Postgres), shared 54; follow-ups 17/18/20/22 open (tickets) |
| 3 web              | IN PROGRESS: one write agent in its own worktree (started from 080abcf, folder `apps/web` only)                                                                                                                        | report pending                                                                        |
| 4 infra            | PARTLY: `infra/docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`, AGENTS.md, GLOSSARY done. TODO: Dockerfiles, README run-in-5-minutes, CI parity check, HTML removal (after parity gate), final reports | compose/CI not yet run                                                                |

Deviations from the older prompt, recorded: Lane 2 and 3 started in parallel before GATE A (Gate A is therefore applied late, to the Lane 3 diff and to the contract); worktrees live in `.claude/worktrees/` (git-ignored) instead of `../wt-*`.

## Order of remaining work

1. Lane 3 returns -> I re-run its gates (typecheck, lint, test, build, e2e) -> merge -> push -> reviewer (read-only) -> fix or log findings.
2. Lane 2 review findings -> fix (surgical-patch) -> push.
3. Lane 4: Dockerfiles (api: tsup bundle; web: Next standalone), README, run every CI step locally and paste output; say plainly CI has not run on GitHub.
4. Parity gate: ported tests vs `tests-legacy` (69): same names/counts or each difference explained. Then remove the HTML (owner yes first).
5. `ponytail-debt`, `verify-and-stop` (full gate: frozen install, lint, typecheck, test, api e2e, web e2e + axe, docker compose if a daemon exists), `mattpocock-pr` PR body, final status. Stop at "ready to open PR".

## Gates the owner types (I stop and print `GATE <n>: please type /<skill>`)

| Gate                                                                                                                                                   | When                                                   | Commands                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A (late)                                                                                                                                               | now/next, on the contract and the Lane 3 diff          | `/mattpocock-grill-with-docs`, `/pstack-interrogate`, `/pstack-sharpen`, `/pstack-blast-radius`                     |
| B                                                                                                                                                      | check the round/save state machine the web agent built | `/pstack-statechart`, `/pstack-architect`                                                                           |
| C                                                                                                                                                      | tickets for open audit items not in PLAN.md            | `/mattpocock-to-tickets`, `/mattpocock-triage` (+ `/mattpocock-wayfinder`)                                          |
| D                                                                                                                                                      | after Lane 3 merge (and re-run on Lane 2 if wanted)    | `/pstack-typescript-best-practices`, `/pstack-no-comments`, `/pstack-unslop`, `/pstack-show-me-your-work`           |
| E                                                                                                                                                      | before removing the HTML                               | `/pstack-correct` or `/mattpocock-wait-what`, `/pstack-swarm` or `/pstack-arena` (concurrent saves, coach fallback) |
| F                                                                                                                                                      | before the PR body                                     | `/mattpocock-improve-codebase-architecture`, `/mattpocock-retro`, `/pstack-reflect`                                 |
| Anytime: `/mattpocock-handoff` (heavy context), `/pstack-recall`, `/pstack-how`, `/pstack-why`. First gate due: **A**, then **D** when Lane 3 returns. |

## Skills I invoke myself (still to do)

`ponytail` (while building), `ponytail-debt`, optional `ponytail-gain`, `superpowers-verification-before-completion` (each lane), `-requesting-code-review`, `-test-driven-development`,
`-finishing-a-development-branch`, `mattpocock-code-review` / `-domain-modeling` / `-pr` / `-writing-for-agents` / `-tdd`, `caveman-review`, `caveman-commit`, `lean-build`, `migration`, `safe-refactor`, `surgical-patch`, `verify-and-stop`.
Owner approved `mattpocock-git-guardrails-claude-code` (blocks force-push/reset --hard, plain push stays allowed) and `mattpocock-setup-pre-commit` (Husky + lint-staged, typecheck on commit, unit tests on push). MERGED (files). Guardrails hook is active for Claude sessions via .claude/settings.json. Husky is NOT yet enabled in this clone (`HUSKY=0` installs): enable with a plain `pnpm install` once the web and api-fix agents have merged, so their commits are not blocked by someone else's type error.

## Release gate record (2026-10-24, head b709393)

| Condition (rule 4.4)                                                                                                      | Evidence                                                                                                                                              | State                |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Local gate green                                                                                                          | lint/typecheck 0 errors; unit 7+163+48+90; api e2e 67; web e2e 18 (fake) + 23 pass/1 skip (real API); parity 69/69 exit 0; legacy 49+20; hook 293/293 | green                |
| CI green on GitHub                                                                                                        | runs 59 (push) and 60 (pull_request) green on 8753b16; run 50's log shows 18 + 22 Playwright tests on a Postgres service; PR #3 mergeable_state clean | met                  |
| No open Critical/High                                                                                                     | AUD-01/02/03/05/06/07/08 fixed with tests; AUD-04 downgraded to Medium with reason (repo setting unreachable from this session)                       | met                  |
| Parity + legacy HTML removed                                                                                              | parity-report exit 0; HTML moved to tests-legacy/ fixture                                                                                             | met                  |
| docker compose up --build                                                                                                 | no Docker daemon in this container: `compose config` validated, every Dockerfile RUN step replayed (migrate, /v1/health db:true, web rewrite)         | recorded unavailable |
| Secret scan of history                                                                                                    | 0 hits over 66 commits, all refs; only .env.example files ever committed                                                                              | met                  |
| Husky enabled (core.hooksPath=.husky/_): pre-commit ran lint-staged + typecheck (9.7 s), pre-push ran unit tests (4.3 s). |
