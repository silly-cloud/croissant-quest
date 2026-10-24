#!/usr/bin/env bash
# Real end-to-end check of COACH_PROVIDER=claude-cli on YOUR computer, with your own Claude Code login.
# No API key is used or needed. Start the app first in another terminal (`pnpm dev:local`), then run:
#   bash scripts/smoke-local-coach.sh
# It prints only PASS/FAIL lines, the auth method name and the questions Claude wrote. It never prints or
# reads your credentials; `claude auth status` is the CLI's own report, and only two fields are shown.
set -euo pipefail
cd "$(dirname "$0")/.."
WEB=${WEB:-http://127.0.0.1:3000}
API=${API:-http://127.0.0.1:3001}
fail() { echo "FAIL: $*"; exit 1; }
pass() { echo "PASS: $*"; }

# 1. nothing here can bill an API account
[ -z "${ANTHROPIC_API_KEY:-}" ] || fail "ANTHROPIC_API_KEY is set in this shell: unset it"
[ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] || fail "ANTHROPIC_AUTH_TOKEN is set in this shell: unset it"
if [ -f apps/api/.env ] && grep -Eq '^\s*ANTHROPIC_(API_KEY|AUTH_TOKEN)\s*=\s*\S' apps/api/.env; then
  fail "apps/api/.env sets ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN: empty it"
fi
pass "no API key or auth token in this shell or apps/api/.env"

# 2. the CLI is installed and signed in with a claude.ai subscription
command -v claude >/dev/null || fail "claude is not on PATH (see docs/LOCAL-CLAUDE-CLI.md)"
echo "claude: $(claude --version)"
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude auth status 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let j = {}; try { j = JSON.parse(s); } catch {}
    console.log(`auth: loggedIn=${j.loggedIn} authMethod=${j.authMethod}`);
    process.exit(j.loggedIn === true && j.authMethod === "claude.ai" ? 0 : 1);
  });' || fail "Claude Code must be signed in with your claude.ai account: run \`claude\`, type /login"
pass "Claude Code is signed in with a claude.ai subscription"

# 3. the app answers here, and only here
jar=$(mktemp)
trap 'rm -f "$jar"' EXIT
code=$(curl -sS -o /dev/null -w '%{http_code}' -c "$jar" "$WEB/v1/progress" || true)
[ "$code" = 200 ] || fail "GET $WEB/v1/progress gave '$code': is \`pnpm dev:local\` running?"
pass "web and API are up on 127.0.0.1; device cookie issued"

lan=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$lan" ]; then
  for port in 3000 3001; do
    if curl -sS --max-time 3 -o /dev/null "http://$lan:$port/" 2>/dev/null; then
      fail "port $port answers on the LAN address $lan: the app must listen on 127.0.0.1 only"
    fi
  done
  pass "ports 3000 and 3001 refuse connections on the LAN address $lan"
fi
code=$(curl -sS -o /dev/null -w '%{http_code}' -H 'host: attacker.example' "$API/v1/health" || true)
[ "$code" = 403 ] || fail "a forged Host header got '$code', expected 403"
pass "a request with a foreign Host header is refused (403)"

# 4. a real coach round: Claude must write it (no local-round fallback)
echo "asking Claude for 8 questions through the app (can take 10-25 s)..."
t0=$(date +%s)
body=$(curl -sS --max-time 40 -b "$jar" -H 'content-type: application/json' -H "origin: $WEB" \
  -X POST "$WEB/v1/coach/round" -d '{"n":8,"focus":["m","f","neg"]}' || true)
t1=$(date +%s)
printf '%s' "$body" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let j; try { j = JSON.parse(s); } catch { console.log("not JSON: " + s.slice(0, 200)); process.exit(1); }
    if (j.fallback !== false) { console.log("coach fell back, reason=" + j.reason); process.exit(1); }
    console.log(`Claude wrote ${j.questions.length} questions, for example:`);
    for (const q of j.questions.slice(0, 3)) console.log(`  ${q.s}   -> ${q.a}`);
  });' || fail "the coach did not return Claude's questions (see the API terminal and docs/LOCAL-CLAUDE-CLI.md#troubleshooting)"
pass "coach round written by Claude via your subscription in $((t1 - t0)) s, no fallback"
echo "ALL PASS"
