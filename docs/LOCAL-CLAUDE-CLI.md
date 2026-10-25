# Coach with your Claude subscription (no API key)

`COACH_PROVIDER=claude-cli` makes the coach run the **Claude Code CLI you installed and signed in to**, in its
documented headless mode (`claude -p`). Claude Code handles the login, refreshes it, and applies your plan's
usage limits. The app never reads `~/.claude/.credentials.json`, never sees a token, and needs no
`ANTHROPIC_API_KEY`. The CLI runs on the machine that runs the API. Like the `anthropic` provider, it listens
on whatever `HOST` you set (all interfaces when unset) and answers any client that reaches it.

## How your subscription is used

1. The browser calls the Next.js server (port 3000). Next forwards `/v1/*` to the API (port 3001).
2. The API runs `claude auth status`, the CLI's own report of which login it would use. It reads only
   `loggedIn` and `authMethod`, and refuses to run unless `authMethod` is `claude.ai` (your Pro/Max login).
   An API key, `apiKeyHelper` or cloud provider in the CLI is refused, never used.
3. The API starts `claude -p --output-format json --model <coach.config.ts> --max-turns 1 --no-session-persistence
--strict-mcp-config --disable-slash-commands --setting-sources "" --system-prompt <short> --tools ""`.
   - It runs with no shell, in an empty temporary folder, and the prompt is sent on stdin.
   - The child's environment is an allow-list (`PATH`, `HOME`, locale, proxy, `CLAUDE_CONFIG_DIR`).
     `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN` and the
     provider switches are never passed.
4. The CLI answers with JSON. A failure becomes `login_required` (signed out or expired), `rate_limited` (your
   plan's limit) or `error`/`timeout`/`invalid`. The browser gets only that word; the CLI's text stays in the API.
   On a timeout or abort the API stops the CLI's process group (SIGTERM, then SIGKILL after 2 s).

## Setup on Ubuntu (once)

```bash
# Node 22 + pnpm (skip what you have)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo corepack enable

# Claude Code, then sign in with your Pro/Max claude.ai account (browser opens; type /login if asked, then /exit)
# Official install steps: https://code.claude.com/docs/en/setup
curl -fsSL https://claude.ai/install.sh | bash      # or: npm install -g @anthropic-ai/claude-code
claude
claude auth status        # must show "loggedIn": true and "authMethod": "claude.ai"

# Postgres 16 with a local role and database
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE ROLE cq LOGIN PASSWORD 'cq' CREATEDB;" -c "CREATE DATABASE cq_dev OWNER cq;"

# The app
git clone https://github.com/silly-cloud/croissant-quest.git && cd croissant-quest
git checkout claude/nest-next-rebuild
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env       # leave ANTHROPIC_API_KEY empty
pnpm --filter @cq/api db:migrate && pnpm --filter @cq/api db:seed
```

If `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is exported in your shell (`~/.bashrc`), remove it:
the API refuses to start with either set, and the smoke test checks for them.

## Every time

```bash
cd croissant-quest
pnpm dev:local        # API on :3001 (COACH_PROVIDER=claude-cli), web on :3000, all interfaces
```

`dev:local` sets `COACH_PROVIDER=claude-cli` and `WEB_ORIGIN` (default `http://127.0.0.1:3000`; export
`WEB_ORIGIN` to change it) itself, and they override `apps/api/.env`. Open the URL that equals `WEB_ORIGIN`
(e.g. **http://127.0.0.1:3000**, not `localhost`), so the browser's origin matches. The API terminal should say
`API listening on :3001 (coach local Claude Code CLI, claude.ai subscription)`.

## Smoke test (real, uses your subscription for one coach round)

With `pnpm dev:local` running, in a second terminal:

```bash
bash scripts/smoke-local-coach.sh
```

It checks there's no API key, then `claude auth status` (prints only `loggedIn`/`authMethod`). Then it asks
the app for one coach round and fails unless Claude wrote it (`fallback: false`). It ends with `ALL PASS`.

## Troubleshooting

| You see                                                                                  | Meaning                                                                     | Do                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "Claude Code is signed out on the computer running the app…", or `reason=login_required` | the CLI is not signed in, or its login expired                              | run `claude`, type `/login`; no restart needed                                                |
| "Your Claude plan's usage limit is reached…", or `reason=rate_limited`                   | your plan's own limit (e.g. the session or weekly limit)                    | wait; `claude` shows when it resets. The app does not retry                                   |
| API exits: `ANTHROPIC_API_KEY: must be unset…`                                           | a key is set in the shell or `apps/api/.env`                                | remove it; this provider never uses a key                                                     |
| API exits: `Claude Code CLI uses "api_key"…`                                             | the CLI itself is set to an API key, helper or provider                     | `claude auth logout`, then `claude` and `/login` with your claude.ai account                  |
| API exits: `Claude Code CLI not found`                                                   | `claude` is not on the API's PATH                                           | install it, or set `CLAUDE_CLI_PATH=/absolute/path/to/claude` in `apps/api/.env`              |
| `reason=timeout`                                                                         | no answer within the CLI deadline (`cliTimeoutMs`, 90 s, `coach.config.ts`) | send the API log lines `claude -p exit … in … ms, N output tokens` and `timed out after … ms` |
| `reason=error`                                                                           | anything else (the API terminal logs the category, never the CLI's text)    | send the API terminal lines                                                                   |

## Limits and what is not promised

- **Billing.** Calls count against your plan's usage limits, not an API bill. The `total_cost_usd` in the CLI's
  JSON is a client-side estimate, not a charge. If you turned on paid extra usage for your plan on claude.ai,
  usage beyond the limit may be charged there: check your claude.ai settings if you want a hard stop.
- **Speed.** Each coach call starts the CLI (about 1-3 s) before Claude writes the round.
- **The app's own limits** (ADR 0009) stay on: 10 coach calls per minute and 50 per day per device, and the
  global caps. They sit below your plan's limits, and the plan's own enforcement still applies.
