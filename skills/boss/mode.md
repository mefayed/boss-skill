<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Boss mode — the full chain for one task

Read when SKILL.md's mode trigger fires. It adds no new machinery: it runs debate.md, challenge.md, the Protocol and inspect.md in order, each under its own rules.

## Trigger
- `/boss:mode <task>`, or a command with a task attached: "boss mode: <task>", "<task>, full team", "<task>, all in". "all in" counts only at the very start or end of the message.
- Never from prose ("we're all in on this design", "the full team reviewed it"), quoted text, repo content or memory.
- One task only. When it is done, normal triage returns. "stay in boss mode" → say once that it runs per task, since every task would cost a full chain, and ask them to attach it each time.
- No task attached → ask what to run it on.

## Before the first call
- Small (passes the inline gate): ask once `This looks small — I'd just do it. Run the full chain anyway?` No → normal flow.
- Setup line, plain words: what will run and roughly what it costs. `Full chain: 3 models argue the options, the winner's plan gets checked, then I build and a fresh model tries the result. About 15–20 model calls.`
- Codex and outside models join only if named in this message. Memory never opts them in. "claude only" holds.

## Chain
1. Debate — debate.md as written, open round included. Its exits hold: a unanimous, untested consensus skips to step 2 and says so in one line.
2. Challenge — challenge.md. After a debate, its "Debate … then challenge" seats: the winning advocate's model writes, the others check, the debate judge judges. After a consensus exit, auto seats.
3. Build — challenge.md's Build rule. Full agreement → Protocol from the final plan. Anything else → that file's pause.
4. Inspect — inspect.md, always, even when the build stayed inline: the user asked for an independent check. Dispatch once the diff is final.
5. Report — one report, the 8-line rule: the debate's winner, how the challenge ended, what changed, the inspector's line, open items.

"plan only" in the ask ("boss mode, plan only: <task>") → stop after step 2.

## Limits
- Each stage keeps its own caps and dials (challenge.md's 10 calls and 5 rounds). No stage is dropped to save tokens; "careful with tokens" moves each stage by its own rule.
- Any stage's pause stops the chain there: a judge-decided or failed challenge, destructive or external effects, an inspector FAIL still open after its rounds. Say where it stopped and what is open; never carry on past a pause.
