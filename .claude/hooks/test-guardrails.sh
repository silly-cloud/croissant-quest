#!/bin/bash
# Usage: .claude/hooks/test-guardrails.sh   (needs jq)
HOOK="$(dirname "$0")/block-dangerous-git.sh"
fail=0
check() { # expected exit, command
  local payload rc
  payload=$(jq -n --arg c "$2" '{tool_name:"Bash",tool_input:{command:$c}}')
  printf '%s' "$payload" | "$HOOK" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "$1" ]; then echo "ok   [$1] $2"; else echo "FAIL [want $1, got $rc] $2"; fail=1; fi
}
for c in 'git push --force' 'git push -f origin x' 'git push origin +main' 'git push --force-with-lease' \
  'git reset --hard HEAD~1' 'git clean -fd' 'git branch -D x' 'git checkout .' 'git restore .' \
  'git status && git push origin main --force' 'git commit -m "x"; git reset --hard'; do check 2 "$c"; done
for c in 'git push -u origin claude/nest-next-rebuild' 'git push' 'git status' 'git log --oneline' \
  'git reset --soft HEAD~1' 'git commit -m "reset --hard is dangerous"' "git commit -m 'git push --force'" \
  'git branch -d merged' 'git checkout main' 'git clean -n' 'git push origin HEAD' 'git diff -- .'; do check 0 "$c"; done
exit $fail
