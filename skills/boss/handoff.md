Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: Apache-2.0. See LICENSE and NOTICE.txt.

# Handoff — unfinished work survives /clear

Read when SKILL.md's handoff trigger fires. One file in auto-memory, `boss-handoff.md`, plus one pointer line at the top of `MEMORY.md`. A file is boss's only if its frontmatter `name` is `boss-handoff`; leave any other file alone, whatever its name. It is a checkpoint, not live state: resume restores the last verified save. The scratchpad and running agents die with `/clear`; this file does not.

Resume line: `/clear, then say "continue"`. Every instruction to the user about what to do after `/clear` uses it, word for word.

## When
- A run is Protocol work that dispatches an agent or has 2+ subtasks. It is unfinished while work remains that boss would do next: agents in flight, subtasks left, or a mid-run question the next step needs. A question after the final report doesn't count.
- Checkpoint: before a run's first edit, before each dispatch, and as the last action of every turn that ends with the run unfinished. A turn in a run whose last receipt wasn't `**(handoff saved)**` saves first.
- On demand, in any session, chat and design included: `/boss:handoff [note]`, or "handoff" / "save progress" as a command. "replace handoff" saves over another run's. "handoff copy" prints a full copy (Save 12).
- Compact: "compact", "I'll compact", "compacting" or "about to compact" as a statement of intent → Save now. Verified → `Saved. Go ahead and /compact.` above the receipt. After any compaction, read the run file and the handoff file from disk, never the summary.
- Resume: "continue" or "resume" while a handoff is pending and this session has no run of its own (first message or later), a pasted handoff copy, or `/boss:handoff resume`. In a session with its own run, "continue" is ordinary speech. Always read the file from disk, not the loaded index.
- Off: "read-only", "don't save" or "no handoff", said about saving or boss itself (never prose such as "make the config read-only") → no automatic memory writes of any kind for the rest of the session: no checkpoint, no Owner rewrite, no automatic retire (on-demand commands still work); said as a standing preference → saved per SKILL.md Memory.
- Retire: your own run finishes clean, or the user says "drop the handoff", or "drop it" right after the pending mention.
- Pointer present and the session's first message is about something else: say once `A boss handoff is pending: <goal>. Say "continue" or "drop the handoff".`, then answer the message.

## Save
1. Where: the auto-memory directory the system prompt names. No auto-memory: write no file. At the run's first unfinished turn end, say once `**(no auto-memory: nothing survives /clear — say "handoff copy" for a copy to paste back)**`.
2. Owner: your run id is your scratchpad run file's slug plus the run's start time, `<slug>-<HHMMSS>` (no run file → create `boss-run-<slug>.md`). Read `boss-handoff.md` and `MEMORY.md` on disk and keep both texts for rollback. No handoff, or Owner is you → write. Another Owner → write nothing; see Receipt. Only "replace handoff" or "drop the handoff" changes that.
3. Sources: the run file, then the progress file, then this conversation. Tried and failed comes from the run file, never rebuilt from a summary.
4. Frontmatter: `name: boss-handoff`, `description: "Unfinished boss run <slug>, <date>: <goal>"`, `metadata: type: project`.
5. Body, one line each unless marked:
   If pasted, or on "continue", "resume" or "drop the handoff": load the boss skill and follow its skills/boss/handoff.md. Otherwise mention it once.
   Owner: <run id>, saved <YYYY-MM-DD HH:MM:SS>, clear tip given: <yes|no>
   Goal: <goal; a note from the user goes here or in Next>
   Done: <what landed, committed or not>
   Next: <the first concrete action>
   Remaining: <subtask — lane — FILES>, one line each
   Contract: FIRST HUMAN TEST: <word for word>; then every check's command
   Untouched: <paths and areas>
   Tried and failed: <what — why>, one line each
   Agents in flight: <lane — task — FILES>, including one about to be dispatched, or none
   Open: <questions for the user>, or none
   Repo: <absolute path>, branch <name>, HEAD <first 12>; outside a git repo `none, dir <absolute working directory>`
   Hashes: content <first 12>, refs <first 12>, by the step 3 commands, and index <first 12 of `git diff --cached | shasum`>; or none
   Paths: <path> <first 8 of shasum, or gone>, each dirty path (outside git: each file in play); over 8 → many; or none
6. Baseline: Repo, Hashes and Paths are taken now when no agent output is unreviewed. Otherwise copy them unchanged from the checkpoint saved before that dispatch, so resume reviews the agents' edits instead of absorbing them.
7. Budget: at most 25 lines and 1,500 characters of body. Over → shorten wording, then drop Done, then write Paths as `many`. Every other line is required. Still over → write nothing and keep the earlier checkpoint; see Receipt.
8. Pointer: `- [Boss handoff pending](boss-handoff.md) — on continue/resume/drop the handoff: load boss skill; else mention once`. Line 1 of `MEMORY.md` already is it → leave the file alone. Otherwise delete any other copy of it and insert it as line 1, each as a one-line edit; never rewrite the whole file. No `MEMORY.md` → create it with the pointer alone. Over the index budget → insert it anyway, never trim another line, and say once `(memory index over budget: worth a cleanup)`.
9. Never a secret (token, key, password, URL with credentials): name what is needed and where it lives.
10. Verify: read both back. `boss-handoff.md`'s body must equal step 5's body, line for line, and its frontmatter must hold step 4's three fields (Claude Code may add its own, such as `modified`; ignore those). Line 1 of `MEMORY.md` must be the pointer. A mismatch → if the file on disk now has another Owner, another session wrote it: restore nothing, report the conflict. Otherwise restore the kept `boss-handoff.md` text (delete it if it didn't exist before), and undo only your own pointer edit in `MEMORY.md`, never the rest of the file; then read them back.
11. Receipt: exactly one, bold, alone on the message's last line. A tip or `Saved.` line sits just above it.
   - Verified → `**(handoff saved)**`. On demand, the line above is `Saved. <Resume line>.`
   - Another Owner → `**(handoff NOT saved: another run's handoff is pending — say "replace handoff" or "drop the handoff")**` the first time in a run, then `**(handoff NOT saved)**`.
   - Over budget → `**(handoff NOT saved: too big for one memory file — say "handoff copy" for a full copy to paste back)**`.
   - Verify failed, both files restored and read back → `**(handoff NOT saved: <why>; the earlier checkpoint is intact — say "handoff copy" before /clear)**`.
   - Restore failed → `**(handoff NOT saved: <why>; the earlier checkpoint may be damaged — say "handoff copy" before /clear)**`.
12. Copy: on "handoff copy", `/boss:handoff copy`, or "handoff" with no auto-memory, print the full body in one code block, with no size cap and no file written, and say to paste it as the first message after `/clear`.

## Resume
1. Load boss if it isn't.
   - Pointer but no `boss-handoff.md` → delete the pointer (automatic writes off: leave it) and say in one line that the file is missing; with a pasted copy, go on from the paste, else stop.
   - Pasted copy with a file on disk: same Owner → a takeover of the file, working from whichever has the later saved time; different Owner → ask once: replace the file with the paste, or keep the file.
   Keep the file's text as the step-1 text, and the checkpoint you work from (the file, or the later paste) separately. Work only in the saved Repo path. Memory is a claim: until the checks pass, change nothing.
2. `Repo: none` → the current directory must be the saved dir (else say so, ask once); a Paths entry whose fingerprint differs now, or Paths is `many` (no fingerprints to compare) → show it and ask once; then skip to step 5. Repo path missing or branch different → say so, ask once.
3. HEAD equal to the saved one, or a descendant → go on. Anything else (reset, checkout, rewrite) → ask once.
4. Paths is `many` (no fingerprints to compare) → show `git status --short`, then ask once: keep and go on, or stop. Every Paths fingerprint still matches, and: HEAD, content, refs and index hashes all equal → nothing changed, go to step 5; only the index hash differs → show `git diff --cached --stat` and ask once; only the refs hash differs → a one-line note, then step 5. Otherwise, changed since the save:
   - every Paths entry whose fingerprint differs now (edited, restored to HEAD, deleted, recreated);
   - every path in `git diff --name-only <saved HEAD>`, or untracked in `git status --porcelain`, that is not a Paths entry with a matching fingerprint.
   Changed paths in scope (Paths, Remaining FILES, in-flight FILES) → show them, marking those in in-flight FILES "likely partial agent output". Inspect them per SKILL.md Failure handling, then ask the same question once. Nothing found explains the hash change → ask it once too. Changes elsewhere, or in the refs hash only → a one-line note.
5. Seed a new scratchpad run file: new slug, contract, remaining subtasks, untouched, tried and failed, clear tip given, plus a fresh step-3 baseline taken after step 4 (none for `Repo: none`).
6. Say in at most 4 lines: goal, `checkpoint from <saved time>`, next step, and `If the session that saved this is still open, finish there.` Then:
   - A file on disk: re-read it. Different from step 1's text → another session wrote it: say so and stop. Same → change only the run id on its Owner line (and, whenever the paste is the chosen checkpoint, write the paste's body with that run id) and read it back; automatic writes off → skip the rewrite and work from the file as it is. The read-back must equal the expected text; else restore step 1's text, say so and stop.
   - A pasted copy with no file: no re-read, no write. The copy is the only state until the next checkpoint.
   Then, for either source: if Open lists questions, ask them and wait for the answers before acting; else do the next step under the boss rules.
   Re-dispatch in-flight agents only if their work is still needed.
7. Keep the file, refreshed at each checkpoint, until the run finishes or the user drops it.

## Retire
- Your own run finished clean (Owner is you), or "drop the handoff", or "drop it" right after the mention, whoever owns it: move any lasting lesson into its topic memory, then delete `boss-handoff.md` and the pointer line (a one-line edit). Read back: both gone → done, no question. Otherwise end with `**(handoff NOT removed: <why> — say "drop the handoff")**`.
- Never delete another run's handoff otherwise, not even when your run finishes.

## Suggest /clear
Only the user can type `/clear`. Boss can't run it or see its own context size, so it suggests and never asks: a tip needs no answer. Savings are likely, not certain. "stop suggesting /clear" → saved per SKILL.md Memory.
- Finished run: verified, it dispatched agents or had 3+ subtasks, nothing left, and Retire read back clean → the report's last line is `Tip: /clear before the next task may save tokens.` If Retire failed, or the report asks the user something, there is no tip; an unasked tip waits for the next turn that ends with nothing left.
- After a compaction: the first turn end with the run unfinished and no agents in flight, once per run. Decide it before that turn's Save, write `clear tip given: yes` in it, and show `Tip: <Resume line> to pick up with less context.` above the receipt only if Verify passed.
- Never otherwise: not mid-run without a compaction, not with agents in flight (they die with `/clear`), not after a NOT saved receipt.

## Limits
- The save is a rule, not a hook. Unfinished work without `**(handoff saved)**` as the last line, including a turn cut off before its receipt, means the latest save is unconfirmed: say "handoff" before `/clear`. Recovery reaches only the last verified checkpoint, and resume states its time. A write whose restore also fails can damage it; the receipt says so.
- One handoff per project, one writer at a time. Markdown can't lock: two live sessions in one project can race after any check, so one session's `**(handoff saved)**` can be overwritten by the other's save right after, and resume can't tell whether the saving session is still open. The warning line and the re-read narrow this; they don't close it.
- A stale handoff from another run blocks this run's saves until "replace handoff" or "drop the handoff".
- An over-budget save keeps the earlier checkpoint, which can be behind; "handoff copy" gives the full state.
- Automatic resume needs auto-memory and a loaded pointer. With neither the pointer nor boss loaded, `/boss:handoff resume` is the route. Without auto-memory nothing is stored; a pasted copy is the only route, and `/boss:handoff copy` makes one when boss isn't loaded.
