<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Outside CLIs — procedure

Read only after SKILL.md's gate passed: the user explicitly asked for a named outside participant. Nothing here runs otherwise.

## Resolve

- A name is not necessarily an executable. Map it to one: `command -v <name>` first, then the vendor's obvious binary (cursor → `cursor-agent`). A model name rather than a vendor → search the model lists of installed multi-provider CLIs only (`ollama list`, `cursor-agent models`, `opencode models`, `llm models` — probe only the ones `command -v` found; some hit the network). Pass names as literal arguments, never as shell code.
- One route that preserves the requested provider/model → use it. Several, or the backend/billing provider is ambiguous → ask. None → report exactly which failure it was: missing executable, model not available, not logged in (give its login command, e.g. `cursor-agent login`), or discovery failed. Never substitute another provider, never fall back to Codex, never install, log in, or pull a model yourself — offer the command, the user runs it.
- Before dispatch, state the resolved route in one line: `<requested name> → <executable> / <model> / <provider> (read-only: <verified restriction>)`, e.g. `cursor → cursor-agent / <model> / Cursor (read-only: --mode ask)`. A sandbox flag alone does not establish read-only.

## Safety — read-only is enforced, never requested

Before the first call to each distinct CLI in a session, read `<bin> --help` for its non-interactive flag and its tool restrictions. The chosen mode must block every mutating tool — shell and MCP included — or disable tool execution entirely. An advisor or debate call needs one of:

- a native mode that disables mutating tools (e.g. `cursor-agent -p --mode ask`), or
- a pure-chat entry with no tool execution at all (e.g. `ollama run <model>` with the brief on stdin).

Neither established → report the route unsupported and stop. A bare `-p`/`--print` on an agent CLI has write and bash — never use it. Instructions like "edit nothing" and a content-baseline check are supplementary, never a substitute. Stdin alone does not make a tool read-only.

## Run

- One call per named participant per review cycle, in the background; if the run is detached rather than a harness background command, start a background waiter polling for its exit (capped at the run's 10 minutes) so its end wakes you. Closed brief: every question batched, the diff or exact file excerpts inline, ending "verify only this; do not explore beyond these files."
- Capture stdout, stderr and exit status to a scratchpad file; cap a run at 10 minutes. A failed, empty or timed-out run is not an opinion — report the observed kind (not logged in → give the CLI's login command; model not available; timeout; empty response; other failure) with its diagnostic line.
- No retries, no rebuttal calls, no fix loops; Claude handles re-validation. On cancellation, confirm the process exited.
- The answer is a claim, weighed like any advisor's. In a debate its opening case may be rebutted and judged, but it gets no second call.
- Challenge mode (`challenge.md`) replaces, for that run only, the one-call, no-second-call, no-rebuttal and no-fix-loop limits above: one fresh closed call per turn, plus one re-ask when a successful reply is malformed. A failed, empty or timed-out run is still never retried. Resolution, enforced read-only, capture, the 10-minute cap and failure reporting apply to every call unchanged.
