#!/bin/sh
# Regression test for the boss plugin shape. Checks hooks/hooks.json (the guard
# is a prompt hook: parses, prompt handlers only, one shared prompt that names
# every dispatchable lane) and the agent files (identical builder bodies, no
# ignored keys, closed advisory tools lists). It cannot test the model's
# allow/block judgment itself; that was live-tested by hand.

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
hook_check "every lane except fable-advisor is named bare and as boss:<lane>" '
p = ps.pop()
names = [re.search(r"^name:\s*(\S+)", open(f).read(), re.M).group(1) for f in glob.glob(sys.argv[2] + "/agents/*.md")]
assert names
for n in names:
    if n == "fable-advisor":
        continue
    assert re.search(r"(?<![\w:-])" + n + r"(?![\w-])", p) and ("boss:" + n) in p, n'
hook_check "fable-advisor is not named in the prompt" 'assert "fable-advisor" not in ps.pop()'

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
