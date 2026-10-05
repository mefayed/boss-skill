<!-- Copyright (c) 2026 Mohamed Fayed (github.com/mefayed). Source: https://github.com/mefayed/boss-skill. SPDX-License-Identifier: MIT. See LICENSE. -->

# Debate — procedure

Read only after SKILL.md's debate trigger fired. Challenge mode has its own file; this one covers a plain debate.

1. **Frame** — trace the code first, then write each candidate approach as one paragraph plus shared FACTS. 2–3 candidates; if you can't name a real second option, there is no debate.
2. **Advocates** — one `advocate` per candidate, parallel, one message. Each brief: the question, ALL candidates, shared FACTS, and the assigned position. Mix models so it isn't one model arguing with itself — default sonnet + opus (third: haiku).
3. **Judge** — one `fable-advisor` exchange: all cases in, reply as `WINNER / WHY / RISKS / WHAT WOULD CHANGE THE VERDICT`. The judge is never forced to pick: it may return `INSUFFICIENT EVIDENCE — missing: X` (debate pauses until you fetch X) or `REFRAME — missing option: X` (add the option as a new advocate, judge once more). "judge with <name>" seats that model instead (read-only, this shape in its brief); if it was an advocate, fable (else the cheapest default) takes its seat; named as both judge and seat → ask. Everyone is blind, rebuttals included: briefs carry roles and inline text, never a model name or scratchpad path; relabel each reply on arrival (Advocate A/B/…, Judge; model, vendor and self-references become labels, names that are the subject stay); the map only in your report. Offer an out-of-family judge; disclose a same-family one.
4. **Rebuttal** — only if the judge calls it too close: SendMessage each advocate ONLY the attacks made against its position — never the full rival cases (≤10-line reply each), judge decides. One round, never a third (challenge mode aside).
5. **Report** — verdict in at most 6 lines: winner, why, risks, dissent. Expensive work still waits for their green light.

Codex in a debate is opt-in only: the user names it ("debate with astra", "include codex", "sol joins", "ask terra and sol") → one extra advocate per named model via `codex:rescue`, same brief, resolved and run per codex.md. Never add Codex to a debate they didn't ask it into. "claude only" excludes it even when named earlier in the session. An outside CLI named the same way gets one seat through SKILL.md's Outside CLIs rules (and outside-clis.md) — same brief, no rebuttal call; "claude only" excludes it too.

Effort dials apply: "careful with tokens" → 2 advocates (haiku + sonnet), opus judges. "think more" → opus advocates, fable judges, rebuttal allowed by default.
