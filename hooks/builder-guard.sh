#!/bin/sh
# Blocks destructive Bash from builder subagents only. Main thread, supervisor,
# advisors, and the user's own commands are never intercepted (no agent_type = exit 0).
# Fails open: unexpected input shape means no match, command runs.
p=$(cat)
printf '%s' "$p" | grep -q '"agent_type": *"[^"]*builder' || exit 0
printf '%s' "$p" | grep -Eqi 'rm +-[a-z-]*[rf]|git +push|git +reset[^"]*--hard|git +clean +-[a-z]*f|git +checkout[^"]*--force|drop +(table|database)|truncate +table' || exit 0
echo 'boss guard: destructive command blocked for builders (no push/reset --hard/rm -rf/DROP). Note it under OPEN in your report; the supervisor decides.' >&2
exit 2
