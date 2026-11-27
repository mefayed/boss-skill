import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NUDGE =
  'Boss: if this message corrects you or states a like, dislike or standing preference, save or sharpen the lesson (global or project) and read it back before saying learned.'
const ASK = "Ask as numbered questions (`1. Q? — I'd pick X`) or the picker."
const SAVE = 'Write the lesson and read it back before saying it is saved.'

// A machine with a home folder, a repo and the files the test puts there; nothing real is read.
const HOME = '/home/me'
const REPO = '/work/my repo'
const MEMORY = `${HOME}/.claude/projects/-work-my-repo/memory`
function world(on: On, files: Record<string, { text: string; at?: number }> = {}) {
  const prompts: string[] = []
  mock.clock(on)
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: REPO }))
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: '/private/tmp/claude-501/p/s1/scratchpad' } }))
  on('fs.read', (_, e) => (files[e.path] === undefined ? { deny: `ENOENT: ${e.path}` } : { value: files[e.path]?.text ?? '' }))
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined }))
  on('fs.list', (_, e) => {
    const inside = Object.entries(files).filter(([path]) => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
    if (inside.length === 0) return { deny: `ENOENT: ${e.path}` }
    return { value: inside.map(([path, f]) => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: f.text.length, mtimeMs: f.at ?? 0, isLink: false })) }
  })
  on('agent.spawn', (_, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-sonnet-4-5', agentId: `${e.description}-id` }
  })
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('ui.toast', () => ({ value: undefined }))

  return prompts
}

async function spawn($: Engine, subagentType: string, prompt: string, description = 'job') {
  return $.agent.spawn({
    tool_use_id: `t-${description}`,
    prompt,
    description,
    subagentType,
    provider: { plugin: 'boss', tier: 'user' },
    parentModel: 'claude-opus',
    background: true,
    fork: false,
  })
}

const say = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const stop = async ($: Engine, answer: string) => (await $.classic.Stop({ stop_hook_active: false, last_assistant_message: answer })).block

test('a boss session gets the learning nudge on each prompt; another session does not', async ($, on) => {
  world(on)
  expect((await $.classic.UserPromptSubmit({ prompt: 'no, keep it shorter' })).additionalContext ?? []).toEqual([])

  await $.tool.call({ tool: 'Skill', skill: 'boss:boss' })
  expect((await $.classic.UserPromptSubmit({ prompt: 'no, keep it shorter' })).additionalContext).toEqual([NUDGE])
})

test('a prompt that starts with /boss turns the nudge on, and the card command does not', async ($, on) => {
  world(on)
  expect((await $.classic.UserPromptSubmit({ prompt: '/boss-live' })).additionalContext ?? []).toEqual([])
  expect((await $.classic.UserPromptSubmit({ prompt: '/boss fix the parser' })).additionalContext).toEqual([NUDGE])
  expect((await $.classic.UserPromptSubmit({ prompt: 'thanks' })).additionalContext).toEqual([NUDGE])
})

const CLAUDE_MD = `# My rules
- when anything: not a boss lesson
## Boss lessons
- when asking a choice: number it \`1. Q? — I'd pick X\`
  evidence: asked in prose twice (2026-11-27)
- when inspecting [inspector]: name the repo first
- when reporting [all]: put skipped checks first
## Other
- when ignored: outside the section`

const LESSON_FILES = {
  [`${HOME}/.claude/CLAUDE.md`]: { text: CLAUDE_MD },
  [`${MEMORY}/MEMORY.md`]: { text: '- [Temp files](temp.md) — when writing temp files: scratchpad only', at: 3000 },
  [`${MEMORY}/temp.md`]: { text: '---\nname: temp\n---\nWhen writing temp files [builder]: keep them in the scratchpad\nWhy: three strays in /tmp', at: 2000 },
  [`${MEMORY}/tests.md`]: { text: 'when running tests: use bun test\nwhen naming: plain words\nwhen looking up [errand]: cite the line\nwhen q: r', at: 1000 },
}

test('a builder brief gains the matching lessons from CLAUDE.md and project memory, five at most', async ($, on) => {
  const prompts = world(on, LESSON_FILES)
  await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: add a flag`)
  expect(prompts.at(-1)).toBe(
    `REPO: ${REPO}\nGOAL: add a flag\n\nLESSONS (the user's standing rules, binding):\n` +
      "- when asking a choice: number it `1. Q? — I'd pick X`\n" +
      '- when reporting [all]: put skipped checks first\n' +
      '- When writing temp files [builder]: keep them in the scratchpad\n' +
      '- when running tests: use bun test\n' +
      '- when naming: plain words',
  )

  await spawn($, 'boss:inspector', `REPO: ${REPO}\nASK: x`, 'check')
  expect(prompts.at(-1)).toContain('- when inspecting [inspector]: name the repo first')
  expect(prompts.at(-1)).not.toContain('temp files')
  expect(prompts.at(-1)).not.toContain('cite the line')

  // A brief that already carries its lessons is left alone.
  await spawn($, 'boss:builder', `REPO: ${REPO}\nLESSONS: when x: y`, 'again')
  expect(prompts.at(-1)).toBe(`REPO: ${REPO}\nLESSONS: when x: y`)
})

test('no lesson files leave the brief unchanged', async ($, on) => {
  const prompts = world(on)
  await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: add a flag`)
  expect(prompts.at(-1)).toBe(`REPO: ${REPO}\nGOAL: add a flag`)
  await spawn($, 'boss:errand', 'ASK: what version?', 'look')
  expect(prompts.at(-1)).toBe('ASK: what version?')
})

test('a builder or inspector brief without an absolute REPO path is refused', async ($, on) => {
  world(on)
  const REFUSED = 'boss-live: add REPO: <absolute path> to the brief'
  expect((await spawn($, 'boss:builder', 'GOAL: add a flag')).deny).toBe(REFUSED)
  expect((await spawn($, 'boss:builder-deep', 'REPO: my repo\nGOAL: add a flag')).deny).toBe(REFUSED)
  expect((await spawn($, 'boss:inspector', 'ASK: does it work?')).deny).toBe(REFUSED)
  expect((await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: add a flag`)).agentId).toBe('job-id')
  expect((await spawn($, 'boss:inspector', `ASK: does it work?\nREPO: ${REPO}`, 'check')).agentId).toBe('check-id')
  expect((await spawn($, 'boss:errand', 'ASK: what version?', 'look')).agentId).toBe('look-id')
})

test('a prose "Reply go" ask is stopped once; numbered questions or the picker pass', async ($, on) => {
  world(on)
  await say($, 'add a cache')
  expect(await stop($, 'I could use redis or memory. Reply "go" to take my picks.')).toBe(ASK)
  expect(await stop($, 'I could use redis or memory. Reply "go" to take my picks.')).toBeUndefined()

  await say($, 'hmm')
  expect(await stop($, '1. Which store? — I\'d pick memory: no server\nReply "go" to take my picks.')).toBeUndefined()

  await say($, 'and the TTL?')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'TTL?', header: 'TTL', options: [], multiSelect: false }] } as never)
  expect(await stop($, 'Reply go to take my picks.')).toBeUndefined()
})

test('saying learned with no memory write this turn is stopped; after a write it passes', async ($, on) => {
  world(on)
  await say($, 'keep reports short from now on')
  await $.tool.call({ tool: 'Write', file_path: `${REPO}/notes.md`, content: 'x' })
  expect(await stop($, 'Done. (learned: keep reports short)')).toBe(SAVE)

  // Saying nothing was learned is not a claim (seen live: "(learned: none)").
  await say($, 'thanks')
  expect(await stop($, 'Done.\n\n(learned: none)')).toBeUndefined()
  await say($, 'ok')
  expect(await stop($, 'Done. (noted: nothing)')).toBeUndefined()

  await say($, 'and plain words')
  await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/plain-words.md`, content: 'when reporting: plain words' })
  expect(await stop($, 'Done. (learned: plain words)')).toBeUndefined()
})

test('a memory write over its budget is refused, naming the budget', async ($, on) => {
  const index = Array.from({ length: 50 }, (_, k) => `- [Lesson ${k}](l${k}.md) — when ${k}: do it`).join('\n')
  world(on, { [`${MEMORY}/MEMORY.md`]: { text: index } })
  const write = (file_path: string, content: string) => $.tool.call({ tool: 'Write', file_path, content })

  expect((await write(`${MEMORY}/long.md`, `---\nname: long\n---\n${'x'.repeat(1501)}`)).deny).toContain('1500 characters')
  expect((await write(`${MEMORY}/short.md`, `---\nname: short\n---\nwhen asking: number it\n${'x'.repeat(1400)}`)).deny).toBeUndefined()
  const edit = await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/MEMORY.md`, old_string: '— when 49: do it', new_string: '— when 49: do it\n- [New](new.md) — when new: do it' })
  expect(edit.deny).toContain('50 lines')
})

test('a builder writes only inside the repo and its scratchpad; the main session is not limited', async ($, on) => {
  world(on)
  const b = `${(await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: add a flag`)).agentId}`
  const write = async (file_path: string, agentId?: string) => (await $.tool.call({ tool: 'Write', file_path, content: 'x', agentId })).deny
  const bash = async (command: string) => (await $.tool.call({ tool: 'Bash', command, agentId: b })).deny

  expect(await write('/tmp/elsewhere.txt', b)).toContain('outside REPO and the scratchpad')
  expect(await write('/private/tmp/claude-501/other/x.txt', b)).toContain('outside REPO and the scratchpad')
  expect(await write(`${REPO}/../elsewhere.txt`, b)).toContain('outside REPO and the scratchpad')
  expect(await write(`${REPO}/src/flag.ts`, b)).toBeUndefined()
  expect(await write('/private/tmp/claude-501/p/s1/scratchpad/notes.md', b)).toBeUndefined()
  expect(await write('/tmp/claude-501/p/s1/scratchpad/notes.md', b)).toBeUndefined()
  expect(await bash('echo x > /tmp/boss-try/out.txt')).toContain('outside REPO and the scratchpad')
  expect(await bash('echo x | tee -a /tmp/out.txt')).toContain('outside REPO and the scratchpad')
  expect(await bash('cd /tmp && echo x >> out.txt')).toContain('outside REPO and the scratchpad')
  expect(await bash('echo x > out.txt && echo y 2>/dev/null > src/y.txt')).toBeUndefined()
  expect(await write('/tmp/elsewhere.txt')).toBeUndefined()
})

test('a builder may not create or change files outside the repo with any file command', async ($, on) => {
  world(on)
  const b = `${(await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: add a flag`)).agentId}`
  const d = `${(await spawn($, 'boss:builder-deep', `REPO: ${REPO}\nGOAL: add a flag`, 'deep')).agentId}`
  const bash = async (command: string) => (await $.tool.call({ tool: 'Bash', command, agentId: b })).deny
  const OUT = 'outside REPO and the scratchpad'

  // The inspector's cases: an Edit from builder-deep, a cp, a notebook.
  expect((await $.tool.call({ tool: 'Edit', file_path: '/tmp/boss-try/check_x.py', old_string: 'a', new_string: 'b', agentId: d })).deny).toContain(OUT)
  expect(await bash('cp src/check_x.py /tmp/boss-try/check_x.py')).toContain(OUT)
  expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/Users/someone/nb.ipynb', new_source: 'x', agentId: b } as never)).deny).toContain(OUT)
  expect((await $.tool.call({ tool: 'MultiEdit', file_path: '/tmp/x.ts', edits: [], agentId: b } as never)).deny).toContain(OUT)

  for (const command of [
    'cp -r src /tmp/boss-try',
    'cp -t /tmp/boss-try a.txt',
    'mv out.txt /tmp/out.txt',
    'mv /tmp/in.txt src/in.txt',
    'install -m 644 a.txt /usr/local/bin/a',
    'rsync -a src/ /tmp/boss-try/',
    'rsync -a src/ host:backup/',
    'ln -s src/a.ts /tmp/link',
    'touch /tmp/boss-try/x',
    'mkdir -p /tmp/boss-try',
    "sed -i '' s/a/b/ /etc/hosts",
    'sed -i -e s/a/b/ /tmp/x.txt',
    "perl -pi -e 's/a/b/' /tmp/x.txt",
    'dd if=/dev/zero of=/tmp/blob bs=1 count=1',
  ]) expect(await bash(command)).toContain(OUT)

  for (const command of [
    'cp src/a.ts src/b.ts',
    'cp src/a.ts /private/tmp/claude-501/p/s1/scratchpad/a.ts',
    'mv a.txt b.txt',
    'ln -s src/a.ts',
    'mkdir -p build/out && touch build/out/x',
    "sed -i '' '/^#/d' src/a.ts",
    "perl -pi -e 's/a/b/' src/a.ts",
    'dd if=/dev/zero of=build/blob bs=1 count=1',
    'dd if=src/a.ts of=/dev/null',
  ]) expect(await bash(command)).toBeUndefined()
})

test('memory files that exist are changed with Edit only; a new topic file may be written', async ($, on) => {
  world(on, {
    [`${MEMORY}/MEMORY.md`]: { text: '- [Temp](temp.md) — when writing temp files: scratchpad only' },
    [`${MEMORY}/temp.md`]: { text: '---\nname: temp\n---\nwhen writing temp files: scratchpad only' },
    [`${HOME}/.claude/CLAUDE.md`]: { text: '# Mine\n## Boss lessons\n- when asking: number it' },
  })
  const RACE = 'boss: edit memory files with Edit, never rewrite them with Write — another session may have just added a lesson'
  const write = async (file_path: string, agentId?: string) => (await $.tool.call({ tool: 'Write', file_path, content: 'when x: y', agentId })).deny
  const job = `${(await spawn($, 'boss:errand', 'ASK: x', 'look')).agentId}`

  expect(await write(`${MEMORY}/MEMORY.md`)).toBe(RACE)
  expect(await write(`${HOME}/.claude/CLAUDE.md`)).toBe(RACE)
  expect(await write(`${MEMORY}/temp.md`, job)).toBe(RACE)
  expect(await write(`${MEMORY}/new-lesson.md`)).toBeUndefined()
  const edit = await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/temp.md`, old_string: 'scratchpad only', new_string: 'scratchpad only, never /tmp' })
  expect(edit.deny).toBeUndefined()
})
