#!/bin/sh
# Best-effort tripwire against accidental destructive Bash from builder and
# errand subagents only. NOT a security boundary: deliberate obfuscation gets
# through by design (git${IFS}push, quote-splitting, git aliases, a command
# split across lines by an escaped newline — matching is per line, on both the
# parsed and the raw path — and any indirection that hides the command text
# from this hook, such as writing it to a file and running `sh that-file`,
# which an agent has already done here in practice. The real
# enforcement is the supervisor's full diff read after the builder reports.
# Main thread, supervisor, advisors, and the user's own commands are never
# intercepted (no agent_type = exit 0). Fails open on unexpected input.
p=$(cat)

# Prefer parsed fields. Raw-payload matching is the fallback ONLY when jq is
# absent or the payload doesn't parse — it over-blocks, since any field
# (a description, a note) can carry a destructive-looking phrase.
parsed=0
agent_type=""
cmd=""
if command -v jq >/dev/null 2>&1 && printf '%s' "$p" | jq -e . >/dev/null 2>&1; then
  parsed=1
  agent_type=$(printf '%s' "$p" | jq -r '.agent_type // empty' 2>/dev/null)
  cmd=$(printf '%s' "$p" | jq -r '.tool_input.command // empty' 2>/dev/null)
fi

if [ "$parsed" = 1 ]; then
  case "$agent_type" in
    *builder*|*errand*) ;;
    *) exit 0 ;;
  esac
  [ -n "$cmd" ] || exit 0
else
  printf '%s' "$p" | grep -Eq '"agent_type"[[:space:]]*:[[:space:]]*"[^"]*(builder|errand)' || exit 0
  cmd=$p
fi

# Shell separators (; & | parens) end a command, so they bound a match just
# like whitespace — `git push; x` and `(git push)` must not slip past. The
# quote is a boundary for the raw-payload fallback, and the slash catches
# an absolute invocation like `/usr/bin/git push`.
b='[[:space:]";&|()/]'
tok='[^[:space:];&|()]'
# Global git options before the subcommand: `-C dir`, `-c k=v`, `--no-pager`,
# with values that may be quoted or contain escaped spaces. The run must START
# with a dash token — allowing a bare first token would block `echo git status
# push`. Once it does, any words may follow, so quoted paths are covered.
g="([[:space:]]+-${tok}*([[:space:]]+${tok}+)*)?"
a="([[:space:]]+${tok}+)*"

printf '%s' "$cmd" | grep -Eqi \
  -e "(^|$b)git$g[[:space:]]+push($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+commit($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+checkout$a[[:space:]]+(-f|--force)($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+reset$a[[:space:]]+--hard($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+clean$a[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*($b|\$)" \
  -e "(^|$b)rm$a[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)($b|\$)" \
  -e 'drop[[:space:]]+(table|database)' \
  -e 'truncate[[:space:]]+table' \
  || exit 0

echo 'boss guard: destructive command blocked for builders (no push/commit/reset --hard/rm -r*/checkout -f/DROP/TRUNCATE). Note it under OPEN in your report; the supervisor decides.' >&2
exit 2
