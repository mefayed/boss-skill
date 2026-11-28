import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register } from 'claude-code'

import type { BossLiveJob, BossLiveLane, BossLiveProof, BossLiveResult, BossLiveState } from '../types'
import { outsideRun, readContract, readInspection, readQuestions, readStatus, short } from './boss-text'
import { CARD_HEIGHT, cardSvg, type CardKind, type CardModel } from './card'
import { bashRule, clean, inRoots, inScratch, scratchRoot, within, type Roots } from './guard'
import { hasRepo, isLessonFile, NEED_REPO, NUDGE, REWRITE, overBudget, places, recall, repoLines, replyProblem, resultText, withLessons, withoutCode } from './learn'
import { redact } from './redact'

// Change the tag when the state's fields change: it declines what an earlier
// version stored, which outlives a reload.
const live = atom(
  { plugin: 'boss', key: 'live' } as const,
  { jobs: {}, agents: {}, run: null, proof: null, finished: null, isWaiting: false, inPicker: false, waitingSince: null, questions: [], hadRun: false, task: null },
  { shape: 'live-6' },
)
const isHidden = atom({ plugin: 'boss', key: 'isHidden' } as const, false)
const learn = atom({ plugin: 'boss', key: 'learn' } as const, { isBoss: false, asked: false, wroteMemory: false, blocked: false }, { shape: 'learn-1' })
// Hidden stays hidden (across runs and sessions) until /boss-live; the status line says how.
const HIDDEN_HINT = 'boss-live hidden · type /boss-live'
async function setHidden($: $, value: boolean) {
  await update($, isHidden, () => value)
  await $.store.set('isHidden', value).catch(() => undefined)
  $.ui.status(value ? HIDDEN_HINT : undefined)
}

// Highest first: the band names the first phase any running job is in.
const PHASES = ['building', 'testing', 'checking the plan', 'looking up']
const LANES: Record<string, { phase: string; who: string; isReadOnly: boolean }> = {
  builder: { phase: 'building', who: 'builders', isReadOnly: false },
  'builder-deep': { phase: 'building', who: 'builders', isReadOnly: false },
  inspector: { phase: 'testing', who: 'inspectors', isReadOnly: true },
  'fable-advisor': { phase: 'checking the plan', who: 'plan advisors', isReadOnly: true },
  advocate: { phase: 'checking the plan', who: 'advocates', isReadOnly: true },
  errand: { phase: 'looking up', who: 'errand agents', isReadOnly: true },
}
// The companion's verbs that start a Codex job.
const START = new Set(['task', 'adversarial-review'])
const CODEX = /codex-companion\.mjs["']?\s+(task|adversarial-review|result|cancel)\b/
const QUESTION = /Reply ["“]go["”]/
const CHECK_TONE: Record<BossLiveResult, string> = { PASS: 'success', FAIL: 'error', 'NOT CHECKED': 'warning' }
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ROLE: Record<string, string> = {
  builder: 'Builder',
  'builder-deep': 'Builder',
  inspector: 'Inspector',
  'fable-advisor': 'Plan critic',
  advocate: 'Debater',
  errand: 'Researcher',
  codex: 'Codex',
  local: 'Local model',
  outside: 'Outside model',
}
const MOOD: Record<string, string> = {
  building: 'Building',
  testing: 'Testing',
  'checking the plan': 'Reviewing the plan',
  'looking up': 'Researching',
  'needs your answer': 'Your turn',
  working: 'Working',
}
// The redraw timer; the module's own, so it starts over on a reload.
let ticker: { cancel: () => void } | null = null
// Tool-call times per boss agent, for the quiet-agent toast. Kept out of state: it
// changes on every call and means nothing after a reload.
const beats = new Map<string, number[]>()
const BUCKET = 5000

// Haiku, given only the person's words and the kinds hidden, never a secret or a report.
// Unsure, failed or slow: hide.
async function judge($: $, text: string, kinds: string[]): Promise<boolean> {
  try {
    const r = await $.model.complete({ model: 'haiku', system: JUDGE, prompt: `Message: ${text}\nHidden: ${kinds.join(', ')}`, maxTokens: 5, timeoutMs: 5000 })
    return r.isAnswered && /^SHOW\.?$/i.test(r.text.trim())
  } catch {
    return false
  }
}

// Whole minutes, so a running clock changes the card once a minute, not every second.
function minutes(seconds: number): string {
  return seconds < 60 ? '<1m' : `${Math.floor(seconds / 60)}m`
}

// What each boss agent did last, as one of a few fixed phrases: never a path, a
// command, a URL or a query. `counts` holds a test run's tally ("5 pass, 2 fail").
const doing = new Map<string, { what: string; at: number; counts?: string }>()
// Files edited this run, only to count them.
let edited = new Set<string>()
// Files the builders edited this run, and those the last pass proved: an edit to one
// of them before a new run makes that proof stale. Paths stay here, never drawn.
let built = new Set<string>()
// Builders whose last report was BLOCKED or NEEDS_CONTEXT: waking one clears the card's
// "stuck" only when no other builder is still stuck.
let blockedBuilders = new Set<string>()
// Proven paths with their modified time at the pass (null when unknown).
let proved: Map<string, number | null> | null = null
let isProofStale = false
// Boss agents waiting on a permission prompt, by agent id: the tool asked for.
const asking = new Map<string, string>()
// The last call of each quiet agent already told about: one toast per quiet spell.
const toldQuiet = new Map<string, number>()
const QUIET_MS = 3 * 60_000
// The right-now phrase on the card, and when it took the place, so it holds 1.5s.
let shown: { text: string; at: number } | null = null
const HOLD_MS = 1500
// The order of the main turn's start and the person's last message: an ask whose
// turn began before the person answered is already answered.
let seq = 0
let mainTurnSeq = 0
let personSeq = 0
// The main loop's turn as its start and end report it; null after a reload, when the band's isWorking stands in.
let mainTurn: { id: string; running: boolean } | null = null
// What the person typed over a running main turn, by that turn's id, until the next main turn starts.
const typedOver = new Map<string, string>()
// The person's last message and the judge's word on it, asked at most once a turn: a
// report's secret shows only when their own words ask for it. Secrets live in memory only.
let asked: { text: string; shows?: Promise<boolean> } | null = null
// What was hidden since, by value, until "show it" or two more messages of the person's.
let hidden: { secrets: Map<string, string>; turns: number } | null = null
const JUDGE = 'Read the message a person typed. Answer SHOW only if it clearly asks to see the value of a secret of the kind named, else HIDE. One word.'
const REVEAL = /^\s*(?:show(?: me)?(?: it| them| the \w+(?: \w+)?)?|unhide(?: it| them)?)[\s.!]*$/i
// Tool calls still running per boss agent: one long call is not a quiet agent.
const inFlight = new Map<string, number>()
// The run the day already counted, and whether it counted its pass: a verdict that changes counts once.
let dayRun: { run: number; proven: boolean } | null = null

const READS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']
const EDITS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const LOOKUPS = ['WebSearch', 'WebFetch']
// What an approval is for, in plain words: never the command, path or URL.
function askPhrase(tool: string): string {
  return tool === 'Bash' ? 'run a command' : EDITS.includes(tool) ? 'change a file' : LOOKUPS.includes(tool) ? 'open a web page' : 'use a tool'
}
async function modifiedAt($: $, path: string): Promise<number | null> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return null
  }
}
// A file the pass proved changed since: by any agent, the main session, or a save outside Claude.
function staleIf($: $, path: string) {
  if (proved?.has(path) !== true || isProofStale) return
  isProofStale = true
  $.ui.invalidate('ui.render')
}
function pathOf(e: object): string | undefined {
  const path = (e as { file_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path
  return typeof path === 'string' ? path : undefined
}
const TESTS =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|bun\s+test|jest|vitest|pytest|py\.test|mocha|rspec|phpunit|playwright\s+test|go\s+test|cargo\s+test|deno\s+test|claude\s+plugin\s+test|python3?\s+-m\s+(?:pytest|unittest)|make\s+test)\b/
// The tally in a test run's summary, in the common formats; null when there is none.
export function testCounts(out: string): string | null {
  const last = (pattern: RegExp) => {
    const found = [...out.matchAll(pattern)].pop()
    return found === undefined ? null : Number(found[1])
  }
  let pass = last(/(\d+)\s+(?:passed|passing|pass)\b/gi)
  const fail = last(/(\d+)\s+(?:failed|failing|fail|failures?)\b/gi) ?? last(/Failures:\s*(\d+)/g)
  // rspec counts examples; phpunit says "OK (7 tests" or "Tests: 7".
  const total = last(/(\d+)\s+examples?\b/gi) ?? last(/OK \((\d+) tests?/g) ?? last(/Tests:\s*(\d+),/g)
  if (pass === null && total !== null) pass = total - (fail ?? 0)
  if (pass === null && fail === null) return null
  return [pass === null ? '' : `${pass} pass`, fail === null ? '' : `${fail} fail`].filter(part => part !== '').join(', ')
}

// The run's task: the builder brief's GOAL line.
function readGoal(brief: string): string | null {
  const goal = /^\s*GOAL\b[^:\n]{0,80}:\s*(.+)$/m.exec(brief)?.[1]
  return goal === undefined ? null : short(goal, 200)
}

// The brief's REPO folders, one per REPO line: the whole line when it is a folder, since paths
// hold spaces, else the line cut at its note (" (", " — ", " - ", " # "), longest cut first.
async function readRepos($: $, brief: string): Promise<string[]> {
  const found: string[] = []
  for (const line of repoLines(brief)) {
    const cuts = [...line.matchAll(/ \(| — | - | # /g)].map(m => line.slice(0, m.index).trim()).reverse()
    let pick = cuts.at(-1) ?? line
    for (const one of [line, ...cuts]) {
      if (await $.fs.list(one).then(() => true, () => false)) {
        pick = one
        break
      }
    }
    const repo = clean(pick)
    if (repo !== null && !found.includes(repo)) found.push(repo)
  }
  return found
}

const STEPS = ['Plan', 'Build', 'Check', 'Done']
// The step a job works on, from what it does: a read-only Codex or outside model reviews the work.
function stepOf(job: BossLiveJob): number {
  if (job.phase === 'building') return 1
  if (job.phase === 'testing' || job.lane === 'codex' || job.lane === 'local' || job.lane === 'outside') return 2
  return 0
}
const STEP_WORD = { done: 'done', skipped: 'skipped', current: 'now', next: 'next', failed: 'failed', open: 'open' } as const

// The last card drawn: an unchanged card keeps its picture, so its animations run on
// smoothly instead of restarting every time the band is asked again.
let lastCard: { sig: string; source: string; alt: string } | null = null

// Buttons that wait for something: compact once the handoff is printed; go
// cheaper once per run.
// Turns left to wait for the checkpoint; 0 means no compaction is waiting.
let compactAfterHandoff = 0
// The stage the card last drew and when it began, to time what arrives with it.
let stage: { mood: string; at: number } | null = null
let cheaperForRun: number | null = null

// Your day, kept across chats under one key per local date.
type Day = { runs: number; proven: number; agentMs: number }
function dayKey(now: number): string {
  const d = new Date(now)
  return `day:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
async function addToDay($: $, now: number, add: Partial<Day>) {
  const key = dayKey(now)
  const day = ((await $.store.get(key)) ?? { runs: 0, proven: 0, agentMs: 0 }) as Day
  await $.store.set(key, { runs: day.runs + (add.runs ?? 0), proven: day.proven + (add.proven ?? 0), agentMs: day.agentMs + (add.agentMs ?? 0) })
  // Only today is kept.
  for (const old of (await $.store.keys()).filter(k => k.startsWith('day:') && k !== key)) await $.store.delete(old)
}
async function todayLine($: $, now: number): Promise<string | null> {
  const day = (await $.store.get(dayKey(now)).catch(() => undefined)) as Day | undefined
  if (day === undefined || day.runs === 0) return null
  const minutes = Math.round(day.agentMs / 60_000)
  return `Today ${day.runs} run${day.runs === 1 ? '' : 's'} · ${day.proven} proven${minutes > 0 ? ` · ${minutes}m` : ''}`
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const TONE: Record<string, string> = {
  building: 'claude',
  testing: 'suggestion',
  'checking the plan': 'planMode',
  'looking up': 'subtle',
  'needs your answer': 'warning',
}

type $ = EngineInterface

function laneOf(type: string): BossLiveLane | undefined {
  const name = type.replace(/^boss:/, '')
  return name in LANES ? (name as BossLiveLane) : undefined
}

function shortModel(model: string | undefined): string {
  return /haiku|sonnet|opus|fable/.exec(model ?? '')?.[0] ?? model ?? 'agent'
}

const isBuilder = (lane: BossLiveLane) => lane === 'builder' || lane === 'builder-deep'

// The session's scratch root: its scratchpad, else its claude-N TMPDIR (null: neither).
async function scratchOf($: $): Promise<string | null> {
  const dir = (await $.session.info().catch(() => null))?.scratchpadDir
  return scratchRoot(dir, await $.env.get('TMPDIR').catch(() => undefined))
}

// Where a builder may write. shortcut: no session folder (tests, odd hosts) leaves writes unchecked.
async function writeRoots($: $, agentId?: string): Promise<Roots | null> {
  try {
    const cwd = await $.session.cwd()
    const scratch = await scratchOf($)
    const repos = agentId === undefined ? [] : ((await read($, live)).agents[agentId]?.repos ?? [])
    return { cwd, repos, scratch }
  } catch {
    return null
  }
}

// Why a REPO outside the session folder may not become a write root; null when it may.
async function repoProblem($: $, repo: string): Promise<string | null> {
  const home = clean((await $.env.get('HOME').catch(() => undefined)) ?? '')
  const config = clean((await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? (home === null ? '' : `${home}/.claude`))
  if (repo === '/') return 'the filesystem root'
  if (home !== null && within(home, repo)) return 'your home folder or above it'
  if (config !== null && within(repo, config)) return 'inside the Claude config folder'
  if (home !== null && within(repo, home) && repo.slice(home.length + 1).startsWith('.')) return 'inside a hidden folder of your home'
  const entries = await $.fs.list(repo).catch(() => null)
  if (entries === null) return 'not a folder'
  if (entries.some(f => f.name === '.git')) return null
  const dirs = entries.filter(f => f.kind === 'dir').map(f => $.fs.exists(`${repo}/${f.name}/.git`).catch(() => false))
  return (await Promise.all(dirs)).some(Boolean) ? null : 'a folder that has no .git in it or a folder just inside it'
}

async function agentLane($: $, agentId: string): Promise<BossLiveLane | undefined> {
  const known = (await read($, live)).agents[agentId]
  if (known !== undefined) return known.lane
  try {
    const agent = (await $.agent.list()).find(one => one.id === agentId)
    return agent === undefined ? undefined : laneOf(agent.type)
  } catch {
    return undefined
  }
}

async function addJob($: $, id: string, job: BossLiveJob, goal: string | null = null) {
  let isNewRun = false
  await update($, live, s => {
    // A proof still open means the same run goes on (build, review, then the inspector).
    // So does a start within two minutes of the last finish (a local model, then the builder),
    // and a builder of this session woken again (boss's bounce).
    const isOpen = s.proof !== null && s.proof.verdict === null
    const isWokenBuilder = isBuilder(job.lane) && s.agents[id] !== undefined
    const resumed = s.run === null && s.finished !== null && (isOpen || isWokenBuilder || job.startedAt - s.finished.endedAt < 120_000) ? s.finished : null
    isNewRun = s.run === null && resumed === null
    const agents = Object.fromEntries([...Object.entries(s.agents).filter(([key]) => key !== id), [id, job]].slice(-50))
    const run = s.run ?? (resumed === null ? null : { startedAt: resumed.startedAt, count: resumed.count })
    // An agent this run already counted (a resume, the inspector's phase 2) is not one more.
    const known = s.agents[id]
    const isCounted = run !== null && known !== undefined && known.startedAt >= run.startedAt
    return {
      ...s,
      finished: s.run === null ? null : s.finished,
      jobs: { ...s.jobs, [id]: job },
      agents,
      run: { startedAt: run?.startedAt ?? job.startedAt, count: (run?.count ?? 0) + (isCounted ? 0 : 1) },
      hadRun: true,
      // A builder's GOAL names the run from then on (the next unit of a queue).
      task: goal ?? (isNewRun ? null : s.task),
    }
  })
  if (isNewRun) {
    edited = new Set()
    built = new Set()
    blockedBuilders = new Set()
    proved = null
    isProofStale = false
  }
}

const EMPTY: BossLiveProof = { test: null, verdict: null, checks: [], builder: null, doneAt: null, by: null, mayReplace: false }

// Building again: the verdict no longer stands, the checks wait to be proven again.
function reopened(proof: BossLiveProof): BossLiveProof {
  return { ...proof, verdict: null, by: null, mayReplace: false, doneAt: null, builder: 'working', checks: proof.checks.map(check => ({ name: check.name, result: null })) }
}
// A reopen also forgets what the last pass proved.
function forgetProof() {
  proved = null
  isProofStale = false
}

// A builder's brief opens the proof board, or adds its checks to the open one; one with no
// contract reopens the board it works on.
function withBrief(proof: BossLiveProof | null, brief: string): BossLiveProof | null {
  const { test, checks } = readContract(brief)
  const isOpen = proof !== null && proof.verdict === null
  if (test === null && checks.length === 0) return proof === null ? proof : isOpen ? { ...proof, builder: 'working' } : reopened(proof)
  const base: BossLiveProof = isOpen ? proof : EMPTY
  const names = new Set(base.checks.map(check => check.name))

  return {
    ...base,
    test: base.test ?? test,
    checks: [...base.checks, ...checks.filter(name => !names.has(name)).map(name => ({ name, result: null }))],
    builder: 'working',
  }
}

function withReport(proof: BossLiveProof | null, lane: BossLiveLane, answer: string, isLastBuilder: boolean, now: number, id: string) {
  if (isBuilder(lane)) {
    if (proof === null) return proof
    const status = readStatus(answer)
    if (status === 'blocked' || proof.builder === 'blocked') return { ...proof, builder: 'blocked' as const }
    return isLastBuilder ? { ...proof, builder: status ?? 'done' } : proof
  }
  if (lane !== 'inspector') return proof

  const { test, verdict, rows } = readInspection(answer)
  const base: BossLiveProof = proof ?? EMPTY
  if (verdict === null) return { ...base, test: base.test ?? test }
  // A FAIL stands against another inspector until a counted edit follows it, or the board reopens.
  if (base.verdict === 'FAIL' && verdict !== 'FAIL' && base.by !== id && !base.mayReplace) return { ...base, test: base.test ?? test }
  const shown = rows.filter(row => !/first human test/i.test(row.name)).map(row => ({ ...row, at: now }))
  // Over another inspector's pass, a worse verdict keeps that pass's rows and updates them by name.
  const isMerge = base.verdict === 'PASS' && base.by !== id && verdict !== 'PASS'
  const merged = [...base.checks.map(check => shown.find(row => row.name === check.name) ?? check), ...shown.filter(row => !base.checks.some(check => check.name === row.name))]
  const checks = shown.length === 0 ? base.checks : isMerge ? merged : shown

  return { ...base, test: base.test ?? test, verdict, by: id, mayReplace: false, doneAt: now, checks }
}

// `stopped`: the run ended with no answer, so it proves nothing. `timer`: a time limit, which
// ends only a job still running (a harvested one stays as it ended).
async function endJob($: $, id: string | undefined, report = '', how: { stopped?: boolean; timer?: boolean } = {}) {
  const now = await $.clock.now()
  let toast: string | null = null
  let day: Partial<Day> | null = null
  let verdict: BossLiveResult | null = null
  let counted: typeof dayRun = dayRun
  await update($, live, s => {
    const job = id === undefined ? undefined : how.timer === true ? s.jobs[id] : (s.jobs[id] ?? s.agents[id])
    if (id === undefined || job === undefined) return s
    const { [id]: _, ...jobs } = s.jobs
    const isLastBuilder = !Object.values(jobs).some(other => isBuilder(other.lane))
    const isStopped = how.stopped === true
    const proof = isStopped
      ? isBuilder(job.lane) && s.proof !== null ? { ...s.proof, builder: 'blocked' as const } : s.proof
      : withReport(s.proof, job.lane, report, isLastBuilder, now, id)
    if (isBuilder(job.lane) && (isStopped || readStatus(report) === 'blocked')) blockedBuilders.add(id)
    const isDone = Object.keys(jobs).length === 0
    const known = s.agents[id]
    const agents = known === undefined ? s.agents : { ...s.agents, [id]: { ...known, endedAt: now, ...(isStopped ? { stopped: true as const } : {}) } }
    toast = null
    if (isStopped) {
      toast = 'Boss: stopped'
    } else if (proof !== null && proof.verdict !== null && s.proof?.verdict !== proof.verdict) {
      const total = proof.checks.length
      const proven = proof.checks.filter(check => check.result === 'PASS').length
      const failedCheck = proof.checks.find(check => check.result === 'FAIL')
      toast =
        proof.verdict === 'PASS'
          ? `Boss: proven${total > 0 ? ` ${proven}/${total}` : ''}`
          : proof.verdict === 'FAIL'
            ? `Boss: failed${failedCheck === undefined ? '' : ` — ${short(failedCheck.name, 50)}`}`
            : 'Boss: not checked'
    } else if (s.jobs[id] !== undefined && isDone && s.run !== null && now - s.run.startedAt > 60_000 && (proof === null || proof.verdict !== null)) {
      const n = s.run.count
      toast = `Boss finished: ${n} agent${n === 1 ? '' : 's'}, ${clock(Math.round((now - s.run.startedAt) / 1000))}`
    }
    const finished = isDone && s.run !== null ? { startedAt: s.run.startedAt, endedAt: now, count: s.run.count } : s.finished
    const isNewVerdict = proof !== null && proof.verdict !== null && s.proof?.verdict !== proof.verdict
    day = s.jobs[id] === undefined ? null : { agentMs: now - job.startedAt }
    // The day counts each run once, and its pass once, however often its verdict changes.
    const runKey = s.run?.startedAt ?? s.finished?.startedAt ?? now
    counted = dayRun?.run === runKey ? dayRun : null
    const runs = counted === null ? 1 : 0
    if (isNewVerdict) verdict = proof.verdict
    if (isNewVerdict) {
      const isFirstPass = proof.verdict === 'PASS' && counted?.proven !== true
      day = { ...day, runs, proven: isFirstPass ? 1 : 0 }
      counted = { run: runKey, proven: counted?.proven === true || isFirstPass }
    } else if (isDone && proof === null && s.jobs[id] !== undefined) {
      day = { ...day, runs }
      counted = { run: runKey, proven: counted?.proven === true }
    }
    return { ...s, jobs, agents, proof, finished, run: isDone ? null : s.run }
  })
  dayRun = counted
  if (id !== undefined) {
    asking.delete(id)
    toldQuiet.delete(id)
  }
  // A new verdict starts the proof fresh; a pass remembers what it proved.
  if (verdict !== null) {
    proved = null
    isProofStale = false
    if (verdict === 'PASS') {
      const times = new Map<string, number | null>()
      for (const path of built) times.set(path, await modifiedAt($, path))
      proved = times
    }
  }
  if (toast !== null) $.ui.toast(toast)
  if (day !== null) await addToDay($, now, day).catch(() => undefined)
}

function proofState(proof: BossLiveProof): { icon: string; word: string; color: string } {
  if (proof.verdict === 'PASS') return { icon: '✓', word: 'passed', color: 'success' }
  if (proof.verdict === 'FAIL') return { icon: '✗', word: 'failed', color: 'error' }
  if (proof.verdict === 'NOT CHECKED') return { icon: '?', word: 'not checked', color: 'warning' }
  if (proof.builder === 'blocked') return { icon: '✗', word: 'builder stuck', color: 'error' }
  if (proof.builder === 'done') return { icon: '◈', word: 'built, being proven', color: 'suggestion' }
  return { icon: '◇', word: 'not proven yet', color: 'claude' }
}

// An approval was answered: its next call started, or the call ran or was refused.
function answered($: $, id: string | undefined) {
  if (id !== undefined && asking.delete(id)) $.ui.invalidate('ui.render')
}

// A Claude agent with no tool call for 3 minutes gets one toast; its next call starts the count again.
async function tellQuiet($: $) {
  if (await read($, isHidden)) return
  const now = await $.clock.now()
  for (const [id, job] of Object.entries((await read($, live)).jobs)) {
    if (!(job.lane in LANES) || asking.has(id) || (inFlight.get(id) ?? 0) > 0) continue
    const last = Math.max(job.startedAt, beats.get(id)?.at(-1) ?? 0)
    if (now - last < QUIET_MS || toldQuiet.get(id) === last) continue
    toldQuiet.set(id, last)
    $.ui.toast(`${ROLE[job.lane] ?? job.lane} has been quiet for 3 min`)
  }
}

// The boss lanes' guard and what the card learns from each call.
const bossCall: Hook<'tool.call'> = async ($, e, next) => {
  // The main session asks in Claude Code's own picker: in a boss session, your turn until it returns.
  if (e.tool === 'AskUserQuestion' && e.agentId === undefined) {
    await update($, learn, s => ({ ...s, asked: true }))
    if (!(await read($, learn)).isBoss) return next(e)
    const now = await $.clock.now()
    const asked = (Array.isArray(e.questions) ? e.questions : []).map(q => ({ text: short(String(q.question), 70), pick: null, isLeastSure: false }))
    await update($, live, s => ({ ...s, isWaiting: true, inPicker: true, waitingSince: s.waitingSince ?? now, questions: asked }))
    try {
      return await next(e)
    } finally {
      await update($, live, s => ({ ...s, isWaiting: false, inPicker: false, waitingSince: null, questions: [] }))
    }
  }
  const lane = e.agentId === undefined ? undefined : await agentLane($, e.agentId)
  if (lane !== undefined && e.agentId !== undefined) {
    const now = await $.clock.now()
    beats.set(e.agentId, [...(beats.get(e.agentId) ?? []).filter(t => now - t < 8 * BUCKET), now].slice(-200))
  }
  const rules = lane === undefined ? undefined : LANES[lane]
  if (rules !== undefined) {
    const roots = lane !== undefined && isBuilder(lane) ? await writeRoots($, e.agentId) : null
    const path = EDITS.includes(String(e.tool)) ? pathOf(e) : undefined
    // Every lane's scratchpad is this session's own; none known, any /tmp/claude-N folder.
    const scratch = roots !== null ? roots.scratch : await scratchOf($)
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? null
    let what: string | null = null
    if (e.tool === 'Bash') what = bashRule(e.command, rules.isReadOnly, roots, { scratch, home })
    else if (rules.isReadOnly && (e.tool === 'Write' || e.tool === 'Edit') && !inScratch(e.file_path, null, scratch)) what = 'write files outside the scratchpad'
    else if (rules.isReadOnly && e.tool === 'NotebookEdit' && !inScratch(e.notebook_path, null, scratch)) what = 'write files outside the scratchpad'
    else if (roots !== null && path !== undefined && !inRoots(path, roots)) what = 'write files outside REPO and the scratchpad'
    // A refusal that says what to do instead comes whole.
    if (what?.startsWith('boss-live: ')) return { deny: what }
    const where = scratch !== null && what?.endsWith('outside the scratchpad') ? ` (${scratch})` : ''
    if (what !== null) return { deny: `boss-live: ${rules.who} may not ${what}${where} — report it under OPEN instead` }
  }
  // Right now, in fixed phrases: what kind of work, never what it touched. An edit counts once it ran.
  const isTest = lane !== undefined && e.tool === 'Bash' && TESTS.test(e.command)
  if (lane !== undefined && e.agentId !== undefined) {
    const tool = String(e.tool)
    const what = READS.includes(tool)
      ? 'Reading the code'
      : LOOKUPS.includes(tool)
        ? 'Looking things up'
        : tool === 'Bash'
          ? isTest
            ? 'Running tests'
            : 'Running a command'
          : null
    if (what !== null) doing.set(e.agentId, { what, at: await $.clock.now() })
  }

  // A background model run ends when boss reads its output (or after boss's 10-minute cap).
  const looked = e.tool === 'Bash' ? e.command : e.tool === 'Read' ? e.file_path : ''
  if (looked !== '') {
    const open = Object.keys((await read($, live)).jobs).filter(id => id.startsWith('bg:') && looked.includes(id.slice(3)))
    for (const id of open) await endJob($, id)
  }

  if (e.tool !== 'Bash') {
    const ran = await next(e)
    const path = EDITS.includes(String(e.tool)) ? pathOf(e) : undefined
    if (lane !== undefined && e.agentId !== undefined && path !== undefined && ran.deny === undefined && ran.isError !== true) {
      edited.add(path)
      if (isBuilder(lane)) built.add(path)
      doing.set(e.agentId, { what: `Editing ${edited.size} file${edited.size === 1 ? '' : 's'}`, at: await $.clock.now() })
    }
    return ran
  }
  const command = e.command
  const model = outsideRun(command)
  if (model?.script !== undefined && model.model === 'ollama') {
    // The script names its model: {"model": "llama3.2:3b", ...}.
    const path = model.script.replace(/^\$\{?(\w+)\}?/, (_, name: string) => new RegExp(`(?:^|[;&\\s])${name}=["']?([^\\s;"']+)`).exec(command)?.[1] ?? '')
    try {
      model.model = /"model"\s*:\s*"([^"]+)"/.exec(await $.fs.read(path))?.[1] ?? 'ollama'
    } catch {
      // The script is gone or unreadable: the card says "ollama".
    }
  }
  if (model !== null) {
    await addJob($, e.tool_use_id, {
      lane: model.lane,
      phase: 'checking the plan',
      model: model.model,
      description: model.lane === 'local' ? 'Local model' : 'Outside model',
      startedAt: await $.clock.now(),
    })
    const ran = await next(e)
    const taskId = (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
    if (typeof taskId === 'string' && ran.deny === undefined) {
      if (await renameJob($, e.tool_use_id, `bg:${taskId}`)) $.clock.after(600_000, () => void endJob($, `bg:${taskId}`, '', { timer: true }))
    } else {
      await endJob($, e.tool_use_id)
    }
    return ran
  }
  const known = Object.entries((await read($, live)).jobs).filter(([, job]) => job.lane === 'codex')
  // A harvest or cancel that names a job id ends that job.
  const named = /\b(result|cancel)\b/.test(command) ? known.find(([id]) => command.includes(id)) : undefined
  const codex = CODEX.exec(command)
  const verb = codex?.[1] ?? ''
  if (named !== undefined) await endJob($, named[0])
  else if (codex !== null && !START.has(verb)) {
    // shortcut: a harvest or cancel with no job id ends the oldest Codex job.
    await endJob($, known.sort(([, a], [, b]) => a.startedAt - b.startedAt)[0]?.[0])
  }

  const isTask = START.has(verb)
  const isWrite = /\s--write\b/.test(command)
  const job = async (id: string) =>
    addJob($, id, {
      lane: 'codex',
      phase: isWrite ? 'building' : 'checking the plan',
      model: /--model[=\s]+["']?([^\s"']+)/.exec(command)?.[1] ?? 'codex',
      description: isWrite ? 'Codex build' : 'Codex review',
      startedAt: await $.clock.now(),
    })
  if (isTask) await job(e.tool_use_id)
  const ran = await next(e)
  // A finished test run adds its tally.
  const output = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  const counts = isTest ? testCounts(`${typeof output?.stdout === 'string' ? output.stdout : ''}\n${typeof output?.stderr === 'string' ? output.stderr : ''}`) : null
  if (counts !== null && e.agentId !== undefined) doing.set(e.agentId, { what: `Running tests · ${counts}`, at: await $.clock.now(), counts })
  // A job sent to the background says so, whatever path or variable launched it: Codex
  // prints the line on its own. Text that only quotes it (a test file read, a grep) does not count.
  const stdout = (ran.result as { stdout?: unknown } | undefined)?.stdout
  const started = typeof stdout === 'string' ? /^Codex Task started in the background as ([\w-]+)/im.exec(stdout)?.[1] : undefined
  // Run in the background by Bash, the job is known by its task id until boss reads its output.
  const taskId = (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
  const later = isTask && ran.deny === undefined && typeof taskId === 'string' ? `bg:${taskId}` : started !== undefined && ran.deny === undefined && !known.some(([id]) => id === started) ? started : null
  if (later !== null) {
    // The launch's own job becomes the background one: one job, not two.
    if (!isTask || !(await renameJob($, e.tool_use_id, later))) await job(later)
    // A job never harvested still leaves the card (the longest Codex run boss waits for).
    $.clock.after(45 * 60_000, () => void endJob($, later, '', { timer: true }))
  } else if (isTask) {
    await endJob($, e.tool_use_id)
  }

  return ran
}

// An edit to the project by a builder or boss itself (never the scratchpad or a lesson file):
// after a FAIL it lets another inspector's pass replace it; a builder's after a PASS makes it stale.
async function countEdit($: $, path: string, agentId: string | undefined) {
  const lane = agentId === undefined ? undefined : await agentLane($, agentId)
  if ((agentId !== undefined && (lane === undefined || !isBuilder(lane))) || inScratch(path, null, await scratchOf($))) return
  const s = await read($, live)
  const root = await $.session.root().catch(() => null)
  const roots = [root, ...Object.values(s.agents).flatMap(job => job.repos ?? [])].filter((one): one is string => typeof one === 'string')
  if (!roots.some(one => within(path, one))) return
  if (s.proof?.verdict === 'FAIL' && !s.proof.mayReplace) {
    await update($, live, now => (now.proof?.verdict === 'FAIL' ? { ...now, proof: { ...now.proof, mayReplace: true } } : now))
  } else if (s.proof?.verdict === 'PASS' && agentId !== undefined && !isProofStale) {
    isProofStale = true
    $.ui.invalidate('ui.render')
  }
}

// A launch's job, known from now on by the id its output carries; false when it already ended.
async function renameJob($: $, from: string, to: string): Promise<boolean> {
  let isRenamed = false
  await update($, live, s => {
    const { [from]: started, ...jobs } = s.jobs
    const { [from]: _, ...agents } = s.agents
    isRenamed = started !== undefined
    return started === undefined ? s : { ...s, jobs: { ...jobs, [to]: started }, agents: { ...agents, [to]: started } }
  })
  return isRenamed
}

// A builder woken (boss's bounce) reopens a board that has a verdict; a stuck one is working
// again, unless another builder is still stuck.
async function wake($: $, id: string) {
  const known = (await read($, live)).agents[id]
  if (known === undefined || !isBuilder(known.lane)) return
  blockedBuilders.delete(id)
  let isReopened = false
  await update($, live, now => {
    isReopened = now.proof !== null && now.proof.verdict !== null
    if (now.proof === null || !isReopened) return now
    const proof = reopened(now.proof)
    return { ...now, proof: blockedBuilders.size > 0 ? { ...proof, builder: 'blocked' as const } : proof }
  })
  if (isReopened) forgetProof()
  if (blockedBuilders.size > 0) return
  await update($, live, now => (now.proof !== null && now.proof.verdict === null ? { ...now, proof: { ...now.proof, builder: 'working' as const } } : now))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'boss-live',
      description: 'Show or hide the boss-live card',
      // Typed while boss works, it runs at once instead of waiting for the turn to end.
      immediate: true,
    })
    if ((await $.store.get('isHidden').catch(() => undefined)) === true) await setHidden($, true)
    // A reload forgets the timers: a Codex job still on the card gets its 45-minute limit again,
    // a background outside model its 10 minutes.
    const now = await $.clock.now()
    for (const [id, job] of Object.entries((await read($, live)).jobs)) {
      if (job.lane === 'codex') $.clock.after(Math.max(0, job.startedAt + 45 * 60_000 - now), () => void endJob($, id, '', { timer: true }))
      else if (id.startsWith('bg:')) $.clock.after(Math.max(0, job.startedAt + 600_000 - now), () => void endJob($, id, '', { timer: true }))
    }
    return next(e)
  })

  // One word, one toggle: /boss-live shows the card if hidden, hides it if showing.
  on('command.run', { command: 'boss-live' }, async $ => {
    const willHide = !(await read($, isHidden))
    await setHidden($, willHide)
    return { text: willHide ? 'boss-live is hidden. Type /boss-live to show it again.' : 'boss-live is showing. It appears while boss works.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const lane = laneOf(e.subagentType)
    // A resume (boss's bounce, the inspector's phase 2) is a message to an agent that has
    // its brief already: no REPO line to ask for, no lessons to add, no new builder.
    if (e.resume !== undefined) {
      const ran = await next(e)
      if (ran.agentId !== undefined) await wake($, e.resume.agentId)
      return ran
    }
    // A builder may write in its REPO too, so one outside the session folder must be a project's own.
    const roots = lane !== undefined && isBuilder(lane) ? await writeRoots($) : null
    // Kept for every boss agent: an edit inside a REPO is an edit to the project.
    const repos = lane === undefined ? [] : await readRepos($, e.prompt)
    for (const repo of roots === null ? [] : repos.filter(one => !within(one, roots.cwd))) {
      const why = await repoProblem($, repo)
      if (why !== null) return { deny: `boss-live: REPO ${repo} is ${why} — brief the project's own folder` }
    }
    // An agent that writes or tests must know which repo: one once inspected the wrong one.
    if (lane !== undefined && (isBuilder(lane) || lane === 'inspector') && !hasRepo(e.prompt)) return { deny: NEED_REPO }
    // The owner's lessons, read from disk at each dispatch, so one learned mid-run reaches the next agent.
    const prompt = lane === undefined ? e.prompt : withLessons(e.prompt, await recall($, lane))
    const ran = await next(prompt === e.prompt ? e : { ...e, prompt })
    if (lane !== undefined && ran.agentId !== undefined) {
      // A boss agent makes this a boss session.
      await update($, learn, s => (s.isBoss ? s : { ...s, isBoss: true }))
      // A new builder resets "stuck" (withBrief), so the stuck list starts over with it.
      if (isBuilder(lane)) {
        blockedBuilders.clear()
        let isReopened = false
        await update($, live, s => {
          const proof = withBrief(s.proof, e.prompt)
          isReopened = s.proof?.verdict != null && proof?.verdict == null
          return { ...s, proof }
        })
        if (isReopened) forgetProof()
      }
      await addJob($, ran.agentId, {
        lane,
        phase: LANES[lane]?.phase ?? 'building',
        model: shortModel(e.model ?? ran.model),
        description: e.description,
        startedAt: await $.clock.now(),
        ...(repos.length === 0 ? {} : { repos }),
      }, isBuilder(lane) ? readGoal(e.prompt) : null)
    }

    return ran
  })

  // Every agent's report, foreground, background or resumed, in any session: secrets leak in all of them.
  on('agent.report', async ($, e, next) => {
    const ran = await next(e)
    if (ran.consumed !== undefined) return ran
    const found: { kind: string; value: string }[] = []
    const text = redact(ran.text, found)
    // No message of the person's yet (or a reload since): nothing to judge, nothing to ask back.
    if (found.length === 0 || asked === null) return { ...ran, text }
    const kinds = [...new Set(found.map(secret => secret.kind))]
    asked.shows ??= judge($, asked.text, kinds)
    if (await asked.shows) return ran
    hidden ??= { secrets: new Map(), turns: 0 }
    for (const secret of found) hidden.secrets.set(secret.value, secret.kind)
    hidden.turns = 0
    const one = found.length === 1
    return { ...ran, text: `${text}\n\n(boss: hid ${found.length} secret${one ? '' : 's'} (${kinds.join(', ')}); say "show it" to see ${one ? 'it' : 'them'})` }
  })

  // The main turn runs; a boss agent woken again (the inspector's second phase) runs once more.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      mainTurnSeq = ++seq
      mainTurn = { id: e.turnId, running: true }
      // A turn with words of its own starts the reply checks over; a continuation does not.
      if (e.text !== '') await update($, learn, s => ({ ...s, asked: false, wroteMemory: false, blocked: false }))
      // A message typed over the last turn, now run as this one, answers the wait.
      const text = e.text.trim()
      const isAnswer = text !== '' && [...typedOver.values()].some(typed => typed.trim() !== '' && text.includes(typed.trim()))
      typedOver.clear()
      if (isAnswer) await update($, live, s => ({ ...s, isWaiting: false, inPicker: false, waitingSince: null, questions: [] }))
    }
    if (e.agentId !== undefined) {
      const s = await read($, live)
      const known = s.agents[e.agentId]
      if (known !== undefined && s.jobs[e.agentId] === undefined) {
        const { endedAt: _, stopped: _stopped, ...again } = known
        await addJob($, e.agentId, { ...again, startedAt: await $.clock.now() })
        await wake($, e.agentId)
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Compact only after the reply that holds the checkpoint (its Goal: and Next: lines).
    const isCheckpoint = /^\s*Goal:/m.test(e.answer) && /^\s*Next:/m.test(e.answer)
    if (e.agentId === undefined && compactAfterHandoff > 0 && !isCheckpoint) {
      compactAfterHandoff -= 1
      if (compactAfterHandoff === 0) $.ui.toast('Boss: no checkpoint came; run /compact yourself')
    }
    if (e.agentId === undefined && compactAfterHandoff > 0 && isCheckpoint) {
      compactAfterHandoff = 0
      // Compaction waits for the turn to end; the checkpoint is now in the chat.
      $.clock.after(1500, () => {
        $.session.compact({ instructions: 'Keep the boss checkpoint printed just before this compaction, word for word.' }).catch(() => {
          $.ui.toast('Boss: the checkpoint is saved; run /compact to finish')
        })
      })
    }
    if (e.agentId !== undefined) {
      // Interrupted, refused or cut off by an error: stopped, not done.
      await endJob($, e.agentId, e.answer, { stopped: e.reason !== 'answer' })
    } else {
      // Aborted or answered, the main turn is over: the card stops looking busy.
      mainTurn = { id: e.turnId, running: false }
      $.ui.invalidate('ui.render')
    }
    if (e.agentId === undefined && QUESTION.test(withoutCode(e.answer)) && !(mainTurnSeq > 0 && personSeq > mainTurnSeq)) {
      // Waits on the person, unless they answered after this turn began (Go pressed before it ended).
      let isNew = false
      const questions = readQuestions(e.answer)
      const now = await $.clock.now()
      await update($, live, s => {
        isNew = !s.isWaiting && s.hadRun
        return { ...s, isWaiting: true, inPicker: false, waitingSince: s.waitingSince ?? now, questions, hadRun: isNew ? false : s.hadRun }
      })
      // A message typed over this turn is already on its way: no toast to chase it.
      if (isNew && !typedOver.has(e.turnId)) $.ui.toast('Boss needs your answer')
    }

    return next(e)
  })

  // An answer ends the wait; a new ask after a finished run clears the board.
  on('prompt.submit', async ($, e, next) => {
    // Only a person's message counts: an agent-finished notice or a continuation
    // the engine sends must not end the wait or clear the board.
    const MACHINE = ['task-notification', 'auto-continuation', 'observer', 'observer-activity', 'coordinator', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay']
    if (MACHINE.includes(e.origin.kind) || e.isMeta === true) return next(e)
    // A plugin's prompt (this card's Go, Go cheaper) did its own bookkeeping.
    if (e.origin.kind === 'plugin') return next(e)
    asked = { text: e.text }
    if (hidden !== null && REVEAL.test(e.text)) {
      const lines = [...hidden.secrets].map(([value, kind]) => `- ${kind}: ${value}`)
      hidden = null
      e = { ...e, text: `${e.text}\n\n(boss: the secrets hidden from agent reports, as you asked)\n${lines.join('\n')}` }
    } else if (hidden !== null && ++hidden.turns >= 2) hidden = null
    // Typed over a running turn: it answers a wait but starts no new ask.
    if (e.turnId !== undefined) {
      typedOver.set(e.turnId, e.text)
      await update($, live, s => ({ ...s, isWaiting: false, inPicker: false, waitingSince: null, questions: [] }))
      return next(e)
    }
    personSeq = ++seq
    await update($, live, s => {
      const isNewAsk = Object.keys(s.jobs).length === 0 && !s.isWaiting
      return {
        ...s,
        isWaiting: false,
        inPicker: false,
        waitingSince: null,
        questions: [],
        proof: isNewAsk ? null : s.proof,
        finished: isNewAsk ? null : s.finished,
        task: isNewAsk ? null : s.task,
      }
    })

    return next(e)
  })

  // In a boss session, each message of the person's reminds the main model to keep what it teaches.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const ran = await next(e)
    if (e.agent_id !== undefined || (e.source !== undefined && e.source !== 'user' && e.source !== 'sdk')) return ran
    if (/^\s*\/boss(?![\w-])/.test(e.prompt)) await update($, learn, s => ({ ...s, isBoss: true }))
    if (!(await read($, learn)).isBoss) return ran
    return { ...ran, additionalContext: [...(ran.additionalContext ?? []), NUDGE] }
  })
  // A reply that asks in prose, or says it learned with nothing written, goes back once per turn.
  on('classic.Stop', async ($, e, next) => {
    const ran = await next(e)
    const s = await read($, learn)
    if (e.agent_id !== undefined || e.stop_hook_active || s.blocked || !s.isBoss) return ran
    const problem = replyProblem(e.last_assistant_message ?? '', s)
    if (problem === null) return ran
    await update($, learn, now => ({ ...now, blocked: true }))
    return { ...ran, block: problem }
  })

  // Observed only, the answer stays the person's: a boss agent's permission prompt is your turn.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id !== undefined && (await read($, live)).jobs[e.agent_id] !== undefined) {
      asking.set(e.agent_id, e.tool_name)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
  // Claude Code watches the proven files only from a session start (the one place a hook adds
  // watch paths); its change events then mark the proof stale.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (proved === null || proved.size === 0) return started
    return { ...started, watchPaths: [...new Set([...(started.watchPaths ?? []), ...proved.keys()])] }
  })
  on('classic.FileChanged', ($, e, next) => {
    staleIf($, e.file_path)
    return next(e)
  })
  on('classic.PermissionDenied', ($, e, next) => {
    answered($, e.agent_id)
    return next(e)
  })
  on('tool.run', ($, e, next) => {
    answered($, e.agentId)
    return next(e)
  })
  // Every call answers its agent's ask, as it starts and once it ran or was refused; an edit
  // to a file the last pass proved makes that proof stale.
  on('tool.call', async ($, e, next) => {
    answered($, e.agentId)
    const agentId = e.agentId
    if (agentId !== undefined) inFlight.set(agentId, (inFlight.get(agentId) ?? 0) + 1)
    try {
      if (e.agentId === undefined && e.tool === 'Skill' && /^(boss:)?boss$/.test(e.skill)) await update($, learn, s => ({ ...s, isBoss: true }))
      const path = EDITS.includes(String(e.tool)) ? pathOf(e) : undefined
      const at = path === undefined ? null : await places($)
      const target = path === undefined ? null : clean(path)
      const isLesson = at !== null && target !== null && isLessonFile(target, at)
      if (at !== null && target !== null && isLesson && (e.tool === 'Write' || e.tool === 'Edit')) {
        // Sessions share these files: a whole-file Write would drop a lesson another one just added.
        if (e.tool === 'Write' && (await $.fs.exists(target).catch(() => false))) return { deny: REWRITE }
        // In a boss session a lesson file stays within its budget, so memory stays small enough to read.
        const text = (await read($, learn)).isBoss ? await resultText($, e, target) : null
        // Over budget only counts when it is worse than the file is now: a trim always lands.
        const over = text === null ? null : overBudget(target, text, at, String(await $.fs.read(target).catch(() => '')))
        if (over !== null) return { deny: `boss-live: ${over} — trim or merge lessons, then write` }
      }
      const ran = await bossCall($, e, next)
      const isDone = ran.deny === undefined && ran.isError !== true
      if (ran.deny === undefined && path !== undefined) staleIf($, path)
      if (isDone && isLesson && e.agentId === undefined) await update($, learn, s => ({ ...s, wroteMemory: true }))
      if (isDone && target !== null && !isLesson) await countEdit($, target, e.agentId)
      return ran
    } finally {
      answered($, e.agentId)
      if (agentId !== undefined) {
        const left = (inFlight.get(agentId) ?? 1) - 1
        if (left > 0) inFlight.set(agentId, left)
        else inFlight.delete(agentId)
        // A call that just ended is the agent's latest sign of life.
        if (beats.has(agentId)) beats.set(agentId, [...(beats.get(agentId) ?? []).slice(-199), await $.clock.now()])
      }
    }
  }).catch(($, e, next) =>
    next.called || e.agentId === undefined ? next(e) : { deny: 'boss-live: the safety check failed, so this call was stopped' },
  )

  // Claude Code's own picker keeps its look; while boss works, one quiet line above it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const picker = await next(e)
    const s = await read($, live)
    const jobs = Object.values(s.jobs)
    if (jobs.length === 0 && s.run === null && (s.proof === null || s.proof.verdict !== null)) return picker
    try {
      const { Box, Text } = $.ui.resolve(e)
      const n = e.props.questions.length
      const stage = MOOD[PHASES.find(p => jobs.some(job => job.phase === p)) ?? 'working'] ?? 'Working'
      return (
        <Box flexDirection="column">
          <Text dimColor>{`${n} question${n === 1 ? '' : 's'} from your team · ${stage}`}</Text>
          {picker}
        </Box>
      )
    } catch {
      return picker
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s: BossLiveState = await read($, live)
    const jobs = Object.values(s.jobs).sort((a, b) => a.startedAt - b.startedAt)
    // Hidden: no card, so nothing to redraw and no quiet toasts.
    if (await read($, isHidden)) {
      ticker?.cancel()
      ticker = null
      return next(e)
    }
    // The main turn as its events report it; after a reload, the band's own word.
    const mainRunning = mainTurn?.running ?? e.props.isWorking
    // The pulse runs only while someone is working.
    // Between agents: the builder is done and boss reads its work before the inspector.
    const isBetween = jobs.length === 0 && !s.isWaiting && s.proof !== null && s.proof.verdict === null && s.finished !== null && mainRunning
    const isTicking = jobs.length > 0 || s.isWaiting || isBetween
    if (isTicking && ticker === null) {
      ticker = $.clock.every(5000, () => {
        $.ui.invalidate('ui.render')
        void tellQuiet($).catch(() => undefined)
      })
    }
    if (!isTicking && ticker !== null) {
      ticker.cancel()
      ticker = null
    }
    if (e.props.hasSurvey || (jobs.length === 0 && !s.isWaiting && s.proof === null)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    // Boss's turn ended with the team done and no verdict: drawn as not checked, never stored,
    // so an inspector that comes later still joins this run.
    const overlay: BossLiveProof | null =
      jobs.length === 0 && !s.isWaiting && s.finished !== null && s.proof?.verdict === null && !mainRunning ? { ...s.proof, verdict: 'NOT CHECKED' } : s.proof
    const proof = overlay
    // A save no event reported: the proven files' modified times, checked as the card draws.
    if (proved !== null && !isProofStale && proof?.verdict === 'PASS') {
      for (const [path, at] of proved) {
        if (at !== null && (await modifiedAt($, path)) !== at) {
          isProofStale = true
          break
        }
      }
    }
    const isStale = isProofStale && proof?.verdict === 'PASS'
    // A boss agent waiting on your approval: what for, in plain words, and who asks.
    const asker = Object.entries(s.jobs).find(([id]) => asking.has(id))
    const askText = asker === undefined ? null : `Asking you to ${askPhrase(asking.get(asker[0]) ?? '')} · ${ROLE[asker[1].lane] ?? asker[1].lane}`
    const phase = s.isWaiting || askText !== null
      ? 'needs your answer'
      : (PHASES.find(p => jobs.some(job => job.phase === p)) ?? (jobs.length > 0 ? 'working' : 'done'))
    const accent =
      proof?.verdict === 'PASS' && jobs.length === 0 && !isStale
        ? 'success'
        : proof?.verdict === 'FAIL' || (proof?.verdict === null && proof.builder === 'blocked')
          ? 'error'
          : (TONE[phase] ?? 'claude')
    const mood = isBetween
      ? 'Reviewing the work'
      : phase !== 'done'
        ? (MOOD[phase] ?? 'Working')
        : proof?.verdict === 'PASS'
          ? 'Done'
          : proof?.verdict === 'FAIL'
            ? 'Failed'
            : 'Done'

    // The team of this run: who is working now, and who already finished.
    const since = s.run?.startedAt ?? s.finished?.startedAt ?? Number.POSITIVE_INFINITY
    const running = new Set(Object.keys(s.jobs))
    const team = [
      ...Object.entries(s.jobs),
      ...Object.entries(s.agents).filter(([id, job]) => !running.has(id) && job.startedAt >= since),
    ].sort(([, a], [, b]) => a.startedAt - b.startedAt)
    const frame = Math.floor(now / 1000)
    const runStart = s.run?.startedAt ?? (isBetween ? s.finished?.startedAt : undefined)
    const elapsed = runStart === undefined ? null : Math.max(0, Math.floor((now - runStart) / 1000))

    // What's happening, in plain words. The task: the brief's GOAL, or the first agent's own words.
    const firstWords = team[0]?.[1].description.split(/(?<=[.!?])\s/)[0]
    const task = s.task ?? (firstWords === undefined || firstWords.trim() === '' ? null : short(firstWords, 200))
    // Right now: the latest thing any working agent did; the run's state when none works.
    const acts = jobs.length === 0 ? [] : Object.entries(s.jobs).map(([id, job]) => {
      const role = ROLE[job.lane] ?? job.lane
      const last = doing.get(id)
      const fresh = last !== undefined && last.at >= job.startedAt ? last : undefined
      const what =
        job.lane === 'inspector'
          ? `Inspector trying your test${fresh?.counts === undefined ? '' : ` · ${fresh.counts}`}`
          : job.lane === 'codex' || job.lane === 'local' || job.lane === 'outside'
            ? `${role} thinking`
            : null
      return { text: what ?? (jobs.length > 1 ? `${role}: ` : '') + (fresh?.what ?? 'Getting started'), at: fresh?.at ?? job.startedAt }
    }).sort((a, b) => b.at - a.at)
    const verdict = proof?.verdict ?? null
    const candidate =
      askText ??
      acts[0]?.text ??
      (s.isWaiting
        ? 'Waiting for your answer'
        : isBetween
          ? 'Boss is looking over the work'
          : verdict === 'PASS'
            ? isProofStale
              ? 'Finished: a proven file changed since'
              : 'Finished: your test passed'
            : verdict === 'FAIL'
              ? 'Stopped: your test failed'
              : verdict === 'NOT CHECKED'
                ? 'Finished, not checked'
                : 'Finished')
    // A new phrase waits until the shown one has held 1.5s; a settled run, or an ask coming or going, shows at once.
    const isAskChange = askText !== null || shown?.text.startsWith('Asking you to ') === true
    if (shown === null || (shown.text !== candidate && (acts.length === 0 || isAskChange || now - shown.at >= HOLD_MS))) shown = { text: candidate, at: now }
    const rightNow = shown.text
    // Plan › Build › Check › Done: steps the run passed are done, or skipped if no agent did them.
    const reached = new Set(team.map(([, job]) => stepOf(job)))
    const current =
      jobs.length > 0
        ? Math.max(...jobs.map(stepOf))
        : verdict !== null
          ? 3
          : team.length > 0
            ? Math.max(...reached)
            : 0
    const steps = STEPS.map((label, k) => ({
      label,
      state: k === current ? ('current' as const) : k > current ? ('next' as const) : reached.has(k) ? ('done' as const) : ('skipped' as const),
    }))
    const stepAt =
      current === 3 ? (proof?.doneAt ?? null) : (team.filter(([, job]) => stepOf(job) === current).map(([, job]) => job.startedAt).sort((a, b) => a - b)[0] ?? null)

    const proven = proof === null ? 0 : proof.checks.filter(check => check.result === 'PASS').length
    const total = proof?.checks.length ?? 0
    const failed = proof?.verdict === 'FAIL' ? proof.checks.filter(check => check.result === 'FAIL') : []
    const usage = await $.session.usage().catch(() => null)
    const limitNow = usage?.rateLimits.find(l => l.kind === 'five_hour') ?? usage?.rateLimits.find(l => l.kind === 'seven_day') ?? usage?.rateLimits[0]
    const contextLeftNow = usage?.context.percent === undefined ? null : Math.max(0, 100 - usage.context.percent)
    const runKey = s.run?.startedAt ?? null
    // A press has 10s, and these start a whole turn: start it and return, never await it.
    const saveAndCompact = () => {
      compactAfterHandoff = 3
      $.command.run({ command: 'boss:handoff' }).catch(() => {
        // No boss handoff command here: compact straight away.
        compactAfterHandoff = 0
        $.session.compact().catch(() => $.ui.toast('Boss: run /compact to free context'))
      })
    }
    const goCheaper = async () => {
      cheaperForRun = runKey
      $.prompt.submit({ text: 'careful with tokens', asUser: true }).catch(() => undefined)
    }
    const go = async () => {
      personSeq = ++seq
      await update($, live, now => ({ ...now, isWaiting: false, inPicker: false, waitingSince: null, questions: [] }))
      $.prompt.submit({ text: 'go', asUser: true }).catch(() => undefined)
    }
    const state = proof === null ? null : proofState(proof)
    const isCompact = (await $.store.get('isCompact').catch(() => undefined)) === true
    const toggleSize = async () => {
      await $.store.set('isCompact', !isCompact)
      $.ui.invalidate('ui.render')
    }

    // One colour at most: amber while you are asked, green once proven, red when failed.
    const kind: CardKind =
      phase === 'needs your answer'
        ? 'turn'
        : jobs.length > 0
          ? 'working'
          : proof?.verdict === 'PASS'
            ? isStale
              ? 'still'
              : 'done'
            : proof?.verdict === 'FAIL' || (proof?.verdict === null && proof.builder === 'blocked')
              ? 'failed'
              : isBetween
                ? 'working'
                : 'still'
    // The stage's colour while the team works: violet planning or researching, blue building, teal testing.
    const HUES = { 'checking the plan': 'plan', 'looking up': 'plan', building: 'build', testing: 'check' } as const
    const hue = kind !== 'working' ? null : phase in HUES ? HUES[phase as keyof typeof HUES] : (['plan', 'build', 'check', 'check'] as const)[current] ?? 'build'
    // A failed test stops the run at Check, with Done still ahead; a run not checked, or a
    // proof gone stale, leaves Check open. Not while someone works again. Every surface draws these.
    const isUnproven = verdict === 'NOT CHECKED' || isStale
    const drawnSteps =
      jobs.length > 0 || !(verdict === 'FAIL' || isUnproven)
        ? steps
        : steps.map((step, k) =>
            k === 2
              ? { ...step, state: verdict === 'FAIL' ? ('failed' as const) : step.state === 'done' ? ('open' as const) : step.state }
              : k === 3 && (verdict === 'FAIL' || kind === 'still')
                ? { ...step, state: 'next' as const }
                : step,
          )
    const stepsText = drawnSteps.map(step => `${step.label} ${STEP_WORD[step.state]}`).join(', ')
    // A stopped agent: never a tick. The card folds a big or finished team into a count.
    const isFolded = team.length > 3 || kind === 'done'
    // The same colours for the compact line's dot: one tone each that reads on dark and on light.
    const DOT = { plan: '#8f77f0', build: '#3f8ae6', check: '#1f9aa6', turn: '#bf7a00', done: '#23a05a', failed: '#e5484d' } as const
    const dotColor = kind === 'working' ? DOT[hue ?? 'build'] : kind === 'still' ? undefined : DOT[kind]
    // Beside the stage word, the same facts in the fewest words: how many questions and
    // where, that the test proved it, or the check that failed.
    const asked = s.questions.length
    const where = s.inPicker ? 'the picker' : 'the chat'
    const headline = (isShort: boolean) =>
      askText === null && s.isWaiting && asked > 0
        ? isShort
          ? `${asked} question${asked === 1 ? '' : 's'} in ${where}`
          : `${asked} question${asked === 1 ? ' is' : 's are'} waiting for you in ${where}`
        : kind === 'done'
          ? 'Proven by your test'
          : kind === 'failed' && failed[0] !== undefined
            ? `“${short(failed[0].name, 50)}” did not pass`
            : rightNow
    // One clock: the run's time, else how long you were asked, else how long the run took.
    const done = s.finished
    const length = done === null ? 0 : Math.round((done.endedAt - done.startedAt) / 1000)
    const clockText =
      elapsed !== null
        ? minutes(elapsed)
        : s.isWaiting
          ? minutes(Math.max(0, Math.floor((now - (s.waitingSince ?? now)) / 1000)))
          : done === null
            ? null
            : minutes(length)

    // Questions are answered in Claude Code's picker; a plain-text ask keeps one press.
    // What the moment needs comes first, so Show less and Hide never move.
    const buttons = [
      s.isWaiting && !s.inPicker ? <Button key="go" label="Go with my picks" variant="primary" hotkey="1" onPress={go} /> : null,
      contextLeftNow !== null && contextLeftNow <= 15 ? (
        <Button key="compact" label="Save & make room" variant={s.isWaiting ? undefined : 'primary'} onPress={saveAndCompact} />
      ) : null,
      limitNow !== undefined && limitNow.percentUsed >= 85 && runKey !== null && cheaperForRun !== runKey ? (
        <Button key="cheaper" label="Go cheaper" onPress={goCheaper} />
      ) : null,
      <Button key="size" label={isCompact ? 'Show more' : 'Show less'} dimColor onPress={toggleSize} />,
      <Button key="hide" label="Hide" dimColor onPress={() => setHidden($, true)} />,
    ].filter(button => button !== null)
    // Context and the usage limit, quiet and to the left of the buttons; the terminal band has its own line.
    const LIMIT_LABEL: Record<string, string> = { five_hour: '5h limit', seven_day: 'Week limit', spend_limit: 'Spend limit' }
    const resetMs = limitNow?.resetsAt === undefined ? NaN : Date.parse(limitNow.resetsAt) - now
    const resetMinutes = Number.isFinite(resetMs) && resetMs > 0 ? Math.max(1, Math.floor(resetMs / 60_000)) : null
    const resetIn = resetMinutes === null ? null : resetMinutes >= 60 ? `${Math.floor(resetMinutes / 60)}h ${resetMinutes % 60}m` : `${resetMinutes}m`
    const usageText = [
      contextLeftNow === null ? null : `Context ${Math.round(100 - contextLeftNow)}%`,
      limitNow === undefined ? null : `${LIMIT_LABEL[limitNow.kind] ?? 'Limit'} ${Math.round(limitNow.percentUsed)}%`,
      resetIn === null ? null : `resets in ${resetIn}`,
    ].filter(part => part !== null).join(' · ')
    const buttonRow = (
      <Box justifyContent="flex-end" gap={1}>
        {e.surface !== 'terminal' && usageText !== '' && (
          <Box flexGrow={1}>
            <Text dimColor>{usageText}</Text>
          </Box>
        )}
        {buttons}
      </Box>
    )

    // Compact: one quiet line on every surface, the buttons at its right end. The dot takes
    // the stage's colour, grey when finished unproven; a line too long loses its end first.
    if (isCompact) {
      const proofWord = proof === null || total === 0 ? null : isStale ? 'Re-check needed' : `${proven} of ${total} proven`
      const rest = [team.length > 0 || s.isWaiting ? short(headline(true), 60) : null, proofWord, clockText].filter(part => part !== null)
      return (
        <Box gap={1}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">
              <Text color={dotColor} dimColor={dotColor === undefined}>●</Text>
              {' '}
              <Text weight="semibold">{mood}</Text>
              <Text dimColor>{rest.map(part => ` · ${part}`).join('')}</Text>
            </Text>
          </Box>
          {buttons}
        </Box>
      )
    }

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const working = team.filter(([id]) => running.has(id)).length
      type ProofKind = 'pending' | 'built' | 'pass' | 'fail' | 'unchecked' | 'stuck'
      const proofKind: ProofKind =
        proof === null
          ? 'pending'
          : proof.verdict === 'PASS'
            ? 'pass'
            : proof.verdict === 'FAIL'
              ? 'fail'
              : proof.verdict === 'NOT CHECKED'
                ? 'unchecked'
                : proof.builder === 'blocked'
                  ? 'stuck'
                  : proof.builder === 'done'
                    ? 'built'
                    : 'pending'
      const WORD: Record<ProofKind, string> = {
        pending: 'not proven yet',
        built: 'proving',
        pass: 'proven',
        fail: 'failed',
        unchecked: 'not checked',
        stuck: 'builder stuck',
      }
      const agentsText = (n: number) => `${n} agent${n === 1 ? '' : 's'}`
      const receipt =
        done === null || jobs.length > 0 || isBetween
          ? null
          : // The test row carries the verdict; the subline keeps time and team.
            [proof?.verdict === undefined || proof?.verdict === null ? 'Team finished' : '', clock(length), agentsText(done.count)]
              .filter(part => part !== '')
              .join(' · ')
      const note = s.isWaiting && s.questions.length > 0 ? `${s.questions.length} question${s.questions.length === 1 ? '' : 's'}` : null
      const subline = s.isWaiting
        ? `${s.inPicker ? 'Answer in the picker below' : 'Answer in chat'} · waiting ${minutes(Math.max(0, Math.floor((now - (s.waitingSince ?? now)) / 1000)))}`
        : // While the team row shows who works, the subline stays quiet.
          (receipt ?? (working > 0 ? (team.length > 0 ? '' : `${agentsText(working)} working`) : isBetween ? 'Checking what the team built' : 'Team finished'))
      const testText = proof === null ? null : (proof.test ?? 'not written yet')
      const proofWord = isStale ? 're-check needed' : WORD[proofKind]
      // The count while it is being proven; the check that failed; else the verdict in a word.
      const failedAt = proof === null ? -1 : proof.checks.findIndex(check => check.result === 'FAIL')
      const proofText = isStale
        ? 'Re-check needed'
        : proofKind === 'fail' && failedAt >= 0
          ? `Check ${failedAt + 1} of ${total} failed`
          : total > 0 && ['pending', 'built', 'pass'].includes(proofKind)
            ? `${proven} of ${total} proven`
            : WORD[proofKind]
      if (stage === null || stage.mood !== mood) stage = { mood, at: now }
      const card: CardModel = {
        kind,
        hue,
        stage: mood,
        doing: short(headline(false), 120),
        doingAt: shown.at,
        clock: clockText,
        // Shown once a run has a team; before that the headline says enough.
        task: team.length === 0 || task === null ? null : short(task, 140),
        team: team.map(([id, job]) => {
          const role = ROLE[job.lane] ?? job.lane
          if (!running.has(id) && job.stopped === true && !isFolded) return { role: `${role} stopped`, state: 'stopped' as const }
          return { role, state: running.has(id) ? ('run' as const) : ('done' as const) }
        }),
        proof:
          proof === null || testText === null
            ? null
            : {
                test: short(testText, 140),
                word: proofText,
                isStale,
                // Not checked, or stale: the words alone, with no pips to read as progress.
                checks: isUnproven ? [] : proof.checks.map(check => (check.result === 'PASS' ? 'pass' : check.result === 'FAIL' ? 'fail' : 'pending')),
                checkAt: proof.doneAt,
              },
        steps: drawnSteps,
        stepAt,
        // When the verdict came or the wait began; else when the card first drew this stage.
        stageAt: (kind === 'turn' ? s.waitingSince : kind === 'done' || kind === 'failed' ? proof?.doneAt : null) ?? stage.at,
        now,
      }
      const alt = [
        `Boss: ${mood}${note === null ? '' : ` · ${note}`}`,
        subline,
        ...team.map(([id, job]) => `${ROLE[job.lane] ?? job.lane} ${running.has(id) && asking.has(id) ? 'asking you' : running.has(id) ? 'working' : job.stopped === true ? 'stopped' : 'done'}`),
        testText === null ? '' : `Your test: ${testText}, ${proofWord}`,
        total > 0 ? `${proven} of ${total} proven${isProofStale && proof?.verdict === 'PASS' ? ' before the change' : ''}` : '',
        team.length === 0 || task === null ? '' : `Task: ${task}`,
        team.length === 0 ? '' : `Now: ${rightNow}`,
        team.length === 0 ? '' : `Steps: ${stepsText}`,
      ]
        .filter(part => part !== '')
        .join('. ')
      // The picture is kept until what it shows, or what its alt says, changes.
      const { now: _drawnAt, ...still } = card
      const sig = JSON.stringify([still, alt])
      if (lastCard === null || lastCard.sig !== sig) lastCard = { sig, source: cardSvg(card), alt }
      const drawn = lastCard

      // As wide as the card, so the buttons end at its right edge.
      return (
        <Box flexDirection="column" gap="xs" alignSelf="flex-start">
          <Svg source={drawn.source} alt={drawn.alt} height={CARD_HEIGHT} />
          {buttonRow}
        </Box>
      )
    }

    const fiveHour = usage?.rateLimits.find(l => l.kind === 'five_hour')
    const today = await todayLine($, now)
    const terminalStats =
      usage === null
        ? today
        : [
            fiveHour === undefined ? '' : `5-hour limit ${Math.round(fiveHour.percentUsed)}% used`,
            contextLeftNow === null ? '' : `context ${100 - contextLeftNow}% used`,
            today ?? '',
          ]
            .filter(part => part !== '')
            .join(' · ') || null
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text backgroundColor={accent} color="inverseText" weight="bold">{' BOSS '}</Text>
            <Text color={accent} weight="bold">{mood}</Text>
          </Box>
          {elapsed !== null && <Text dimColor>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</Text>}
        </Box>
        {team.length > 0 && (
          <Box columnGap={2} flexWrap="wrap">
            {team.slice(0, 5).map(([id, job], i) => (
              <Text>
                <Text color={!running.has(id) ? (job.stopped === true ? 'error' : 'success') : asking.has(id) ? 'warning' : accent}>
                  {!running.has(id) ? (job.stopped === true ? '✗' : '✓') : asking.has(id) ? '●' : (SPIN[(frame + i * 3) % SPIN.length] ?? '•')}
                </Text>
                <Text weight={running.has(id) ? 'semibold' : 'regular'} dimColor={!running.has(id)}>{` ${ROLE[job.lane] ?? job.lane}`}</Text>
                <Text dimColor>{` ${job.model}`}</Text>
              </Text>
            ))}
            {team.length > 5 && <Text dimColor>{`+${team.length - 5}`}</Text>}
          </Box>
        )}
        {team.length > 0 && task !== null && (
          <Text>
            <Text dimColor>{'Task '}</Text>
            {short(task, 90)}
          </Text>
        )}
        {team.length > 0 && (
          <Text>
            {drawnSteps.map((step, k) => (
              <Text
                color={step.state === 'current' ? accent : step.state === 'done' ? 'success' : step.state === 'failed' ? 'error' : undefined}
                dimColor={step.state === 'next' || step.state === 'skipped'}
                weight={step.state === 'current' || step.state === 'failed' ? 'bold' : 'regular'}
              >
                {`${k === 0 ? '' : ' › '}${step.state === 'done' ? '✓ ' : step.state === 'failed' ? '✗ ' : ''}${step.label}`}
              </Text>
            ))}
            <Text dimColor>{'  ·  '}</Text>
            {rightNow}
          </Text>
        )}
        {proof !== null && state !== null && (
          <Box gap={1}>
            <Text color={isStale ? undefined : state.color} dimColor={isStale} weight="bold">{state.icon}</Text>
            <Text weight="semibold">Your test</Text>
            <Text dimColor>{short(proof.test ?? 'not written yet', 56)}</Text>
            <Text color={isStale ? undefined : state.color} dimColor={isStale}>{isStale ? 'Re-check needed' : state.word}</Text>
          </Box>
        )}
        {proof !== null && total > 0 && (
          <Text>
            <Text dimColor>{'Proof '}</Text>
            {proof.checks.map(check => (
              <Text color={check.result === null || isStale ? undefined : CHECK_TONE[check.result]} dimColor={check.result === null || isStale}>
                {check.result === null ? '▱' : '▰'}
              </Text>
            ))}
            <Text dimColor>{` ${proven} of ${total} proven${isStale ? ' before the change' : ''}`}</Text>
          </Text>
        )}
        {terminalStats !== null && <Text dimColor>{terminalStats}</Text>}
        {failed.length > 0 && (
          <Text color="error">{`✗ failed: ${failed.slice(0, 2).map(check => short(check.name, 40)).join(' · ')}`}</Text>
        )}
        {buttonRow}
      </Box>
    )
  })
}
