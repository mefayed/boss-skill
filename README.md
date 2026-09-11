# boss

**One orchestrator, the right model for every job.**

A Claude Code skill that turns your main session into a supervisor: it triages every coding task to the cheapest model that can do it right — Haiku for mechanical work, Sonnet for standard features, Opus for the hard stuff — consults a Fable advisor before expensive-to-reverse decisions, runs multi-model debates when an approach needs validating, reviews every diff itself, and reports back in one compact message. Your main chat stays lean; the work happens in isolated subagent contexts.

```
you → /boss fix the export filter and add date range to search
      → 2 tasks. haiku: filter fix. sonnet: date range. running.
      ✓ done. 4 files, gates pass. 1 judgment call: reused existing debounce — ok?
```

## Why

- **Token efficiency.** Standing rules live in agent definitions (sent once per spawn, never repeated in briefs). Briefs are 6 lines. Reports are summaries. Bounces are deltas to a live agent, not respawns. Escalation is bounded: one bounce, then the supervisor takes over.
- **Right-sized models.** Six lanes (haiku → opus-deep) routed by total expected cost _including review and rework_ — a likely one-shot Sonnet beats Haiku-fail-then-Sonnet. Inline is the default — localized work (≤3 files, ≤~100 non-generated lines, an existing pattern, fast deterministic gates) never leaves main chat, since dispatch that buys no parallelism, specialization, or context isolation costs a whole session for nothing.
- **Review-first.** The supervisor reads the actual diff in full, re-runs the decisive gate itself, and checks test edits before trusting green. Builder reports are claims, not evidence. Builders never commit.

## Install

This repo is a Claude Code **plugin marketplace** — one command gets the skill _and_ the agents, on CLI and Desktop alike:

```
/plugin marketplace add mefayed/boss-skill
/plugin install boss@boss-skill
```

Bundled agents register automatically — no manual copying. On **Claude Desktop**, use **+ → Plugins → Add plugin** with the same repo.

Alternatives:

```bash
# skills CLI (skill only; then copy agents by hand)
npx skills add mefayed/boss-skill && cp agents/*.md ~/.claude/agents/

# fully manual
mkdir -p ~/.claude/skills/boss ~/.claude/agents
cp skills/boss/SKILL.md ~/.claude/skills/boss/
cp agents/*.md ~/.claude/agents/
```

The skill also works without the agent files — it falls back to `general-purpose` subagents with the builder contract inlined in the brief.

## Use

Start a session on your strongest model (the supervisor role assumes it), then:

```
/boss <task>
```

It also auto-triggers on plain coding tasks without the slash command.

### Steering

| You say                                 | Effect                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| `boss think more`                       | shifts dispatches one step up (deep variant or next model)        |
| `boss careful with tokens`              | shifts down, skips the advisor unless irreversible, batches edits |
| `use sonnet` / `ask fable` / `no fable` | overrides the triage directly                                     |
| `delegate to codex` / `delegate to astra`  | routes implementation to the Codex lane (optional, see below)     |
| `second opinion from codex` / `consult astra` | adds Codex as an additional advisor                              |
| `debate it` / `validate this approach` / `compare options` | runs a structured debate before the work (see below)  |
| `debate with astra` / `debate it, include codex` | adds one Codex advocate per named model to the debate       |

Directives persist for the session until countermanded.

## What's inside

```
skills/boss/SKILL.md      the orchestration protocol (triage, briefs, review, escalation)
agents/builder.md         implementer contract — rules + report format, model chosen per dispatch
agents/builder-deep.md    same contract at high reasoning effort
agents/errand.md          bounded read-only lookup contract — answers, never edits; Agent tool denied too
agents/fable-advisor.md   design critique before irreversible decisions; advises, never edits
agents/advocate.md        argues one assigned approach in a debate; read-only, evidence-cited
hooks/builder-guard.sh    tripwire: blocks destructive Bash (push, commit, reset --hard, rm -rf, DROP, gh/curl writes) from builder + errand + advocate agents ONLY
tests/guard-test.sh       pins the guard's allow/block table and the agent-file shape, incl. known ceilings
```

The guard is agent-scoped: hook input carries `agent_type` only inside subagents, so your own commands and the supervisor's are never intercepted. Best-effort tripwire against accidental destructive commands from builder, errand and advocate agents. Not a security boundary — obfuscated commands get through (including any indirection that hides the command text, such as writing it to a file and running `sh that-file`; an agent building this release did exactly that unprompted) and some safe commands are wrongly blocked; the supervisor's full diff read remains the real enforcement. It fails open on unexpected input, and the `general-purpose` fallback lane stays instruction-only (unguarded).

The errand agent has Write/Edit/NotebookEdit/Agent hard-removed at dispatch; the advisory lanes (`fable-advisor`, `advocate`) instead enumerate a closed `tools:` list, which also withholds every MCP server. Errand and advocate share the builders' destructive-Bash tripwire. Neither is read-only enforcement: Bash stays live in every one of these lanes and the guard only pattern-matches it — a plugin cannot sandbox a shell, so an authenticated CLI the guard does not name can still reach the outside world, the errand lane keeps every writable MCP server the session carries, a `Skill` that runs in its own subagent brings its own tools, and an unchanged content baseline cannot see commits, pushes, or external state. The brief's READ-ONLY line is the contract; re-running decisive checks yourself is the enforcement.

### The lanes

| Lane        | For                                                                  |
| ----------- | -------------------------------------------------------------------- |
| errand      | bounded read-only lookup — docs, MCP/skill queries, tool runs; returns an answer, never edits |
| haiku       | mechanical, pattern exists, zero design decisions                    |
| haiku-deep  | fiddly-mechanical — the cheap-model-thinking-hard bet                |
| sonnet      | standard feature/fix, clear spec                                     |
| sonnet-deep | hard but contained                                                   |
| opus        | cross-cutting, security, uncertain spec                              |
| opus-deep   | rare, genuinely hard                                                 |
| advisor     | one-exchange critique, on demand — a blocking decision or the user asks |
| debate      | validate an approach when 2+ real options exist (see below)          |
| codex       | outside implementer or second opinion via the Codex CLI (optional)   |

### The loop

1. Supervisor traces the affected code, splits the task, records a content baseline (`git diff HEAD` plus hashed untracked files — `git status` alone misses an edit to an already-modified file). Small localized work stays inline — dispatch buys parallelism, specialization, or context isolation, and costs a session when it buys none. Recon past two quick reads goes to the builder, which traces its own bounded area.
2. Each builder gets a self-contained brief: `GOAL / FILES / VERIFY / UNTOUCHED / DONE WHEN / FACTS` — exact gate commands, explicit no-touch list, decisions carried forward from earlier subtasks.
3. Builders verify their own work and return a structured report. They never commit.
4. Supervisor reviews the diff (test edits first), re-runs the decisive gate, surfaces judgment calls.
5. Small defect → supervisor patches it. Substantial → one delta bounce to the same agent. Still wrong → supervisor takes over. No loops.
6. Queues get a progress file, decided-facts carry-forward, and a coherence close (full gates + repo-wide grep) at the end.

## Debate — validating an approach

When you want proof that an approach is the best one before expensive work, say `debate it` (or `validate this approach`, `compare options`). The supervisor:

1. Traces the code and frames 2–3 real candidate approaches with shared facts.
2. Spawns one read-only **advocate** per candidate, in parallel, on **different models** (default Sonnet + Opus) so it isn't one model arguing with itself. Each argues its position with `file:line` evidence and must concede the condition under which a rival wins.
3. A **Fable judge** rules: `WINNER / WHY / RISKS / WHAT WOULD CHANGE THE VERDICT` — or `INSUFFICIENT EVIDENCE` / `REFRAME` when a forced winner would be false confidence.
4. Too close → one delta rebuttal round (each advocate sees only the attacks against it), then the judge decides. Never a third round.
5. You get a compact verdict; the expensive work still waits for your green light.

Cost dials apply: `careful with tokens` → 2 cheap advocates, Opus judges. `think more` → Opus advocates, Fable judges. **Codex joins only when you name it** ("debate with astra" / "debate it, include codex") — never automatically, since it spends your OpenAI credits.

## Optional: Codex as an extra lane

If OpenAI's Codex plugin is installed, boss can hand work to Codex — as an implementer (briefed like a builder, diff reviewed the same way), as a second advisor, or as a debate advocate. Naming a model routes it explicitly — "debate with astra", "consult sol", "delegate to terra". The model list is **never hardcoded**: boss resolves the name against the live Codex catalog plus your config at dispatch time, so a model released tomorrow works tomorrow, with no update to this skill. Codex is always opt-in by name — boss never spends your OpenAI credits unasked. It runs as a **single deep pass in the background**, in parallel with the Claude advisors — never inside a fix-review-refix loop, where its 8-minute exploration cost buys nothing a Claude advisor doesn't deliver in 90 seconds.

Not installed? Two steps:

```
npm install -g @openai/codex        # the Codex CLI, then run `codex` once to log in
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
```

Without it, the codex lane simply doesn't exist — everything else works unchanged.

## Scoping what an agent can reach

There is no per-dispatch scoping — the Agent tool takes no tools parameter. A lane's surface is fixed in its agent file:

| Frontmatter | Effect |
| ----------- | ------ |
| `tools:` | Allowlist: the lane gets exactly what you name and nothing else. Omit `Skill`, the MCP tools or `ToolSearch` and the lane cannot reach them — verified: an agent pinned to `Read, Glob, Grep, Bash` sees no MCP at all |
| `disallowedTools:` | Denylist, takes patterns — `mcp__github`, `mcp__*` |
| `mcpServers:` | Ignored in plugin agent files — the loader warns and drops it. Subagents inherit the session's servers; close `tools:` to withhold them |
| `skills:` | Preload full skill content at startup |

Omitting `tools:` inherits everything — but MCP schemas are **deferred**: names only, ~0 tokens until a tool is actually called. That is why the errand lane omits it. Inheriting is what lets it run skill and MCP errands, and it costs nothing until one is used.

## Requirements

- Claude Code with subagent support (`.claude/agents` definitions, per-dispatch model overrides).
- Access to the models you want in the lanes; edit the `model:` frontmatter in `agents/*.md` to match your plan.

The plugin itself has **zero dependencies** — markdown plus a plain POSIX-sh hook. Everything below is optional; when a tool is missing, boss degrades to the nearest available check, says so in its report, and suggests the install line.

### Optional tools

| Tool | Unlocks | Install |
| ---- | ------- | ------- |
| playwright-cli | screenshot verification of UI work | `npm install -g playwright && npx playwright install chromium` |
| Codex CLI + plugin | the codex lane (outside implementer, advisor, debate advocate) | see "Optional: Codex as an extra lane" below |
| GitHub CLI (`gh`) | PR/issue steps in briefs that need it | `brew install gh` (macOS) / [cli.github.com](https://cli.github.com) |

## License

MIT
