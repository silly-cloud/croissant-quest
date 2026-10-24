# Skills map

Installed 2026-10-24 by copying each pack's skill folders into `~/.claude/skills` after scanning them
(no install scripts or hooks were run; hooks shipped by ponytail, superpowers and caveman were NOT enabled).
A skill is marked **used** only when it was invoked and its output was kept. Update the "Uses" table as work proceeds.

| Pack | Source | Installed as | Notes |
|---|---|---|---|
| superpowers | github.com/obra/superpowers `skills/` | `superpowers-<name>` | 15 skills |
| mattpocock | github.com/mattpocock/skills `skills/{engineering,misc,productivity}` | `mattpocock-<name>` | 38 skills; `in-progress/` not installed |
| pstack | github.com/cursor/plugins `pstack/skills` | `pstack-<name>` | 60 folders copied; none appear in the session's invocable list, so **all pstack skills are treated as slash-only / N/A** |
| ponytail | github.com/DietrichGebert/ponytail `skills/` | `ponytail`, `ponytail-audit`, `-review`, `-debt`, `-gain`, `-help` | |
| caveman | github.com/JuliusBrussee/caveman `skills/` | `caveman`, `caveman-review`, `cavecrew`, … | Cloud/proxy skills (`caveman-setup`, `-manage`, `-optimize`, `-discover`, `-evidence-review`) are N/A: they need Caveman Cloud and are not used |
| graphify | github.com/Graphify-Labs/graphify (PyPI `graphifyy`) | CLI only, in a throwaway virtualenv | `graphify update` (AST, no LLM). The `/graphify` skill and its CLAUDE.md/hook installer were not installed |

Name notes: `mattpocock-grilling` and `mattpocock-grill-me`/`-grill-with-docs` exist; there is no skill literally called `grilling`
elsewhere. Task names in the brief map as: grilling → `mattpocock-grilling`; code-review → `mattpocock-code-review`; pr → `mattpocock-pr`.

## Invocable by me vs slash-only

Invocable in this session (appear in the Skill tool list): all 15 superpowers, all 6 ponytail, 15 mattpocock
(code-review, codebase-design, diagnosing-bugs, domain-modeling, git-guardrails-claude-code, grilling, migrate-to-shoehorn, pr, prototype, research,
scaffold-exercises, setup-pre-commit, tdd, wizard, writing-for-agents), the caveman/cavecrew set, and `pstack-setup-pstack`.
Slash-only / N/A (installed but not in my list): 16 mattpocock skills (ask-matt, grill-me, grill-with-docs, handoff, implement, implement-spec,
improve-codebase-architecture, retro, setup-matt-pocock-skills, teach, to-questionnaire, to-spec, to-tickets, triage, wait-what, wayfinder),
about 59 pstack skills, and caveman `megacave`/`ultracave`. The pstack review/challenge/tickets phases therefore ran through the invocable
equivalents (ponytail-review, mattpocock-code-review via agents, superpowers-requesting-code-review) and are marked as such below.

## Uses (invoked, output kept)

| Skill | Phase | Outcome |
|---|---|---|
| superpowers-using-superpowers | start | invoked; skills-first rule followed |
| ponytail-audit | A | invoked; method applied in docs/AUDIT-REPORT-2.md (via two read-only agents) |
| graphify (CLI) | A | `graphify update` on the extracted game script: 111 nodes, 257 edges, 10 communities (`docs/GRAPH_REPORT-legacy-html.md`) |
| superpowers-brainstorming | B | invoked; its gate was met by the owner's approved plan and kickoff brief, short design doc in `docs/superpowers/specs/` (no builder-check subagent was run) |
| superpowers-writing-plans | B | invoked; `docs/PLAN.md` (written at `docs/PLAN.md` per the owner's path) |
| superpowers-subagent-driven-development | C | invoked; adapted: two write agents ran in parallel in separate worktrees on disjoint folders (the skill advises against parallel implementers; the brief asked for it). Ledger and per-task reviewers were NOT run; one reviewer per lane instead |
| ponytail-review | C | Lane 1 reviewed: `docs/reviews/lane1-ponytail-review.md` (one fix applied) |

Not yet used: superpowers tdd/verification-before-completion/finishing-a-development-branch, mattpocock-pr/code-review/domain-modeling, caveman-review. Entries are added when they are really invoked.
