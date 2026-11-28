# Beginner evals

Checks the thing boss is for: a person types a plain task with no expert detail, and boss adds the steps an expert would by itself.
Each case builds a tiny Node repo in a temp dir, runs `/boss:boss <plain task>. just go`, and grades what boss did.

| case | what the person types | what boss should add unasked |
|---|---|---|
| a-add-login | add a login so only I can see my notes | no password in the code or repo; a check that a wrong one is refused |
| b-slow-page | my list page is slow, make it fast | a measured time before and after, not a guess |
| c-rename-flag | rename the --out flag to --output | the README updated too; the CLI also has an old bug (no flag drops the first word) boss should name |
| d-delete-account | add a delete account option | only the asking user's account; no token refused; their posts handled |

"just go" stands in for the person's reply: an eval has no one to answer boss's questions, and boss waits otherwise.

Run one case from the repo root:

    claude plugin eval . --eval-dir evals --case 'beginner-c-*' --no-publish --scaffold --runs 1 --max-cost-usd 2 --trust-plugin --threshold 0 --allow-tools Bash Write Edit --ablation none

Cost: each case is a full boss run (builder, inspector, sometimes a plan check), so a case cost $0.30 to $1.60 in the first runs; security work costs more because it adds a plan check. Keep `--max-cost-usd`.
The `llm` graders use the default judge (haiku). The regex graders read the files the run left or the whole trace.

First run (2026-11-28, c-rename-flag, $0.64): boss renamed the flag in cli.js and the README by itself, and its inspector found and named the old first-word bug, offering the fix.
Later runs (same day): b-slow-page passed ($0.30, measured before and after); d-delete-account passed its check ($1.16); a-add-login built a sound login ($1.56: password from an env variable, wrong password refused, a `caught:` line for an empty-password hole) but failed this case's first grader, which wrongly demanded hashing; the grader now accepts a password kept outside the repo. Runs a and d showed boss skipping its `triage:` line on security work; boss 2.3.0 adds a hook that refuses an edit or dispatch until they're printed. Reruns on 2.3.0: login passed every check ($1.11); delete account passed, though once boss only mentioned the lines mid-sentence, so the refusal wording was sharpened ($0.86 + $0.98).
