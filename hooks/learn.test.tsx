import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NUDGE =
  'Boss: if this message corrects you or states a like, dislike or standing preference, save or sharpen the lesson (global or project) and read it back before saying learned.'
const ASK = "Ask as numbered questions (`1. Q? — I'd pick X`) or the picker."
const PICKER = 'Ask these choices through the AskUserQuestion picker (your pick first, marked Recommended), not as text lines.'
const SAVE = 'Write the lesson and read it back before saying it is saved.'

// What the model says in the next step of the main loop (speak).
let words = ''
// A machine with a home folder, a repo and the files the test puts there; nothing real is read.
const HOME = '/home/me'
const REPO = '/work/my repo'
const MEMORY = `${HOME}/.claude/projects/-work-my-repo/memory`
function world(on: On, files: Record<string, { text: string; at?: number }> = {}, cwd = REPO) {
  const prompts: string[] = []
  mock.clock(on)
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: REPO }))
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
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text' as const, index: 0, text: words }
    return { turnId: e.turnId, index: e.index, answer: words, toolUses: [], stopReason: 'tool_use' as const, usage: null }
  })

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

// A typed prompt, and the main turn it starts: the reply checks start over there.
let turns = 0
async function say($: Engine, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text, turnId: `m${++turns}` })
}
// The reply checks and the memory budget apply in a boss session.
const asBoss = ($: Engine) => $.tool.call({ tool: 'Skill', skill: 'boss:boss' })
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
  await asBoss($)
  await say($, 'add a cache')
  expect(await stop($, 'I could use redis or memory. Reply "go" to take my picks.')).toBe(ASK)
  expect(await stop($, 'I could use redis or memory. Reply "go" to take my picks.')).toBeUndefined()

  await say($, 'hmm')
  expect(await stop($, '1. Which store? — I\'d pick memory: no server\nReply "go" to take my picks.')).toBeUndefined()

  await say($, 'and the TTL?')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'TTL?', header: 'TTL', options: [], multiSelect: false }] } as never)
  expect(await stop($, 'Reply go to take my picks.')).toBeUndefined()
})

test('with the picker in the session, a choice asked as text goes back once; a fact question passes', async ($, on) => {
  world(on)
  on('tool.list', () => ({ value: [{ name: 'Read' }, { name: 'AskUserQuestion' }] }) as never)
  await asBoss($)
  const text = "Done.\n\n1. Build these as 2.2.6? — I'd pick yes: text only"
  await say($, 'what next')
  expect(await stop($, text)).toBe(PICKER)
  expect(await stop($, text)).toBeUndefined()

  await say($, 'and the TTL?')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'TTL?', header: 'TTL', options: [], multiSelect: false }] } as never)
  expect(await stop($, text)).toBeUndefined()

  await say($, 'which token?')
  expect(await stop($, '1. Which token do you use? — needed: I cannot see it')).toBeUndefined()
  await say($, 'ok')
  expect(await stop($, 'Done. Tests pass.')).toBeUndefined()
})

test('saying learned with no memory write this turn is stopped; after a write it passes', async ($, on) => {
  world(on)
  await asBoss($)
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
  await asBoss($)
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

test('C3: a word after learned or noted is not a claim; (learned: x) with no write still is', async ($, on) => {
  world(on)
  await asBoss($)
  await say($, 'explain the retry logic')
  expect(await stop($, 'The retry cap (noted above) is 3, so the loop ends.')).toBeUndefined()
  await say($, 'ok')
  expect(await stop($, 'Use a lock here (learned the hard way in the old queue).')).toBeUndefined()
  await say($, 'keep it short')
  expect(await stop($, 'Done. (learned: keep it short)')).toBe(SAVE)
})

test('C5: a memory file over budget may shrink but never grow', async ($, on) => {
  const index = Array.from({ length: 55 }, (_, k) => `- [Lesson ${k}](l${k}.md) — when ${k}: do it`).join('\n')
  world(on, {
    [`${MEMORY}/MEMORY.md`]: { text: index },
    [`${MEMORY}/big.md`]: { text: `---\nname: big\n---\n${'line\n'.repeat(30)}` },
  })
  await asBoss($)
  const edit = async (file: string, old_string: string, new_string: string) =>
    (await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/${file}`, old_string, new_string })).deny

  expect(await edit('MEMORY.md', '\n- [Lesson 54](l54.md) — when 54: do it', '')).toBeUndefined()
  expect(await edit('MEMORY.md', '— when 53: do it', '— when 53: do it\n- [New](new.md) — when new: do it')).toContain('50 lines')
  expect(await edit('big.md', 'line\nline\n', '')).toBeUndefined()
  expect(await edit('big.md', 'line\n', 'line\nline\n')).toContain('25 lines')
  // A new file starts from nothing.
  expect((await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/new.md`, content: 'x'.repeat(1501) })).deny).toContain('1500 characters')
})

test('C5: a long MEMORY.md line already there blocks no edit; a new long line is refused', async ($, on) => {
  const long = `- [Old](old.md) — ${'a stock auto-memory line that runs well past the eighty characters the boss budget allows'}`
  world(on, { [`${MEMORY}/MEMORY.md`]: { text: `${long}\n- [B](b.md) — short` } })
  await asBoss($)
  const edit = async (old_string: string, new_string: string) =>
    (await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/MEMORY.md`, old_string, new_string })).deny

  expect(await edit('- [B](b.md) — short', '- [B](b.md) — short\n- [C](c.md) — when c: d')).toBeUndefined()
  expect(await edit('- [B](b.md) — short', `- [B](b.md) — ${'x'.repeat(81)}`)).toContain('80 characters')
})

test('F2: lessons live under the session root, even after a shell cd moved the folder', async ($, on) => {
  world(on, {}, `${REPO}/hooks`)
  await asBoss($)
  await say($, 'keep reports short')
  expect((await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/long.md`, content: 'x'.repeat(5000) })).deny).toContain('1500 characters')
  await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/short.md`, content: 'when reporting: keep it short' })
  expect(await stop($, 'Done. (learned: keep reports short)')).toBeUndefined()
})

test('flow 7: a boss run under the guard: a builder loops over its files, an inspector works in its scratchpad, boss trims memory and says learned', async ($, on) => {
  const SCRATCH = '/private/tmp/claude-501/p/s1/scratchpad'
  const index = Array.from({ length: 52 }, (_, k) => `- [Lesson ${k}](l${k}.md) — when ${k}: do it`).join('\n')
  world(on, { [`${MEMORY}/MEMORY.md`]: { text: index } })
  await asBoss($)
  await say($, '/boss rename the flag, and from now on keep reports short')
  await speak($, 'triage: dispatch — renames across files\nadding: nothing beyond what you asked')
  const built = await spawn($, 'boss:builder', `GOAL: rename the flag\n**REPO:** \`${REPO}\`\nFILES: src/*.ts`, 'build')
  const inspected = await spawn($, 'boss:inspector', `REPO: ${REPO} (the app)\nCONTRACT: flag renamed`, 'inspect')
  expect([(built as { deny?: string }).deny, (inspected as { deny?: string }).deny]).toEqual([undefined, undefined])
  const b = `${built.agentId}`
  const i = `${inspected.agentId}`
  const bash = async (command: string, agentId: string) => (await $.tool.call({ tool: 'Bash', command, agentId })).deny

  expect(await bash(`cd "${REPO}" && for f in src/*.ts; do sed -i '' 's/old/new/' "$f"; done`, b)).toBeUndefined()
  expect(await bash('git ls-files | while read f; do sed -i \'\' \'s/old/new/\' "$f"; done', b)).toContain('use a `for f in <files>` loop')
  expect(await bash(`S=${SCRATCH}/t; cd "$S" && npm ci && sed -i '' s/a/b/ $PWD/x.ts && echo ok > "$S/report.txt"`, i)).toBeUndefined()
  expect(await bash(`S=${SCRATCH}/t; cd "$S" && echo x > "${REPO}/src/a.ts"`, i)).toContain('inspectors may not write files outside the scratchpad')

  const trim = await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/MEMORY.md`, old_string: '- [Lesson 51](l51.md) — when 51: do it', new_string: '- [Short](short.md) — when reporting: keep it short' })
  expect(trim.deny).toBeUndefined()
  expect(await stop($, 'Renamed and proven. (learned: keep reports short)')).toBeUndefined()
})

// The model's words this turn, streamed as one step of the main loop.
async function speak($: Engine, text: string) {
  words = text
  for await (const _ of $.turn.step({ turnId: `m${turns}`, index: 0, model: 'claude-opus', messageCount: 1 })) void _
}
const OPENING =
  'boss: print the opening lines first: the `triage:` line, and before a build the `adding:` line (`adding: nothing beyond what you asked` when none), then try again'
const AGAIN =
  'boss: still no opening lines in this turn\'s chat text. A mention inside a sentence or a file does not count: start a line with `triage:` (and one with `adding:` before a build), then make this call again'
const edit = async ($: Engine, agentId?: string) =>
  (await $.tool.call({ tool: 'Edit', file_path: `${REPO}/src/a.ts`, old_string: 'a', new_string: 'b', agentId })).deny

test('opening 1: in a boss turn with no triage: line, an edit or a boss dispatch is refused twice, then passes', async ($, on) => {
  world(on)
  await asBoss($)
  await say($, '/boss add a delete account option')
  expect(await edit($)).toBe(OPENING)
  expect(await edit($)).toBe(AGAIN)
  expect(await edit($)).toBeUndefined()

  await say($, 'and a dark mode')
  expect((await $.tool.call({ tool: 'Write', file_path: `${REPO}/src/b.ts`, content: 'x' })).deny).toBe(OPENING)
  expect((await $.tool.call({ tool: 'Write', file_path: `${REPO}/src/b.ts`, content: 'x' })).deny).toBe(AGAIN)
  expect((await $.tool.call({ tool: 'Write', file_path: `${REPO}/src/b.ts`, content: 'x' })).deny).toBeUndefined()

  await say($, 'and a notebook')
  expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${REPO}/nb.ipynb`, new_source: 'x' } as never)).deny).toBe(OPENING)

  for (const lane of ['boss:builder', 'boss:builder-deep', 'boss:inspector']) {
    await say($, `go ${lane}`)
    expect((await spawn($, lane, `REPO: ${REPO}\nGOAL: x`, lane)).deny).toBe(OPENING)
    expect((await spawn($, lane, `REPO: ${REPO}\nGOAL: x`, lane)).deny).toBe(AGAIN)
    expect((await spawn($, lane, `REPO: ${REPO}\nGOAL: x`, lane)).deny).toBeUndefined()
  }
})

test('opening 2: a builder dispatch with triage: but no adding: line is refused twice; an inspector or an edit passes', async ($, on) => {
  world(on)
  await asBoss($)
  await say($, '/boss add a delete account option')
  await speak($, 'triage: dispatch — touches persistent data')
  expect(await edit($)).toBeUndefined()
  expect((await spawn($, 'boss:inspector', `REPO: ${REPO}\nASK: x`, 'check')).deny).toBeUndefined()
  expect((await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: x`)).deny).toBe(OPENING)
  expect((await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: x`, 'again')).deny).toBe(AGAIN)
  expect((await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: x`, 'third')).deny).toBeUndefined()
})

test('opening 3: with both lines printed earlier in the turn, edits and dispatches pass; a new message starts over', async ($, on) => {
  world(on)
  await asBoss($)
  await say($, '/boss add a delete account option')
  await speak($, 'Looking at the store.\n**triage:** dispatch — touches persistent data\n')
  await speak($, 'adding: the delete survives a restart; a test of it')
  expect(await edit($)).toBeUndefined()
  expect((await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: x`)).deny).toBeUndefined()
  expect((await spawn($, 'boss:builder-deep', `REPO: ${REPO}\nGOAL: x`, 'deep')).deny).toBeUndefined()
  expect((await spawn($, 'boss:inspector', `REPO: ${REPO}\nASK: x`, 'check')).deny).toBeUndefined()

  // A line that only mentions the word is not the line.
  await say($, 'now the export')
  await speak($, 'I will print the triage: line soon')
  expect(await edit($)).toBe(OPENING)
})

test('opening 4: a non-boss session, subagent calls and lesson or scratchpad writes are never refused', async ($, on) => {
  world(on)
  await say($, 'add a flag')
  expect(await edit($)).toBeUndefined()

  await asBoss($)
  await say($, '/boss add a flag')
  const b = `${(await spawn($, 'boss:builder', `REPO: ${REPO}\nGOAL: x`, 'first')).agentId}`
  await say($, 'go on')
  expect(await edit($, b)).toBeUndefined()
  const child = await $.agent.spawn({
    tool_use_id: 't-child', prompt: `REPO: ${REPO}\nGOAL: x`, description: 'child', subagentType: 'boss:builder',
    provider: { plugin: 'boss', tier: 'user' }, parentModel: 'claude-opus', background: true, fork: false, parentAgentId: b,
  })
  expect(child.deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/plain.md`, content: 'when reporting: plain words' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/private/tmp/claude-501/p/s1/scratchpad/boss-run-x.md', content: 'x' })).deny).toBeUndefined()
  expect(await edit($)).toBe(OPENING)
})
