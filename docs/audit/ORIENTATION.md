# Audit 3: orientation (phase 1)

## Recall brief (pstack-recall, followed manually; adapted: no Cursor transcripts exist here, so built from live state: git, PR list, docs)
**Capsule**
- Croissant Quest is being rebuilt from one HTML file into a pnpm monorepo: Next.js web, NestJS API, Postgres, shared rules and content packages.
- Shared + content + API are merged on `claude/nest-next-rebuild` (HEAD aa8794d), reviewed once, with 3 Must and 13 Should review fixes merged.
- The web app is still being written by an agent in a worktree and is not merged. Dockerfiles, README rewrite and HTML removal are not done.
- Guardrail hook is merged and active for Claude Code; Husky is merged but not enabled in this clone.
- Section 0 baseline is green: lint, typecheck, 5 + 54 + 34 unit tests; earlier API e2e 43 on real Postgres.

**Threads**
- [open PR #3] `claude/nest-next-rebuild` → main: the rebuild (this audit's subject).
- [open PR #2] `claude/gallant-rubin-3c19iz`: an abandoned duplicate of fixes 1-10 (owner said leave it, do not delete).
- [open PR #1] `audit-fixes`: the baseline (dffd29b) the rebuild started from.
- [in flight worktree-agent-af9d5…] apps/web (Lane 3).
- [planned, not started] Lane 4 rest: Dockerfiles, README, CI run on GitHub, parity gate, HTML removal.

**Problems** (recurring)
1. Agents claimed counts and fixes that needed re-verification (every merge so far was re-run by the orchestrator; all held).
2. Merge semantics changed twice (max streak → paired streak/last; log newer-wins → union): docs must follow (ADR 0002 vs 0006).
3. Slash-only skills cannot be invoked by the Skill tool; the owner has now directed they be followed manually from SKILL.md.

**Next move**: finish lanes A-K, reproduce the top findings, then write the fix plan for the owner's yes.

## How the save path works (pstack-how, followed manually; simple path: the lanes are the explorers)
**Overview.** Progress is one JSON document per device. The browser keeps a copy in localStorage and plays rounds locally; the API stores the authoritative copy in Postgres and merges, never overwrites.
**Key concepts.** `State` (packages/shared/src/state.ts), `normState` (sanitise any shape), `mergeStates` (counters by max; streak+last paired by later `last`; log union; wrong/feel/calib/feelLog newer `ts` wins), `version` (optimistic lock), device cookie `cq_device`.
**How it works.** `GET /v1/progress` creates the device on first visit and returns `{state, version}`. `PUT /v1/progress` with `If-Match: <version>`: the service reads the row, 409 with the server copy if the version moved, else merges `normState(server)` with `normState(body, knownQids)`, clamps `ts`, and writes with `UPDATE … WHERE version = n` (compare-and-swap) in a transaction. The client merges the 409 copy and retries.
**Where things live.** apps/api/src/modules/progress/*, apps/api/src/modules/device/*, packages/shared/src/{state,contract}.ts, apps/api/prisma/schema.prisma.
**Gotchas.** A PUT without the cookie is 401, so the client must GET first. `wrong` is newer-wins, so a miss recorded on a device with an older clock can be lost. Coach routes never create users. Rate limiter is in-process memory.

## Map (mattpocock-wayfinder, followed manually; local-markdown tracker because no tracker is configured)
**Destination:** a ranked, evidenced audit of the rebuild plus a dependency-ordered fix plan the owner can approve or reject. No fixes applied.
**Notes:** read-only; evidence rule; skills per lane in docs/SKILLS-MAP.md.
**Decisions so far:** scope = whole repo + in-flight web snapshot; web lane is audited as a snapshot, not merged (owner rule: no merge during the audit).
**Not yet specified:** whether to keep `wrong` newer-wins or move to per-key event merging (hangs on lane K evidence); whether ADR 0004 must be widened to real cross-device identity (product decision).
**Out of scope:** applying fixes; GitHub settings changes; publishing the artifact.
**Open HITL tickets for the owner (grilling type; the skill forbids the agent answering its own grilling):** (1) Is cross-device sync required for v1, or is one device per learner acceptable? (2) Should streak survive a merge from a stale device, or follow the newest device? (3) Is the coach meant to ship on a public host (cost exposure) or stay local?

## Graph (graphify CLI)
`graphify update` on a `git archive` copy of HEAD without the legacy HTML: 739 nodes, 1242 edges, 46 communities, 103 files. Cross-app import check (grep over apps/*, packages/*, and the web worktree): **none**. ADR 0001 holds.

## Env reads and log sinks (caveman-explore, invoked)
  apps/api/src/env.ts:5-25  single zod env schema: DATABASE_URL, ANTHROPIC_API_KEY, PORT, WEB_ORIGIN, COOKIE_SECURE, TRUST_PROXY_HOPS, COACH_GLOBAL_PER_MIN; only process.env read
  apps/api/src/main.ts:15  bootstrap log: says coach enabled/disabled, not the key
  apps/api/src/main.ts:19  console.error(e.message) on startup failure (lane D/H: can a pg error message carry DATABASE_URL?)
  apps/api/src/modules/coach/coach.service.ts:26  Coach logger (status codes only, per lane 2 review)
  apps/api/src/common/http-exception.filter.ts:11  Http logger for 5xx
  apps/api/prisma/seed.ts:21-24  seed output
