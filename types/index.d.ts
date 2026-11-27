export type BossLiveLane =
  | 'builder'
  | 'builder-deep'
  | 'errand'
  | 'inspector'
  | 'fable-advisor'
  | 'advocate'
  | 'codex'
  // A model run through its own CLI: on this Mac (ollama), or a vendor's (gemini…).
  | 'local'
  | 'outside'

export type BossLiveJob = {
  lane: BossLiveLane
  phase: string
  model: string
  description: string
  startedAt: number
  // When this agent last finished; absent while it runs.
  endedAt?: number
}

export type BossLiveResult = 'PASS' | 'FAIL' | 'NOT CHECKED'

// What boss promised to prove, and what the inspector proved: a builder's
// own "done" is a claim, so only an inspector row turns a check green.
export type BossLiveProof = {
  test: string | null
  // The inspector's VERDICT; null until one reports.
  verdict: BossLiveResult | null
  // `at`: when the inspector reported this check.
  checks: { name: string; result: BossLiveResult | null; at?: number }[]
  builder: 'working' | 'done' | 'blocked' | null
  // When the inspector's verdict arrived.
  doneAt: number | null
}

export type BossLiveQuestion = {
  text: string
  // Boss's recommended answer; null for a fact only the person has.
  pick: string | null
  isLeastSure: boolean
}

export type BossLiveState = {
  // Running boss agents by agent id, and Codex jobs by the launching call's id.
  jobs: Record<string, BossLiveJob>
  // Boss agents seen this session, so a resumed one is known again.
  agents: Record<string, BossLiveJob>
  run: { startedAt: number; count: number } | null
  proof: BossLiveProof | null
  // The run that ended last, for the receipt.
  finished: { startedAt: number; endedAt: number; count: number } | null
  isWaiting: boolean
  // The wait is Claude Code's own question picker (AskUserQuestion), not a plain-text ask.
  inPicker: boolean
  waitingSince: number | null
  questions: BossLiveQuestion[]
  // Agents ran since the last "needs your answer" toast.
  hadRun: boolean
  // What this run is for, from the builder brief's GOAL line; null until one comes.
  task: string | null
}

// Boss's learning: whether boss runs in this session, and what this turn did.
export type BossLearnState = {
  isBoss: boolean
  // The main session asked through the picker this turn.
  asked: boolean
  // The main session wrote CLAUDE.md or a project memory file this turn.
  wroteMemory: boolean
  // A reply was already sent back this turn.
  blocked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    boss: { live: Shaped<BossLiveState>; isHidden: boolean; learn: Shaped<BossLearnState> }
  }
}
