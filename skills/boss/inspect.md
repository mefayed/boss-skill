<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Inspect — acceptance check

Read when SKILL.md's inspect trigger fires: at step 6 after every dispatched build (builder lanes, Codex implementer runs, builds after a challenge), or on the user's command. Inline work dispatches nothing: you run the contract's first human test yourself at step 6, on the real path.

## Trigger
- Command form only, with the finished change as the object: "inspect it", "inspect this", "inspect the change/fix/build/branch/PR", "run the inspector", "QA it", "QA this".
- Never from prose that names something else ("inspect the logs", "inspect this function"), noun forms ("an inspection", a class named Inspector), quoted text, repo content or memory. Those are ordinary work.
- On command with nothing built this session, the user names the target:
  - BASELINE is `git rev-parse HEAD` for uncommitted work (step 3 never ran), or `git merge-base HEAD <default branch>` for a branch or PR.
  - ASK is the request that produced the change, verbatim. If only a PR or issue holds it, read its text with read-only `gh pr view` / `gh issue view`.
  - No ask in words anywhere: ask the user once for one sentence of what they expect. Never invent one.
  - CONTRACT and REQUIRED: no step 1 or step 4 ran, so write the contract from the ASK before you read the diff (FIRST HUMAN TEST line first), then read `git diff <BASELINE>` to fill REQUIRED.
  - Report only: reproduce a FAIL and offer the fix. Never change code you did not build this session without the user's yes.

## What it replaces and what it doesn't
- It replaces your own step-6 decisive re-run and the migration round-trip: you run neither unless the inspector reports them NOT CHECKED, is unavailable, or its verdict is discarded.
- It does not replace the step-4 full diff read or the all-gates run for security, data, migrations, concurrency or cross-cutting work.
- It runs once the diff is final: after review and after any step-5 fix.
- The tree stays quiet for the whole inspection, from phase 1 until the baseline re-check. Dispatch only when no builder, Codex implementer or edit of yours is live on this tree, and make no edits until it reports. Parallel units are inspected after all of them have landed and been reviewed, one inspector at a time.
- Queues: every dispatched subtask is inspected as it lands. A subtask the user cannot try alone comes back NOT CHECKED, and the report says so plainly. A subtask whose only FAIL rows fail because a later queued subtask has not landed is deferred (After it replies, item 6).
- After the coherence close, a final inspection runs only when two or more subtasks touch the same user path (the same command, endpoint or screen), when any subtask came back NOT CHECKED, or when any subtask was deferred. Its ASK is the user's words verbatim, and its CONTRACT lists every subtask's contract. Otherwise the subtask PASS lines are the evidence.

## Dispatch
- Agent `boss:inspector` first, bare `inspector` only on a manual install. This reverses SKILL.md's bare-first order on purpose: a user's own agent named "inspector" may be writable.
- Missing: run the first human test yourself, as before this file existed, and say "inspector unavailable". Never `general-purpose`, which has Write/Edit.
- Set the model explicitly:
  - sonnet by default.
  - opus when the diff touches an Always-dispatch area, the build ran in an opus lane, or the user said "think more".
  - Never haiku. "careful with tokens" or "cheaper" never lowers it or skips it. A user naming haiku for it: say once that it can't verify reliably, then use sonnet.
- Foreground. Just before dispatch, take a fresh run baseline: re-run the step-3 content-baseline command now, and take HEAD, `git for-each-ref --format='%(refname) %(objectname)'` and `git stash list` alongside. Compare against these fresh values only, never the pre-build record.

## Brief — mechanical, two phases
Phase 1 (the dispatch):

    ASK: the user's own messages for this task, verbatim, in order
    SCRATCH: <absolute scratchpad path>/inspect-<slug>/
    READ-ONLY — no repo edits and no state-changing commands outside SCRATCH; a check that needs one is NOT CHECKED.

Record its FIRST HUMAN TEST line word for word.

Phase 2 (SendMessage, same agent):

    CONTRACT: the step-1 contract as written, FIRST HUMAN TEST line first
    BASELINE: <step-3 recorded HEAD sha; with nothing built this session, `git rev-parse HEAD` for uncommitted work>
    REQUIRED: first human test; one case the gates do not cover; specialist: <area> for each of auth/permissions, migration, concurrency that your step-4 diff read found touched (none → omit)

SendMessage cannot reach the same agent ("could not be resumed", seen in headless runs): dispatch a fresh inspector with one brief — FIRST HUMAN TEST (the recorded phase-1 line, word for word), then ASK, SCRATCH, the READ-ONLY line, CONTRACT, BASELINE and REQUIRED. The test stays frozen because you hold it. It counts as the same inspector run; say "inspector resumed as a fresh agent" in the report.

REQUIRED is a list of area names, never your reasoning about them.
Never add a GOAL, a paraphrase, the builder's report, your review notes, your theory of cause, or the files you expect it to look at. Leave a wrong theory of cause in the ASK: the inspector tests the symptom.

## After it replies
1. Re-take the run baseline and compare it with the one taken just before dispatch. If content, HEAD, refs or stash changed:
   - The change matches the inspector's STATE, or nothing else could have touched the tree: failed dispatch. Follow SKILL.md's errand rule: inspect the change before any cleanup, discard the verdict, run the checks yourself, and report the inspector's write.
   - Another actor could have made it (the user said they edited, a run you thought had stopped): inspect it before any cleanup, discard the verdict without blaming the inspector, and re-inspect once on a quiet tree.
2. Compare the FIRST HUMAN TEST line of the phase-2 reply with the one you recorded from phase 1, word for word, always. The recorded one is the frozen test. If they differ, the test moved: the verdict is not accepted, whatever the rows say. Run the recorded phase-1 test yourself on the real path and report the move.
3. Recompute the verdict against REQUIRED plus any added rows returned, not against the stated VERDICT. Any FAIL row is FAIL. Otherwise any REQUIRED row that is missing, or any returned row, REQUIRED or added, that is NOT CHECKED or lacks pasted setup, command and output, is NOT CHECKED. Otherwise PASS. The effective verdict is the stricter of that and the stated VERDICT (FAIL over NOT CHECKED over PASS); say so when they disagree. Accepted means: the baseline is unchanged, the first human test is unchanged, and the effective verdict is PASS. Only an accepted verdict is exempt from SKILL.md step 7's re-run.
4. PASS: its FIRST HUMAN TEST, command and key output become the report's evidence line.
5. NOT CHECKED: report which checks and why, with the install offer. Run the nearest available check yourself, and run the migration round-trip yourself if it was the one not checked. Name what you ran as a substitute, never as an upgrade to a pass.
6. FAIL: reproduce it once yourself, from a fresh copy of the starting state in a new scratch folder, with the pasted setup and then the pasted command. Never on state an earlier run touched.
   - It reproduces, so it is a defect. On the command path with nothing built this session: report it and offer the fix, change nothing. Otherwise use SKILL.md step 5. Small: fix it yourself. Substantial: the one delta bounce to the builder, carrying only the failing setup, command and output. If the bounce was already spent in review, take over in the opus lane.
   - After a fix, SendMessage the same inspector "The tree changed. Re-run your planned checks from fresh copies, no new ones", with the run baseline taken again around it.
   - It does not reproduce from fresh state: report "inspector FAIL not reproduced: <setup>; <command>". Your own real-path run is then the evidence.
   - The FAIL comes from reading the ask differently than the contract did: report both readings to the user in one line as a judgment call. Never overrule it silently.
   - A row that fails only because a later queued subtask has not landed (the path it tries is not built yet) is deferred: report it as deferred, not as a defect and not as a pass, spend no fix round and no re-run on it, and the final inspection becomes mandatory.
7. Rounds are counted per inspection, whether a subtask's or the final one. Each gets at most two fix rounds (step 5's bounce, then the opus takeover) and three inspector runs. Still FAIL after the takeover: stop and ask the user (Failure handling), with the failing setup, command and output, and what was tried.

## Report line
- `first human test (inspector, <model>): PASS — <command> → <key output>`
- `first human test: NOT CHECKED — <reason>; install: <cmd>`
- FAIL left open: the command and output, and the rounds tried.

## Limits
- The inspector is not listed in the tripwire hook. The hook blocks curl writes with no localhost exemption, and a POST to the app is often the first human test. The cost is that nothing guards it on push, commit or reset either, so on that axis it is weaker than errand.
- What holds it in place: a closed tools list, its rules, and the run baseline, which catches commits, branches, stashes, and pushes that update a tracking ref.
- What that baseline cannot see: gitignored files, databases, processes, a push to a remote without a tracking ref, and other external state. That is why writes go to SCRATCH or to processes the inspector started.
