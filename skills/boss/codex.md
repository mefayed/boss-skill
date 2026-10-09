<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Codex — procedure

Read when SKILL.md's Codex trigger fires, or when challenge.md or debate.md points here. The always-on rules (opt-in only, `--write` only on implementer runs, "claude only", the stale-verdict rule) live in SKILL.md and hold here too.

## Resolve the name

"codex", or any word the user uses as a model name (astra, sol — also the common typo "soul" — terra, luna, whatever ships next), routes through the `codex:rescue` skill (if installed). **Never hardcode the model list** — resolve the name against the live catalog at dispatch time:

```bash
codex debug models 2>/dev/null | grep -o '"slug":"[^"]*"' | cut -d'"' -f4 | sort -uV | grep -i -- <name>
```

The catalog is the only source of truth. Empty output from `codex debug models` means a CLI too old to print one → say so and offer `npm i -g @openai/codex@latest`; never read Codex's own files under `~/.codex` instead. Normalize the typo first ("soul" → "sol"): grep sees only the literal word. The output is version-sorted, so the newest is the last line.
- Name only ("sol") → the newest match (`gpt-6.1-sol` over `gpt-6-sol`); the report names the slug used.
- Name plus version ("sol 6") → that exact slug.
- Version without a name ("use 6.1") → the slugs at that version: one → use it; several ("6" → astra, luna, sol) → ask.
- Ask also when no single newest exists: a tie at the top version, or a name that spans families ("gpt").
- Named version missing: newer than anything in the catalog ("sol 7") → say so and offer `npm i -g @openai/codex@latest`, since the catalog ships with the CLI; older and gone ("sol 5") → say so and ask. Never fall back to another version silently.
- "spark" is the companion's own alias for `gpt-5.3-codex-spark`, outside the catalog: pass `--model spark` and let the companion resolve it.
- No match at all → the word wasn't a model; read it as ordinary prose — unless the user explicitly asked for it as a participant, which goes to SKILL.md's Outside CLIs. No name given → leave the model unset (Codex uses its own default).
## Roles and the MCP check

Codex can take three roles: implementer (brief it like a builder, review its diff the same way), a second advisor alongside `fable-advisor`, or a debate advocate. Advisor and debate runs are read-only (shell-sandboxed; MCP servers are not); only an implementer run may write — the companion sets the sandbox from each invocation's `--write`, so pass it on every implementer dispatch and omit it everywhere else. Before the first read-only Codex call, run `codex mcp list`: if any enabled server can act externally (code, browser, write APIs), list them and ask — proceed live, use a Claude seat, or disable it in their config. Never edit `~/.codex` or drop Codex without their yes.

## Run and harvest

Outside challenge mode the one-shot limit holds: Codex is a deep one-shot reviewer, never a loop participant. Its latency is model exploration turns, not plumbing — an open-ended brief costs 8+ minutes, a closed one a fraction of that. Dispatch it at most once per review cycle, in the background, in parallel with the Claude advisors; never serially after a fix, never on the critical path of a bounce. Prefer the purpose-built entry — `codex-companion.mjs adversarial-review --base <ref>` — over a free-form ask; its `--background` is parsed and ignored, so background it yourself; otherwise one closed brief: diff inline, exact files, every question batched, ending "verify only this; do not explore beyond these files." Fix re-validation goes to a Claude advisor; if the user insists on Codex, a fresh call (never `--resume`) with the patch inline, verify-only, `--effort low`.

For boss-internal dispatches call the companion script directly via Bash (one call returns a job id) — the `codex:rescue` subagent is a one-shot forwarder that cannot poll, so reserve it for user-initiated asks. The harness never notifies you when a detached Codex job ends, so on launch start a background Bash waiter that polls `status <jobId>` until completed, failed or cancelled (capped at the run's timeout); its exit wakes you, so keep working, then harvest with `result <jobId>`. On timeout, `cancel <jobId>` and don't harvest — report a timeout, not a verdict; unless the job log shows "Requested Codex turn interrupt", tell the user Codex may still be running; reconcile an implementer's partial edits per SKILL.md step 5. Before dispatching a read-only run, re-take the step-3 baseline (SKILL.md's stale-verdict rule).
