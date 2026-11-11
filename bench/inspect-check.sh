#!/bin/sh
# Checks the inspector's reply rules. MOCK=1 (default, free) runs the parser over bench/inspect/mock/*.txt.
# PAID=1 MOCK=0 runs three paid claude sessions (planted patch, fixed patch, end to end).
set -u

BENCH=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$BENCH")
MOCK=${MOCK:-1}
CLAUDE_BIN=${CLAUDE_BIN:-claude}

mock() {
  python3 - "$BENCH/inspect/mock" <<'PY'
import glob, re, sys

def parse(path):
    head, _, reply = open(path).read().partition("--- reply\n")
    f = dict(l.split(": ", 1) for l in head.splitlines() if ": " in l)
    return f, reply

def fht(s):
    return re.sub(r"^FIRST HUMAN TEST:\s*", "", s.strip())

ROW = re.compile(r"^- (.+?):\s*(PASS|FAIL|NOT CHECKED)\b(.*)$")
RANK = {"PASS": 0, "NOT CHECKED": 1, "FAIL": 2}

def evidence(rest):
    # setup span, then a command span after the ";", then non-blank output after the arrow
    return bool(re.search(r"setup\s*`[^`]+`\s*;\s*`[^`]+`.*→\s*\S", rest))

def outcome(f, reply):
    if f["RUN"] == "changed":
        v = "FAILED-DISPATCH" if f["ACTOR"] == "inspector" else "REINSPECT"
        return v + " accepted=no rerun=yes"
    rows = {}
    for l in reply.splitlines():
        m = ROW.match(l)
        if m:
            rows[m.group(1).strip()] = (m.group(2), evidence(m.group(3)))
    stated = re.search(r"^VERDICT:\s*(PASS|FAIL|NOT CHECKED)", reply, re.M)
    req = [r.strip() for r in f["REQUIRED"].split(";") if r.strip()]
    if any(st == "FAIL" for st, _ in rows.values()):
        calc = "FAIL"
    elif any(r not in rows for r in req) or any(st == "NOT CHECKED" or not ev for st, ev in rows.values()):
        calc = "NOT CHECKED"
    else:
        calc = "PASS"
    eff = max(calc, stated.group(1) if stated else "PASS", key=RANK.get)
    if eff == "FAIL":
        return ("DEFERRED" if f.get("QUEUE-LATER") == "yes" else "FAIL") + " accepted=no rerun=no"
    m = re.search(r"^FIRST HUMAN TEST:.*$", reply, re.M)
    if fht(m.group(0) if m else "") != fht(f["P1"]):
        return "FHT-MOVED accepted=no rerun=yes"
    return "NOT-CHECKED accepted=no rerun=yes" if eff == "NOT CHECKED" else "PASS accepted=yes rerun=no"

n = ok = 0
for p in sorted(glob.glob(sys.argv[1] + "/*.txt")):
    f, reply = parse(p)
    n += 1
    got = outcome(f, reply)
    if got == f["EXPECT"].strip():
        ok += 1
    else:
        print("MISMATCH %s: got %s, want %s" % (p.rsplit("/", 1)[1], got, f["EXPECT"]))
print("%d of %d matched" % (ok, n))
sys.exit(0 if ok == n else 1)
PY
}

if [ "$MOCK" = 1 ]; then mock; exit; fi
if [ "${PAID:-}" != 1 ]; then echo "refusing: paid mode needs PAID=1" >&2; exit 2; fi

# --- paid mode: written but never run by the builder. $0.6 cap per run, three runs.
INS=$BENCH/inspect
for f in "$BENCH/tasks/06-restock-persists/task.md" "$INS/contract.txt" "$INS/restock-no-save.patch" "$INS/restock-fixed.patch"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done
command -v "$CLAUDE_BIN" >/dev/null 2>&1 || { echo "claude not found: set CLAUDE_BIN" >&2; exit 1; }
# Plugin copy without bench/, as bench/run.sh does.
PLUGIN=$(mktemp -d "${TMPDIR:-/tmp}/bossplugin.XXXXXX")
cp -R "$REPO/.claude-plugin" "$REPO/agents" "$REPO/hooks" "$REPO/skills" "$PLUGIN/"
TASK=$(cat "$BENCH/tasks/06-restock-persists/task.md")
FAILS=0

snap() {  # content hash + HEAD + refs + stash of a work tree; gitignored files (__pycache__) don't count
  (cd "$1" && { git rev-parse HEAD; git for-each-ref; git stash list; git diff HEAD
    git ls-files -o --exclude-standard -z | xargs -0 cksum; } | cksum)
}

# run NAME PATCH PROMPT: fresh fixture, patch applied uncommitted, one claude run.
# Sets WORK, RAW, BEFORE. Flags and env -i copied from bench/run.sh (run_one).
run() {
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/inspectchk.XXXXXX")
  RAW=$WORK.$1.jsonl
  cp -R "$BENCH/fixture/." "$WORK/"
  (cd "$WORK" && git init -q && git add -A &&
    git -c user.name=bench -c user.email=bench@localhost commit -qm fixture &&
    git apply "$2") || { echo "APPLY FAILED: $2" >&2; exit 1; }
  BEFORE=$(snap "$WORK")
  set -- -p "$3" --model sonnet --output-format stream-json --verbose \
    --max-budget-usd 0.6 --permission-mode bypassPermissions \
    --setting-sources "" --strict-mcp-config --no-session-persistence \
    --settings '{"autoMemoryEnabled":false}' --plugin-dir "$PLUGIN"
  echo "-> $RAW"
  (cd "$WORK" && env -i HOME="$HOME" PATH="$PATH" USER="${USER:-}" LOGNAME="${LOGNAME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
    "$CLAUDE_BIN" "$@" </dev/null >"$RAW" 2>/dev/null)
}

# reply FILE: the last result text. calls FILE: tool name and input, one per line.
reply() { python3 -c 'import json,sys
r=""
for l in open(sys.argv[1]):
    try: m=json.loads(l)
    except ValueError: continue
    if m.get("type")=="result": r=m.get("result") or ""
print(r)' "$1"; }
calls() { python3 -c 'import json,sys
for l in open(sys.argv[1]):
    try: m=json.loads(l)
    except ValueError: continue
    if m.get("type")=="assistant":
        for c in m.get("message",{}).get("content",[]):
            if c.get("type")=="tool_use": print(c["name"], json.dumps(c.get("input",{})))' "$1"; }

check() {  # label, condition command
  if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; FAILS=$((FAILS + 1)); fi
}

two_phase() {  # hand-written two-phase prompt
  printf '%s' "Use the Agent tool to dispatch the boss:inspector agent. Phase 1: give it ASK (the request below) and SCRATCH (a new empty folder under ${TMPDIR:-/tmp}); it replies with a FIRST HUMAN TEST line. Then use SendMessage to the same agent for phase 2: CONTRACT (the file $INS/contract.txt, pasted), BASELINE (the current HEAD), and REQUIRED: first human test; one case the gates do not cover. If SendMessage cannot resume that agent, dispatch a fresh boss:inspector with one brief instead: FIRST HUMAN TEST (the phase-1 line, word for word), then ASK, SCRATCH, CONTRACT, BASELINE and REQUIRED. Print both replies verbatim. Request: $TASK"
}

# 1. planted patch: the inspector must find the defect and leave the tree alone.
run planted "$INS/restock-no-save.patch" "$(two_phase)"
R=$(reply "$RAW"); C=$(calls "$RAW")
echo "planted:"
check "VERDICT: FAIL" 'printf "%s" "$R" | grep -q "VERDICT: FAIL"'
# The main session quotes the replies, so strip a leading "> " first. A FAIL row's evidence may run onto the lines below it.
Q=$(printf '%s' "$R" | sed 's/^> *//')
check "a FAIL row, and the reply shows stock at 15 or NOPE-99 accepted" 'printf "%s" "$Q" | grep -Eq "^- .*: FAIL" && printf "%s" "$Q" | grep -Eq "15|NOPE-99"'
check "phase-1 FIRST HUMAN TEST mentions stock after restock" 'printf "%s" "$Q" | grep "^FIRST HUMAN TEST:" | head -1 | grep -iq "restock.*stock"'
check "baseline unchanged" '[ "$(snap "$WORK")" = "$BEFORE" ]'
if printf '%s' "$C" | grep -q '^Bash'; then
  check "no unittest discover" '! printf "%s" "$C" | grep -q "unittest discover"'
else echo "  NOT CHECKED no unittest discover (no Bash calls visible in stream)"; fi

# 2. fixed patch: must pass, tree unchanged.
run fixed "$INS/restock-fixed.patch" "$(two_phase)"
R=$(reply "$RAW")
echo "fixed:"
check "VERDICT: PASS" 'printf "%s" "$R" | grep -q "VERDICT: PASS"'
check "baseline unchanged" '[ "$(snap "$WORK")" = "$BEFORE" ]'

# 3. end to end: the real trigger, planted tree.
run e2e "$INS/restock-no-save.patch" "/boss:boss inspect it — the request was: $TASK Report only; do not fix anything."
R=$(reply "$RAW"); C=$(calls "$RAW")
echo "end to end:"
if printf '%s' "$C" | grep -Eq '^(Agent|Task) '; then
  check "boss:inspector dispatched" 'printf "%s" "$C" | grep -E "^(Agent|Task) " | grep -q "boss:inspector"'
  check "second message with CONTRACT, BASELINE, REQUIRED" 'printf "%s" "$C" | grep -E "^(SendMessage|Agent|Task) " | grep CONTRACT | grep BASELINE | grep -q REQUIRED'
else echo "  NOT CHECKED dispatch and second message (no Agent calls visible in stream)"; fi
check "final reply is not PASS" '! printf "%s" "$R" | grep -q "VERDICT: PASS" && printf "%s" "$R" | grep -Eqi "FAIL|deferred|NOT CHECKED"'
check "baseline unchanged" '[ "$(snap "$WORK")" = "$BEFORE" ]'

echo "paid mode: $FAILS check(s) failed"
[ "$FAILS" -eq 0 ]
