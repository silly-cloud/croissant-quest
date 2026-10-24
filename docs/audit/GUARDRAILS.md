# Guardrails: what exists, what gets through, what to add

Source: lane G-guardrails (main evidence), plus F-infra-ci, H-security and I-docs. Orchestrator-reproduced items are marked (O).

## 1. What exists
| Guardrail | Where | State |
|---|---|---|
| Claude Code PreToolUse hook | .claude/settings.json:1-15 -> .claude/hooks/block-dangerous-git.sh | **Live in sessions** (it blocked G's heredoc). It is the only registration (/root/.claude/settings.json does not exist). Its own suite test-guardrails.sh passes 23/23 but has no evasion rows. In worktree subagents, `$CLAUDE_PROJECT_DIR` may point at a worktree that has no .claude/hooks; then the hook gets rc 127 and fails open (UNVERIFIED) |
| Husky pre-commit | .husky/pre-commit (lint-staged + `pnpm -r typecheck` when .ts is staged) | **Not enabled**: `core.hooksPath` is unset. If enabled it never runs in worktrees (`.husky/_` is missing there) or on merges (no pre-merge-commit) |
| Husky pre-push | .husky/pre-push (unit tests of packages/* only) | Not enabled. An apps/api type error still pushes |
| lint-staged | .lintstagedrc.json | eslint + prettier --write. Its glob catches root `.mjs` files, for which there is no eslint config. It does not validate content JSON |
| CI | .github/workflows/ci.yml | install, lint, typecheck, test, api e2e, build, web e2e. The web steps pass with no project (O). No permissions block (O). No prettier check. Not a required check |
| AGENTS.md | AGENTS.md:1-11 | qid, French rules, model-id location, no secrets. Missing: no push/merge to main, no bypass, SEEN_CAP, ADR pointers. Not auto-loaded because there is no CLAUDE.md (O) |
| ADR 0007 | docs/adr/0007-git-safety-hooks.md | Says the listed set is "Blocked"; quoted and `-C` variants get through. Says "accepted" although Husky is off. No Limits section |
| GitHub protection | branch settings | main `protected:false` (classic). Rulesets UNVERIFIED |

## 2. Hook bypass table (40 of 120 attempts)
The full matrix is in scratch/G-guardrails/matrix.md. Each attempt was piped to the hook as PreToolUse JSON; no command was executed. B = blocked (rc 2), A = allowed (rc 0).

| # | Attempt | Expected | Actual |
|---|---|---|---|
| 1 | `git push --force` | B | B |
| 2 | `git push -f` | B | B |
| 7 | `git push origin main` (O) | B | **A** |
| 8 | `git push origin HEAD:main` | B | **A** |
| 11 | `git reset --hard` | B | B |
| 14 | `git clean -f` | B | B |
| 18 | `git branch -D x` | B | B |
| 20 | `git branch -df x` | B | **A** |
| 21 | `git checkout .` | B | B |
| 23 | `git checkout -f` | B | **A** |
| 28 | `git stash drop` | B | **A** |
| 29 | `git stash clear` | B | **A** |
| 32 | `git update-ref -d refs/heads/main` | B | **A** (policy gap; the reflog recovers it) |
| 34 | `rm -rf .git` | B | **A** |
| 38 | `git -c x=y push --force` | B | **A** |
| 39 | `git --git-dir=.git push -f` | B | B |
| 40 | `git -C /tmp/x push -f` (O, as `git -C . push -f`) | B | **A** |
| 41 | `git -C /tmp/x reset --hard` | B | **A** |
| 42 | `GIT_DIR=.git git push -f` | B | B |
| 44 | `\git push -f` | B | **A** |
| 45 | `/usr/bin/git push -f` | B | **A** |
| 48 | `sh -c "git push -f"` | B | **A** (cannot be caught by text matching) |
| 50 | `eval "git push -f"` | B | **A** (cannot be caught by text matching) |
| 53 | `git status; git push -f` | B | B |
| 57 | `git push "--force"` | B | **A** |
| 59 | `git push "-f"` (O; dry run shows `(forced update)`) | B | **A** |
| 60 | `git push -F` | B | A (git rejects it, harmless) |
| 62 | `git push --forc` | B | A (git: ambiguous option, harmless) |
| 70 | `git push --mirror` (O; dry run shows 3 remote branches `[deleted]`) | B | **A** |
| 71 | `git push --delete origin main` | B | **A** |
| 72 | `git push origin :main` | B | **A** |
| 73 | `git push --prune origin` | B | **A** |
| 74 | `gh api -X DELETE repos/o/r/git/refs/heads/main` | B | **A** |
| 77 | `git worktree remove --force x` | B | **A** |
| QP | `echo 'say "hi' && git push -f && echo '"'` (quote pairing) | B | **A** |
| 87 | `git push` | A | A |
| 92 | `git commit -m "reset --hard is dangerous"` | A | A |
| 93 | `git commit -m 'git push --force'` | A | A |
| 114 | `git push --dry-run --force` | A | **B** (wrong block) |
| 118 | heredoc whose body mentions `git push -f` | A | **B** (wrong block, also hit live) |

**Totals: 120 attempts, 64 as expected, 54 allowed that should have been blocked, 2 wrongly blocked.** Of the 54: 19 are real evasions of patterns ADR 0007 says it blocks, 29 are policy gaps the ADR does not cover, and 6 are not exploitable (git rejects them).

Fail-open cases outside the matrix, all rc 0: empty stdin (O), non-JSON (O), truncated JSON, `command` given as an array, jq missing from PATH. A missing hook script gives rc 127, which Claude Code treats as non-blocking.

Comparison: the skill's reference script scores 75 ok / 31 miss / 14 wrong blocks (more precise on obfuscation, but it blocks every push).

## 3. Gaps
1. Nothing stops a push to main at the remote: no protection, no required check (AUD-04).
2. The hook fails open on every error path (AUD-05).
3. Quoted flags, `-C`/`-c` with an argument, path-prefixed git, `-df`, `--mirror`, `--prune` and `--delete` all evade it (AUD-05, AUD-14).
4. Commands that discard work with no reflog are not covered: stash drop/clear, checkout -f, switch -f/--discard-changes, worktree remove --force, rm -rf .git (AUD-14).
5. Agents never see the rules: no CLAUDE.md, and AGENTS.md has no "no push/merge" or "no bypass" lines (AUD-15).
6. CI is green with nothing run for web (AUD-06), has no format check (AUD-58), and no permissions block (AUD-13).
7. Husky gives no protection to worktree agents or merges. `prepare: husky` breaks prod installs (AUD-29, AUD-59).
8. Wrong blocks (heredoc, `--dry-run --force`) stop agents mid-task, because the message says "do not retry" (AUD-60).
9. `sh -c`, `eval`, xargs and script files cannot be caught by text matching. Only remote protection covers them.

## 4. Minimal recommended set (smallest first)
1. **Ruleset on `main`** (owner, about 2 min): require a PR and the `check` status, block force push and deletion. This makes every hook bypass harmless to main.
2. **Hook fails closed** (2 lines): `command -v jq >/dev/null || exit 2`; exit 2 if the JSON does not parse.
3. **CLAUDE.md = `@AGENTS.md`**, plus 3 AGENTS.md bullets: no push to main and no PR, merge or publish without the owner's yes; never bypass a hook (`--no-verify`, `HUSKY=0`, rephrasing a blocked command); SEEN_CAP and qid are frozen without a migration; pointer to docs/adr.
4. **`--fail-if-no-match`** on the two web CI lines; `permissions: contents: read`.
5. **`"prepare": "husky || true"`**.
6. **Hook regex fixes** for the cheap evasions: strip quote characters, `-C/-c <arg>`, `\git` and `/path/git`, `-df`, `--mirror/--delete/:ref/--prune`, a push whose destination is main, plus the no-reflog list in section 3.4. Allow `--dry-run` and skip heredoc bodies. Add these rows to test-guardrails.sh as expected results. Stop there; `sh -c`/`eval` are covered by item 1.
7. **One Prettier commit + `prettier --check .` in CI**; narrow the lint-staged eslint glob; add the content test for `packages/content/data/*.json`.
8. **dependabot.yml** (npm + github-actions) and SHA-pinned actions.
Not needed: blocking rebase or update-ref (the reflog recovers them), or more Husky stages (they never run for worktree agents).

## 5. GitHub settings checklist (owner)
| Item | Current state |
|---|---|
| `main` protected (classic) | **false** (`list_branches`: main, audit-fixes, claude/nest-next-rebuild, claude/gallant-rubin-3c19iz all false) |
| Ruleset on main | UNVERIFIED (MCP shows only the `protected` flag; gh token invalid) |
| Required status check `check` | off (no protection, so it cannot be required) |
| Block force push / deletion on main | off (follows from the above) |
| Require PR review / CODEOWNERS | off: no CODEOWNERS file in /, .github or docs |
| Signed commits required | UNVERIFIED |
| Secret scanning + push protection | UNVERIFIED (gh token invalid) |
| Dependabot alerts | UNVERIFIED; no dependabot.yml or renovate.json in the repo |
| Actions default GITHUB_TOKEN permissions | UNVERIFIED (`gh api …/actions/permissions/workflow` -> 403 from proxy); ci.yml declares none (O) |
| Allowed merge types / auto-delete branches | UNVERIFIED |
| CI has ever run on GitHub | UNVERIFIED (RUNBOOK says not yet) |
| PR #3 | open, not draft (I-docs, `gh api …/pulls/3`) |
