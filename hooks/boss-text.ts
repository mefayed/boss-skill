// Reads what boss already writes: a builder brief's CONTRACT, an inspector's
// FIRST HUMAN TEST, VERDICT and CHECKS rows, a builder's STATUS, and the
// supervisor's Open choices questions. Pure, so the tests can feed it text.

import type { BossLiveQuestion, BossLiveResult } from '../types'

import { parse } from './guard'

// A header may carry a note: `CONTRACT (all fail now):`.
const HEADER = /^\s*(GOAL|FILES|CONTRACT|VERIFY|TOOLS|UNTOUCHED|DONE WHEN|FACTS|ASK|SCRATCH|BASELINE|REQUIRED|DETAIL|REPO|LESSONS)\b[^:\n]{0,80}:/
const TEST = /FIRST HUMAN TEST\s*:\s*(.+)/
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s*/

function plain(text: string): string {
  return text.replace(/\*\*|__/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

export function short(text: string, max = 60): string {
  const one = plain(text)
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

// The brief's CONTRACT block: its FIRST HUMAN TEST and one label per check.
export function readContract(brief: string): { test: string | null; checks: string[] } {
  const lines = brief.split('\n')
  const at = lines.findIndex(line => /^\s*CONTRACT\b[^:\n]{0,80}:/.test(line))
  const test = TEST.exec(brief)?.[1] ?? null
  if (at < 0) return { test: test === null ? null : plain(test), checks: [] }

  const block = [lines[at]?.replace(/^\s*CONTRACT\b[^:\n]{0,80}:/, '') ?? '']
  for (const line of lines.slice(at + 1)) {
    if (HEADER.test(line)) break
    block.push(line)
  }
  const checks = block
    .map(line => line.replace(BULLET, '').trim())
    .filter(line => line !== '' && !TEST.test(line) && !/^none\b/i.test(line))
    .map(line => short(line))

  return { test: test === null ? null : plain(test), checks }
}

// An inspector's reply: phase 1 holds only its FIRST HUMAN TEST, phase 2 adds
// VERDICT and one CHECKS row per check.
export function readInspection(answer: string): {
  test: string | null
  verdict: BossLiveResult | null
  rows: { name: string; result: BossLiveResult }[]
} {
  const test = TEST.exec(answer)?.[1] ?? null
  const verdict = /^[\s*#>_-]*VERDICT[\s*_]*:?[\s*_]*(PASS|NOT CHECKED|FAIL)/im.exec(answer)?.[1] ?? null
  const rows = [...answer.matchAll(/^\s*-\s+(.+?):\s+\**(PASS|FAIL|NOT CHECKED)\b/gm)].map(match => ({
    name: short(match[1] ?? ''),
    result: (match[2] ?? 'NOT CHECKED') as BossLiveResult,
  }))

  return { test: test === null ? null : plain(test), verdict: verdict as BossLiveResult | null, rows }
}

export function readStatus(answer: string): 'done' | 'blocked' | null {
  const status = /^\s*\**STATUS\**\s*:\s*\**(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED)/m.exec(answer)?.[1]
  if (status === undefined) return null
  return status.startsWith('DONE') ? 'done' : 'blocked'
}

// Open choices: one question per line, its recommendation after it. Boss writes
// `<question> — I'd pick <X>: <why>` by the rule, and in practice also
// `**<question>?** I'd add X. Why: …`; a fact only the person has says `needed`.
export function readQuestions(answer: string): BossLiveQuestion[] {
  const out: BossLiveQuestion[] = []
  for (const raw of answer.split('\n')) {
    if (/Reply ["“]go["”]/.test(raw)) break
    const line = plain(raw).replace(BULLET, '')
    const mark = line.indexOf('?')
    const dash = /\s[—–-]{1,2}\s/.exec(line)
    const end = mark >= 0 ? mark + 1 : dash !== null && /^\s*(I(?:'|’)d|needed)\b/i.test(line.slice(dash.index + dash[0].length)) ? dash.index : -1
    if (end < 0 || !/^\s*(?:[-*•]|\d+[.)])/.test(raw)) continue

    const rest = line.slice(end).replace(/^\s*[—–-]{1,2}\s*/, '')
    const isLeastSure = /\(least sure\)/i.test(line)
    const pick = /\bI(?:'|’)d\s+.+?(?=[.:;]\s|[.:;]?$|\s\(least sure\))/i.exec(rest)?.[0] ?? null
    out.push({ text: short(line.slice(0, end), 70), pick: pick === null || /^needed/i.test(rest) ? null : short(pick, 50), isLeastSure })
    if (out.length === 5) break
  }

  return out
}

// Model CLIs boss runs as outside seats. Local ones run on this Mac.
const LOCAL_CLIS = ['ollama', 'lms', 'llama-cli']
const OUTSIDE_CLIS = ['gemini', 'cursor-agent', 'opencode', 'kimi', 'qwen', 'llm', 'aider', 'glm']

// The model a command runs through its own CLI, if any: `ollama run qwen3 < brief`. Only the
// command a segment runs counts (its first word after wrappers, an interpreter's script, curl's
// target), so reading, testing or searching for a model never makes a job.
export function outsideRun(command: string): { lane: 'local' | 'outside'; model: string; script?: string } | null {
  // The model Ollama's server or a small script (ask_ollama.py) is asked for, named anywhere.
  const tag = /\b([a-z][\w.-]*:(?:\d+(?:\.\d+)?[bmk]|latest|[\w.-]*\d+b[\w.-]*))\b/i.exec(command)?.[1]
  const body = /"model"\s*:\s*"([^"]+)"/.exec(command)?.[1]
  for (const { words } of parse(command)) {
    let i = 0
    while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i] ?? '') || ['nohup', 'exec', 'command', 'time'].includes(words[i] ?? ''))) i++
    if (['timeout', 'gtimeout'].includes(words[i] ?? '')) i += 2
    const bin = (words[i] ?? '').replace(/^\(+/, '').split('/').pop() ?? ''
    const args = words.slice(i + 1)
    if (bin === 'curl' && args.some(a => /:11434\/api\/(generate|chat)\b/.test(a))) return { lane: 'local', model: body ?? tag ?? 'ollama' }
    const script = /^(python[\d.]*|node|bun|sh|bash)$/.test(bin) ? args.find(a => !a.startsWith('-')) : undefined
    if (script !== undefined && /ollama[^/]*\.(py|mjs|js|ts|sh)$/i.test(script)) return { lane: 'local', model: tag ?? 'ollama', script }
    const flag = args.findIndex(a => a === '--model' || a === '-m')
    const named = flag >= 0 ? args[flag + 1] : args.find(a => a.startsWith('--model='))?.slice(8)
    if (bin === 'ollama' && args[0] === 'run' && args[1] !== undefined) return { lane: 'local', model: args[1] }
    if (LOCAL_CLIS.includes(bin) && bin !== 'ollama' && named !== undefined) return { lane: 'local', model: named }
    if (OUTSIDE_CLIS.includes(bin) && !['--help', '-h', '--version', 'models', 'login'].includes(args[0] ?? '')) {
      return { lane: 'outside', model: named ?? bin }
    }
  }
  return null
}
