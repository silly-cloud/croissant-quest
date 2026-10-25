# Fix plan (dependency order)

How to read it:
- Tickets in the same **parallel group** have disjoint file scopes and can run as parallel sub-agents.
- Groups run in order: G1 -> G2 -> G3 -> G4 -> G5 -> G6.
- **DECISION** = needs the owner first; at most 2 options are given.
- **OWNER** = only the owner can do it (GitHub settings).
- Every acceptance test must fail before the fix and pass after it.
- No ticket pushes to main or opens or merges a PR without the owner's yes.

## G1: unblock (parallel)

### FIX-01: Merge apps/web into the workspace + fix its typecheck
- Closes: AUD-07 (and makes every web finding testable in the repo)
- Scope: apps/web/** (from worktree agent-af9d502963e0ce5f9 once that agent has finished), pnpm-lock.yaml
- Change: bring the web commits in, add `"vitest": "^5.0.5"` to apps/web devDependencies, align `@types/node` with the root, update the lockfile.
- Acceptance: on a fresh `git archive HEAD` tree: `pnpm install --frozen-lockfile --offline && pnpm --filter @cq/web typecheck && pnpm --filter @cq/web build && pnpm --filter @cq/web test && pnpm --filter @cq/web test:e2e` all exit 0 (today typecheck exits 2 with 15x TS2339).
- Effort: M. Prerequisite: the web agent is done and the owner agrees to merge it into the branch (not into main).

### FIX-02: CI: real web gate + least privilege
- Closes: AUD-06, AUD-13
- Scope: .github/workflows/ci.yml, .github/dependabot.yml (new)
- Change: `--fail-if-no-match` on both `@cq/web` lines; top-level `permissions: {contents: read}`; `concurrency: {group: ci-${{ github.ref }}, cancel-in-progress: true}`; `timeout-minutes: 20`; `push` only on main; actions pinned to SHAs; dependabot for npm and github-actions.
- Acceptance: on a tree without apps/web, `pnpm --filter @cq/web --fail-if-no-match exec playwright --version; test $? -ne 0`. `grep -q '^permissions:' ci.yml && grep -q 'concurrency:' ci.yml`. Every `uses:` line matches `@[0-9a-f]{40}`. After FIX-01, F's `ci-sim.sh` step 08b exits 0.
- Effort: S

### FIX-03 (OWNER): Ruleset on main
- Closes: AUD-04 (remote half)
- Scope: GitHub settings only
- Change: require a PR, require status `check`, block force push and deletion.
- Acceptance: `list_branches` shows main `protected:true` (or the rulesets API lists one). From a scratch clone, `git push origin HEAD:main` and `git push -f origin main` are rejected by the remote.
- Effort: S

### FIX-04: Hook fails closed + cheap evasions + push to main
- Closes: AUD-05, AUD-04 (local half), AUD-14, AUD-60
- Scope: .claude/hooks/block-dangerous-git.sh, .claude/hooks/test-guardrails.sh, docs/adr/0007-git-safety-hooks.md
- Change: exit 2 when jq is missing or the JSON does not parse. Strip quote characters instead of quoted strings. The git regex skips `-C/-c <arg>` and accepts `\git` and `/path/git`. Add `-[a-z]*f` for branch, `--mirror/--delete/:ref/--prune`, a push destination of main, and stash drop/clear, checkout -f, switch -f/--discard-changes, worktree remove --force, `rm -rf` of .git, / and ~. Allow `-n/--dry-run` and skip heredoc bodies. Add an ADR 0007 Limits paragraph (sh -c/eval are out of reach).
- Acceptance: new suite rows expect rc 2 for matrix #7-10, 20, 23, 28, 29, 34-36, 38, 40, 41, 44, 45, 57-59, 70-73, 77, 79, 80, the quote-pairing case, empty stdin, non-JSON and `PATH` without jq. They expect rc 0 for #87-113, 114, 115-119. `bash .claude/hooks/test-guardrails.sh` reports 0 fail. Re-running `scratch/G-guardrails/run.sh cases.txt` leaves only #43, 48-50, 64-67 (and the 6 non-exploitable ones) as MISS.
- Effort: M

### FIX-05: Agents actually load the rules
- Closes: AUD-15
- Scope: CLAUDE.md (new), AGENTS.md
- Change: CLAUDE.md is one line, `@AGENTS.md`. AGENTS.md gets bullets for: no push to main and no PR, merge or publish without the owner's yes; never bypass a hook or rephrase a blocked command; SEEN_CAP and qid frozen; pointers to docs/adr, GLOSSARY and RUNBOOK. Mark the `@cq/web` line "after merge" if FIX-01 is not done yet.
- Acceptance: `test -f CLAUDE.md && grep -qx '@AGENTS.md' CLAUDE.md && grep -q -- '--no-verify' AGENTS.md && grep -q SEEN_CAP AGENTS.md && grep -q 'docs/adr' AGENTS.md`.
- Effort: S

## G2: formatting baseline (alone; touches every file)

### FIX-06: One Prettier commit + format check + lint-staged fixes
- Closes: AUD-58, AUD-59, AUD-61
- Scope: whole repo (format only), .github/workflows/ci.yml (one step), .lintstagedrc.json, .gitattributes (new), docs/adr/0007 (Limits: Husky does not run in worktrees or on merges)
- Acceptance: `pnpm exec prettier --check .` exits 0. CI runs it. In a scratch clone with Husky on, staging a broken `packages/content/data/bank.json` makes the commit fail, and staging `scripts/x.mjs` commits. `git ls-files --eol .husky .claude/hooks` shows `i/lf` only.
- Effort: S. It must run with no other ticket in flight, otherwise every parallel branch conflicts.

## G3: independent fixes (parallel)

### FIX-07: Shared mutation killers + TZ pin
- Closes: AUD-23 (shared and content half)
- Scope: packages/shared/test/killers.test.ts (new, taken from scratch/C-shared/killers.test.ts), packages/shared/package.json (`test` with `TZ=Asia/Kolkata`), packages/content/test/schema.test.ts (new: negative cases for M03/M04)
- Acceptance: `pnpm --filter @cq/shared test` green under TZ=Asia/Kolkata, America/Los_Angeles and Pacific/Kiritimati. Re-running `scratch/C-shared/run-mutants.mjs` kills >= 81 of 83 non-equivalent mutants. M28 (SEEN_CAP 4) and M76 (local-time dayBefore) are killed.
- Effort: S

### FIX-08: API abuse limits (no-decision part)
- Closes: AUD-10 (API part), AUD-11 (415 part), AUD-31, AUD-32
- Scope: apps/api/src/modules/device/**, apps/api/src/modules/coach/rate-limit.guard.ts, apps/api/src/modules/coach/coach.controller.ts, apps/api/test/e2e/abuse.e2e.ts (new)
- Change: per-IP RateLimiter on the DeviceGuard create branch. The coach must pass both `u:<id>` and `ip:<ip>` plus global. 415 when content-type is not application/json on /coach/*. Token charset check `^[A-Za-z0-9_-]{43}$`. At the limiter cap, refuse new keys instead of evicting; key IPv6 by /64.
- Acceptance (e2e): 300 cookieless `GET /v1/progress` from one IP create at most the configured limit of User rows and the rest get 429. 14 minted cookies x 10 coach calls from one IP give at most 10x200, after which a device from another IP still gets 200. `POST /v1/coach/round` with `Content-Type: text/plain` -> 415. Cookie `cq_device=%00` -> no 500.
- Effort: M

### FIX-09: API error mapping, headers, env
- Closes: AUD-36, AUD-37, AUD-38, AUD-42, AUD-03 (API half)
- Scope: apps/api/src/setup-app.ts, apps/api/src/main.ts, apps/api/src/common/http-exception.filter.ts, apps/api/src/env.ts, apps/api/prisma.config.ts, apps/api/src/modules/progress/progress.service.ts (only the Prisma 22P05/22021 -> 400 mapping), apps/api/test/e2e/misc.e2e.ts
- Acceptance: a malformed JSON body -> 400 whose message contains no body fragment. A bad gzip body -> 400. No `X-Powered-By`. A disallowed-origin GET /v1/questions carries `Vary: Origin`. `WEB_ORIGIN=file:///x` fails env load. `prisma migrate deploy` with DATABASE_URL unset errors out. A PUT whose `log[0].gave` holds a lone surrogate -> 400 (not 500).
- Effort: S

### FIX-10: HUD fits phones
- Closes: AUD-08, AUD-50 (token part, E-web-12)
- Scope: apps/web/src/app/globals.css, apps/web/e2e/layout.spec.ts (new)
- Acceptance: Playwright at 320, 360 and 390 px with xp 12345, streak 120 and cro 42: `document.documentElement.scrollWidth <= innerWidth`, and the Settings link's bounding box is inside the viewport. axe light/dark stays green.
- Effort: S. Depends on FIX-01.

### FIX-11: Web round lifecycle
- Closes: AUD-21, AUD-22, AUD-30, AUD-03 (web half)
- Scope: apps/web/src/lib/round-host.ts, apps/web/src/lib/engine.ts, apps/web/src/components/{RoundScreen.tsx,FreshButton.tsx,Results.tsx}, apps/web/test/round-host.test.ts, apps/web/test/engine.test.ts, apps/web/e2e/coach.spec.ts (new)
- Acceptance (unit): `fresh()` then `release()` with no engine returns "stale" and never calls `router.replace`. With `store.update` throwing in finish(), phase becomes "done" (A's `zz-finish` probe inverted). A typed 59-char answer + 🥐 gives `log.gave` with `isWellFormed()` true. (e2e): coach delayed 3 s, tap Settings, and the URL is still /settings 5 s later. With a hanging coach, "Play my weak spots now" is visible within 6 s.
- Effort: M. Depends on FIX-01.

### FIX-12: Web sync robustness
- Closes: AUD-09, AUD-10 (web half, E-web-4), AUD-51
- Scope: apps/web/src/lib/game-store.ts, apps/web/src/components/AppShell.tsx, apps/web/test/game-store.test.ts
- Acceptance: E's `twotab.mjs` with the API down: after tab A and tab B each answer once, a new tab reads seen total 2 (today 1). Unit: fetch GET 200 / PUT 401 and 5 `store.update` calls give exactly 1 GET plus the "Cloud save is blocked" banner (today 5 GETs). With the fake API down then up and no `online` event, the banner clears within 60 s under fake timers.
- Effort: M. Depends on FIX-01. Works with either FIX-22 option, since it calls mergeStates.

### FIX-13: French content text
- Closes: AUD-17, AUD-18, AUD-49
- Scope: packages/content/data/{tags.json,rules.json,bank.json}, apps/api/src/modules/coach/coach.prompts.ts, packages/content/test/bank.test.ts
- Constraint: no edit to a bank `t`, `k`, `s`, `en` or `a` field (that would change the qid). Only `why`, `alt` and `tag` may change.
- Acceptance: a content test asserts that for every bank item with tag `qty` and `a === "d'"` the TAG.qty text contains `d'`. `grep -c "bare de" apps/api/src/modules/coach/coach.prompts.ts` = 0. TAG.p no longer contains "-S on the noun". #205-207 and #220 have `why`. #34 has tag `ah`. The qid set is unchanged (`bank.test` qid snapshot).
- Effort: S

### FIX-14: Runnable container stack
- Closes: AUD-25, AUD-26, AUD-27, AUD-28, AUD-29, AUD-12, AUD-33, AUD-40, AUD-41
- Scope: apps/api/Dockerfile, apps/web/Dockerfile, .dockerignore (new), infra/docker-compose.yml, infra/.env.example, root package.json (`prepare` only), .gitignore
- Acceptance (needs a Docker daemon): on an empty volume, `docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d` brings api to healthy, `curl -s localhost:3000/v1/progress` -> 200 through the web proxy, and the User table exists. `docker compose config` shows no db port or 127.0.0.1 only, and api `expose` only. Without POSTGRES_PASSWORD, compose fails fast. `pnpm install --prod --frozen-lockfile` in a git-archive tree with no .git exits 0. `docker build` context size < 50 MB.
- Effort: L. Depends on FIX-01.

### FIX-15: API dev and ops papercuts
- Closes: AUD-24, AUD-56, AUD-57, AUD-66 (D-api-13 part)
- Scope: apps/api/package.json, apps/api/README.md (rollback section only), docs/adr/0002-progress-storage.md (rollback line only), apps/api/test/e2e/global-setup.ts, apps/api/test/unit/core.test.ts
- Acceptance: on a fresh archive, `pnpm install && pnpm --filter @cq/api test` passes without running typecheck first. Following the README rollback on `cq_audit_x`, then `prisma migrate deploy`, recreates the User and Progress tables. `E2E_DB=cq_e2e_x pnpm --filter @cq/api test:e2e` uses that DB. `git grep -n "claude-sonnet" apps/api/test` is empty.
- Effort: S

## G4: depends on G3

### FIX-16: Shared state hygiene
- Closes: AUD-02, AUD-03 (shared half), AUD-46, AUD-47
- Scope: packages/shared/src/{state.ts,rounds.ts}, packages/shared/test/{state.test.ts,rounds.test.ts}, apps/api/src/modules/progress/progress.service.ts (future-`last` clamp; after FIX-09)
- Acceptance: `normState({last:"z".repeat(2e5)}).last === null`. `normState({last:"2026-10-24 "}).last === null`. `normState({crowns:{6:1e15}}).crowns[6] === 5`. A `log` entry with a lone surrogate or NUL comes out `isWellFormed()` with no `\0`. `noteAnswer(s,"toString",true)` leaves `Object.prototype.toString` untouched. `scoreRound` with `[]` gives `crowned:false`. today < last leaves the streak unchanged. e2e: PUT `{streak:50,last:"9999-12-31"}`, then an honest `{streak:1,last:<today>}`, stores `last = today`. FIX-07 killers stay green.
- Effort: S. After FIX-07 (killers first) and FIX-09.

### FIX-17: Coach validator and service
- Closes: AUD-16, AUD-43, AUD-44, AUD-45
- Scope: apps/api/src/modules/coach/{coach.validate.ts,coach.service.ts,coach.config.ts}, packages/shared/src/text.ts, packages/shared/src/index.ts (export MUTEH), apps/api/test/unit/coach.test.ts
- Acceptance: B's `probe.ts` rows: the 4 bad rows are rejected; `Ce n'est pas ___ vin rouge` a=`du` and cnt a=`une` are accepted; tag `t2` is rejected. `Il mange ___ chocolat !` is rejected as a bank copy. A fake upstream 200 with bad JSON gives exactly 1 upstream hit. The server answers `timeout` within 25.1 s.
- Effort: S. After FIX-13 (prompt text) and FIX-08 (same folder, different files).

### FIX-18 (DECISION, glyph only): Pronunciation liaison + glyphs
- Closes: AUD-48, AUD-19
- Scope: packages/shared/src/pron.ts, packages/content/data/pron.json, packages/shared/test/pron.test.ts
- Decision (owner or native reader): (A) Devanagari /z/=ज़, /ʒ/=झ़; Gujarati /ʒ/=જ઼. (B) The same, but Gujarati /ʒ/=ઝ઼.
- Acceptance: `pron("des hommes").e` contains `-z`. `pron("un animal").e` shows an n-liaison. A test checks that every Devanagari /z/ uses ज़ and every /ʒ/ uses झ़, and Gujarati /ʒ/ uses one glyph. `fille` reads "fee-y". Indic rows of every bank sentence contain no Latin letters.
- Effort: S

### FIX-19: Freshen repeats / show repeats
- Closes: AUD-20
- Scope: apps/web/src/lib/round-host.ts, apps/web/src/components/{RoundScreen.tsx,Map.tsx} (EMPTY_NOTE import + repeat tag), apps/web/test/round-host.test.ts
- Acceptance: a round-host test with a topic-6 state where k questions have seen >= 3: startLocal(6) calls `requestCoachRound({n:k})` and swaps them in. On fallback the note "k of these are repeats" is set. A Playwright check shows the repeat tag.
- Effort: M. After FIX-11 (same files).

## G5: decisions, then the work that follows them

### FIX-20: Port the missing legacy tests + parity name map
- Closes: AUD-23 (A-2, A-4 half)
- Scope: apps/web/test/legacy-*.test.ts (new), apps/web/e2e/boss.spec.ts (new), packages/shared/test/legacy-parity.test.ts (new), docs/parity-map.json (new), scripts/parity-check.mjs (new)
- Acceptance: `node scripts/parity-check.mjs` maps all 69 names in tests-legacy/C-behave.js and fixes.js to a ported test and exits 0 (0 missing). The 9 missing tests (A's list) pass.
- Effort: M. After FIX-19 (round-host behaviour settled).

### FIX-21: Web copy and lang nits
- Closes: AUD-50 (E-web-6, E-web-9), AUD-52
- Scope: apps/web/src/components/{WhyCard.tsx,Map.tsx,RoundScreen.tsx}, apps/web/src/lib/rich.tsx, docs/AUDIT-REPORT-2.md (behaviour-change list)
- Acceptance: Playwright: the boss button and rule-card `<code>` have `lang="fr"`. The Weak Spots empty copy matches what the button does. AUDIT-REPORT-2 lists A-5, A-6, A-7, the system theme and haptics.
- Effort: S. After FIX-19.

### FIX-22 (DECISION): Merge semantics for parallel copies
- Closes: AUD-01
- Scope: packages/shared/src/state.ts (+ a migration of the stored state shape if A)
- Option A: per-device counters (G-counter `xpBy:{device:n}`, total = sum) for xp/cro/rounds/seen/hist; per-key LWW `wrong:{qid:{n,at}}` with tombstones; a recent play-day set for the streak; union feelLog.
- Option B: keep max/LWW, document the loss in ADR 0006, and narrow it with FIX-12 (storage-event absorb) only.
- Acceptance (either): K's `two-tabs-min.ts` gives server xp 49 and keeps both misses (A); or the ADR states the measured 24-33% loss and two-tabs-min is pinned as a known-behaviour test (B).
- Effort: L (A) / S (B)

### FIX-23 (DECISION): Cross-device identity
- Closes: AUD-54 (I-docs-6 part; ADR 0004 export/import follow-up)
- Option A: build an export/import (or link) code so two devices share one User; then K-6-style streak merging matters.
- Option B: accept one browser = one learner; reword ADR 0006 to "tabs/offline copies of one browser", delete the export/import sentence from ADR 0004.
- Acceptance: the ADR 0004/0006 text matches the chosen option. (A) e2e: device 2 redeems a code and GET /v1/progress returns device 1's state.
- Effort: L (A) / S (B)

### FIX-24 (DECISION): Coach on a public host
- Closes: AUD-11 (device part), AUD-10 (spend ceiling)
- Option A: require the device cookie on /coach/* (RequireDeviceGuard) and add a daily global spend ceiling (`COACH_DAILY`).
- Option B: do not set ANTHROPIC_API_KEY on a public host until there are real accounts; the coach stays local-fallback only.
- Acceptance: (A) a cookieless coach call -> 401, and the daily ceiling returns 429 after N calls (unit, fake clock). (B) RUNBOOK/compose state that the key is unset in public deploys, and `/v1/coach/round` returns `no_key` there.
- Effort: S

### FIX-25: Docs refresh
- Closes: AUD-53, AUD-54, AUD-55
- Scope: README.md, docs/** (except files owned by FIX-15/21), AGENTS.md web line, apps/api/README.md (401 sentence), LICENSE holder (owner input)
- Acceptance: a new `scripts/docs-check.mjs` (every backticked repo path in README/docs exists in `git ls-files`) exits 0 and fails on today's README `cd tests`. `grep -rn "NestJS 10\|mergeState\b\|Four packages" docs README.md` is empty. ADR 0002 and 0004 contain "Amended by 0006". The SKILLS-MAP table renders (no blank line inside it).
- Effort: M. After FIX-22 and FIX-23 (merge and identity wording).

### FIX-26: Low-cost security hardening
- Closes: AUD-34, AUD-35, AUD-39
- Scope: apps/api/prisma/** (token hash migration), apps/api/src/modules/device/device.service or guard lookup (after FIX-08), root package.json (`pnpm.overrides`, allowlist), infra/ (app role, after FIX-14)
- Acceptance: the DB `deviceToken` column holds no value equal to any issued cookie (e2e). `pnpm audit --prod` shows 0 high. The API works with a role that lacks CREATE (e2e run with `cq_app`).
- Effort: M

## G6: cleanup (alone, last)

### FIX-27: Dead code, duplication, config, clutter
- Closes: AUD-62, AUD-63, AUD-64, AUD-65, AUD-66
- Scope: packages/shared/src/{contract.ts,rounds.ts,text.ts,state.ts}, apps/api/src/modules/coach/*, apps/api/src/common/tokens.ts, packages/config/**, packages/content/src/index.ts, package.json files, docs/GRAPH_REPORT-legacy-html.md, docs/audit-prompt.md
- Acceptance: `pnpm -r typecheck && pnpm -r test && pnpm --filter @cq/api test:e2e` green. `git grep -n "Array.from(.*).slice(0" -- apps packages` has 1 hit. `git grep -nw ConflictResponse` has 0 hits outside its definition, or the web uses it. PRON_DICT and TAG are parsed by zod (a test with a malformed entry throws).
- Effort: M
