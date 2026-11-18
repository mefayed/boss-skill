---
name: handoff
description: Save unfinished boss work now so a fresh session picks it up after /clear, resume a saved one, or print a copy to paste back. Runs only when the user types /boss:handoff; boss also saves on its own.
argument-hint: [note | resume | copy]
disable-model-invocation: true
---
<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Boss handoff

The user typed the handoff command.

1. If the boss rules (the text headed `# Boss — multi-model orchestration`) are not already in this conversation, read `${CLAUDE_PLUGIN_ROOT}/skills/boss/SKILL.md` in full and act as its supervisor from here on.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/boss/handoff.md`. Argument `resume` → run its Resume. `copy`, or no auto-memory on this host → run Save 12. Anything else, or none → run its Save now, with the argument as a note. Every rule in the boss skill still holds.

Argument: $ARGUMENTS
