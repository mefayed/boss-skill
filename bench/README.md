# boss benchmark

This compares plain Claude Code with Claude Code plus the boss plugin. Both get the same coding tasks, the same model and the same prompt text. Each run records what it cost, how long it took, and whether the result passes tests the agent never saw.

Boss claims to give the same result for less money. This benchmark tests that claim, including the cases where it doesn't hold.

## What runs

For every task, each condition, and each repetition, `run.sh`:

1. Copies `fixture/` into a fresh temp directory outside this repo, then runs `git init` and makes one commit.
2. Runs `claude -p` in that directory, headless, with a dollar cap.
3. Records the diff against the initial commit.
4. Copies the task's `hidden_test.py` into `tests/test_hidden.py` and runs the hidden test alone, then the whole suite.
5. Appends one JSON line to `results/<timestamp>.jsonl`.

After all runs it prints a markdown table.

The two conditions:

| | baseline | boss |
|---|---|---|
| prompt | text of `task.md` | `/boss:boss ` + the same text |
| main model | `--model $MODEL` (default `opus`) | same |
| plugins | none (only Claude Code's built-ins) | only boss, loaded from this repo with `--plugin-dir` |

Boss is loaded from this working tree, not from an installed copy. The runner copies the plugin's folders (without `bench/`) to a temp dir and loads that, so the plugin path never leads to the hidden tests. Each result line records the repo revision (`boss_rev`), so you can tell which version of boss was measured.

## Isolation

The person who built this has many plugins, skills, hooks, MCP servers and an output style installed globally, boss included. Without isolation, both conditions would carry all of that. Each run uses:

- `--setting-sources ""`, which loads no user, project or local settings. That means no enabled plugins, no user hooks, and no output style.
- `--strict-mcp-config` with no `--mcp-config`, so no MCP servers load.
- `--settings '{"autoMemoryEnabled":false}'`, so there is no auto-memory.
- `--no-session-persistence`.
- `env -i` with only `HOME`, `PATH`, `USER`, `LOGNAME`, `TMPDIR`, `LANG` (and `ANTHROPIC_API_KEY` if you set one). Nothing from a parent shell or a parent Claude Code session leaks in.
- `--permission-mode bypassPermissions`, so the agent can edit and run tests without prompts. This setting is the same in both conditions.

None of this needs an API key. It works with a normal `claude` login (OAuth/keychain). Options that were tried and rejected:

- `--bare` reads only `ANTHROPIC_API_KEY`.
- A temp `CLAUDE_CONFIG_DIR` loses the login ("Not logged in").
- `--safe-mode` still listed 25 user plugins in the session and kept the user's output style.

Isolation is checked on every run, not assumed. The session's `init` event lists the loaded plugins, skills, agents, MCP servers, output style and memory paths, and each result line stores them under `isolation`. A run gets `isolation_ok: true` only when all of these hold:

- the non-built-in plugins are exactly `[]` (baseline) or `["boss"]` (boss)
- there are no MCP servers
- the output style is `default`
- memory is off

The summary warns about any run that fails the check. On the development machine, baseline loaded 19 built-in skills and 5 built-in agents. Boss loaded the same plus `boss:boss` and the 5 `boss:*` agents.

## Tasks

The fixture is `fixture/`, a small shop library: orders, inventory, pricing, reports and a CLI. It has 10 source files, about 420 lines, 32 visible tests, and conventions written in its README. It is Python 3.9+ standard library only, so there is nothing to install.

| id | kind | what it asks | expected size |
|---|---|---|---|
| 01-rename-format-cents | mechanical | rename a helper everywhere, no alias | 5 files, one-word edits |
| 02-barcode-field | mechanical | add an optional field following the `category` pattern | 3 source files + tests |
| 03-cancel-stock-bug | standard | bug report that blames the wrong component | 1 line of logic |
| 04-report-since | standard | small CLI feature with input validation | 1-2 files |
| 05-partial-refunds | harder | cross-file feature with an exact-cents edge case | 4-5 files |

Each `task.md` is the exact prompt, written the way a user would type it. The tasks were not picked to favour boss. Task 03 is a one-line fix and tasks 01-02 are mechanical. Boss's own rules say to do work this small inline, so on these tasks its extra instructions may cost more than they save. That is part of what the benchmark measures.

The hidden tests check behaviour the prompt asks for, through public functions, the CLI and the files on disk. They don't check how the code is structured.

Two checks were done on the hidden tests during development:

- Each one fails on the untouched fixture. The command is under [Re-checking the tests](#re-checking-the-tests).
- Each one passes, with the full suite, after a hand-written reference fix. The reference fixes are not included here.

## Running it

Requirements: `claude` logged in, `python3` (3.9+), `git`, a POSIX `sh`.

```sh
sh bench/run.sh                                  # all 5 tasks x 2 conditions x 1 rep
REPS=3 sh bench/run.sh                           # more reps (recommended)
TASKS="01-rename-format-cents 03-cancel-stock-bug" sh bench/run.sh
sh bench/run.sh summarize bench/results/<stamp>.jsonl   # re-print a table
```

| variable | default | meaning |
|---|---|---|
| `CLAUDE_BIN` | `claude` | path to the Claude Code binary |
| `MODEL` | `opus` | main model, same for both conditions |
| `BUDGET` | `3` | `--max-budget-usd` per run; a run that hits it ends with an error and counts as whatever its tests say |
| `REPS` | `1` | repetitions per task and condition |
| `TASKS` | all | space-separated task ids |
| `CONDITIONS` | `baseline boss` | either or both |
| `EFFORT` | unset | passes `--effort`; unset means Claude Code's default for the model |

A full run is 10 sessions. At the default cap, the most it can spend is $30 per rep.

Run order alternates. On some tasks baseline goes first, on others boss does, and the pattern flips each rep. That way neither condition always runs second, which could give it warmer prompt caches.

## Reading the results

The summary table shows, per task and condition:

- mean cost in USD
- mean wall-clock seconds
- passes out of runs, where a pass means the full suite, including the hidden test, passed
- for boss, how many subagents it dispatched

It ends with totals and a boss-vs-baseline percentage for cost and time.

Each line in `results/<stamp>.jsonl` holds one run:

- `total_cost_usd`, `num_turns`, `model_usage` (per-model tokens and cost), `is_error`, `subtype` (`success`, `error_max_budget_usd`, ...): taken from Claude Code's final `result` event.
- `wall_s`: seconds measured by the runner. This is the time the summary uses. When boss runs a builder in the background, the headless session reports one `result` per turn. `result_events` counts them. Each one's `duration_ms` covers only its own turn, but `total_cost_usd` is cumulative, so the runner takes cost from the last result and time from the clock.
- `dispatches`, `dispatch_lanes`: subagent calls from the main session, as `type/model`.
- `hidden_pass`, `suite_pass`, `suite_tests_ran`.
- `files_changed`, `insertions`, `deletions`: the diff against the fixture, after the run and before the hidden test is added.
- `isolation`, `isolation_ok`: see above.
- `claude_version`, `boss_rev`, `model_requested`, `effort`, `budget_usd`, `slot` (1 = ran first in its pair).

`results/raw/<stamp>/<task>.<condition>.<rep>/` holds the full stream-json transcript, stderr, `diff.patch` and the test output for every run. It is git-ignored because of its size. Keep it if you publish numbers, so anyone can check them.

`total_cost_usd` is Claude Code's own estimate at list API prices (`costBasis: "list"` in `model_usage`). On a subscription it is not what you are billed, but both conditions are priced the same way.

## Results so far (2026-10-05)

Claude Code 2.1.289, main model Opus 5.5 in both conditions, one run per cell. Small N: this shows direction, not proof.

| task | baseline $ | boss $ | both passed |
|---|---|---|---|
| 02-barcode-field | 0.17 | 0.23 | yes |
| 04-report-since | 0.21 | 0.27 | yes |
| 05-partial-refunds | 0.26 | 0.31 | yes |
| **total** | **0.64** | **0.81** | 6/6 |

On these tasks boss cost about 26% more for the same result. Every task was small enough that boss did it inline and dispatched nothing, so it paid for its own instructions and extra checks and saved nothing. That is the honest finding: boss does not save money on small work in a small repo. Its savings depend on dispatching larger work to cheaper models, which this fixture is too small to trigger.

Other runs, kept for the record:

- `20261005T162524Z.jsonl`: task 03 (one-line bug fix). Baseline $0.18, boss $0.26, both passed.
- `20261005T165029Z.jsonl`: boss only, after cutting its always-loaded instructions by about a quarter. $0.80 total against $0.81 before. Run-to-run variance in the number of turns is larger than the saving, so one run can't show it.
- `20261005T163045Z.jsonl`: an interrupted run (one boss result for task 01, $0.16, passed).
- `20261005T161818Z.jsonl`: a test of the runner itself with Haiku as the main model, not a benchmark result. There, boss sent the bug to a Haiku builder, which misread it and failed the hidden test; baseline Haiku passed.

Next step for a fair test of the savings claim: a larger fixture with tasks big enough that boss dispatches, and 3+ runs per cell.

## Re-checking the tests

To confirm the hidden tests fail on the untouched fixture and the visible ones pass:

```sh
cd "$(mktemp -d)" && cp -R /path/to/repo/bench/fixture/. . &&
python3 -m unittest discover -s tests -t . &&            # visible: OK
for t in /path/to/repo/bench/tasks/*/; do
  cp "$t/hidden_test.py" tests/test_hidden.py
  python3 -m unittest tests.test_hidden >/dev/null 2>&1 && echo "PASSES (bad): $t" || echo "fails as expected: $t"
done
```

## Known limits

- **Small N.** 5 tasks and 1 rep by default. Agent runs vary a lot from one run to the next. A single run per cell shows direction, not proof. Use `REPS=3` or more before drawing conclusions, and report the spread, not only the means.
- **One fixture, one language.** A small Python codebase, much smaller than most real repos. Boss's dispatching is meant for larger work, so this setup is not neutral. Small repos likely favour baseline, because there is less context for boss to keep out of the expensive model.
- **Model versions drift.** `opus` and `haiku`/`sonnet` are aliases that move. Claude Code updates change prompts and tools. Each line records the Claude Code version and the resolved models. Compare only runs from the same versions.
- **Prompt caching.** The two conditions share most of Claude Code's system prompt, so whichever runs second may get cheaper cache reads. The run order alternates to spread this out. It is not eliminated.
- **The hidden tests are on disk.** They sit in this repo, not in the temp directory, and the agent is never told about them. Neither the temp directory nor the loaded plugin copy contains them, but an agent that searched the whole filesystem could find them. Nothing in the transcripts so far shows this happening, and the transcripts are kept so it can be checked.
- **`bypassPermissions`** lets the agent run any command as your user. Run this on a machine where that is acceptable.
- **Not fully hermetic.** Even with `--no-session-persistence`, Claude Code 2.1.289 writes subagent transcripts under `~/.claude/projects/<temp-dir-name>/`. These are new directories named after each temp dir. They don't affect later runs, but you may want to delete them.
- **Boss is measured as invoked explicitly** (`/boss:boss`). This leaves out whether the skill would trigger on its own.
