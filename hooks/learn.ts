// Boss's learning: where the user's lessons live, the lessons a brief gets, the
// memory budgets, and the reply checks. Reads only; the model writes the lessons.

import type { EngineInterface } from 'claude-code'

import type { BossLiveLane } from '../types'

type $ = EngineInterface

export const NUDGE =
  'Boss: if this message corrects you or states a like, dislike or standing preference, save or sharpen the lesson (global or project) and read it back before saying learned.'
export const NEED_REPO = 'boss-live: add REPO: <absolute path> to the brief'
export const REWRITE = 'boss: edit memory files with Edit, never rewrite them with Write — another session may have just added a lesson'
const ASK_NUMBERED = "Ask as numbered questions (`1. Q? — I'd pick X`) or the picker."
const SAVE_FIRST = 'Write the lesson and read it back before saying it is saved.'

// The global CLAUDE.md and this project's auto-memory folder.
export type Places = { claudeMd: string; memory: string }

export async function places($: $): Promise<Places | null> {
  try {
    const home = await $.env.get('HOME')
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home === undefined ? undefined : `${home}/.claude`)
    if (dir === undefined) return null
    // Claude Code names a project's folder after its path, every other character a dash.
    const project = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
    return { claudeMd: `${dir}/CLAUDE.md`, memory: `${dir}/projects/${project}/memory` }
  } catch {
    return null
  }
}

export function isLessonFile(path: string, at: Places): boolean {
  return path === at.claudeMd || (path.startsWith(`${at.memory}/`) && path.endsWith('.md'))
}

// The "## Boss lessons" section of CLAUDE.md, up to the next heading of its level or higher.
function section(text: string): string | null {
  const lines = text.split('\n')
  const at = lines.findIndex(line => /^##\s+Boss lessons\s*$/i.test(line))
  if (at < 0) return null
  const end = lines.findIndex((line, k) => k > at && /^#{1,2}\s/.test(line))
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n')
}

const lessonLines = (text: string) =>
  text.split('\n').map(line => line.trim().replace(/^[-*]\s+/, '')).filter(line => /^[Ww]hen\s/.test(line))

// Untagged and [all] lessons reach every lane; [builder] reaches both builder lanes.
function isForLane(line: string, lane: BossLiveLane): boolean {
  const tags = [...line.matchAll(/\[(builder|inspector|errand|all)\]/g)].map(match => match[1])
  return tags.length === 0 || tags.includes('all') || tags.includes(lane === 'builder-deep' ? 'builder' : lane)
}

// Up to 5 lessons for this lane: CLAUDE.md's first, then project memory, newest file first.
export async function recall($: $, lane: BossLiveLane): Promise<string[]> {
  const at = await places($)
  if (at === null) return []
  const found: string[] = []
  try {
    found.push(...lessonLines(section(String(await $.fs.read(at.claudeMd))) ?? ''))
  } catch {
    // No CLAUDE.md: nothing global yet.
  }
  try {
    const files = (await $.fs.list(at.memory)).filter(f => f.kind === 'file' && f.name.endsWith('.md')).sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const file of files) found.push(...lessonLines(String(await $.fs.read(`${at.memory}/${file.name}`).catch(() => ''))))
  } catch {
    // No memory folder for this project.
  }
  return [...new Set(found)].filter(line => isForLane(line, lane)).slice(0, 5)
}

export function withLessons(brief: string, lessons: string[]): string {
  // A LESSONS line the supervisor already filled (anything but "none") stays as written.
  const isFilled = /^\s*LESSONS\b[^:\n]*:[ \t]*(?!none\b)\S/im.test(brief)
  if (isFilled || lessons.length === 0) return brief
  return `${brief.trimEnd()}\n\nLESSONS (the user's standing rules, binding):\n${lessons.map(line => `- ${line}`).join('\n')}`
}

export const hasRepo = (brief: string) => /^\s*REPO\s*:\s*\/\S/m.test(brief)

// The file a Write or Edit would leave; null when it can't be known (the tool then decides).
export async function resultText($: $, call: object, path: string): Promise<string | null> {
  const e = call as { tool?: unknown; content?: unknown; old_string?: unknown; new_string?: unknown; replace_all?: unknown }
  if (e.tool === 'Write') return typeof e.content === 'string' ? e.content : null
  if (e.tool !== 'Edit' || typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null
  const from = e.old_string
  const to = e.new_string
  const now = String(await $.fs.read(path).catch(() => ''))
  if (!now.includes(from)) return null
  return e.replace_all === true ? now.split(from).join(to) : now.replace(from, () => to)
}

const size = (text: string) => ({ lines: text.trim() === '' ? 0 : text.trim().split('\n').length, chars: text.length })

// Which budget the new text breaks, in words; null within budget.
export function overBudget(path: string, text: string, at: Places): string | null {
  if (path === at.claudeMd) {
    const lessons = section(text)
    if (lessons === null) return null
    const { lines, chars } = size(lessons.trim())
    return lines > 40 || chars > 3000 ? `the Boss lessons section of CLAUDE.md may hold 40 lines and 3000 characters; this makes ${lines} lines, ${chars} characters` : null
  }
  if (path === `${at.memory}/MEMORY.md`) {
    const { lines, chars } = size(text)
    const long = text.split('\n').find(line => /\]\([^)]*\)/.test(line) && line.replace(/^.*?\]\([^)]*\)\s*/, '').length > 80)
    if (lines > 50 || chars > 6000) return `MEMORY.md may hold 50 lines and 6000 characters; this makes ${lines} lines, ${chars} characters`
    return long === undefined ? null : 'each MEMORY.md line may hold 80 characters after its link'
  }
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const { lines, chars } = size(body)
  return lines > 25 || chars > 1500 ? `a memory topic file may hold 25 lines and 1500 characters, frontmatter not counted; this makes ${lines} lines, ${chars} characters` : null
}

// What this turn did that the reply checks need.
type Turn = { asked: boolean; wroteMemory: boolean }

// The reason to send the reply back once, or null. Code is left out: a quoted rule is not an ask.
export function replyProblem(answer: string, turn: Turn): string | null {
  const prose = answer.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  if (/Reply\s+["“]?go\b/.test(prose) && !/^\s*1\.\s.*\?/m.test(prose) && !turn.asked) return ASK_NUMBERED
  const claims = /\((?:learned|noted)\b(?!\s*:\s*(?:none|nothing)\b)|saved (?:it |this |that )?to memory|I['’]ve saved\b[^.\n]{0,40}\b(?:memory|lesson|preference|rule)/i
  if (claims.test(prose) && !turn.wroteMemory) return SAVE_FIRST
  return null
}
