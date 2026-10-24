#!/bin/bash
# PreToolUse hook (matcher: Bash). Blocks destructive git commands. See docs/adr/0007-git-safety-hooks.md.
# Plain `git push` and `git push -u origin <branch>` are allowed on purpose.
# A guard rail, not a security boundary: it inspects the command text only.

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$COMMAND" ] && exit 0

# Drop quoted strings (commit messages etc.) so words inside them do not trigger, then split into simple commands.
SEGMENTS=$(printf '%s' "$COMMAND" | tr '\n' ' ' | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g" \
  | sed -E 's/(&&|\|\||[;|&(){}`])/\n/g')

G='(^|[[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*'
S='[[:space:]]'

block() {
  echo "BLOCKED: '$COMMAND' is a destructive git command ($1). You do not have authority to run it. Do NOT retry or work around it: ask the user, who can run it themselves if they really want it." >&2
  exit 2
}

while IFS= read -r seg; do
  if echo "$seg" | grep -qE "${G}push($S|\$)"; then
    echo "$seg" | grep -qE "$S(--force[^[:space:]]*|-[a-zA-Z]*f[a-zA-Z]*)($S|\$)" && block "force push"
    echo "$seg" | grep -qE "$S\+[^[:space:]]" && block "force push via +refspec"
  fi
  echo "$seg" | grep -qE "${G}reset$S.*--hard" && block "git reset --hard"
  if echo "$seg" | grep -qE "${G}clean($S|\$)"; then
    echo "$seg" | grep -qE "$S(--force|-[a-zA-Z]*f[a-zA-Z]*)($S|\$)" && block "git clean -f"
  fi
  echo "$seg" | grep -qE "${G}branch$S.*(-[a-zA-Z]*D[a-zA-Z]*|--delete$S+--force|--force$S+--delete)($S|\$)" && block "git branch -D"
  echo "$seg" | grep -qE "${G}checkout($S+--)?$S+\.($S|\$)" && block "git checkout ."
  echo "$seg" | grep -qE "${G}restore($S.*)?$S\.($S|\$)" && block "git restore ."
done <<< "$SEGMENTS"

exit 0
