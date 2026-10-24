#!/bin/sh
# PreToolUse hook (matcher: Bash). Fails CLOSED: the real check is guard.mjs (Node, no jq);
# this wrapper only makes sure that a missing node, a missing guard.mjs or a crash blocks (exit 2)
# instead of becoming a non-blocking hook error. Uses shell builtins only, so it works with an empty PATH.
# See docs/adr/0008-guardrail-hook-v2.md. Tests: bash .claude/hooks/test-guardrails.sh
case "$0" in */*) DIR=${0%/*} ;; *) DIR=. ;; esac
GUARD="$DIR/guard.mjs"
fail() {
  echo "BLOCKED: guardrail could not check this command ($1); ask the user. They can run it themselves." >&2
  exit 2
}
command -v node >/dev/null 2>&1 || fail "node is not on PATH"
[ -r "$GUARD" ] || fail "$GUARD is missing"
node "$GUARD"
rc=$?
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 2 ] && exit 2
fail "guard.mjs exited with status $rc"
