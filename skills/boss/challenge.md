<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Challenge mode — procedure

Read only after SKILL.md's gate passed. Debates never need this file.

## Seats

- One writer, one or more checkers in the order named, one judge. One lap (the writer's turn plus each live checker once) is one round.
- Named: "<A> writes, <B> checks" or "<A> writes, <B> and <C> check"; "<C> judges" means "judge with <C>". "writer <A>, checker(s) <B>[ and <C>], judge <D>" reads the same, only with the role word directly before a model name. Older forms still work: "X challenge Y" (Y writes, X checks) and chains "A→B→C" / "A, then B, then C" (A writes). Unclear → ask who writes. Same model as writer and checker → ask once: `<x> checking its own plan shares its blind spots — keep it, or pick another checker?`; the answer wins, and each role is its own separate dispatch. The judge in another role → ask, as below.
- "Debate … then challenge": run the debate first; the winning advocate's model writes the winning option, the other advocates check it, and the debate judge judges again (no menu).
- No names → auto seats, tiered by SKILL.md's own triage. The checker always outranks the writer (haiku < sonnet < opus < fable), and the judge is never a writer or checker. Fable judges unless it's the checker.
  - Simple (passes the inline gate): first ask `This looks small — I'd just do it. Challenge anyway?`; yes → haiku writes, sonnet checks, fable judges; no → the normal inline flow.
  - Normal (everything else): sonnet writes, opus checks, fable judges.
  - Hard (SKILL.md's Always-dispatch list): sonnet writes, fable checks, opus judges.
- The user names one seat → only that seat changes; fill the rest keeping the checker above the writer and the judge apart. The user's own picks break these rules → say so once, then run them as given (never a judge who also writes or checks). No model left that outranks the named writer (e.g. fable writes) → ask: pick a checker, or accept an equal or weaker one.
- Fable unavailable → opus judges and the seats step down a notch as needed so the checker still outranks the writer (e.g. haiku writes, sonnet checks). Never drop the judge.
- Codex and outside models are never auto-picked. Naming a seat or judge is the opt-in; memory never is. "claude only" drops every non-Claude seat and judge, and says so in one line. Naming a judge never moves fable into a checker seat.
- Menu only when asked ("who can challenge?", "list models"): show it, call nobody, wait for a pick.
  `Pick who writes and who checks, e.g. "sonnet writes, opus checks". Claude: fable, opus, sonnet, haiku. Codex (your catalog; access not verified; spends OpenAI credits): <slugs>. Or name an outside CLI.`
  Slugs: `{ codex debug models 2>/dev/null | grep -o '"slug":"[^"]*"' | cut -d'"' -f4; grep -ho 'gpt[a-z0-9.-]*' ~/.codex/config.toml ~/.codex/.codex-global-state.json 2>/dev/null; } | sort -u`. It calls no model; no output or no companion → drop the Codex clause. Never probe outside CLIs here.
- Routing per seat, as in SKILL.md: a Claude name runs as the `advocate` agent with that model; a Codex name resolves against the catalog; any other name goes through outside-clis.md (resolve, route line, enforced read-only, a fresh call per turn) and may hold any role. A named outside or local model checking a stronger writer → warn once: `<x> is likely weaker than <writer> — checks may be shallow. Continue?`
- Seats and judge are settled before turn 1, then frozen: nothing is added or swapped mid-run.

## Plan files

- Blind, everyone: relabel each reply once on arrival (Writer, Checker 1/2…, Judge; the seat's own name, self-references and other seat-identifying model or vendor names become labels; names that are the plan's subject stay), then file, brief and relay only the relabeled text. Briefs name roles, never models or scratchpad paths. Check FACTS and the question once for seat-identifying names. No file holds the label→model map: it is the setup line and your report; "show me the discussion" relabels back at display time. Chat messages to the user keep real names; seats never see chat.
- Boss keeps `<scratchpad>/challenge-<slug>/`: `plan-v<N>.md` (the writer's full plan, relabeled), `ledger.md` (the ids, internal only) and `transcript.md` (every relabeled reply, shown on "show me the discussion"). Raw captures (outside-clis.md files, Codex job logs) stay outside this folder and are never named in a brief. Only the writer changes plan content.
- Every brief, every turn and every backend, is closed: the question, FACTS, the current version in full, the change log since this seat's last turn, the open ledger, the seat's role and reply shape, and "read-only; verify only what the plan touches." Checker briefs add: "Your job is to find problems. Assume there is at least one flaw; find it."

## Calls

- Claude seat: the first turn is a fresh `advocate` dispatch; later turns SendMessage the same agent the same closed brief.
- Codex seat: a fresh call every turn: `node <companion> task --background --fresh --model <slug> --effort medium --prompt-file <brief>`. Never `--write`. Never `--resume` / `--resume-last`: either picks the newest thread in the session, not this seat's. Harvest as SKILL.md says. Only in this mode may Codex take more than one call per review cycle.
- Outside seat: one outside-clis.md run per turn under its challenge bullet.
- Malformed but successful reply: one re-ask with the shape; it counts as a turn; still malformed → failed.
- Failed, empty or timed-out turn: never agreement, never retried. The seat sits out the rest of the run, its open ids stay open, and its endorsement is missing, so the run cannot end in full agreement. Writer failure ends the run: report the last version and what's still open.

## Reply shapes (≤~15 lines each; the plan body goes in the file, not the count)

WRITER
```
VERSION: v<N>  (or UNCHANGED + reason)
CHANGES: - <change> [addresses O<id>]
RESPONSES: O<id> FIXED-BY <change> | O<id> DISPUTED: <reason>
PLAN: <full plan text>
```
CHECKER
```
STANCE: AGREE | OBJECT   (on v<N>)
LEDGER: O<id> CLOSED-FIXED by <cited change> | O<id> WITHDRAWN: <reason> | O<id> STILL-OPEN: <why the change falls short>
NEW: O<next> <objection> — <evidence file:line> — <better alternative>
CHECKED: <files, lines, cases actually checked>   (required with AGREE)
RESIDUAL RISK: <biggest remaining risk>   (required with AGREE)
```

## Ledger

- Boss assigns ids O1, O2… in raise order and records who raised each, by label.
- Only the raiser closes an id: CLOSED-FIXED citing a plan change, or WITHDRAWN with a reason. The writer's FIXED-BY only proposes closure.
- Boss records these as OBJECT:
  - an AGREE while any of that seat's ids are still open after applying this reply's own LEDGER lines;
  - an AGREE on a version identical to the last one it saw, without a cited reason;
  - an AGREE without RESIDUAL RISK;
  - from round 4, an AGREE that doesn't cite the closing change for each of its ids.
- An AGREE without concrete CHECKED evidence is not a check: one re-ask, "Show what you checked" (this is the one malformed-reply re-ask, not an extra); still empty → the seat failed, and the user is told. A round-1 AGREE with no objections gets this check strictly.
- Full agreement means all four of these hold:
  - every checker seated at the start has AGREEd on the same latest version;
  - no seat failed;
  - no ids are open;
  - no seat is left unendorsed by a partial lap.
- A new version needs every checker's AGREE again.

## Rounds and budget

- The default cap is 3; the user may set N. Stop early on agreement, no progress (a round where no id closed or opened), or a repeat (an id reopened, or the same objection back under a new id; boss decides "same" and says so in the round line).
- 10 calls total (writer, checker, re-ask or judge), one kept for the judge; before each seat call check used + 1 + 1 ≤ 10 and rounds ≤ 5; offer only rounds that fit; a stuck run stops mid-lap (seats that haven't seen the last version are not endorsed) and goes to the judge. Never dispatch past 10; full agreement leaves the judge's call unused.
- At the cap, if the ledger changed in the last round, ask the cap question for k = min(asked, 5 − rounds done, ⌊(9 − seat calls used) / calls per round⌋) rounds; k = 0 or no ledger change → go to the judge without asking.
- Only the user's explicit words in this run lift the 5-round / 10-call ceiling; never memory.
- Estimates: ~2 min per Claude turn, 3–8 per Codex, ≤10 per outside.
- Dials: "think more" → one tier harder (Codex `--effort high`), "careful with tokens" → one tier cheaper and cap 2 (Codex `--effort low`); never past hard or below simple. No dial moves the ceiling.

## Judge

- Named judge ("judge with X" / "X judges") → X; X also named as a seat → ask. No judge named and no "claude only" → the setup line may suggest one out-of-family judge that is actually available (a Codex catalog slug if no Codex seat is in the fight, or an outside CLI the user already named this run, never discovered); it's a question, not a dispatch, and with no answer the auto judge runs. Auto judge unavailable → the first unseated of fable, opus, sonnet, haiku, run as `fable-advisor`; all four seated → ask. Disclose a same-family judge in the setup line and the report.
- Blind: the judge sees the same labels every seat sees (Writer, Checker 1/2…). Boss writes the whole judge brief inline: final version, open points with both sides' last words, change log. It contains no file or scratchpad paths. Add "judge only from this brief; do not open files outside the repo." The label→model map appears only in the final report. The judge is never a seat.
- Reply shape: `WINNER / WHY / RISKS / WHAT WOULD CHANGE THE VERDICT`, each open id ruled UPHELD (plan must change: how) or OVERRULED in WHY; INSUFFICIENT EVIDENCE / REFRAME work as in a debate. A re-judge happens at most once, and only if a call is free; otherwise stop with the ceiling message. Judge calls count toward the 10.
- Rulings are never applied silently: the report shows them, and the writer applies upheld ones only after the user's OK; that one writer call is outside the 10, the OK being the explicit lift.

## Build

- The request includes a build task → on full agreement go straight to Protocol (Intake → Dispatch from the final plan; normal review and verify), with no extra question. Pause for the user on a judge-decided, failed-seat, partial-lap or unresolved outcome, or when the plan has destructive, external or irreversible effects.
- "plan …" or no build task → stop at the plan.

## Messages

Plain words, one verb ("check/checked"), no talk of seats, ledgers, ids, turns or ceilings. Use real names, caps and timings; mention a judge only if one was used.

- Setup: `Login touches security, so hard: Sonnet writes, Fable checks it, and if they don't agree Opus decides. Up to 3 rounds (I'll ask before going past that; hard stop at 5), about <n> min each; up to <k> Fable calls.` Same-family judge, only when a named alternative is available: `Sonnet and Fable are both Claude — say "judge with <x>" for a different judge, or just let it run.`
- Each round: `Round 2: Sonnet's new plan fixes the sizing worry; the deploy risk is still open. Opus is checking it again next.`
- At the cap: `3 rounds done, one point still open — the deploy risk. Go one more round? About 4 min.`
- Limit reached: `We've hit the most back-and-forth I'll do without asking — <5 rounds | 10 calls> — before everyone agreed. Still open: the deploy risk. Say "keep going" to allow more, or I'll wrap up with what we have.`
- Pause before build: `<Fable had to break a tie on this one | a check failed | this deletes data>, so I'm pausing before building — say "build it" to go ahead, or "show me the discussion" first.`
- Final report: `Done in 2 rounds. Opus's worry about the sizing was fixed; the deploy-risk question stayed open and Fable sided with Sonnet's plan. Plan: <path>. Sonnet wrote it, Opus checked it, Fable judged — say "show me the discussion" for the full back-and-forth, or "build it" to go.`
