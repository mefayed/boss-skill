#!/bin/sh
# Best-effort tripwire against accidental destructive Bash from builder,
# errand and advocate subagents only, matched by exact lane name. It also trips on
# the common outward-facing writes (gh/curl with a write method, gh pr/issue/release
# create) because those mutate state no diff review can see or undo. NOT a security
# boundary. It reads one command string at a time, so chaining exempts: a read and a
# write in the same line share one verdict. Deliberate obfuscation gets
# through by design (git${IFS}push, quote-splitting, git aliases, a command
# split across lines by an escaped newline — matching is per line, on both the
# parsed and the raw path — and any indirection that hides the command text
# from this hook, such as writing it to a file and running `sh that-file`,
# which an agent has already done here in practice. The real
# enforcement is the supervisor's full diff read after the builder reports.
# Main thread, supervisor, fable-advisor, and the user's own commands are never
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
    builder|builder-deep|errand|advocate|boss:builder|boss:builder-deep|boss:errand|boss:advocate) ;;
    *) exit 0 ;;
  esac
  [ -n "$cmd" ] || exit 0
else
  printf '%s' "$p" | grep -Eq '"agent_type"[[:space:]]*:[[:space:]]*"(boss:)?(builder|builder-deep|errand|advocate)"' || exit 0
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

# Three passes. SQL is matched case-insensitively because it is written either way;
# everything else is case-SENSITIVE, because curl's `-f` (fail silently, a read)
# and `-F` (form upload, a write) differ only in case and blocking reads is worse
# than missing an exotic write spelling.
if printf '%s' "$cmd" | grep -Eqi \
  -e 'drop[[:space:]]+(table|database)' \
  -e 'truncate[[:space:]]+table'; then
  blocked=1
fi

# `-XPOST` and `--method=POST` are as common as the spaced forms, so the separator
# is optional. The gh verb must follow its noun directly: scanning the whole argument
# list blocked `gh pr list --search "fix merge conflict"` on the word "merge".
if ! printf '%s' "$cmd" | grep -Eq "(^|$b)curl$a[[:space:]]+(-G|--get)($b|\$)" &&
   printf '%s' "$cmd" | grep -Eq \
  -e "(^|$b)git$g[[:space:]]+push($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+commit($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+checkout$a[[:space:]]+(-f|--force)($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+reset$a[[:space:]]+--hard($b|\$)" \
  -e "(^|$b)git$g[[:space:]]+clean$a[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*($b|\$)" \
  -e "(^|$b)rm$a[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)($b|\$)" \
  -e "(^|$b)(gh|curl)$a[[:space:]]+(-X|--method|--request)[[:space:]=]*([Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee])($b|\$)" \
  -e "(^|$b)curl$a[[:space:]]+(-d|-F|-T)($b|=|[^[:space:]-]|\$)" \
  -e "(^|$b)curl$a[[:space:]]+(--data[a-z-]*|--form|--upload-file|--json)($b|=|\$)" \
  -e "(^|$b)gh[[:space:]]+(pr|issue|release|repo|gist|workflow|secret|variable|run|cache)[[:space:]]+(create|delete|merge|close|edit|comment|review|upload|run|lock|set|ready|rerun|cancel|sync)($b|\$)"; then
  blocked=1
fi

# `gh api` with a field flag defaults to POST — unless the caller named a read method,
# which is how a GraphQL query or a filtered search is written.
if printf '%s' "$cmd" | grep -Eq "(^|$b)gh$a[[:space:]]+api($b|\$)" &&
   printf '%s' "$cmd" | grep -Eq '[[:space:]](-f|-F|--field|--raw-field|--input)([[:space:]]|=|[^[:space:]-])' &&
   ! printf '%s' "$cmd" | grep -Eq '(--method|-X)[[:space:]=]*(GET|HEAD)' &&
   ! { printf '%s' "$cmd" | grep -Eq "(^|$b)gh$a[[:space:]]+api$a[[:space:]]+graphql($b|\$)" &&
       ! printf '%s' "$cmd" | grep -Eqi 'mutation'; }; then
  blocked=1
fi

[ "${blocked:-0}" = 1 ] || exit 0

echo 'boss guard: destructive command blocked for builder/errand/advocate agents (no push/commit/reset --hard/rm -r*/checkout -f/DROP/TRUNCATE, no gh/curl writes). Note it under OPEN in your report; the supervisor decides.' >&2
exit 2
