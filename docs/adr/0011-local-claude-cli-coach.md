# ADR 0011: Local coach through the Claude Code CLI (`COACH_PROVIDER=claude-cli`)

Status: accepted, 2026-10-24.

## Context

The owner wants the coach on their own Ubuntu computer, using their existing Claude subscription login and its
usage limits, without an Anthropic API key or API billing. The Anthropic SDK needs an API key.
Reading or converting `~/.claude/.credentials.json` is out (owner rule).

## Decision

A second `CoachClient`, `ClaudeCliCoachClient` (`apps/api/src/modules/coach/coach.cli-client.ts`), runs the
installed, unmodified CLI in its documented headless mode (`claude -p --output-format json`). It is selected
only by `COACH_PROVIDER=claude-cli`. There is no automatic switch between providers, and the Anthropic
provider is unchanged.

- **Auth stays the CLI's.** Before a call (cached 5 min) the client runs `claude auth status` and reads only
  `loggedIn` and `authMethod`. It refuses anything but `claude.ai`, so an API key, helper or provider in the
  CLI is never used.
- **Isolation.** There is no shell. The prompt goes on stdin. The child runs in an empty temporary folder with
  an allow-listed environment. `--tools ""`, `--max-turns 1`, `--no-session-persistence`,
  `--strict-mcp-config`, `--disable-slash-commands` and `--setting-sources ""` are set, plus a short
  `--system-prompt`. stdout is capped at 1 MB. Abort or timeout kills the process group (SIGTERM, then SIGKILL
  after 2 s), and shutdown kills any run still going.
- **Errors.** Errors become `login_required`, `rate_limited`, `invalid` or `error` (`CoachClientError`), and
  the browser gets only the word. The first three are never retried. `error` is retried only for no-response
  or 5xx results, inside the existing deadline. No reset time is invented; the plan enforces its own window.
- **Local only.** `env.ts` refuses this provider when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set,
  `HOST` isn't 127.0.0.1 or ::1, `WEB_ORIGIN` isn't localhost or 127.0.0.1, or `TRUST_PROXY_HOPS` isn't 0.
  `HOST` defaults to 127.0.0.1. `localOnly` (in `setup-app.ts`) answers 403 unless the peer is loopback and
  `Host`/`X-Forwarded-Host`/`X-Forwarded-For` name this machine, which also stops DNS rebinding.
  `pnpm dev:local` binds Next.js to 127.0.0.1.
- **Contract.** `CoachFallbackReason` gains `login_required` and `rate_limited`, and the web shows a note for
  each.

## Consequences

- Each call starts the CLI (1-3 s). A real 8-question round timed out at the API's 25 s, so the CLI has its own
  deadline (`cliTimeoutMs`, 90 s) and the web waits 100 s. Each run logs duration and token counts, never text.
- The flags were checked against `claude --help` on v2.1.310. If a future CLI renames one, the run exits
  with a non-JSON error and the coach answers `error`. Nothing falls back to another provider.
- Tests: `apps/api/test/unit/coach.cli-client.test.ts` (a fake CLI per scenario) and
  `apps/api/test/unit/local-only.test.ts` (env refusals, the guard, and real sockets over the LAN address).
  The real-subscription check is `scripts/smoke-local-coach.sh`, run on the owner's machine.
