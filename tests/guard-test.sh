#!/bin/sh
# Regression test for the boss plugin shape. Checks hooks/hooks.json (the guard
# is a prompt hook: parses, prompt handlers only, one shared prompt that names
# every dispatchable lane) and the agent files (identical builder bodies, no
# ignored keys, closed advisory tools lists). The inspector is the second lane
# deliberately not named in the hook, and its tools list is closed. It cannot
# test the model's allow/block judgment itself; that was live-tested by hand.

dir=$(cd "$(dirname "$0")/.." && pwd)
hooks="$dir/hooks/hooks.json"

pass=0
fail=0

tmp=$(mktemp -d) || { echo "SKIP: could not create temp dir"; exit 1; }
trap 'rm -rf "$tmp"' EXIT

if grep -q 'disallowedTools: Write, Edit, NotebookEdit, Agent' "$dir/agents/errand.md" 2>/dev/null; then
  echo "PASS: errand.md still carries its denial list"
  pass=$((pass + 1))
else
  echo "FAIL: errand.md denial list missing or changed"
  fail=$((fail + 1))
fi

# builder.md and builder-deep.md must stay byte-identical below the frontmatter:
# the deep variant differs only by name, description and `effort: high`. Nothing
# else enforces that, and a contract edit applied to one file and not the other
# would silently split the lane pairs.
strip_frontmatter() {
  awk 'BEGIN { n = 0 } /^---$/ { n++; next } n >= 2' "$1"
}
if [ -f "$dir/agents/builder.md" ] && [ -f "$dir/agents/builder-deep.md" ] &&
   strip_frontmatter "$dir/agents/builder.md" > "$tmp/builder.body" &&
   strip_frontmatter "$dir/agents/builder-deep.md" > "$tmp/builder-deep.body" &&
   [ -s "$tmp/builder.body" ] &&
   cmp -s "$tmp/builder.body" "$tmp/builder-deep.body"; then
  echo "PASS: builder.md and builder-deep.md bodies are identical"
  pass=$((pass + 1))
else
  echo "FAIL: builder.md and builder-deep.md bodies diverged"
  fail=$((fail + 1))
fi

# The plugin agent loader silently drops permissionMode, hooks and mcpServers from
# plugin agent files (it warns and continues). A lane that declares one of them reads
# as configured while behaving as if it were not, so keep them out of the repo.
if grep -lE '^(permissionMode|hooks|mcpServers):' "$dir"/agents/*.md >/dev/null 2>&1; then
  echo "FAIL: an agent file declares a key ignored for plugin agents (permissionMode/hooks/mcpServers)"
  fail=$((fail + 1))
else
  echo "PASS: no agent file declares a key the plugin loader ignores"
  pass=$((pass + 1))
fi

# The advisory lanes enumerate a closed `tools:` list on purpose. It must carry the
# research tools (the judge can search; an advocate that cannot is why this changed),
# and must never carry a write or dispatch tool, nor be replaced by `disallowedTools:`,
# which would silently hand the lane every writable MCP server in the session.
for adv in advocate fable-advisor; do
  f="$dir/agents/$adv.md"
  # normalise: strip the key, YAML brackets and quotes, so `tools: [A, B]` and
  # `tools: A, B` are checked identically — a bracketed list slipped past this once.
  line=$(grep '^tools:' "$f" 2>/dev/null | sed 's/^tools://; s/[]["'"'"']/ /g')
  if [ -z "$line" ]; then
    echo "FAIL: $adv.md must enumerate a closed tools: list, not inherit"
    fail=$((fail + 1))
  elif ! printf '%s' "$line" | grep -q 'WebSearch' || ! printf '%s' "$line" | grep -q 'WebFetch'; then
    echo "FAIL: $adv.md cannot research — tools: is missing WebSearch/WebFetch"
    fail=$((fail + 1))
  elif printf '%s' "$line" | grep -Eq '(^|[ ,])(Write|Edit|NotebookEdit|Agent)([ ,]|$)'; then
    echo "FAIL: $adv.md tools: grants a write or dispatch tool"
    fail=$((fail + 1))
  elif printf '%s' "$line" | grep -Eq 'mcp__|ToolSearch'; then
    echo "FAIL: $adv.md tools: reaches an MCP server — the thing a closed list exists to withhold"
    fail=$((fail + 1))
  else
    echo "PASS: $adv.md keeps a closed, research-capable, write-free tools: list"
    pass=$((pass + 1))
  fi
done

# The inspector's tools list is closed too, and its model is pinned to sonnet or
# opus (never haiku, never inherited). Same normalising as the loop above.
f="$dir/agents/inspector.md"
line=$(grep '^tools:' "$f" 2>/dev/null | sed 's/^tools://; s/[]["'"'"']/ /g')
if [ -z "$line" ] || ! printf '%s' "$line" | grep -q 'Bash' || ! printf '%s' "$line" | grep -q 'Read'; then
  echo "FAIL: inspector.md must enumerate a closed tools: list with Bash and Read"
  fail=$((fail + 1))
elif printf '%s' "$line" | grep -Eq '(^|[ ,])(Write|Edit|NotebookEdit|Agent|Skill)([ ,]|$)|mcp__|ToolSearch'; then
  echo "FAIL: inspector.md tools: grants a write, dispatch, Skill or MCP tool"
  fail=$((fail + 1))
elif grep -q '^disallowedTools:' "$f"; then
  echo "FAIL: inspector.md uses disallowedTools: instead of a closed list"
  fail=$((fail + 1))
elif ! grep -Eq '^model: (sonnet|opus)$' "$f"; then
  echo "FAIL: inspector.md model must be sonnet or opus"
  fail=$((fail + 1))
else
  echo "PASS: inspector.md keeps a closed, write-free tools: list and a sonnet/opus model"
  pass=$((pass + 1))
fi

# No hook guards the inspector, so its rule text is the only guard: pin it.
if grep -qF 'Never commit, push, reset' "$dir/agents/inspector.md" 2>/dev/null; then
  echo "PASS: inspector.md carries its no-commit/push/reset rule"
  pass=$((pass + 1))
else
  echo "FAIL: inspector.md rule 'Never commit, push, reset' missing"
  fail=$((fail + 1))
fi

# Every file SKILL.md lists as on-demand must exist.
if python3 -c "
import re, os, sys
d = sys.argv[1]
fs = re.findall(r'^- \`([\w-]+\.md)\` —', open(d + '/skills/boss/SKILL.md').read(), re.M)
assert fs
for f in fs:
    assert os.path.isfile(d + '/skills/boss/' + f), f
" "$dir" >/dev/null 2>&1; then
  echo "PASS: every on-demand file named in SKILL.md exists"
  pass=$((pass + 1))
else
  echo "FAIL: an on-demand file named in SKILL.md is missing"
  fail=$((fail + 1))
fi

# Every agent and skill markdown file carries the SPDX header.
if [ -z "$(grep -L 'SPDX-License-Identifier: MIT' "$dir"/agents/*.md "$dir"/skills/*/*.md)" ]; then
  echo "PASS: every agent and skill file carries the SPDX header"
  pass=$((pass + 1))
else
  echo "FAIL: an agent or skill file lacks the SPDX header"
  fail=$((fail + 1))
fi

# Triage is written down before any edit, with Always-dispatch tested first:
# without the visible line boss slides into inline work on risky areas.
f="$dir/skills/boss/SKILL.md"
if grep -qF 'triage: dispatch — touches' "$f" && grep -qF 'triage: inline — no Always-dispatch area' "$f" &&
   python3 -c "
import sys
s = open(sys.argv[1]).read()
assert s.index('**Always dispatch**') < s.index('inline gate') < s.index('Chat stays short')
" "$f" 2>/dev/null; then
  echo "PASS: SKILL.md tests Always-dispatch before the inline gate and prints a triage line"
  pass=$((pass + 1))
else
  echo "FAIL: SKILL.md triage line missing, or the inline gate comes before Always-dispatch"
  fail=$((fail + 1))
fi

# Builders open their report with a status and show each contract check failing first.
if [ -z "$(grep -L '^STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED$' "$dir/agents/builder.md" "$dir/agents/builder-deep.md")" ] &&
   [ -z "$(grep -L '^CONTRACT: .*failed before' "$dir/agents/builder.md" "$dir/agents/builder-deep.md")" ]; then
  echo "PASS: builder reports carry STATUS and failed-before evidence"
  pass=$((pass + 1))
else
  echo "FAIL: a builder report shape lacks STATUS or the failed-before CONTRACT line"
  fail=$((fail + 1))
fi

# Other plugins inject style modes into subagents; every lane pins its reply shape.
if [ -z "$(grep -L 'overrides any style or mode injected into this session' "$dir"/agents/*.md)" ]; then
  echo "PASS: every agent file pins its reply shape against injected style modes"
  pass=$((pass + 1))
else
  echo "FAIL: an agent file does not pin its reply shape against injected style modes"
  fail=$((fail + 1))
fi

# /boss:mode is the expensive full chain: only the user may start it, and it
# must point at the boss rules and the chain procedure instead of copying them.
f="$dir/skills/mode/SKILL.md"
if grep -q '^name: mode$' "$f" 2>/dev/null && grep -q '^disable-model-invocation: true$' "$f" &&
   grep -qF 'skills/boss/SKILL.md' "$f" && grep -qF 'skills/boss/mode.md' "$f" && grep -qF '$ARGUMENTS' "$f"; then
  echo "PASS: skills/mode/SKILL.md is user-invoked only and points at the boss rules"
  pass=$((pass + 1))
else
  echo "FAIL: skills/mode/SKILL.md missing, model-invocable, or not pointing at the boss rules"
  fail=$((fail + 1))
fi

# The guard is a prompt hook, never a command hook (the plugin directory refuses
# command hooks from non-Verified orgs). Each check is a python3 assertion over
# hooks/hooks.json; the file is passed as argv so paths never reach the code.
hook_check() {
  label=$1
  code=$2
  if python3 -c "
import json, sys, glob, re
h = json.load(open(sys.argv[1]))
hs = [x for m in h['hooks']['PreToolUse'] for x in m['hooks']]
ps = {x.get('prompt') for x in hs}
$code" "$hooks" "$dir" >/dev/null 2>&1; then
  echo "PASS: $label"
  pass=$((pass + 1))
else
  echo "FAIL: $label"
  fail=$((fail + 1))
fi
}
hook_check "hooks.json parses and has handlers" 'assert hs'
hook_check "every handler has type prompt" 'assert all(x["type"] == "prompt" for x in hs)'
hook_check "no handler anywhere has type command" '
def walk(o):
    if isinstance(o, dict):
        assert o.get("type") != "command"
        [walk(v) for v in o.values()]
    elif isinstance(o, list):
        [walk(v) for v in o]
walk(h)'
hook_check "every handler if starts with Bash(" 'assert all(x.get("if", "").startswith("Bash(") for x in hs)'
hook_check "all handlers share one identical prompt" 'assert len(ps) == 1 and None not in ps'
hook_check "the prompt contains \$ARGUMENTS" 'assert "$ARGUMENTS" in ps.pop()'
hook_check "every lane except fable-advisor and inspector is named bare and as boss:<lane>" '
p = ps.pop()
names = [re.search(r"^name:\s*(\S+)", open(f).read(), re.M).group(1) for f in glob.glob(sys.argv[2] + "/agents/*.md")]
assert names
for n in names:
    if n in ("fable-advisor", "inspector"):
        continue
    assert re.search(r"(?<![\w:-])" + n + r"(?![\w-])", p) and ("boss:" + n) in p, n'
hook_check "fable-advisor is not named in the prompt" 'assert "fable-advisor" not in ps.pop()'
hook_check "inspector is not named in the prompt" 'assert "inspector" not in ps.pop()'

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
