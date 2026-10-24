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

## Uses

| Skill | Phase | Outcome |
|---|---|---|
| superpowers-using-superpowers | start | invoked; skills-first rule followed |
| ponytail-audit | A | invoked; report in docs/AUDIT-REPORT-2.md |
| graphify (CLI) | A | `graphify update` on the extracted game script: 111 nodes, 257 edges, 10 communities (`docs/GRAPH_REPORT-legacy-html.md`) |
