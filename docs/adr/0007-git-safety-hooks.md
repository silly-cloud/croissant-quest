# 0007 Git safety hooks (Claude Code guardrails, Husky)
Status: accepted.

## Claude Code guardrail
`.claude/settings.json` registers a PreToolUse hook on `Bash`: `.claude/hooks/block-dangerous-git.sh`. It exits 2 with a message telling the model to ask the user. Blocked:
force push (`--force`, `-f`, `--force-with-lease`, `+refspec`), `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout .`, `git restore .`.
Why: they destroy remote history or uncommitted work that cannot be recovered, and several agents share one repository.
Deliberately allowed: plain `git push` and `git push -u origin <branch>` (the orchestrator pushes with them), `reset --soft`, `branch -d`, `clean -n`.
Quoted strings are stripped before matching, so `git commit -m "reset --hard is dangerous"` passes. Test: `.claude/hooks/test-guardrails.sh` (needs `jq`).

## Husky
- `pre-commit`: `lint-staged` on staged files only (eslint --fix on ts/tsx/mjs, prettier --write on ts/tsx/json/md/css; `.prettierignore` skips `packages/content/data/`, `pnpm-lock.yaml`, `croissant-quest.html`, `tests-legacy/`), then `pnpm -r typecheck` only if a `.ts/.tsx` file is staged.
- `pre-push`: unit tests of `packages/*` only. No tests or e2e in pre-commit: they need Postgres.
- `prepare` runs `husky`, which prints a notice and exits 0 when there is no `.git` (Docker builds). `HUSKY=0 pnpm install` skips installing hooks.

## Bypass
- A blocked command: the owner runs it in their own terminal. The agent must not retry or rephrase it.
- One-off commit or push without hooks: `HUSKY=0 git commit ...` (or `--no-verify`).

## Limits
A hook is a guard rail, not a security boundary. It matches command text, so it can be evaded (variables, `eval`, `sh -c`, scripts that call git, aliases, other tools such as the GitHub API) and can rarely over-block. Husky hooks run client side and are skipped by `--no-verify`. Real protection is branch protection on the remote and CI.
