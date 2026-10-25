#!/bin/bash
# Usage: bash .claude/hooks/test-guardrails.sh   (needs bash and node; no jq)
# Pipes PreToolUse JSON into the real hook entry point and checks the exit code. No command is ever executed.
# Expect 2 = blocked, 0 = allowed. See docs/adr/0008-guardrail-hook-v2.md.
DIR=$(cd "$(dirname "$0")" && pwd)
HOOK="$DIR/block-dangerous-git.sh"
ROOT=/home/user/croissant-quest   # fake project root / cwd sent in the payload
export CLAUDE_PROJECT_DIR="$ROOT"
total=0 fails=0 bok=0 aok=0
NL=$'\n'

json_str() { local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/\\r}; printf '"%s"' "$s"; }
payload() { printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":%s}}' "$ROOT" "$(json_str "$1")"; }
show() { local s=${1//$'\n'/\\n}; printf '%s' "$s"; }

result() { # want got label
  total=$((total + 1))
  if [ "$1" = "$2" ]; then
    [ "$1" = 2 ] && bok=$((bok + 1)) || aok=$((aok + 1))
    echo "ok   [$1] $3"
  else
    echo "FAIL [want $1, got $2] $3"; fails=$((fails + 1))
  fi
}
check() { local rc; payload "$2" | "$HOOK" >/dev/null 2>&1; rc=$?; result "$1" "$rc" "$(show "$2")"; }
raw() { local rc; printf '%s' "$2" | "$3" >/dev/null 2>&1; rc=$?; result "$1" "$rc" "fail-closed: $4"; }

echo "== BLOCK (policy) =="
BLOCK=(
  'git push --force' 'git push -f origin x' 'git push origin +main' 'git push --force-with-lease'
  'git reset --hard HEAD~1' 'git clean -fd' 'git branch -D x' 'git checkout .' 'git restore .'
  'git status && git push origin main --force' 'git commit -m "x"; git reset --hard'
  'git push -f' 'git push --force-with-lease=main:abc123' 'git push --force-if-includes' 'git push -uf origin x'
  'git push -fu origin claude/x' 'git push origin +refs/heads/claude/x' 'git push --mirror' 'git push --prune origin'
  'git push --delete origin claude/x' 'git push -d origin claude/x' 'git push origin :claude/x' 'git push origin :'
  'git push origin main' 'git push origin HEAD:main' 'git push origin x:refs/heads/main' 'git push origin HEAD:refs/heads/main'
  'git push origin master' 'git push origin claude/x:main' 'git push origin refs/heads/*:refs/heads/*' 'git push --all origin'
  'git push --no-verify' 'git push --no-verify origin claude/x'
  'git reset --hard' 'git reset --merge' 'git reset --keep HEAD~1'
  'git clean -f' 'git clean -fdx' 'git clean -ffd' 'git clean --force -d' 'git clean -d -f' 'git clean -xdf'
  'git branch -df x' 'git branch -fd x' 'git branch --delete --force x' 'git branch -d -f x' 'git branch --force --delete x'
  'git checkout -- .' 'git checkout -f' 'git checkout -f main' 'git checkout HEAD -- .' 'git checkout --force main'
  'git switch -f main' 'git switch --discard-changes main'
  'git restore --staged --worktree .' 'git restore --staged .' 'git restore -- .' 'git restore -s HEAD~1 .'
  'git stash drop' 'git stash drop stash@{0}' 'git stash clear'
  'git tag -d v1' 'git tag --delete v1' 'git update-ref -d refs/heads/main'
  'git filter-branch --tree-filter x HEAD' 'git filter-repo --path x' 'git rebase main' 'git rebase -i HEAD~3'
  'rm -rf .git' 'rm -rf ./.git' 'rm -fr .git/' 'rm -rf /home/user/croissant-quest/.git' 'rm -rf apps/web/.git'
  'rm -rf /' 'rm -rf /*' 'rm -rf ~' 'rm -rf ~/' 'rm -rf "$HOME"' 'rm -rf $HOME' 'rm -rf ${HOME}/'
  'rm -rf .' 'rm -rf ..' 'rm -rf *' 'rm -rf ./*' 'rm -r -f .git' 'rm -R --force .' 'rm --recursive --force /'
  'rm -rf /home/user/croissant-quest' 'rm -rf /home/user' 'rm -rf -- .git' 'rm -r .git'
  'find . -delete' 'find / -name x -delete' 'find -delete' 'find . -name "*.tmp" -delete'
  'git config alias.p "push --force"' "git config --global alias.nuke 'reset --hard'" "git config alias.x '!git push -f'"
  'git config core.hooksPath /dev/null' 'git config --global core.hooksPath /dev/null' 'git config --unset core.hooksPath'
  'git config set core.hooksPath x' 'git -c core.hooksPath=/dev/null commit -m x' 'git -c alias.p="push -f" p'
  'git commit --no-verify -m x' 'git commit -n -m x' 'git commit -nm x' 'git commit -am x --no-verify'
  'git merge --no-verify x' 'HUSKY=0 git commit -m x' 'HUSKY=0 git push' 'env HUSKY=0 git commit -m x'
)
for c in "${BLOCK[@]}"; do check 2 "$c"; done

echo "== BYPASS (audit evasions; all must block) =="
BYPASS=(
  'git push "-f"' "git push '-f'" 'git push "--force"' 'git push origin "+main"' "git push origin 'HEAD:main'" 'git push origin \main'
  'git push --forc' 'git push --for' 'git push --force-w' 'git push --f' 'git push -F' 'git push --FORCE' 'git push -o ci.skip -f'
  'git -c x=y push --force' 'git -C /tmp/x push -f' 'git -C /tmp/x reset --hard' 'git --git-dir=.git push -f'
  'git --no-pager push -f' 'git --work-tree /tmp push -f' 'git -C dir -c a=b --no-pager reset --hard' 'git --exec-path=/x push -f'
  'GIT_DIR=.git git push -f' 'FOO=1 BAR="a b" git push -f' '\git push -f' '/usr/bin/git push -f' '"git" push -f' 'g""it push -f'
  'command git push -f' 'command -p git reset --hard' 'builtin git push -f' 'env git push -f' 'env -i PATH=/usr/bin git push -f'
  "env -S 'git push -f'" 'exec git push -f' 'nohup git push -f' 'sudo git push -f' 'sudo -u root git reset --hard'
  'time git push -f' 'nice -n 5 git push -f' 'timeout 10 git push -f' 'pnpm exec git push -f'
  'xargs git push -f' 'echo -f | xargs git push' 'echo x | xargs -n1 git branch -D' 'echo push -f | xargs git'
  'sh -c "git push -f"' "bash -c 'git reset --hard'" "bash -lc 'git push --force'" 'bash -ec "git status; git push -f"'
  "zsh -c 'git clean -fd'" "sh -c 'sh -c \"git push -f\"'" 'eval "git push -f"' 'eval git push -f'
  'bash <<< "git push -f"' "bash <<EOF${NL}git push -f${NL}EOF" 'echo "git push -f" | bash' "cat <<EOF${NL}\$(git push -f)${NL}EOF"
  'echo $(git push -f)' 'echo "$(git push -f)"' 'echo `git push -f`' 'x=$(git reset --hard)' 'cat <(git push -f)'
  'git status; git push -f' 'git status && git push -f' 'false || git push -f' 'echo x | git push -f' 'git status & git push -f'
  "git status${NL}git push -f" "git status \\${NL}&& git push -f" '{ git push -f; }' '(git push -f)'
  'if true; then git push -f; fi' 'for i in 1; do git reset --hard; done' "echo 'say \"hi' && git push -f && echo '\"'"
  "git commit -m 'a \"b' && git push -f" 'git push --dry-run --force' 'git commit -m "fix" && git push -f'
  'git push -u origin claude/x --force' 'git push origin main --force' 'git config alias.p "push --force"; git p'
)
for c in "${BYPASS[@]}"; do check 2 "$c"; done

echo "== ALLOW =="
ALLOW=(
  'git push -u origin claude/nest-next-rebuild' 'git push' 'git status' 'git log --oneline'
  'git reset --soft HEAD~1' 'git commit -m "reset --hard is dangerous"' "git commit -m 'git push --force'"
  'git branch -d merged' 'git checkout main' 'git clean -n' 'git push origin HEAD' 'git diff -- .'
  'git push origin claude/foo' 'git push -u origin HEAD' 'git push origin claude/foo:claude/foo' 'git push --follow-tags'
  'git push --tags' 'git push -n' 'git push origin feature-f' 'git push origin fix-f-flag' 'git push -o ci.skip origin claude/x'
  'git reset HEAD file' 'git reset' 'git reset --mixed HEAD~1' 'git commit -m "x" -m "git clean -fdx"'
  'git commit -m "--no-verify is banned"' 'git commit -F msg.txt' 'git commit --amend --no-edit' 'git commit -am "fix -n"'
  'git commit --amend -m x' 'git checkout -b x' 'git checkout -b feat' 'git checkout -- src/a.ts' 'git checkout main -- src/a.ts'
  'git clean -nd' 'git stash push -u -m tag' 'git stash list' 'git stash' 'git stash apply 0123abc' 'git stash pop'
  'git tag v1' 'git tag -a v1 -m "delete -d"' 'git merge --no-ff x' 'git merge --no-ff -m "Merge x" x' 'git branch -a' 'git branch x'
  'git fetch --force origin' 'git -C /tmp/x status' 'git log --format=%H -n1' 'git log --all -- .' 'git restore src/a.ts'
  'git restore --staged src/a.ts' 'git add .' 'git config user.name x' 'git config --get core.hooksPath' 'git config core.hooksPath'
  'git config alias.st status' 'git config alias.lg "log --oneline"' 'git rebase --abort' 'git help push' 'command -v git'
  'rm -rf node_modules' 'rm -rf /tmp/claude-0/x' 'rm -rf apps/web/.next' 'rm -rf dist build' 'rm -f file.txt' 'rm -rf ~/.cache/foo'
  'find . -name "*.log"' 'find /tmp/claude-0/x -delete' 'pnpm install' 'HUSKY=0 pnpm install' 'pnpm test'
  'echo "git push --force"' "printf 'git reset --hard\\n'" 'echo "use git reset --hard carefully"' 'grep -rn "git push -f" docs'
  "cat <<X > notes.txt${NL}git push -f is banned${NL}X" "cat <<'X'${NL}\$(git push -f)${NL}X" 'bash .claude/hooks/test-guardrails.sh'
  "bash -c 'git status'" 'sh -c "pnpm test"' "git commit -m \"it's fine\" && git status" 'echo x | xargs git add' ''
  'git status # git push -f' 'git log --grep="reset --hard"'
)
for c in "${ALLOW[@]}"; do check 0 "$c"; done

echo "== FAIL CLOSED =="
raw 2 '' "$HOOK" 'empty stdin'
raw 2 'not json' "$HOOK" 'not JSON'
raw 2 '{"tool_input":{"command":"git st' "$HOOK" 'truncated JSON'
raw 2 '{"tool_input":{"command":["git","push","-f"]}}' "$HOOK" 'command is an array'
raw 2 '{"tool_name":"Bash"}' "$HOOK" 'no tool_input'
raw 2 '{"tool_input":{}}' "$HOOK" 'no tool_input.command'
raw 2 'null' "$HOOK" 'JSON null'
deep=''; for _ in $(seq 40); do deep="$deep\$("; done; deep="${deep}true"; for _ in $(seq 40); do deep="$deep)"; done
check 2 "$deep"
TMP=$(mktemp -d)
rc=0; payload 'git status' | env -i PATH=/nonexistent "$HOOK" >/dev/null 2>&1 || rc=$?; result 2 "$rc" 'fail-closed: PATH without node or jq'
cp "$HOOK" "$TMP/block-dangerous-git.sh"
rc=0; payload 'git status' | "$TMP/block-dangerous-git.sh" >/dev/null 2>&1 || rc=$?; result 2 "$rc" 'fail-closed: guard.mjs missing'
echo 'throw new Error("boom")' > "$TMP/guard.mjs"
rc=0; payload 'git status' | "$TMP/block-dangerous-git.sh" >/dev/null 2>&1 || rc=$?; result 2 "$rc" 'fail-closed: guard.mjs crashes'
rm -rf "$TMP"

echo "== MESSAGE =="
msg=$(payload 'git push -f' | "$HOOK" 2>&1 >/dev/null)
case "$msg" in *"force push"*"ask the user; they can run it themselves"*) result 2 2 'message names the operation and says ask the user';;
  *) result 2 0 "message: $msg";; esac
msg=$(printf 'nope' | "$HOOK" 2>&1 >/dev/null)
case "$msg" in *"guardrail could not check this command"*"ask the user"*) result 2 2 'fail-closed message';; *) result 2 0 "fail-closed message: $msg";; esac

echo "== PERFORMANCE =="
big=''; for _ in $(seq 5000); do big="${big}git status; "; done
for tail in 'git log' 'git push -f'; do
  want=0; [ "$tail" = 'git push -f' ] && want=2
  start=$(date +%s%N); payload "$big$tail" | "$HOOK" >/dev/null 2>&1; rc=$?; ms=$(( ($(date +%s%N) - start) / 1000000 ))
  [ "$ms" -lt 2000 ] || rc="slow:${ms}ms"
  result "$want" "$rc" "5000 segments + '$tail' in ${ms} ms (< 2000)"
done

echo "SUMMARY total=$total blocked_ok=$bok allowed_ok=$aok failures=$fails"
[ "$fails" = 0 ]
