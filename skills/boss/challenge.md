<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Challenge mode — procedure

Read only after SKILL.md's gate passed: the user explicitly asked for challenge mode or named a challenge. Nothing here runs otherwise. Debates never need this file; SKILL.md's judge rules cover them.

## Seats

- Binary: "X challenge Y" → Y authors, X challenges (the one challenged writes the plan). Chain: "A→B→C" / "A, then B, then C" → A authors, then B and C challenge in that order. Mixed or unclear syntax → ask who authors. One lap (author turn plus each live challenger once) is one round.
- "Debate … then challenge": run the debate first; the winning advocate's model authors the winning option, the other advocates challenge it, and the debate judge judges again (seats settled from the debate, so no menu).
- No names: show the menu, call nobody, wait for a pick.
  `Pick an author and challenger(s), e.g. "opus challenge sonnet". Claude: fable, opus, sonnet, haiku. Codex (your catalog; access not verified; spends OpenAI credits): <slugs>. Or name an outside CLI.`
  Slugs: `{ codex debug models 2>/dev/null | grep -o '"slug":"[^"]*"' | cut -d'"' -f4; grep -ho 'gpt[a-z0-9.-]*' ~/.codex/config.toml ~/.codex/.codex-global-state.json 2>/dev/null; } | sort -u`. This is a local read that calls no model. Drop the Codex clause if the command prints nothing or the companion isn't installed. Never list or probe outside CLIs here.
- Routing per seat, as in SKILL.md:
  - a Claude name runs as the `advocate` agent with that model;
  - a Codex name resolves against the catalog;
  - any other name goes through outside-clis.md (resolve, route line, enforced read-only).
  Naming a seat or judge is the opt-in; memory never is. "claude only" drops every non-Claude seat and judge, and says so in one line.
- No author named → ask. The judge is never a seat.
- Author, challengers and judge are settled before turn 1 (see Judge), then frozen for the run: no seat or judge is added or swapped mid-run.
- Setup line before round 1: `Author <m>, challengers <m…>, judge <m> (<family note>) [— suggest judge with <out-of-family>?], cap <n> rounds, ceiling 5 rounds / 10 turns (1 reserved for the judge), ~<min> per round.`

## Canonical plan

- Boss keeps `<scratchpad>/challenge-<slug>/` with three files:
  - `plan-v<N>.md`: the author's full plan, saved verbatim;
  - `ledger.md`;
  - `transcript.md`: every raw reply, appended.
- Only the author changes plan content; boss saves versions and keeps the ledger.
- Every seat brief, every turn and every backend, is closed: the question, FACTS, the current version in full, the change log since this seat's last turn, the open ledger, the seat's role and reply shape, and "read-only; verify only what the plan touches."

## Calls

- Claude seat: the first turn is a fresh `advocate` dispatch; later turns SendMessage the same agent the same closed brief: full current version, change log, open ledger.
- Codex seat: a fresh call every turn.
  - Command: `node <companion> task --background --fresh --model <slug> --effort medium --prompt-file <brief>`.
  - Never `--write`. Never `--resume` / `--resume-last`: either picks the newest thread in the session, not this seat's.
  - Harvest as SKILL.md says: a background waiter polling `status <jobId>`, then `result <jobId>`.
  - Only in this mode may Codex take more than one call per review cycle.
- Outside seat: one outside-clis.md run per turn under its challenge bullet.
- Malformed but successful reply: one re-ask with the shape. The re-ask counts as a turn; still malformed → failed.
- Failed, empty or timed-out turn: never agreement, never retried.
  - The seat sits out the rest of the run and its open ids stay open.
  - Its endorsement is recorded as missing, so the run cannot end in full agreement.
  - Author failure ends the run: report the last version and the ledger.

## Reply shapes (≤~15 lines each; the plan body goes in the file, not the count)

AUTHOR
```
VERSION: v<N>  (or UNCHANGED + reason)
CHANGES: - <change> [addresses O<id>]
RESPONSES: O<id> FIXED-BY <change> | O<id> DISPUTED: <reason>
PLAN: <full plan text>
```
CHALLENGER
```
STANCE: AGREE | OBJECT   (on v<N>)
LEDGER: O<id> CLOSED-FIXED by <cited change> | O<id> WITHDRAWN: <reason> | O<id> STILL-OPEN: <why the change falls short>
NEW: O<next> <objection> — <evidence file:line> — <better alternative>
RESIDUAL RISK: <biggest remaining risk>   (required with AGREE)
```

## Ledger

- Boss assigns ids O1, O2… in raise order and records who raised each.
- Only the raiser closes an id: CLOSED-FIXED citing a plan change, or WITHDRAWN with a reason. The author's FIXED-BY only proposes closure.
- Boss records these as OBJECT:
  - an AGREE while any of that seat's ids are still open after applying this reply's own LEDGER lines;
  - an AGREE on a version identical to the last one it saw, without a cited reason;
  - an AGREE without RESIDUAL RISK;
  - from round 4, an AGREE that doesn't cite the closing change for each of its ids.
- Full agreement means all four of these hold:
  - every challenger seated at the start has AGREEd on the same latest version;
  - no seat failed;
  - no ids are open;
  - no seat is left unendorsed by a partial lap.
- A new version needs every challenger's AGREE again.

## Rounds and budget

- The default cap is 3; the user may set N. Stop early in three cases:
  - agreement;
  - no progress (a round where no id closed or opened);
  - a repeat (an id reopened, or the same objection back under a new id; boss decides "same" and says so in the round line).
- A turn is any call: author, challenger, re-ask or judge. The 10 is total. One turn is reserved for the judge from the start, so seats have 9.
- Before every seat dispatch, check used + 1 (next call) + 1 (reserved judge) ≤ 10, and rounds against the ceiling of 5. Seats thus get at most 9 turns; when the check fails, stop mid-lap: seats that haven't seen the last version are "not endorsed", and the judge takes turn 10.
- A re-judge runs only if a turn is free. Otherwise stop: report the judge's request, the open ids, and "ceiling reached; say so to lift it". Never dispatch past 10.
- Full agreement leaves the reserved turn unused.
- At the cap: if the ledger changed in the last round, offer k = min(asked, 5 − rounds done, ⌊(9 − used seat turns) / turns per round⌋):
  `Round <r> of <cap>: open <ids>. Continue up to <k> more? ~<calls> calls, ~<minutes> min.`
  k = 0, or no ledger change → go to the judge without asking.
- Only the user's explicit words in this run lift the 5-round / 10-turn ceiling; never memory.
- Estimates: ~2 min per Claude turn, 3–8 per Codex turn, ≤10 per outside turn.

## Judge

- Choice, announced in the setup line:
  - "judge with X" → X judges, and fable joins as the last challenger unless it's already seated or X is fable. X also named as a seat → ask.
  - No judge named, and no "claude only" → first suggest, in the setup line, one judge from a family not in the fight: a Codex catalog slug if no Codex seat is in the fight, or an outside CLI the user already named this run (never discovered). The suggestion is a question, not a dispatch; answering "judge with <x>" is the opt-in. Wait for the answer before turn 1; the fallback below applies only when the user declines or explicitly accepts it.
  - No out-of-family option, or the user declined it or accepted the fallback → the first unseated model of fable, opus, sonnet, haiku judges, run as the `fable-advisor` agent with that model, and the same family is disclosed.
  - All four Claude models seated and no out-of-family judge accepted → ask.
  - A same-family judge is disclosed in the setup line and the report. A Codex judge is one fresh read-only call; an outside judge is one outside-clis.md run.
- Blind: the judge sees seats only as Seat A (the author), Seat B, Seat C… in chain order.
  - Boss writes the whole judge brief inline: final version, open ledger with both sides' last words, change log. It contains no file or scratchpad paths.
  - Strip model names, vendor names and self-references ("as Claude", "GPT here", "my earlier turn as opus") wherever they identify a seat. Leave them where they are the plan's subject.
  - Add "judge only from this brief; do not open files outside the repo."
  - Canonical files stay verbatim. The label→model map appears only in the final report.
  - Blinding reduces self-preference but doesn't remove it, so the judge is never a seat.
- Reply shape: `WINNER / WHY / RISKS / WHAT WOULD CHANGE THE VERDICT`, with each open id ruled UPHELD (plan must change: how) or OVERRULED in WHY. INSUFFICIENT EVIDENCE / REFRAME work as in a debate. A re-judge happens at most once, and only if a turn is free (see Rounds). Judge calls count toward the 10.
- Rulings are never applied silently. The report shows them; the author applies upheld ones only after the user's OK.

## Output and after

- One plain line per round to the user, e.g. `Round 2: v3. Seat B closed O1 O3; O4 open. Next: author revises.` (names are fine here; only the judge is blind).
- Final report ≤6 lines: the plan (path to its version), what changed from v1, dissent or judge rulings, the seat→model map with the family disclosure, next step. The transcript only on request.
- Plain "challenge" stops at the plan.
- "challenge … then build" → Protocol (Intake → Dispatch from the final plan; normal review and verify) only on full agreement. Pause for the user on any judge-decided, failed-seat, partial-lap or unresolved outcome, or when the plan has destructive, external or irreversible effects.

## Dials

- "careful with tokens": default cap 2, cheaper Claude seats (haiku/sonnet), Codex `--effort low`.
- "think more": each Claude seat one model up, Codex `--effort high`.
- No dial moves the ceiling.
