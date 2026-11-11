---
name: mode
description: Boss at full strength for one task — debate the options, challenge the winning plan, build it, then have a fresh model inspect the result. Runs only when the user types /boss:mode.
argument-hint: [task]
disable-model-invocation: true
---
<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Boss mode

The user asked for the full chain on one task.

1. If the boss rules (the text headed `# Boss — multi-model orchestration`) are not already in this conversation, read `${CLAUDE_PLUGIN_ROOT}/skills/boss/SKILL.md` in full and act as its supervisor from here on.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/boss/mode.md` and run its chain on the task below. Every rule in the boss skill still holds.

Task: $ARGUMENTS
