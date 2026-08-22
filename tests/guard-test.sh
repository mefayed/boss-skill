#!/bin/sh
# Regression test for hooks/builder-guard.sh. Builds a hook payload for each
# case, feeds it to the guard on stdin, and checks the exit code.

dir=$(cd "$(dirname "$0")/.." && pwd)
guard="$dir/hooks/builder-guard.sh"

pass=0
fail=0

# A jq-less PATH sandbox, so the guard's jq-absent fallback branch (currently
# dead in CI since ubuntu-latest ships jq) gets exercised too. Only symlink
# what the guard needs: grep, cat, sh.
shim=$(mktemp -d) || { echo "SKIP: could not create shim dir for no-jq tests"; exit 1; }
trap 'rm -rf "$shim"' EXIT

link_bin() {
  # $1=name $2=preferred absolute path
  if [ -x "$2" ]; then
    ln -s "$2" "$shim/$1"
  else
    real=$(command -v "$1" 2>/dev/null)
    [ -n "$real" ] && ln -s "$real" "$shim/$1"
  fi
}
link_bin grep /usr/bin/grep
link_bin cat /bin/cat
link_bin sh /bin/sh

# Verify the shim actually works before trusting it: a dangling symlink
# makes grep unavailable, the guard fails open, and every no-jq case would
# then "pass" as ALLOWED without proving anything.
if ! printf 'x' | env -i PATH="$shim" sh -c 'grep -q x' >/dev/null 2>&1; then
  echo "SKIP: no-jq shim is unusable (grep not resolvable inside it) - cannot verify the jq-absent fallback path"
  exit 1
fi

# $1=label $2=expected exit $3=agent_type ("" omits the field) $4=command
# $5=extra "description" field ("" omits) $6=mode ("nojq" runs the guard
# through the jq-less shim; anything else runs it normally)
check() {
  label=$1
  expected=$2
  agent=$3
  cmd=$4
  desc=$5
  mode=$6
  if [ -z "$agent" ] && [ -z "$desc" ]; then
    payload=$(jq -n --arg cmd "$cmd" '{tool_input: {command: $cmd}}')
  elif [ -z "$agent" ]; then
    payload=$(jq -n --arg cmd "$cmd" --arg d "$desc" '{tool_input: {command: $cmd}, description: $d}')
  elif [ -z "$desc" ]; then
    payload=$(jq -n --arg at "$agent" --arg cmd "$cmd" '{agent_type: $at, tool_input: {command: $cmd}}')
  else
    payload=$(jq -n --arg at "$agent" --arg cmd "$cmd" --arg d "$desc" '{agent_type: $at, tool_input: {command: $cmd}, description: $d}')
  fi
  if [ "$mode" = nojq ]; then
    printf '%s' "$payload" | env -i PATH="$shim" sh "$guard" >/dev/null 2>&1
  else
    printf '%s' "$payload" | sh "$guard" >/dev/null 2>&1
  fi
  actual=$?
  if [ "$actual" = "$expected" ]; then
    echo "PASS: $label"
    pass=$((pass + 1))
  else
    echo "FAIL: $label (expected exit $expected, got $actual)"
    fail=$((fail + 1))
  fi
}

while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  check "block: $cmd" 2 boss:builder "$cmd"
done <<'EOF'
git push
git push --force origin main
git -c protocol.version=2 push
git -C /tmp/repo push
git commit -am wip
git commit
git checkout -f other
git checkout --force other
git reset --hard HEAD~1
git clean -fd
rm -rf /tmp/x
rm -fr /tmp/x
rm -r /tmp/x
sqlite3 app.db "DROP TABLE users"
psql -c "TRUNCATE TABLE sessions"
EOF

while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  check "allow: $cmd" 0 boss:builder "$cmd"
done <<'EOF'
git status
git diff --stat
git log --oneline -5
git checkout other-branch
git checkout my-feature-fix
git add -A
rm -f harmless.tmp
npm run build
ls -la
EOF

check "scope: no agent_type field, git push" 0 "" "git push"
check "scope: boss:advocate, rm -rf" 0 "boss:advocate" "rm -rf /tmp/x"
check "scope: fable-advisor, git push" 0 "fable-advisor" "git push"

# errand is guarded the same as builder — the guard scope was widened to
# builder-or-errand, not narrowed to builder-only.
check "errand: block: git push" 2 boss:errand "git push"
check "errand: block: rm -rf" 2 boss:errand "rm -rf /tmp/x"
check "errand: allow: git status" 0 boss:errand "git status"

# PINNED NEGATIVE CONTROL: the guard is deliberately NOT widened to every
# subagent — it's session-global, so widening would block commands from
# general-purpose subagents in unrelated non-boss workflows on this machine.
# This pins that decision so a future "just widen it" change fails loudly.
check "negative control: general-purpose stays unguarded" 0 general-purpose "rm -rf /tmp/x"

# jq-absent fallback path (currently untested elsewhere, since ubuntu-latest
# ships jq and every case above runs with it on PATH).
check "no-jq: block: git push" 2 boss:builder "git push" "" nojq
check "no-jq: allow: git status" 0 boss:builder "git status" "" nojq
check "no-jq: scope: boss:advocate, rm -rf" 0 boss:advocate "rm -rf /tmp/x" "" nojq
check "no-jq: errand: block: git push" 2 boss:errand "git push" "" nojq
# KNOWN, ACCEPTED false positive: without jq the guard falls back to
# matching the whole raw payload, so an unrelated "description" field
# mentioning "git commit" trips the guard even though the actual command
# (git add -A) is harmless. Pinned here so a change to that behavior fails
# loudly instead of silently.
check "no-jq: known false positive: description mentions git commit" 2 boss:builder "git add -A" "stage files before git commit" nojq

# Shell separators end a command, so they must bound a match (found by an
# outside review: every one of these slipped past an earlier revision).
while IFS= read -r c; do
  [ -z "$c" ] && continue
  check "block: $c" 2 boss:builder "$c"
done <<'EOF'
git push; printf done
cd x&&git push
git push&&printf done
(git push)
echo $(git push)
EOF

# Global git options sit between `git` and its subcommand — every protected
# subcommand must tolerate them, not just push.
while IFS= read -r c; do
  [ -z "$c" ] && continue
  check "block: $c" 2 boss:builder "$c"
done <<'EOF'
git -C /tmp/repo commit -m x
git -c user.name=x commit -m x
git -C /tmp/repo checkout -f main
git -C /tmp/repo reset --hard HEAD
git -C /tmp/repo clean -fd
EOF

# Must stay allowed: the destructive word belongs to another command, or the
# flag sits past a separator. Blocking these was a real false positive.
while IFS= read -r c; do
  [ -z "$c" ] && continue
  check "allow: $c" 0 boss:builder "$c"
done <<'EOF'
echo git status push
git checkout safe && echo -f
EOF

# Quoted / escaped option values: a path with spaces is ordinary, not
# obfuscation, and an absolute git path is too. All of these bypassed an
# earlier revision of the option grammar.
while IFS= read -r c; do
  [ -z "$c" ] && continue
  check "block: $c" 2 boss:builder "$c"
done <<'EOF'
git -C "/tmp/repo" push
git -C "/Users/f/work personal/boss-skill" push
git --git-dir "/tmp/x" push
git -c "user.name=x" commit -m x
git --git-dir="/tmp/x y" push
/usr/bin/git push
EOF

# Accepted over-block: once a global option appears, any following words may
# be its value, so a contrived `git --no-pager status push` trips the push
# rule. A surfaced block costs one OPEN note; the alternative (arity-aware
# shell parsing) is not what a tripwire is for.
check "accepted over-block: git --no-pager status push" 2 boss:builder "git --no-pager status push"

# Accepted ceilings, pinned so a future edit that changes them is deliberate:
# deliberate obfuscation and git aliases are out of scope for a tripwire.
check "ceiling: obfuscated git\${IFS}push stays allowed" 0 boss:builder 'git${IFS}push'
check "ceiling: git alias stays allowed" 0 boss:builder "git -c alias.p=push p"

# Parsed payloads must not fall back to whole-payload matching: an empty
# command is empty (not "unparseable"), and agent_type is the top-level
# field only — a nested one must not scope the guard.
raw_check() {
  printf '%s' "$2" | sh "$guard" >/dev/null 2>&1
  actual=$?
  if [ "$actual" = "$3" ]; then
    echo "PASS: $1"
    pass=$((pass + 1))
  else
    echo "FAIL: $1 (expected exit $3, got $actual)"
    fail=$((fail + 1))
  fi
}
raw_check "parsed: empty command + note mentioning git push -> allowed" \
  '{"agent_type":"boss:builder","tool_input":{"command":""},"note":"git push is prohibited"}' 0
raw_check "parsed: nested meta.agent_type does not scope the guard" \
  '{"agent_type":null,"meta":{"agent_type":"boss:builder"},"tool_input":{"command":"git push"}}' 0

if grep -q 'disallowedTools: Write, Edit, NotebookEdit, Agent' "$dir/agents/errand.md" 2>/dev/null; then
  echo "PASS: errand.md still carries its denial list"
  pass=$((pass + 1))
else
  echo "FAIL: errand.md denial list missing or changed"
  fail=$((fail + 1))
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
