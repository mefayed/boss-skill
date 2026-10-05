#!/bin/sh
# Runs every task headless under plain Claude Code (baseline) and Claude Code + boss,
# then scores each run with the task's hidden test. See bench/README.md.
#
#   sh bench/run.sh                         # all tasks, both conditions
#   TASKS="03-cancel-stock-bug" REPS=3 sh bench/run.sh
#   sh bench/run.sh summarize bench/results/<stamp>.jsonl
set -u

BENCH=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$BENCH")
CLAUDE_BIN=${CLAUDE_BIN:-claude}
MODEL=${MODEL:-opus}
BUDGET=${BUDGET:-3}
REPS=${REPS:-1}
EFFORT=${EFFORT:-}
TASKS=${TASKS:-$(ls "$BENCH/tasks")}
CONDITIONS=${CONDITIONS:-baseline boss}

summarize() {
  python3 - "$1" <<'EOF'
import json, sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
conds = [c for c in ("baseline", "boss") if any(r["condition"] == c for r in rows)]
by = defaultdict(list)
for r in rows:
    by[(r["task"], r["condition"])].append(r)
tasks = sorted({r["task"] for r in rows})

def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0

def cell(task, cond):
    rs = by[(task, cond)]
    return (mean([r["total_cost_usd"] or 0 for r in rs]),
            mean([r["wall_s"] for r in rs]),
            sum(r["suite_pass"] for r in rs), len(rs),
            sum(r["dispatches"] for r in rs))

head = "| task |" + "".join(" %s $ | %s s | %s pass |" % (c, c, c) for c in conds)
if "boss" in conds:
    head += " boss dispatches |"
print(head)
print("|---" * (head.count("|") - 1) + "|")
tot = {c: [0.0, 0.0, 0, 0] for c in conds}
for t in tasks:
    line = "| %s |" % t
    for c in conds:
        cost, secs, ok, n, disp = cell(t, c)
        line += " %.2f | %.0f | %d/%d |" % (cost, secs, ok, n)
        for i, v in enumerate((cost, secs, ok, n)):
            tot[c][i] += v
    if "boss" in conds:
        line += " %d |" % cell(t, "boss")[4]
    print(line)
line = "| **total** |"
for c in conds:
    line += " %.2f | %.0f | %d/%d |" % tuple(tot[c])
print(line + (" |" if "boss" in conds else ""))
if conds == ["baseline", "boss"] and tot["baseline"][0] and tot["baseline"][1]:
    dc = (tot["boss"][0] / tot["baseline"][0] - 1) * 100
    dt = (tot["boss"][1] / tot["baseline"][1] - 1) * 100
    print("\nboss vs baseline: cost %+.0f%%, time %+.0f%%, passes %d vs %d (of %d each)."
          % (dc, dt, tot["boss"][2], tot["baseline"][2], tot["baseline"][3]))
print("Cost and wall-clock seconds are per-run means; pass = full test suite incl. the hidden test.")
bad = [r for r in rows if not r["isolation_ok"]]
if bad:
    print("WARNING: %d run(s) failed the isolation check: %s" % (len(bad), ", ".join(r["run_id"] for r in bad)))
errs = [r for r in rows if r["is_error"]]
if errs:
    print("Runs that ended in an error (budget cap, API error, ...): %s"
          % ", ".join("%s (%s)" % (r["run_id"], r["subtype"]) for r in errs))
EOF
}

if [ "${1:-}" = summarize ]; then
  summarize "$2"
  exit
fi

command -v "$CLAUDE_BIN" >/dev/null 2>&1 || { echo "claude not found: set CLAUDE_BIN" >&2; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$BENCH/results/$STAMP.jsonl
RAW=$BENCH/results/raw/$STAMP
mkdir -p "$RAW"
VERSION=$("$CLAUDE_BIN" --version 2>/dev/null | head -1)
BOSS_REV=$(git -C "$REPO" describe --always --dirty 2>/dev/null || echo unknown)
# Load boss from a copy without bench/, so the plugin dir doesn't point the agent at the hidden tests.
PLUGIN=$(mktemp -d "${TMPDIR:-/tmp}/bossplugin.XXXXXX")
cp -R "$REPO/.claude-plugin" "$REPO/agents" "$REPO/hooks" "$REPO/skills" "$PLUGIN/"
echo "claude $VERSION, model $MODEL, budget \$$BUDGET/run, reps $REPS -> $OUT"

run_one() {  # task condition rep slot
  task=$1 cond=$2 rep=$3 slot=$4
  id=$task.$cond.$rep
  raw=$RAW/$id
  mkdir -p "$raw"
  work=$(mktemp -d "${TMPDIR:-/tmp}/bossbench.XXXXXX")
  cp -R "$BENCH/fixture/." "$work/"
  (cd "$work" && git init -q && git add -A &&
    git -c user.name=bench -c user.email=bench@localhost commit -qm fixture)
  base=$(cd "$work" && git rev-parse HEAD)

  prompt=$(cat "$BENCH/tasks/$task/task.md")
  [ "$cond" = boss ] && prompt="/boss:boss $prompt"
  # Isolation: no user/project/local settings (so no user plugins, hooks, output style),
  # no MCP servers, no auto-memory, no saved session. Boss runs add only this repo's plugin.
  set -- -p "$prompt" --model "$MODEL" --output-format stream-json --verbose \
    --max-budget-usd "$BUDGET" --permission-mode bypassPermissions \
    --setting-sources "" --strict-mcp-config --no-session-persistence \
    --settings '{"autoMemoryEnabled":false}'
  [ "$cond" = boss ] && set -- "$@" --plugin-dir "$PLUGIN"
  [ -n "$EFFORT" ] && set -- "$@" --effort "$EFFORT"

  echo "-> $id ($work)"
  t0=$(date +%s)
  # env -i: nothing from the calling shell (e.g. a parent Claude Code session) leaks in.
  (cd "$work" && env -i HOME="$HOME" PATH="$PATH" USER="${USER:-}" LOGNAME="${LOGNAME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
    ${ANTHROPIC_API_KEY:+"ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"} \
    "$CLAUDE_BIN" "$@" </dev/null >"$raw/transcript.jsonl" 2>"$raw/stderr.txt")
  code=$?
  wall=$(( $(date +%s) - t0 ))
  (cd "$work" && git add -A && git diff --cached "$base" >"$raw/diff.patch" &&
    git diff --cached --shortstat "$base" >"$raw/shortstat.txt")
  cp "$BENCH/tasks/$task/hidden_test.py" "$work/tests/test_hidden.py"
  (cd "$work" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_hidden >"$raw/hidden.txt" 2>&1)
  hidden=$?
  (cd "$work" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t . >"$raw/suite.txt" 2>&1)
  suite=$?

  python3 - "$raw" "$task" "$cond" "$rep" "$slot" "$code" "$wall" "$hidden" "$suite" \
    "$MODEL" "$BUDGET" "$EFFORT" "$VERSION" "$work" "$STAMP" "$BOSS_REV" >>"$OUT" <<'EOF'
import json, re, sys
raw, task, cond, rep, slot, code, wall, hidden, suite, model, budget, effort, version, work, stamp, boss_rev = sys.argv[1:]
init, result, results, dispatches, lanes = None, None, 0, 0, []
for line in open(raw + "/transcript.jsonl"):
    try:
        m = json.loads(line)
    except ValueError:
        continue
    if m.get("type") == "system" and m.get("subtype") == "init" and init is None:
        init = m
    elif m.get("type") == "result":
        # A session that waits on background agents emits one result per turn; the last is cumulative.
        result, results = m, results + 1
    elif m.get("type") == "assistant" and not m.get("parent_tool_use_id"):
        for c in m.get("message", {}).get("content", []):
            if c.get("type") == "tool_use" and c.get("name") in ("Task", "Agent"):
                dispatches += 1
                i = c.get("input", {})
                lanes.append("%s/%s" % (i.get("subagent_type", "?"), i.get("model", "default")))
init, result = init or {}, result or {}
extra = sorted(p["name"] for p in init.get("plugins", []) if p.get("path") != "builtin")
want = ["boss"] if cond == "boss" else []
stat = open(raw + "/shortstat.txt").read()
num = lambda pat: int((re.search(pat, stat) or [0, 0])[1])
ran = re.search(r"Ran (\d+) test", open(raw + "/suite.txt").read())
print(json.dumps({
    "run_id": "%s.%s.%s" % (task, cond, rep), "stamp": stamp, "task": task, "condition": cond,
    "rep": int(rep), "slot": int(slot), "model_requested": model, "effort": effort or None,
    "budget_usd": float(budget), "claude_version": version, "boss_rev": boss_rev, "exit_code": int(code),
    "is_error": result.get("is_error", True), "subtype": result.get("subtype", "no-result"),
    "total_cost_usd": result.get("total_cost_usd"), "duration_ms": result.get("duration_ms"),
    "duration_api_ms": result.get("duration_api_ms"), "wall_s": int(wall),
    "num_turns": result.get("num_turns"), "model_usage": result.get("modelUsage"),
    "result_events": results, "dispatches": dispatches, "dispatch_lanes": lanes,
    "hidden_pass": hidden == "0", "suite_pass": suite == "0",
    "suite_tests_ran": int(ran[1]) if ran else 0,
    "files_changed": num(r"(\d+) files? changed"), "insertions": num(r"(\d+) insertion"),
    "deletions": num(r"(\d+) deletion"),
    "isolation": {"session_model": init.get("model"), "non_builtin_plugins": extra,
                  "mcp_servers": [s.get("name") for s in init.get("mcp_servers", [])],
                  "output_style": init.get("output_style"), "skills": init.get("skills"),
                  "agents": init.get("agents"), "memory_paths": init.get("memory_paths")},
    "isolation_ok": bool(init) and extra == want and not init.get("mcp_servers")
                    and init.get("output_style") == "default" and not init.get("memory_paths"),
    "workdir": work, "raw_dir": raw,
}))
EOF
  tail -1 "$OUT" | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print("   cost $%s, %ss, hidden %s, suite %s, dispatches %d, isolation %s" % (r["total_cost_usd"], r["wall_s"], r["hidden_pass"], r["suite_pass"], r["dispatches"], "ok" if r["isolation_ok"] else "FAILED"))'
}

rep=1
while [ "$rep" -le "$REPS" ]; do
  i=0
  for task in $TASKS; do
    # Alternate which condition goes first, so neither one always runs second.
    if [ $(( (rep + i) % 2 )) -eq 0 ]; then order=$CONDITIONS; else order=$(echo "$CONDITIONS" | awk '{for (j = NF; j > 0; j--) printf "%s ", $j}'); fi
    slot=1
    for cond in $order; do
      run_one "$task" "$cond" "$rep" "$slot"
      slot=$((slot + 1))
    done
    i=$((i + 1))
  done
  rep=$((rep + 1))
done

echo
summarize "$OUT"
echo
echo "Raw transcripts, diffs and test output: $RAW"
