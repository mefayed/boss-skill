---
name: handoff
description: Print a checkpoint of unfinished boss work in chat to keep and paste back after /clear, or resume from a pasted one. Runs only when the user types /boss-orchestrator:handoff.
argument-hint: [note | resume]
disable-model-invocation: true
---
Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: Apache-2.0. See LICENSE and NOTICE.txt.

# Boss handoff

The user typed the handoff command.

1. If the boss rules (the text headed `# Boss — multi-model orchestration`) are not already in this conversation, read `${CLAUDE_PLUGIN_ROOT}/skills/boss/SKILL.md` in full and act as its supervisor from here on.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/boss/handoff.md`. Argument `resume` → run its Resume on the checkpoint the user pasted (none pasted → ask for it). Anything else, or none → run its Print, with the argument as a note. Every rule in the boss skill still holds.

Argument: $ARGUMENTS
