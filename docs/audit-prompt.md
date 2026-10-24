# Croissant Quest — full-structure audit, every installed skill, chained

Paste everything below the line into a fresh Claude Code session started in `D:\Claude`.

---

You are auditing **Croissant Quest**, a French A1 learning game: one file, `D:\Claude\croissant-quest.html` (~2400 lines, one `<script>` block, no build step), published as the artifact https://claude.ai/artifact/4ipV5vb4uGF8dezMo9C32k with capabilities `db` and `sample`. Written grammar reference: `D:\Claude\french-a1-notes.md`. Knowledge graph: `D:\Claude\graphify-out\`. Regression suites (12 node scripts that stub the DOM and evaluate the page's script): `C:\Users\viram\AppData\Local\Temp\claude\D--Claude\19a6eca1-ab07-43f5-9ec6-d125461320c1\scratchpad\*.js`.

**Goal:** audit the whole code structure — correctness, data safety, French accuracy, pronunciation, design, tests, over-engineering, accessibility, security — by running **every installed skill exactly once**, in the chain below, each one feeding the next. Produce one ranked findings report. Fix nothing until I approve the fix list at the Phase 6 gate.

## Ground rules (these override any skill that says otherwise)

1. **Precedence:** my instructions here and my CLAUDE.md > `ponytail` (ultra) > `caveman` > everything else. Where `superpowers` or any other skill mandates a heavier workflow (design doc, plan file, announcements), take its *check*, drop its *ceremony*.
2. **Every skill runs once and leaves one line in the ledger** (below), even if the honest result is "N/A — reason". Never skip silently, never fake a run.
3. **Read-only until the Phase 6 gate.** No edits to `croissant-quest.html`, no publish, no db writes. New files only inside the audit workspace.
4. **Never publish without reading the db first** (`ArtifactData get`, collection `save`, doc `state`), and pin every db write with `if_version`. The learner plays between sessions.
5. **Never request the `complex` model tier**, in code or in subagents you spawn for the game's runtime ("make sure it's Sonnet, not Opus"). The game uses `quick` (coach) and `default` (generation, near-miss explainer).
6. **French claims need a source.** Any finding that says the French is wrong cites a primary reference, not memory.
7. **Pronunciation is always three scripts** — English phonetic, Gujarati, Devanagari — and says when it is approximate.
8. **Status words:** every phase result and every table row is `SUCCESSFUL` or `FAILED`, literally.
9. **Subagents:** independent phases run in parallel background subagents; each gets one job, one output file, and is told which files it must not touch.

## The ledger

Create `D:\audit\croissant\decisions.tsv` with `/show-me-your-work` before Phase 1 and append one row per skill run: `ts · phase · skill · decision · why · evidence (file:line / script output) · result`. Evidence is a pointer, never prose.

---

## Phase 0 — Workspace and orientation

The source folder is not a git repo, and seven skills need one. Do not `git init` `D:\Claude` itself.

| Step | Skill | Does |
|---|---|---|
| 0.1 | `superpowers:using-superpowers` | Load the skill index. Record which skills are model-invocable vs slash-only. |
| 0.2 | `pstack:poteto-help` · `mattpocock-skills:ask-matt` · `caveman:caveman-help` · `ponytail:ponytail-help` | Print each family's map. Record any skill this prompt missed. |
| 0.3 | `superpowers:using-git-worktrees` | Copy `croissant-quest.html`, `french-a1-notes.md`, `graphify-out/` and the 12 scripts into `D:\audit\croissant\`, `git init`, commit the baseline, branch `audit`. All later work happens here. |
| 0.4 | `mattpocock-skills:setup-matt-pocock-skills` | Tracker = **local files** (`D:\audit\croissant\.scratch\`), no GitHub labels. This unlocks to-spec / to-tickets / triage / wayfinder. |
| 0.5 | `pstack:setup-pstack` | Record the current role→model mapping. **Do not raise any role to the `complex`/Opus tier for game-runtime work.** |
| 0.6 | `graphify` · `caveman:caveman-explore` | `graphify update` the copy, then `graphify god-nodes --top 15` and `graphify query "how does a round flow from tap to save" --budget 6000`. This is the map every later phase navigates by. |
| 0.7 | `pstack:recall` · `mattpocock-skills:handoff` | Recall prior decisions from memory; write a handoff file summarising project state so any subagent can start cold. |

## Phase 1 — Understand before judging

| Step | Skill | Does |
|---|---|---|
| 1.1 | `pstack:how` · `pstack:in-your-own-words` | Explain the architecture back in plain words from the graph. Any part you cannot explain is a finding. |
| 1.2 | `pstack:figure-it-out` · `pstack:why` | For the 10 god nodes: why does each exist, what breaks without it. |
| 1.3 | `mattpocock-skills:domain-modeling` · `mattpocock-skills:grill-with-docs` | Build `GLOSSARY.md` for the game's own vocabulary (tag, tier, crown, boss card, proof round, calibration, retired question, near-miss). Flag every place the code uses two names for one thing. |
| 1.4 | `mattpocock-skills:codebase-design` · `mattpocock-skills:improve-codebase-architecture` · `pstack:architect` | Map the seams: question bank / pronunciation / round engine / state+save / feel meter / Claude runtime. Name which seams are clean and which leak. |
| 1.5 | `pstack:principle-model-the-domain` · `pstack:principle-foundational-thinking` · `pstack:principle-boundary-discipline` | Judge 1.3–1.4 against these. One line each. |

## Phase 2 — Parallel audits (dispatch as background subagents)

Run with `superpowers:dispatching-parallel-agents` and `pstack:swarm`. Each lane writes `D:\audit\croissant\lanes\<lane>.md`. Lanes are read-only and touch no shared file.

| Lane | Skills | Hunts for |
|---|---|---|
| A · correctness | `superpowers:systematic-debugging` · `mattpocock-skills:diagnosing-bugs` · `caveman:investigate-first` · `pstack:blast-radius` · `caveman:cavecrew-investigator` (agent) | Every path that can blank the screen, lose saved progress, double-count, run a round short/long, or repeat a question past its cap. Proof = a failing script. |
| B · French + pronunciation | `mattpocock-skills:research` · `pstack:interrogate` · `pstack:correct` | All ~250 questions against the rule their tag claims, with primary-source citations. Every dictionary entry's three scripts. Every exception question carries its own rule (`q.why`). |
| C · tests | `mattpocock-skills:tdd` · `superpowers:test-driven-development` · `pstack:tdd` · `pstack:principle-test-behavior-not-implementation` · `pstack:create-verification-skill` | Which behaviour the 12 suites do not cover. Which suites test implementation detail instead of behaviour. Draft (do not install) a verification skill that runs all 12. |
| D · over-engineering | `ponytail:ponytail-audit` · `ponytail:ponytail-review` · `ponytail:ponytail-debt` · `simplify` · `pstack:principle-subtract-before-you-add` · `pstack:principle-laziness-protocol` · `pstack:comment-sicko` (agent) · `pstack:no-comments` · `pstack:unslop` | Dead code, single-caller layers, comments that restate code. **Keep** the `safely()` isolation units and the pronunciation fallback entries — record why if a tool flags them. |
| E · data + security + Claude runtime | `security-review` · `claude-api` · `artifact-capabilities` · `caveman:migration` · `pstack:principle-make-operations-idempotent` · `pstack:principle-separate-before-serializing-shared-state` | The db save race, model-output escaping (`aiRows`), innerHTML sinks, unbounded growth of `log`/`seen`/`wrong`. Every `SAMPLE` call: tier, `cache`, error path, no `complex`. The `seen` flag→count change as a data migration: is old saved state read correctly? |
| F · UI + a11y | `frontend-design:frontend-design` · `artifact-design` · `pstack:principle-experience-first` · `mattpocock-skills:prototype` | Contrast in both themes, 44px tap targets, 360px width, `prefers-reduced-motion`, keyboard reach. Prototype (throwaway HTML) only if a fix is genuinely unclear. |
| G · code review | `code-review` (built-in) · `mattpocock-skills:code-review` · `superpowers:requesting-code-review` · `caveman:caveman-review` · `caveman:cavecrew-reviewer` (agent) | Review the full diff from an empty file to the baseline commit (`git diff --root`). Standards axis + spec axis. |

## Phase 3 — Challenge the findings

| Step | Skill | Does |
|---|---|---|
| 3.1 | `superpowers:receiving-code-review` | Re-verify every lane finding before accepting it. Reject anything without evidence. |
| 3.2 | `pstack:arena` · `pstack:principle-attack-the-premise` · `pstack:principle-exhaust-the-design-space` | For the top 5 findings, argue the opposite fix. Keep whichever survives. |
| 3.3 | `pstack:principle-explain-the-number` · `pstack:benchmark-checklist` | Every number in the report (accuracy, counts, contrast ratios, bytes saved) shows how it was measured. |
| 3.4 | `pstack:principle-fix-root-causes` · `pstack:principle-prove-it-works` | Each fix names the root cause, not the symptom, and the check that proves it. |
| 3.5 | `mattpocock-skills:grilling` | Grill the ranked list: is anything here a symptom of a deeper finding already listed? Merge duplicates. |

## Phase 4 — Turn findings into work

| Step | Skill | Does |
|---|---|---|
| 4.1 | `superpowers:brainstorming` | **Size only**: classify each finding quick-fix / small change / project. No design document for quick fixes. |
| 4.2 | `mattpocock-skills:to-spec` | One spec for everything classed "project". |
| 4.3 | `mattpocock-skills:to-tickets` · `mattpocock-skills:wayfinder` | Tracer-bullet tickets with blocking edges into `.scratch/`. Wayfinder only if a finding is bigger than one session. |
| 4.4 | `superpowers:writing-plans` · `pstack:sharpen` · `pstack:principle-sequence-verifiable-units` | Order the tickets so each lands as one verifiable unit. |
| 4.5 | `mattpocock-skills:triage` | Triage the tickets once through the state machine. |
| 4.6 | `mattpocock-skills:to-questionnaire` | Any decision only I can make (content, difficulty, design taste) goes in a questionnaire, not a guess. |

## Phase 5 — Report

| Step | Skill | Does |
|---|---|---|
| 5.1 | `pstack:technical-writing` · `pstack:principle-minimize-reader-load` · `caveman:caveman` | Write `D:\audit\croissant\REPORT.md`: ranked findings, one line each, `SUCCESSFUL`/`FAILED` status, file:line, failure scenario, proof script, fix. |
| 5.2 | `artifact-design` · `artifact-diagramming` · `dataviz` | Publish the report as a **separate private artifact** (never overwrite the game). Findings by severity as a chart. |
| 5.3 | `mattpocock-skills:pr` | Write the change summary for the eventual fix branch, before/after evidence and blast radius. |
| 5.4 | `pstack:ketchup` · `pstack:reflect` | Catch up anything dropped across phases; reflect on which skills produced findings and which produced nothing. |

## Phase 6 — Gate: stop and ask me

Show me the fix list. **Nothing below runs until I say which items to apply.**

| Step | Skill | Does |
|---|---|---|
| 6.1 | `superpowers:executing-plans` or `superpowers:subagent-driven-development` · `mattpocock-skills:implement` | Apply the approved tickets on the `audit` branch, test-first (`mattpocock-skills:tdd`). Bug fixes via `caveman:surgical-patch`, structural moves via `caveman:safe-refactor`, edits delegated to `caveman:cavecrew-builder` (agent). |
| 6.2 | `superpowers:verification-before-completion` · `caveman:verify-and-stop` | All 12 suites plus any new ones print `SUCCESSFUL` before any claim of done. |
| 6.3 | `superpowers:finishing-a-development-branch` | Merge `audit` into the workspace baseline. Then copy the single file back to `D:\Claude\croissant-quest.html`. |
| 6.4 | — | Read the db, then publish the game to its existing URL. |
| 6.5 | `caveman:caveman-commit` | Commit message for the merge. |

## Phase 7 — Close out

| Step | Skill | Does |
|---|---|---|
| 7.1 | `mattpocock-skills:retro` · `caveman:caveman-compress` (the project memory file) · `pstack:automate-me` · `pstack:principle-build-the-lever` · `pstack:principle-encode-lessons-in-structure` | What should become a check, a hook or a memory so this class of bug cannot return. |
| 7.2 | `mattpocock-skills:writing-for-agents` · `superpowers:writing-skills` · `pstack:maintain-verification-skill` | Only if 7.1 says so: turn the 12 suites into one verification skill. Show me before installing. |
| 7.3 | `superpowers:diagnosing-superpowers` · `caveman:caveman-stats` · `ponytail:ponytail-gain` | Cost of this audit, and any skill that misfired. |
| 7.4 | `pstack:show-me-your-work` (close) | Self-audit the ledger against the transcript; supersede wrong rows; cross-model review. End with its `Attention` section. |

## Skills that apply to nothing here — run once, record N/A

Run each, confirm it has no target, log one row with the reason: `mattpocock-skills:wizard` (no human-only infra steps) · `mattpocock-skills:implement-spec` (covered by 6.1) · `mattpocock-skills:teach` · `pstack:teach` (teaching is the game's job, not the audit's) · `mattpocock-skills:wait-what` · `mattpocock-skills:grill-me` (stateless twin of 3.5) · `pstack:typescript-best-practices` · `pstack:principle-type-system-discipline` (no TypeScript) · `pstack:make-bot-ui` · `pstack:bro` · `pstack:poteto-mode` · `pstack:create-formal-verification-skill` · `pstack:maintain-formal-verification-skill` · `pstack:principle-migrate-callers-then-delete-legacy-apis` · `pstack:principle-never-block-on-the-human` · `pstack:principle-guard-the-context-window` · `pstack:principle-outcome-oriented-execution` · `pstack:principle-redesign-from-first-principles` · `caveman:lean-build` (no new feature in scope) · `caveman:caveman-init` (not a repo of IDE agents) · `caveman:cavecrew` (routing note, used implicitly by the agents above) · every `caveman:*` cloud skill (`caveman-setup`, `caveman-discover`, `caveman-evidence-review`, `caveman-manage`, `caveman-optimize`, `caveman-learn`) — no Caveman Cloud gateway configured.

**Deliberately excluded, not code-audit skills:** office/document skills (`docx`, `pdf`, `pptx`, `xlsx`, `docs`, `google-workspace`), unrelated projects (`mern-cicd-*`), browser/computer control, `morning`, `import-memory`, `skill-creator`, harness config (`update-config`, `keybindings-help`, `fewer-permission-prompts`, `plugin-authoring`, `loop`, `schedule`, `run`, `init`).

If any of these turns out to have a real target, move it into the phase where it belongs and say so.

## Deliverables

1. `D:\audit\croissant\REPORT.md` and its private artifact link.
2. `D:\audit\croissant\decisions.tsv` — one row per skill, nothing missing.
3. `D:\audit\croissant\.scratch\` — spec and tickets.
4. A one-screen summary in chat: top 10 findings, each `SUCCESSFUL`/`FAILED`, and the question "which of these do I apply?"
