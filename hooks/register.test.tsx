import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { outsideRun } from './boss-text'
import { cardSvg, type CardModel } from './card'

const BAND = {
  plugin: 'boss',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// Stands in for the engine: answers spawns, tool runs and toasts.
function engine(on: On) {
  const toasts: string[] = []
  mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-4-5', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  return toasts
}

async function spawn($: Engine, subagentType: string, description: string, model?: string, prompt = 'brief') {
  await $.agent.spawn({
    tool_use_id: `t-${description}`,
    // Builders and inspectors are refused without a REPO line.
    prompt: `REPO: /repo\n${prompt}`,
    description,
    subagentType,
    model,
    provider: { plugin: 'boss', tier: 'user' },
    parentModel: 'claude-opus',
    background: true,
    fork: false,
  })

  return `${description}-id`
}

async function bash($: Engine, command: string, agentId?: string) {
  return (await $.tool.call({ tool: 'Bash', command, agentId })).deny
}

test('a builder may not push, and may read', async ($, on) => {
  engine(on)
  const b = await spawn($, 'boss:builder', 'Fix the parser')

  expect(await bash($, 'git push origin main', b)).toBe(
    'boss-live: builders may not run git push — report it under OPEN instead',
  )
  expect(await bash($, 'cd /repo && FOO=1 git -C x commit -m hi', b)).toContain('git commit')
  expect(await bash($, 'git reset --hard HEAD~1', b)).toContain('git reset --hard')
  expect(await bash($, 'rm -rf src', b)).toContain('rm -r')
  expect(await bash($, 'gh api repos/x/y -X POST', b)).toContain('gh api')
  expect(await bash($, 'curl -d a=1 https://x.test', b)).toContain('curl')
  expect(await bash($, 'git diff', b)).toBeUndefined()
  expect(await bash($, 'cat x | grep y', b)).toBeUndefined()
  expect(await bash($, 'git log --oneline; git status && git show HEAD', b)).toBeUndefined()
  expect(await bash($, 'grep -n "git push" README.md', b)).toBeUndefined()
  expect(await bash($, 'rm -rf /private/tmp/claude-501/x/build', b)).toBeUndefined()
  expect(await bash($, 'echo hi > out.txt', b)).toBeUndefined()
})

test('an inspector may not write in the repo', async ($, on) => {
  engine(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const write = (file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x', agentId: i })

  expect((await write('/Users/me/repo/src/a.ts')).deny).toContain('inspectors may not write files')
  expect((await write('/private/tmp/claude-501/s/notes.md')).deny).toBeUndefined()
  expect(await bash($, 'echo x > src/a.ts', i)).toContain('write files outside')
  expect(await bash($, "sed -i '' s/a/b/ f", i)).toContain('sed -i')
  expect(await bash($, 'npm install left-pad', i)).toContain('install')
  expect(await bash($, 'sed -n 1,5p f && ls | wc -l && jq . a.json 2>/dev/null', i)).toBeUndefined()
  expect(await bash($, 'find . -name "*.ts" | head', i)).toBeUndefined()
  expect(await bash($, 'cat > /private/tmp/claude-501/s/r.txt <<EOF\nrm -rf /\nEOF', i)).toBeUndefined()
})

test('the main session and other agents are never stopped', async ($, on) => {
  engine(on)
  await spawn($, 'Explore', 'Look around')

  expect(await bash($, 'git push origin main')).toBeUndefined()
  expect(await bash($, 'git push origin main', 'Look around-id')).toBeUndefined()
})

async function card($: Engine, surface: 'desktop' | 'vscode' = 'vscode') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const all = await ui.findAll({})
  await ui.unmount()
  const svg = all.find(el => typeof (el.props as { alt?: unknown }).alt === 'string')
  return svg === undefined ? null : (svg.props as { alt: string; source: string; height?: number })
}

// What the picture draws: its markup after the style rules.
const drawing = (svg: string | undefined) => (svg ?? '').slice((svg ?? '').indexOf('</style>'))
// The card's one colour, as its root names it, and the parts drawn in it.
const tone = (svg: string | undefined) => /<svg [^>]*style="--c:var\(--(\w+)\)"/.exec(svg ?? '')?.[1]
const coloured = (svg: string | undefined) =>
  [...new Set([...drawing(svg).matchAll(/<(\w+) class="([^"]*)"[^>]*>([^<]*)/g)].filter(m => /\b(c|ring|live|sh)\b/.test(m[2] ?? '')).map(m => `${m[1]}.${m[2]}${m[3] === '' ? '' : `:${m[3]}`}`))].sort()

async function band($: Engine, surface: 'terminal' | 'desktop' | 'vscode' = 'terminal') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const found = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return found
}

test('the band shows only while boss works', async ($, on) => {
  engine(on)
  expect(await band($)).toEqual([])
  expect(await card($)).toBeNull()

  await spawn($, 'boss:builder', 'Fix the parser')
  expect((await band($)).slice(0, 4)).toEqual([' BOSS ', 'Building', '0:00', '⠋ Builder sonnet'])
  for (const surface of ['desktop', 'vscode'] as const) {
    const drawn = await card($, surface)
    expect(drawn?.alt).toBe('Boss: Building. Builder working. Task: Fix the parser. Now: Getting started. Steps: Plan skipped, Build now, Check next, Done next')
    // One loop: the light on the current step.
    expect(drawn?.source.match(/infinite/g)?.length).toBe(1)
    expect(drawn?.source.match(/class="sheen"/g)?.length).toBe(1)
  }

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'Fix the parser-id', reason: 'answer' })
  expect(await band($)).toEqual([])
})

const done = (answer: string, agentId?: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: `t-${answer.length}`, agentId, reason: 'answer' }) as const

const BRIEF = `GOAL: add a login page
FILES: src/login.ts
CONTRACT:
FIRST HUMAN TEST: open /signin, type the test user, land on the dashboard
- \`npm test -- login\` fails: no route /signin
- \`curl -s localhost:3000/signin\` returns 404
VERIFY: npm test
UNTOUCHED: src/db`

test('the proof board turns green only when the inspector proves it', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const progress = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const bar = await ui.find({ text: /proven/ })
    await ui.unmount()
    return bar?.text
  }

  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  let lines = await band($)
  expect(lines).toContain('open /signin, type the test user, land on the dashboard')
  expect(lines).toContain('not proven yet')
  expect(lines.join(' ')).not.toContain('npm test')
  expect(await progress()).toContain('0 of 2 proven')

  await $.turn.complete(done('STATUS: DONE\nCONTRACT: both pass now', b))
  expect(await band($, 'terminal')).toContain('built, being proven')
  expect(await progress()).toContain('0 of 2 proven')

  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: add a login page')
  await $.turn.complete(done('FIRST HUMAN TEST: open /signin and log in', i))
  await $.turn.start({ text: 'phase 2', turnId: 'p2', agentId: i })
  expect(await band($)).toEqual(expect.arrayContaining(['Testing', '✓ Builder sonnet', '⠋ Inspector sonnet']))
  await $.turn.complete(
    done(
      'FIRST HUMAN TEST: open /signin and log in\nVERDICT: PASS\nCHECKS:\n- FIRST HUMAN TEST: PASS — setup `x`; `y` → ok\n- login route: PASS — setup `a`; `b` → 200\n- signin page: PASS — setup `a`; `c` → 200',
      i,
    ),
  )
  lines = await band($)
  expect((await card($))?.alt).toContain('2 of 2 proven')
  expect(lines).toContain('passed')
  expect(lines).toContain('Done')
  expect(await progress()).toContain('2 of 2 proven')

  await $.prompt.submit({ text: 'thanks, next thing', wait: false, origin: { kind: 'composer' } })
  expect(await band($)).toEqual([])
})

test('a builder that says done is not a pass', async ($, on) => {
  engine(on)
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.turn.complete(done('STATUS: BLOCKED\nOPEN: no db', b))
  const lines = await band($, 'terminal')
  expect(lines).toContain('builder stuck')
  expect(lines).not.toContain('passed')
})

test('a builder bounced back that then finishes, and an unchecked verdict, end grey, not red', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: NEEDS_CONTEXT\nOPEN: which db', b))
  expect(await band($, 'terminal')).toContain('builder stuck')
  expect(tone((await card($))?.source)).toBe('failed')
  // Boss answers it, and the same builder finishes.
  await $.turn.start({ text: 'the db is postgres', turnId: 'w1', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  let lines = await band($, 'terminal')
  expect(lines).toContain('built, being proven')
  expect(lines).not.toContain('builder stuck')
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no logs', i))
  const svg = (await card($))?.source ?? ''
  expect(svg).toContain('>Finished, not checked<')
  expect(tone(svg)).toBe('still')
})

test('a stuck builder is red until a verdict; an unchecked verdict is grey', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: BLOCKED\nOPEN: no db', b))
  expect(tone((await card($))?.source)).toBe('failed')
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no logs', i))
  expect(tone((await card($))?.source)).toBe('still')
})

test('a parallel builder finishing does not hide another one stuck', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const x = await spawn($, 'boss:builder', 'Task X', 'sonnet', BRIEF)
  const y = await spawn($, 'boss:builder', 'Task Y', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: BLOCKED\nOPEN: no db', x))
  await $.turn.complete(done('STATUS: DONE', y))
  expect(await band($, 'terminal')).toContain('builder stuck')
  expect(tone((await card($))?.source)).toBe('failed')
  // Waking the other builder does not clear X's block; X finishing does.
  await $.turn.start({ text: 'one more thing', turnId: 'wy', agentId: y })
  await $.turn.complete(done('STATUS: DONE', y))
  expect(await band($, 'terminal')).toContain('builder stuck')
  await $.turn.start({ text: 'the db is postgres', turnId: 'wx', agentId: x })
  await $.turn.complete(done('STATUS: DONE', x))
  const lines = await band($, 'terminal')
  expect(lines).toContain('built, being proven')
  expect(lines).not.toContain('builder stuck')
})

test('a replacement builder bounced back that then finishes is not stuck', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const x = await spawn($, 'boss:builder', 'Task X', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: BLOCKED\nOPEN: no db', x))
  const z = await spawn($, 'boss:builder', 'Task Z', 'opus', BRIEF)
  await $.turn.complete(done('STATUS: NEEDS_CONTEXT\nOPEN: which db', z))
  await $.turn.start({ text: 'the db is postgres', turnId: 'wz', agentId: z })
  await $.turn.complete(done('STATUS: DONE', z))
  const lines = await band($, 'terminal')
  expect(lines).toContain('built, being proven')
  expect(lines).not.toContain('builder stuck')
})

// Boss's bounce: SendMessage to a finished agent resumes it under the same id, with no brief.
async function resume($: Engine, subagentType: string, description: string, message: string) {
  return $.agent.spawn({
    tool_use_id: `r-${description}`,
    prompt: message,
    description,
    subagentType,
    provider: { plugin: 'boss', tier: 'user' },
    parentModel: 'claude-opus',
    background: true,
    fork: false,
    resume: { agentId: `${description}-id` },
  } as never)
}

test('a bounce resumes a stuck builder with no REPO line, and it is working again', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: NEEDS_CONTEXT\nOPEN: which db', b))
  expect(await band($, 'terminal')).toContain('builder stuck')
  const ran = await resume($, 'boss:builder', 'Add login', 'The db is postgres.')
  expect((ran as { deny?: string }).deny).toBeUndefined()
  await $.turn.start({ text: 'The db is postgres.', turnId: 'r1', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  const lines = await band($, 'terminal')
  expect(lines).toContain('built, being proven')
  expect(lines).not.toContain('builder stuck')
})

test('a bounce to one parallel builder does not hide another one stuck', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const x = await spawn($, 'boss:builder', 'Task X', 'sonnet', BRIEF)
  const y = await spawn($, 'boss:builder', 'Task Y', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: BLOCKED\nOPEN: no db', x))
  await $.turn.complete(done('STATUS: DONE', y))
  await resume($, 'boss:builder', 'Task Y', 'Also rename the helper.')
  await $.turn.complete(done('STATUS: DONE', y))
  expect(await band($, 'terminal')).toContain('builder stuck')
  await resume($, 'boss:builder', 'Task X', 'The db is postgres.')
  await $.turn.complete(done('STATUS: DONE', x))
  const lines = await band($, 'terminal')
  expect(lines).toContain('built, being proven')
  expect(lines).not.toContain('builder stuck')
})

// A session in /x/DC Supervisor, a home folder, and a disk the REPO checks read (folders end in '/').
const SCRATCH = '/private/tmp/claude-501/p/s1/scratchpad'
function desk(on: On, env: Record<string, string> = { HOME: '/home/me' }) {
  engine(on)
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/x/DC Supervisor' }))
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: SCRATCH } }))
  const kinds = new Map<string, 'file' | 'dir'>([['/', 'dir']])
  for (const path of ['/x/DC Home/backend/.git/', '/x/DC Home/README.md', '/x/Flat/src/a.ts', '/x/notes.txt', '/x/cfg/p/.git/',
    '/home/me/.git/', '/home/me/.ssh/.git/', '/home/me/.nvm/v1/.git/', '/home/me/.claude/x/.git/', '/home/.git/', '/.git/']) {
    const parts = path.split('/').filter(Boolean)
    parts.forEach((_, k) => kinds.set(`/${parts.slice(0, k + 1).join('/')}`, k < parts.length - 1 || path.endsWith('/') ? 'dir' : 'file'))
  }
  on('fs.exists', (_, e) => ({ value: kinds.has(e.path) }))
  on('fs.list', (_, e) => {
    if (kinds.get(e.path) !== 'dir') return { deny: `ENOTDIR: ${e.path}` }
    const base = e.path === '/' ? '' : e.path
    const inside = [...kinds].filter(([p]) => p !== '/' && p.slice(0, p.lastIndexOf('/')) === base)
    return { value: inside.map(([p, kind]) => ({ name: p.slice(base.length + 1), kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
}

async function briefed($: Engine, repo: string, description = 'Fix home') {
  const ran = await $.agent.spawn({
    tool_use_id: `t-${description}`,
    prompt: `GOAL: fix it\nREPO: ${repo}  \nFILES: a.ts`,
    description,
    subagentType: 'boss:builder',
    provider: { plugin: 'boss', tier: 'user' },
    parentModel: 'claude-opus',
    background: true,
    fork: false,
  })
  return ran as { agentId?: string; deny?: string }
}

const OUTSIDE = 'outside REPO and the scratchpad'

test('a builder writes in the REPO its brief names, even outside the session folder; elsewhere stays refused', async ($, on) => {
  desk(on)
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const edit = async (file_path: string) => (await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId: b })).deny
  const write = async (file_path: string) => (await $.tool.call({ tool: 'Write', file_path, content: 'x', agentId: b })).deny

  expect(await edit('/x/DC Home/backend/a.ts')).toBeUndefined()
  expect(await write('/x/DC Home/backend/a.ts')).toBeUndefined()
  expect(await write('/x/DC Supervisor/src/a.ts')).toBeUndefined()
  expect(await bash($, 'echo x > "/x/DC Home/a.txt"', b)).toBeUndefined()
  expect(await bash($, 'cd "../DC Home" && cp a b', b)).toBeUndefined()
  expect(await bash($, 'rm a.txt "/x/DC Home/a.txt" /private/tmp/claude-501/p/s1/scratchpad/x', b)).toBeUndefined()

  expect(await edit('/x/Other/a.ts')).toContain(OUTSIDE)
  expect(await write('/x/DC Homework/a.ts')).toContain(OUTSIDE)
  expect(await bash($, 'echo x > /x/Other/a.ts', b)).toContain(OUTSIDE)
  expect(await bash($, 'rm /x/Other/f', b)).toContain('delete files outside REPO and the scratchpad')
})

test('a REPO outside the session folder must be a project folder, never home, config or hidden', async ($, on) => {
  desk(on)
  const why = async (repo: string) => (await briefed($, repo, repo)).deny

  expect(await why('/')).toContain('is the filesystem root')
  expect(await why('/x/..')).toContain('is the filesystem root')
  expect(await why('/home/me')).toContain('is your home folder or above it')
  expect(await why('/home/me/')).toContain('is your home folder or above it')
  expect(await why('/home')).toContain('is your home folder or above it')
  expect(await why('/home/me/.claude/x')).toContain('is inside the Claude config folder')
  expect(await why('/home/me/.ssh')).toContain('is inside a hidden folder of your home')
  expect(await why('/home/me/.nvm/v1')).toContain('is inside a hidden folder of your home')
  expect(await why('/x/notes.txt')).toContain('is not a folder')
  expect(await why('/x/missing')).toContain('is not a folder')
  expect(await why('/x/Flat')).toContain('has no .git in it or a folder just inside it')
  expect(await why('/x/DC Home')).toBeUndefined()
  // Inside the session folder needs no check.
  expect(await why('/x/DC Supervisor/sub')).toBeUndefined()
})

test('a set Claude config folder is refused as a REPO', async ($, on) => {
  desk(on, { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/x/cfg' })
  expect((await briefed($, '/x/cfg/p')).deny).toContain('is inside the Claude config folder')
})

test('without a session folder the REPO is not checked', async ($, on) => {
  engine(on)
  expect((await briefed($, '/home')).deny).toBeUndefined()
})

test('cd, pushd and popd never leave a builder writing where the guard thinks it is not', async ($, on) => {
  desk(on)
  const b = `${(await briefed($, '/x/DC Home')).agentId}`

  for (const command of [
    'cd /etc && bash -c "echo x > passwd"',
    'cd && echo x > .zshrc',
    'cd - && echo x > f',
    'pushd /etc && echo x > passwd',
    'cd /etc && pushd "/x/DC Home" && popd && echo x > passwd',
  ]) expect(await bash($, command, b)).toContain(OUTSIDE)

  expect(await bash($, 'cd "/x/DC Home/backend" && bash -c "echo x > a.ts"', b)).toBeUndefined()
  expect(await bash($, 'pushd "../DC Home" && echo x > a.txt', b)).toBeUndefined()
})

test('a resumed builder keeps the REPO it was briefed with', async ($, on) => {
  desk(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const b = `${(await briefed($, '/x/DC Home', 'Add login')).agentId}`
  await $.turn.complete(done('STATUS: NEEDS_CONTEXT\nOPEN: which db', b))
  await resume($, 'boss:builder', 'Add login', 'The db is postgres.')
  await $.turn.start({ text: 'The db is postgres.', turnId: 'r1', agentId: b })
  expect(await bash($, 'echo x > "/x/DC Home/backend/db.ts"', b)).toBeUndefined()
  expect(await bash($, 'echo x > /x/Other/db.ts', b)).toContain(OUTSIDE)
})

test('a text ask shows its count, not its questions, and one press takes the picks', async ($, on) => {
  const toasts = engine(on)
  const filled: string[] = []
  const sent: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  const x = await spawn($, 'boss:errand', 'Look up')
  await $.turn.complete(done('ANSWER: ok', x))
  await $.turn.complete(
    done(`triage: dispatch — touches auth
1. **Where should login live?** — I'd pick \`/signin\`: matches the nav; if wrong: rename one route
2. Keep people signed in for 30 days? — I'd pick yes (least sure): common default; if wrong: one setting
3. Which email sends the reset link? — needed: only you know it
assuming: bcrypt; sessions in cookies
Reply "go" (or anything like "sounds good") to take my picks, change any one, or say "don't ask me next time" and I'll decide these myself.`),
  )

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const drawn = await card($, 'desktop')
  expect(drawn?.alt).toContain('Boss: Your turn · 3 questions. Answer in chat · waiting <1m')
  for (const shown of [lines.join('\n'), drawn?.source ?? '', drawn?.alt ?? '']) {
    for (const q of ['Where should login live?', 'Keep people signed in', 'Which email sends', "I'd pick"]) expect(shown).not.toContain(q)
  }
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['go', 'size', 'hide'])
  await ui.press({ key: 'go' })
  await ui.unmount()

  expect(filled).toEqual([])
  expect(sent).toEqual(['go'])
  expect(toasts).toEqual(['Boss needs your answer'])
  expect(await band($)).toEqual([])
})

test('a press that starts a turn returns at once, inside its 10s budget', async ($, on) => {
  engine(on)
  const sent: string[] = []
  // The turn a press starts takes minutes: its submit never settles here.
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return new Promise(() => undefined)
  })
  on('command.run', () => new Promise(() => undefined))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 92 }, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] } }))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  await $.turn.complete(done('1. Keep it? — I\'d pick yes: simple; if wrong: one line\nReply "go" to take my picks.'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const settles = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(false), 500))])
  expect(await settles(ui.press({ key: 'cheaper' }))).toBe(true)
  expect(await settles(ui.press({ key: 'compact' }))).toBe(true)
  expect(await settles(ui.press({ key: 'go' }))).toBe(true)
  await ui.unmount()
  expect(sent).toEqual(['careful with tokens', 'go'])
})

test('questions in the wording boss really uses', async ($, on) => {
  engine(on)
  await $.turn.complete(
    done(`triage: dispatch — touches auth and stored passwords (opus builder, then an inspector).

Two questions first:

1. **How should login fit with the greeter?** I'd add \`signup\` and \`login\` subcommands to \`greet.py\`. A successful \`login\` prints Hello. Why: you keep one command. If wrong: we redo it. Another way: a separate \`auth.py\`. **(least sure)**
2. **Should signup enforce password rules?** I'd require at least 8 characters, and refuse a username that is already taken. If wrong: you change one check and one test.

adding: passwords are stored as salted scrypt hashes; tests for signup.

assuming: users are saved in /tmp/boss-demo/users.json; no lockout after failed logins.

Reply "go" (or anything like "sounds good") to take my picks, change any one, or say "don't ask me next time" and I'll decide these myself.`),
  )
  // Both questions are counted; neither is drawn.
  expect((await card($))?.alt).toContain('Boss: Your turn · 2 questions')
  const lines = (await band($, 'terminal')).join('\n')
  expect(lines).toContain('Your turn')
  expect(lines).not.toContain('How should login fit with the greeter?')
  expect(lines).not.toContain('Should signup enforce password rules?')
})

test('a Codex job started through a variable shows until it is harvested', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({
    result: {
      stdout: e.tool === 'Bash' && / task /.test(e.command) ? 'Codex Task started in the background as task-abc-1. Check /codex:status task-abc-1 for progress.' : 'ok',
      stderr: '',
      interrupted: false,
    },
  }))
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command })

  await bash('C=/x/codex-companion.mjs; node $C task --model gpt-6.2-astra --cwd /s "design" --background')
  expect(await band($)).toEqual(expect.arrayContaining(['Reviewing the plan', '⠋ Codex gpt-6.2-astra']))
  await bash('node $C status task-abc-1 --cwd /s --json')
  expect(await band($)).toContain('⠋ Codex gpt-6.2-astra')
  await bash('node $C result task-abc-1 --cwd /s > out.md')
  expect(await band($)).toEqual([])
})

test('quoting the Codex line is not a Codex job, and a forgotten job leaves after 45 minutes', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', (_, e) => ({
    result: {
      stdout:
        e.tool !== 'Bash'
          ? 'ok'
          : / task /.test(e.command)
            ? 'Codex Task started in the background as task-abc-2. Check /codex:status task-abc-2 for progress.'
            : // A read of the test file prints the line inside other text.
              "292:      stdout: e.tool === 'Bash' ? 'Codex Task started in the background as task-abc-1.' : 'ok',",
      stderr: '',
      interrupted: false,
    },
  }))
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command })
  await bash('grep -n background hooks/register.test.tsx')
  expect(await band($)).toEqual([])
  await bash('node $C task --cwd /s "design" --background')
  expect(await band($)).toContain('⠋ Codex codex')
  await clock.advance(45 * 60_000)
  expect(await band($)).toEqual([])
})

test('a proven run ends green and at rest, with its count, team and time', async ($, on) => {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const b = await spawn($, 'boss:builder', 'Add login', 'opus', BRIEF)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: b })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: b })
  let svg = (await card($))?.source ?? ''
  expect(svg).toContain('class="sheen"')
  expect(svg.match(/class="pip track"/g)?.length).toBe(2)
  expect(svg).toContain('>0 of 2 proven<')
  expect(svg).not.toContain('npm test')

  await clock.advance(90_000)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'opus', 'ASK: x')
  await clock.advance(30_000)
  await $.turn.complete(done('VERDICT: PASS\nCHECKS:\n- login route: PASS — setup `a`; `b` → ok\n- signin page: PASS — setup `a`; `c` → ok', i))

  const drawn = await card($)
  svg = drawn?.source ?? ''
  expect(drawn?.alt).toContain('Boss: Done. 2:00 · 2 agents')
  expect(svg).toContain('>Done<')
  expect(svg).toContain('>Proven by your test<')
  expect(svg).toMatch(/<text class="num t1"[^>]*>2 of 2 proven</)
  expect(svg).toContain('>2 agents<')
  expect(svg).toContain('>2m<')
  // Green, on the mark, the stage word and the last step. Nothing loops.
  expect(tone(svg)).toBe('done')
  expect(coloured(svg)).toEqual(['circle.c', 'rect.c grow', 'tspan.w6 c:Done'])
  expect(svg).not.toContain('class="sheen"')
  expect(toasts).toEqual(['Boss: proven 2/2'])
  const lines = await band($)
  expect(lines).toEqual(expect.arrayContaining(['Done', 'passed']))
})

test('a failed run names the check that failed, in red', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const b = await spawn($, 'boss:builder', 'Fix', 'haiku', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: FAIL\nCHECKS:\n- login route: FAIL — setup `a`; `b` → 404\n- signin page: PASS — setup `a`; `c` → ok', i))
  const drawn = await card($)
  expect(drawn?.source).toContain('>Failed<')
  expect(drawn?.source).toContain('>“login route” did not pass<')
  expect(drawn?.source).toMatch(/<text class="num t1"[^>]*>Check 1 of 2 failed</)
  expect(tone(drawn?.source)).toBe('failed')
  expect(coloured(drawn?.source)).toEqual(['circle.c', 'rect.c grow', 'tspan.w6 c:Failed'])
  // The check that failed is hollow, the one that passed is filled: no colour on either.
  expect(drawn?.source).toMatch(/<rect class="pip open grow" style="[^"]*" x="631.5" y="65.5" width="13" height="2" rx="1"\/>/)
  expect(drawn?.source).toMatch(/<rect class="pip fill grow" style="[^"]*" x="648" y="65" width="14" height="3" rx="1.5"\/>/)
  expect(drawn?.source).not.toContain('class="sheen"')
  expect(drawn?.alt).toContain('Boss: Failed')
})

test('local and outside model runs show on the card, and only real runs count', async ($, on) => {
  expect(outsideRun('ollama run qwen3:8b < brief.md > out.txt 2>&1')).toEqual({ lane: 'local', model: 'qwen3:8b' })
  expect(outsideRun('cd /s && timeout 600 ollama run "llama3.2:3b" < b.md')).toEqual({ lane: 'local', model: 'llama3.2:3b' })
  expect(outsideRun('gemini -m gemini-pro -p "review"')).toEqual({ lane: 'outside', model: 'gemini-pro' })
  expect(outsideRun('ollama list')).toBeNull()
  expect(outsideRun('gemini --help')).toBeNull()
  expect(outsideRun('grep -n ollama README.md')).toBeNull()
  expect(outsideRun('curl -s localhost:11434/api/tags')).toBeNull()
  expect(outsideRun('python3 -I /s/boss5/ask_ollama.py /s/boss5/plan.txt')).toEqual({ lane: 'local', model: 'ollama', script: '/s/boss5/ask_ollama.py' })
  expect(outsideRun("S=/s; curl -s localhost:11434/api/tags | grep -q 'llama3.2:3b' && python3 -I $S/ask_ollama.py $S/plan.txt")).toEqual({
    lane: 'local',
    model: 'llama3.2:3b',
    script: '$S/ask_ollama.py',
  })
  expect(outsideRun(`curl -s localhost:11434/api/generate -d '{"model": "qwen3:8b", "prompt": "hi"}'`)).toEqual({ lane: 'local', model: 'qwen3:8b' })

  mock.clock(on)
  const seen: string[][] = []
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash' && e.command.includes('ollama run') && !e.command.includes('&')) seen.push(await band($))
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: e.tool === 'Bash' && e.command.endsWith('&') ? 'bk42' : undefined } }
  })
  await $.tool.call({ tool: 'Bash', command: 'ollama run qwen3:8b < brief.md' })
  expect(seen[0]).toEqual(expect.arrayContaining(['Reviewing the plan', '⠋ Local model qwen3:8b']))
  expect(await band($)).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'ollama run qwen3:8b < brief.md > out.txt 2>&1 &' })
  expect((await card($))?.alt).toContain('Local model working')
  await $.tool.call({ tool: 'Read', file_path: '/tmp/tasks/bk42.output' })
  expect(await card($)).toBeNull()
})

test('a real brief with a note on its CONTRACT header opens the proof', async ($, on) => {
  engine(on)
  await spawn($, 'boss:builder', 'Build CLI', 'haiku', `GOAL: Build a small Python CLI.
FILES: /tmp/boss-try/tempconv.py
CONTRACT (all currently fail — files don't exist):
- \`python3 tempconv.py 100C\` prints exactly \`212.0F\`, exit 0
- \`python3 tempconv.py 32F\` prints exactly \`0.0C\`, exit 0
VERIFY: the commands above.`)
  expect((await card($))?.source.match(/class="pip track"/g)?.length).toBe(2)
})

test('a local model just before the builder stays in the same run', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'ollama run llama3.2:3b < plan.txt' })
  await spawn($, 'boss:builder', 'Build CLI', 'haiku')
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Local model done')
  expect(alt).toContain('Builder working')
})

test('your limit and the context stay off the card; the terminal band keeps them', async ($, on) => {
  engine(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 122_000, window: 200_000, percent: 61 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(80 * 60_000).toISOString() }],
    },
  }))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const svg = (await card($))?.source ?? ''
  for (const part of ['limit', '42%', '61%', 'resets']) expect(svg).not.toContain(part)
  // One clock, at the right of the headline.
  expect(svg).toContain('>&lt;1m<')
  expect(await band($)).toContain('5-hour limit 42% used · context 61% used')
})

test('your day is counted across runs; the terminal band shows it, the card does not', async ($, on) => {
  engine(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  store.set('day:1999-01-01', { runs: 9, proven: 9, agentMs: 1 })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: PASS\nCHECKS:\n- login route: PASS — setup `a`; `b` → ok', i))
  const days = [...store.entries()]
  expect(days).toHaveLength(1)
  expect(days[0]?.[1]).toMatchObject({ runs: 1, proven: 1 })
  expect(await band($)).toContain('Today 1 run · 1 proven')
  expect((await card($))?.source).not.toContain('Today')
})

test('the low-context and high-limit buttons appear only when needed', async ($, on) => {
  engine(on)
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const commands: string[] = []
  on('command.run', (_, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  let usage = { startedAt: 0, context: { window: 200_000, percent: 50 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] }
  on('session.usage', () => ({ value: usage }))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: 'Save & make room' })).toBeUndefined()
  expect(await ui.find({ text: 'Go cheaper' })).toBeUndefined()
  await ui.unmount()

  usage = { startedAt: 0, context: { window: 200_000, percent: 90 }, rateLimits: [{ kind: 'five_hour', percentUsed: 88 }] }
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact' }))?.text).toBe('Save & make room')
  expect((await ui.find({ key: 'cheaper' }))?.text).toBe('Go cheaper')
  await ui.press({ key: 'cheaper' })
  await ui.press({ key: 'compact' })
  await ui.unmount()
  expect(sent).toEqual(['careful with tokens'])
  expect(commands).toEqual(['boss:handoff'])
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: 'Go cheaper' })).toBeUndefined()
  await ui.unmount()
})

test('Save & make room compacts only after the checkpoint is printed', async ($, on) => {
  const clock = mock.clock(on)
  const compacted: string[] = []
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('command.run', () => ({ text: '' }))
  on('session.compact', (_, e) => {
    compacted.push(e.instructions ?? '')
    return { skip: "test" }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 92 }, rateLimits: [] } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  await ui.unmount()

  await $.turn.complete(done('Builder is still going; here is a status line.'))
  await clock.advance(2000)
  expect(compacted).toEqual([])
  await $.turn.complete(done('Owner: boss-run\nGoal: build the CLI\nNext: inspect it'))
  await clock.advance(2000)
  expect(compacted).toHaveLength(1)
})

test('an agent-finished notice does not clear the board', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  await $.prompt.submit({ text: 'Agent "Add login" finished', wait: false, origin: { kind: 'task-notification' } })
  await spawn($, 'boss:inspector', 'Check', 'sonnet', 'ASK: x')
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Builder done')
  expect(alt).toContain('Inspector working')
  expect(alt).toContain('0 of 2 proven')
})

test('one card follows light and dark, and there is no theme to pick', async ($, on) => {
  engine(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const drawn = await card($)
  // One drawing, its colours switched inside it.
  expect(drawn?.source.match(/<svg /g)?.length).toBe(1)
  expect(drawn?.source).toContain('@media (prefers-color-scheme:light)')
  // A theme stored by an older version changes nothing.
  store.set('theme', 'native')
  expect((await card($))?.source).toBe(drawn?.source)
  for (const surface of ['desktop', 'vscode', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const buttons = await ui.findAll({ type: 'Button' })
    await ui.unmount()
    expect(buttons.map(b => b.key)).toEqual(['size', 'hide'])
    expect(buttons.map(b => b.text).join(' ')).not.toContain('◐')
  }
})

test('an unchanged card keeps its picture, so its animations are not restarted', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const first = (await card($))?.source
  // The first minute reads "<1m": escaped, or the picture breaks and VS Code shows only its alt.
  expect(first).toContain('&lt;1m')
  expect(first).not.toContain('><1m<')
  await clock.advance(3000)
  expect((await card($))?.source).toBe(first)
  await clock.advance(60_000)
  expect((await card($))?.source).not.toBe(first)
})

test('a long run ends with a toast', async ($, on) => {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'opus', agentId: e.description }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await spawn($, 'boss:builder-deep', 'a')
  await spawn($, 'boss:errand', 'b')
  await clock.advance(3 * 60_000)
  const end = (agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: agentId, agentId, reason: 'answer' })
  await end('a')
  expect(toasts).toEqual([])
  await end('b')
  expect(toasts).toEqual(['Boss finished: 2 agents, 3:00'])
})

const ASKING = `1. **Where should login live?** — I'd pick \`/signin\`: matches the nav
Reply "go" (or anything like "sounds good") to take my picks, change any one, or say "don't ask me next time" and I'll decide these myself.`
const PASSED = 'VERDICT: PASS\nCHECKS:\n- login route: PASS — setup `a`; `b` → ok\n- signin page: PASS — setup `a`; `c` → ok'
const FAILED = 'VERDICT: FAIL\nCHECKS:\n- login route: FAIL — setup `a`; `b` → 404\n- signin page: PASS — setup `a`; `c` → ok'

// The four states the card is drawn in, reached the way a run reaches them.
async function states($: Engine, on: On) {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const shots: Record<string, Record<string, { alt: string; source: string; height?: number } | null>> = { vscode: {}, desktop: {} }
  const shoot = async (name: string) => {
    for (const surface of ['vscode', 'desktop'] as const) (shots[surface] as Record<string, unknown>)[name] = await card($, surface)
  }
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await shoot('working')
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.turn.complete(done(PASSED, i))
  await shoot('done')
  await $.turn.complete(done(ASKING))
  await shoot('turn')
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  const again = await spawn($, 'boss:builder', 'Fix login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', again))
  const second = await spawn($, 'boss:inspector', 'Check the fix', 'sonnet', 'ASK: x')
  await $.turn.complete(done(FAILED, second))
  await shoot('failed')
  return shots
}

test('the card is the same height in every state, and far under the size limit', async ($, on) => {
  engine(on)
  const shots = await states($, on)
  for (const surface of ['vscode', 'desktop'] as const) {
    for (const name of ['working', 'turn', 'done', 'failed']) {
      const drawn = shots[surface]?.[name]
      expect(drawn?.height, `${surface} ${name}`).toBe(118)
      expect(drawn?.source, `${surface} ${name}`).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="680" height="118" viewBox="0 0 680 118"')
      expect((drawn?.source ?? '').length).toBeLessThan(131072)
      expect((drawn?.source ?? '').length).toBeGreaterThan(1000)
    }
  }
})

test('each stage carries its one colour, and the rest of the card does not', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const look = async () => {
    const svg = (await card($))?.source
    return [tone(svg), coloured(svg)]
  }
  const say = () => $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  // While the team works, the stage picks the colour; the mark, the stage word and the current step carry it.
  const working = (word: string, pie: boolean) => [...(pie ? ['circle.ring', 'path.c'] : ['circle.ring']), 'rect.c half', 'rect.live', 'stop.sh', `tspan.w6 c:${word}`]
  const a = await spawn($, 'boss:fable-advisor', 'Review plan', 'haiku')
  expect(await look()).toEqual(['plan', working('Reviewing the plan', false)])
  await $.turn.complete(done('ok', a))
  const r = await spawn($, 'boss:errand', 'Look up', 'haiku')
  expect(await look()).toEqual(['plan', working('Researching', false)])
  await $.turn.complete(done('ANSWER: a', r))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  expect(await look()).toEqual(['build', working('Building', true)])
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  expect(await look()).toEqual(['check', working('Testing', true)])
  // Finished but not checked: grey, on the mark and the word only.
  await $.turn.complete(done('VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no logs', i))
  expect(await look()).toEqual(['still', ['circle.c', 'circle.ring', 'tspan.w6 c:Done']])
  await say()
  const b2 = await spawn($, 'boss:builder', 'Add login 2', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b2))
  const i2 = await spawn($, 'boss:inspector', 'Check login 2', 'sonnet', 'ASK: x')
  await $.turn.complete(done(PASSED, i2))
  expect(await look()).toEqual(['done', ['circle.c', 'rect.c grow', 'tspan.w6 c:Done']])
  await $.turn.complete(done(ASKING))
  expect(await look()).toEqual(['turn', ['circle.c', 'circle.ring soft', 'rect.c grow', 'tspan.w6 c:Your turn']])
  await say()
  const b3 = await spawn($, 'boss:builder', 'Add login 3', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b3))
  const i3 = await spawn($, 'boss:inspector', 'Check login 3', 'sonnet', 'ASK: x')
  await $.turn.complete(done(FAILED, i3))
  expect(await look()).toEqual(['failed', ['circle.c', 'rect.c grow', 'tspan.w6 c:Failed']])

  // The tones: calm, close in lightness, a dark and a light value each.
  const svg = (await card($))?.source ?? ''
  expect(svg).toContain('--plan:#a895f7;--build:#6eaaf5;--check:#48c2c8;--turn:#f5a623;--done:#3ecf8e;--failed:#ff6166;--still:#a8a8a8')
  expect(svg).toContain('--plan:#6a50d3;--build:#1d68c9;--check:#0b7a85;--turn:#a86500;--done:#17813f;--failed:#d4222b;--still:#5c5c5c')
  // Only four rules draw in the colour, and no part of the drawing names a colour of its own.
  for (const rule of ['.c{fill:var(--c)}', '.ring{fill:none;stroke:var(--c);', '.live{fill:var(--c);', '.sh{stop-color:var(--c)}']) expect(svg).toContain(rule)
  expect(svg.match(/var\(--c\)/g)?.length).toBe(4)
  expect(svg.match(/var\(--(plan|build|check|turn|done|failed|still)\)/g)?.length).toBe(1)
  expect(drawing(svg)).not.toMatch(/(fill|stroke|stop-color)="#|style="[^"]*(fill|stroke|color)/)
})

test('the card moves only while the team works', async ($, on) => {
  engine(on)
  const shots = (await states($, on)).vscode ?? {}
  expect(shots.working?.source).toContain('class="sheen"')
  for (const name of ['turn', 'done', 'failed']) expect(shots[name]?.source).not.toContain('class="sheen"')
  expect(shots.working?.source).toContain('>Building<')
  expect(shots.turn?.source).toContain('>Your turn<')
  expect(shots.done?.source).toContain('>Done<')
  expect(shots.failed?.source).toContain('>Failed<')
})

test('the card draws the task, your test, the team and the four steps', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  const svg = (await card($))?.source ?? ''
  expect(svg).toContain('>Testing<')
  expect(svg).toContain('>Inspector trying your test<')
  expect(svg).toContain('>Task<')
  expect(svg).toContain('>add a login page<')
  expect(svg).toContain('>Your test<')
  expect(svg).not.toContain('>Test<')
  expect(svg).toContain('>open /signin, type the test user, land on the dashboard<')
  expect(svg).toContain('>0 of 2 proven<')
  // Who finished, who works, and one clock.
  expect(svg).toContain('>✓ Builder<')
  expect(svg).toMatch(/<tspan class="t1" font-size="7"[^>]*>●<\/tspan><tspan[^>]*>Inspector</)
  expect(svg).toContain('>&lt;1m<')
  // Plan was skipped (dimmed, never struck through, a dotted rail), Build is done, Check is now and carries the light, Done is next.
  expect(svg).toMatch(/<text class="t3 dim" x="18" y="93">Plan</)
  expect(svg).not.toContain('line-through')
  expect(svg).toMatch(/<line class="skip" x1="20" x2="174" y1="101.5" y2="101.5"\/>/)
  expect(svg).not.toMatch(/<rect class="[^"]*" [^>]*x="18" y="100"/)
  expect(svg).toMatch(/<text class="t2" x="180" y="93">Build</)
  expect(svg).toMatch(/<text class="t1 w6" x="342" y="93">Check</)
  expect(svg).toMatch(/<text class="t3" x="504" y="93">Done</)
  expect(svg).toMatch(/<clipPath id="cur"><rect x="342" y="100" width="158" height="3"/)
  expect(svg).toMatch(/<rect class="sheen"[^>]* x="270" y="100" width="72"/)
})

test('a rebuild after a failed test moves one light, on Build', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.turn.complete(done(FAILED, i))
  // The failed card marks Check in red, with Done still ahead.
  let svg = (await card($))?.source ?? ''
  expect(svg).toMatch(/<text class="t1 w6" x="342" y="93">Check</)
  expect(tone(svg)).toBe('failed')
  expect(svg).toMatch(/<rect class="c grow" style="[^"]*" x="342" y="100" width="158"/)
  expect(svg).toMatch(/<text class="t3" x="504" y="93">Done</)
  // A builder with no new contract goes back to work on it: one loop, no second current step.
  await spawn($, 'boss:builder', 'Fix login', 'sonnet')
  svg = (await card($))?.source ?? ''
  expect(tone(svg)).toBe('build')
  expect(svg.match(/class="sheen"/g)?.length).toBe(1)
  expect(svg.match(/id="cur"/g)?.length).toBe(1)
  expect(svg).toMatch(/<rect class="sheen"[^>]* x="108" y="100" width="72"/)
  expect(svg).toMatch(/<text class="t1 w6" x="180" y="93">Build</)
})

test('a long task or test is cut at a word and ends in an ellipsis, clear of the words at its right', () => {
  const TASK = 'Create greet.py with a function greet(name) that returns "Hello, <name>!", plus a small unittest file that checks two names and the empty name'
  const TEST = 'In /tmp/boss-try, run python3 -B -c "from greet import greet; print(greet(\'Ana\'))" and see Hello, Ana! printed on one line'
  const NOW = 'Asking you to run a command and waiting for the answer before the team goes on with the next step · Builder'
  const svg = cardSvg({
    kind: 'working',
    hue: 'build',
    stage: 'Building',
    doing: NOW,
    doingAt: null,
    clock: '1h 12m',
    task: TASK,
    team: [{ role: 'Plan critic', state: 'done' }, { role: 'Builder', state: 'run' }, { role: 'Inspector', state: 'run' }],
    proof: { test: TEST, word: 'Check 3 of 4 failed', isStale: false, checks: ['pass', 'pass', 'fail', 'pending'], checkAt: null },
    steps: [{ label: 'Plan', state: 'done' }, { label: 'Build', state: 'current' }, { label: 'Check', state: 'next' }, { label: 'Done', state: 'next' }],
    stepAt: null,
    stageAt: null,
    now: 0,
  })
  // No fade: nothing on the card is masked.
  expect(svg).not.toContain('mask')
  expect(svg).not.toContain('linearGradient id="z')
  const unesc = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const drawn = (pattern: RegExp) => unesc(pattern.exec(svg)?.[1] ?? '')
  const cases: [string, string, number, number][] = [
    // What is drawn, the whole sentence, and the fewest and most characters that may fit its space.
    [drawn(/<text class="b" x="104" y="51">([^<]*)</), TASK, 55, 90],
    [drawn(/<text class="b" x="104" y="71">([^<]*)</), TEST, 30, 62],
    [drawn(/<tspan class="fade"[^>]*>([^<]*)</), NOW, 15, 45],
  ]
  for (const [shown, whole, least, most] of cases) {
    expect(shown.endsWith('…'), shown).toBe(true)
    const kept = shown.slice(0, -1)
    // A cut between words: what is kept is whole words of the sentence, with no loose comma or space.
    expect(whole.startsWith(kept), shown).toBe(true)
    expect(whole[kept.length] === ' ' || /^[,.;:]? /.test(whole.slice(kept.length, kept.length + 2)), shown).toBe(true)
    expect(/[\s,.;:-]$/.test(kept), shown).toBe(false)
    expect(kept.length, shown).toBeGreaterThanOrEqual(least)
    expect(kept.length, shown).toBeLessThanOrEqual(most)
  }
  // The test row has less room than the task row: the proof words and pips sit at its right.
  expect((cases[1]?.[0] ?? '').length).toBeLessThan((cases[0]?.[0] ?? '').length)
  // A sentence that fits is drawn whole.
  const whole = cardSvg({ kind: 'working', hue: 'build', stage: 'Building', doing: 'Getting started', doingAt: null, clock: '4m', task: 'Add a login page', team: [], proof: null, steps: [], stepAt: null, stageAt: null, now: 0 })
  expect(whole).toContain('>Add a login page<')
  expect(whole).toContain('>Getting started<')
})

test('a run that was not checked does not look proven, and neither does a stale proof', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const filled = (svg: string, x: number) => new RegExp(`<rect class="(fill|c)[^"]*" [^>]*x="${x}" y="100"`).test(svg)
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/login.ts', old_string: 'a', new_string: 'b', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no access to the logs', i))
  let drawn = await card($)
  let svg = drawn?.source ?? ''
  expect(drawn?.alt).toContain('Your test: open /signin, type the test user, land on the dashboard, not checked')
  expect(svg).toContain('>Finished, not checked<')
  // Only the words: muted, with no pip beside them.
  expect(svg).toMatch(/<text class="num t3" x="662" y="71" text-anchor="end">not checked</)
  expect(svg).not.toContain('class="pip')
  // Build was done; Check is hollow, not passed; Done is plain. Nothing is green.
  expect(filled(svg, 180)).toBe(true)
  expect(filled(svg, 342)).toBe(false)
  expect(filled(svg, 504)).toBe(false)
  expect(svg).toMatch(/<rect class="open" x="342.5" y="100.5" width="157" height="2" rx="1"\/>/)
  expect(svg).toMatch(/<text class="t3" x="342" y="93">Check</)
  expect(svg).toMatch(/<text class="t3" x="504" y="93">Done</)
  expect(tone(svg)).toBe('still')
  expect(svg).not.toContain('class="sheen"')

  // A proven run, then a proven file changes: the same care.
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  const again = await spawn($, 'boss:builder', 'Add login again', 'sonnet', BRIEF)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/login.ts', old_string: 'a', new_string: 'b', agentId: again })
  await $.turn.complete(done('STATUS: DONE', again))
  const second = await spawn($, 'boss:inspector', 'Check login again', 'sonnet', 'ASK: x')
  await $.turn.complete(done(PASSED, second))
  svg = (await card($))?.source ?? ''
  expect(filled(svg, 342)).toBe(true)
  expect(filled(svg, 504)).toBe(true)
  expect(svg.match(/class="pip track"/g)?.length).toBe(2)
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/login.ts', content: 'x' })
  drawn = await card($)
  svg = drawn?.source ?? ''
  expect(svg).toMatch(/<text class="num t3" x="662" y="71" text-anchor="end">Re-check needed</)
  expect(svg).not.toContain('class="pip')
  expect(filled(svg, 180)).toBe(true)
  expect(filled(svg, 342)).toBe(false)
  expect(filled(svg, 504)).toBe(false)
  expect(svg).toMatch(/<rect class="open" x="342.5" y="100.5" width="157" height="2" rx="1"\/>/)
  expect(tone(svg)).toBe('still')
})

test('a skipped step is dimmed, never struck through', () => {
  const svg = cardSvg({
    kind: 'working',
    hue: 'build',
    stage: 'Building',
    doing: 'Getting started',
    doingAt: null,
    clock: '<1m',
    task: 'Add a login page',
    team: [{ role: 'Builder', state: 'run' }],
    proof: null,
    steps: [{ label: 'Plan', state: 'skipped' }, { label: 'Build', state: 'current' }, { label: 'Check', state: 'next' }, { label: 'Done', state: 'next' }],
    stepAt: null,
    stageAt: null,
    now: 0,
  })
  expect(svg).not.toContain('line-through')
  expect(svg).not.toContain('text-decoration')
  expect(svg).toMatch(/<text class="t3 dim" x="18" y="93">Plan</)
  // Dimmer than a step still ahead, which keeps the plain muted tone.
  expect(svg).toMatch(/<text class="t3" x="342" y="93">Check</)
  expect(svg).toContain('.dim{fill-opacity:.55}')
  // Its rail: faint dots, no bar.
  expect(svg).toMatch(/<line class="skip" x1="20" x2="174" y1="101.5" y2="101.5"\/>/)
  expect(svg).not.toMatch(/<rect class="[^"]*" [^>]*x="18" y="100"/)
})

test('more than three agents fold into a count', async ($, on) => {
  engine(on)
  for (const name of ['A', 'B', 'C']) await spawn($, 'boss:errand', `Look up ${name}`)
  await $.turn.complete(done('ANSWER: a', 'Look up A-id'))
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const svg = (await card($))?.source ?? ''
  expect(svg).toContain('>4 agents · 3 working<')
  expect(svg).not.toContain('✓')
})

test('the light keeps its place across redraws, and what is new arrives once', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const sheen = (svg?: string) => /<rect class="sheen" style="animation-delay:(-?\d+)ms"/.exec(svg ?? '')?.[1]
  const fade = (svg?: string) => /<tspan class="fade" style="animation-delay:(-?\d+)ms"/.exec(svg ?? '')?.[1]
  const grow = (svg?: string) => /<rect class="fill grow" style="animation-delay:(-?\d+)ms"/.exec(svg ?? '')?.[1]
  await clock.set(940_000)
  const c = await spawn($, 'boss:fable-advisor', 'Review plan', 'haiku')
  await $.turn.complete(done('ok', c))
  // 1,000,000 ms on the wall clock is 1600 ms into the 2400 ms loop.
  await clock.set(1_000_000)
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  let svg = (await card($))?.source
  expect(sheen(svg)).toBe('-1600')
  // The step that just finished (Plan) fills from now.
  expect(grow(svg)).toBe('0')

  // A new phrase fades in from the moment it changed; the loop is 3000 ms further on.
  await clock.advance(3000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: b })
  svg = (await card($))?.source
  expect(svg).toContain('>Reading the code<')
  expect(sheen(svg)).toBe('-2200')
  expect(fade(svg)).toBe('0')
  expect(grow(svg)).toBe('-3000')

  // A minute on, the clock redraws the card: nothing old plays again.
  await clock.advance(61_000)
  svg = (await card($))?.source
  expect(svg).toContain('>2m<')
  expect(sheen(svg)).toBe('-800')
  expect(fade(svg)).toBe('-61000')
  expect(grow(svg)).toBe('-64000')
})

test('what a verdict brings arrives once, timed from the verdict', () => {
  const at = 5_000_000
  const proven = (now: number): CardModel => ({
    kind: 'done',
    hue: null,
    stage: 'Done',
    doing: 'Proven by your test',
    doingAt: at,
    clock: '6m',
    task: 'Add a greet(name) function',
    team: [{ role: 'Builder', state: 'done' }, { role: 'Inspector', state: 'done' }],
    proof: { test: 'open the app, type a name, see the greeting', word: '4 of 4 proven', isStale: false, checks: ['pass', 'pass', 'pass', 'pass'], checkAt: at },
    steps: [{ label: 'Plan', state: 'done' }, { label: 'Build', state: 'done' }, { label: 'Check', state: 'done' }, { label: 'Done', state: 'current' }],
    stepAt: at,
    stageAt: at,
    now,
  })
  const delays = (svg: string) => ({
    phrase: /<tspan class="fade" style="animation-delay:(-?\d+)ms"/.exec(svg)?.[1],
    pip: /<rect class="pip fill grow" style="animation-delay:(-?\d+)ms"/.exec(svg)?.[1],
    step: /<rect class="fill grow" style="animation-delay:(-?\d+)ms"/.exec(svg)?.[1],
    last: /<rect class="c grow" style="animation-delay:(-?\d+)ms"/.exec(svg)?.[1],
    tick: /<path class="knock draw" style="animation-delay:(-?\d+)ms"/.exec(svg)?.[1],
  })
  // As it happens: the last step fills green 80 ms in, the tick draws 380 ms in.
  expect(delays(cardSvg(proven(at)))).toEqual({ phrase: '0', pip: '0', step: '0', last: '80', tick: '380' })
  // Redrawn five seconds later, each is five seconds further along: already at rest.
  expect(delays(cardSvg(proven(at + 5000)))).toEqual({ phrase: '-5000', pip: '-5000', step: '-5000', last: '-4920', tick: '-4620' })
  // Long after, the delays stop growing.
  expect(delays(cardSvg(proven(at + 3_600_000)))).toEqual({ phrase: '-100000', pip: '-100000', step: '-100000', last: '-99920', tick: '-99620' })
  // Only the newest pip and the newest steps arrive; a finished card has no loop.
  const svg = cardSvg(proven(at))
  expect(svg.match(/class="pip fill grow"/g)?.length).toBe(1)
  expect(svg.match(/class="fill grow"/g)?.length).toBe(1)
  expect(svg.match(/class="c grow"/g)?.length).toBe(1)
  expect(svg).not.toContain('class="sheen"')
})

test('reduced motion stops everything and shows the current step half filled', async ($, on) => {
  engine(on)
  await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  const svg = (await card($))?.source ?? ''
  expect(svg).toContain('@media (prefers-reduced-motion:reduce){.sheen,.fade,.grow,.draw{animation:none}.sheen{display:none}.half{display:inline}}')
  // Every animated element carries one of those four classes.
  const animated = [...svg.matchAll(/@keyframes (\w+)/g)].map(m => m[1])
  expect(animated).toEqual(['sweep', 'fade', 'grow', 'draw'])
  expect(svg.match(/animation:/g)?.length).toBe(5)
  expect(svg).toMatch(/<rect class="c half" x="180" y="100" width="79" height="3"/)
})

test('every word on the card is escaped', async ($, on) => {
  engine(on)
  await spawn($, 'boss:builder', 'Add greet', 'sonnet', `GOAL: Add a greet(name) function that returns "Hello, <name>!" & logs it
CONTRACT:
FIRST HUMAN TEST: type <b>Ann</b> & see "Hello, Ann!"
- greeting shows the name`)
  const drawn = await card($)
  const svg = drawn?.source ?? ''
  expect(svg).toContain('>Add a greet(name) function that returns &quot;Hello, &lt;name&gt;!&quot; &amp; logs it<')
  expect(svg).toContain('>type &lt;b&gt;Ann&lt;/b&gt; &amp; see &quot;Hello, Ann!&quot;<')
  expect(svg).not.toContain('<name>')
  expect(svg).not.toContain('<b>')
  expect(drawn?.alt).toContain('Task: Add a greet(name) function that returns "Hello, <name>!" & logs it')
})

test('the buttons sit in a row under the card, right-aligned: what the moment needs, then Show less, then Hide', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  let usage = { startedAt: 0, context: { window: 200_000, percent: 50 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] }
  on('session.usage', () => ({ value: usage }))
  type Node = { type: string; props: Record<string, unknown>; children?: Node[] }
  const drawn = async (surface: 'vscode' | 'desktop') => {
    const ui = await $.ui.mount({ ...BAND, surface })
    const tree = (await ui.drawn()) as unknown as Node
    await ui.unmount()
    return tree
  }
  const labels = (row?: Node) => (row?.children ?? []).filter(b => b.type === 'Button').map(b => [b.type, b.props.key, b.props.label])
  await spawn($, 'boss:builder', 'Build', 'haiku')
  for (const surface of ['vscode', 'desktop'] as const) {
    const tree = await drawn(surface)
    expect(tree.props.flexDirection).toBe('column')
    expect(tree.children?.map(child => child.type)).toEqual(['Svg', 'Box'])
    const row = tree.children?.[1]
    expect(row?.props.justifyContent).toBe('flex-end')
    expect(row?.props.flexDirection).toBeUndefined()
    expect(labels(row)).toEqual([['Button', 'size', 'Show less'], ['Button', 'hide', 'Hide']])
  }

  // Everything at once: a plain-text ask, a full context and a high limit.
  usage = { startedAt: 0, context: { window: 200_000, percent: 92 }, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] }
  await $.turn.complete(done(ASKING))
  const row = (await drawn('vscode')).children?.[1]
  expect(labels(row)).toEqual([
    ['Button', 'go', 'Go with my picks'],
    ['Button', 'compact', 'Save & make room'],
    ['Button', 'cheaper', 'Go cheaper'],
    ['Button', 'size', 'Show less'],
    ['Button', 'hide', 'Hide'],
  ])
  expect(row?.children?.find(b => b.type === 'Button')?.props.variant).toBe('primary')
  expect(JSON.stringify(row)).not.toContain('◐')
})

// Everything the card shows, in each form: the picture, its alt text and the terminal card.
async function everywhere($: Engine) {
  const drawn = await card($)
  return [drawn?.source ?? '', drawn?.alt ?? '', (await band($)).join('\n')]
}

test('the card names the task from the brief', async ($, on) => {
  engine(on)
  await spawn($, 'boss:builder', 'Add login', 'sonnet', `GOAL: Add login with email and password\n${BRIEF.split('\n').slice(1).join('\n')}`)
  const [svg, alt, text] = await everywhere($)
  expect(svg).toContain('Add login with email and password')
  expect(alt).toContain('Add login with email and password')
  expect(text).toContain('Add login with email and password')
})

test('right now says what the team does, never which files', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/secret-plan.ts', agentId: b })
  let [svg, alt, text] = await everywhere($)
  expect(alt).toContain('Reading the code')
  expect(text).toContain('Reading the code')
  await clock.advance(2000)
  for (const file of ['login-form.tsx', 'auth-store.ts', 'session-db.ts', 'auth-store.ts'])
    await $.tool.call({ tool: 'Edit', file_path: `/repo/src/${file}`, old_string: 'a', new_string: 'b', agentId: b })
  ;[svg, alt, text] = await everywhere($)
  for (const shown of [svg, alt, text]) {
    expect(shown).toContain('Editing 3 files')
    for (const name of ['secret-plan', 'login-form', 'auth-store', 'session-db', '/repo']) expect(shown).not.toContain(name)
  }
})

test('test runs show their counts', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', (_, e) => ({
    result: { stdout: e.tool === 'Bash' && e.command.startsWith('npm') ? 'Tests:       5 passed, 2 failed, 7 total' : '==== 3 passed, 1 failed in 0.2s ====', stderr: '', interrupted: false },
  }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await bash($, 'npm test', b)
  expect((await everywhere($)).join('\n')).toContain('Running tests · 5 pass, 2 fail')
  await clock.advance(2000)
  await bash($, 'cd /repo && pytest -q', b)
  expect((await everywhere($))[1]).toContain('Running tests · 3 pass, 1 fail')
})

test('an inspector at work is trying your test', async ($, on) => {
  engine(on)
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  await spawn($, 'boss:inspector', 'Check login', 'haiku', 'ASK: x')
  for (const shown of await everywhere($)) expect(shown).toContain('Inspector trying your test')
})

test('the steps follow the run from plan to done', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const c = await spawn($, 'boss:fable-advisor', 'Review plan', 'haiku')
  await $.turn.complete(done('ok', c))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  expect((await card($))?.alt).toContain('Steps: Plan done, Build now, Check next, Done next')
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'haiku', 'ASK: x')
  expect((await card($))?.alt).toContain('Steps: Plan done, Build done, Check now, Done next')
  await $.turn.complete(done(PASSED, i))
  expect((await card($))?.alt).toContain('Steps: Plan done, Build done, Check done, Done now')
})

test('a run with no plan starts at Build, with Plan skipped', async ($, on) => {
  engine(on)
  await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build now, Check next, Done next')
})

test('a new phrase holds the last one for 1.5 seconds', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: b })
  expect((await card($))?.alt).toContain('Now: Reading the code')
  await clock.advance(500)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', agentId: b })
  expect((await card($))?.alt).toContain('Now: Reading the code')
  await clock.advance(1100)
  expect((await card($))?.alt).toContain('Now: Editing 1 file')
})

test('a command with a secret never reaches the card', async ($, on) => {
  engine(on)
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await bash($, 'curl -H "Authorization: Bearer abc123" https://x.test/api', b)
  const shown = (await everywhere($)).join('\n')
  expect(shown).toContain('Running a command')
  for (const part of ['abc123', 'Bearer', 'Authorization', 'x.test', 'curl']) expect(shown).not.toContain(part)
})

test('an answer sent before the asking turn ends does not wait again', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.turn.start({ text: 'add login', turnId: 'm1' })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(done(ASKING))
  expect(await band($)).toEqual([])

  await $.prompt.submit({ text: 'and logout', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'and logout', turnId: 'm2' })
  await $.turn.complete(done(ASKING))
  expect((await card($))?.alt).toContain('Boss: Your turn')
})

test('a wait with no parsed questions says so in words', async ($, on) => {
  engine(on)
  await $.turn.complete(done('Reply "go" to take my picks.'))
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Boss: Your turn. Answer in chat · waiting <1m')
  expect(alt).not.toContain('question')
})

test('a picker ask waits while it runs, and draws no question text', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  let during: { alt: string; source: string } | null = null
  let lines: string[] = []
  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      during = await card($)
      lines = await band($)
    }
    return { result: {} }
  })
  await spawn($, 'boss:builder', 'Build', 'haiku')
  const option = { label: 'Yes', description: 'keep it' }
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      { question: 'Where should login live?', header: 'Route', options: [option, { label: 'No', description: 'x' }], multiSelect: false },
      { question: 'Keep people signed in?', header: 'Session', options: [option, { label: 'No', description: 'x' }], multiSelect: false },
    ],
  })
  const seen = during as { alt: string; source: string } | null
  expect(seen?.alt).toContain('Boss: Your turn · 2 questions')
  expect(seen?.source).toContain('>Your turn<')
  expect(seen?.source).toContain('>2 questions are waiting for you in the picker<')
  for (const shown of [seen?.source ?? '', seen?.alt ?? '', lines.join('\n')]) {
    expect(shown).not.toContain('Where should login live')
    expect(shown).not.toContain('Keep people signed in')
  }
  const after = await card($)
  expect(after?.alt).toContain('Boss: Building')
  expect(after?.source).not.toContain('2 questions')
})

test('a text ask keeps one Go button and no Change buttons', async ($, on) => {
  engine(on)
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await spawn($, 'boss:builder', 'Build', 'haiku')
  await $.turn.complete(done(ASKING))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.key)).toEqual(['go', 'size', 'hide'])
  expect(buttons[0]?.text).toBe('Go with my picks')
  expect(await ui.find({ text: /Change|Answer$/ })).toBeUndefined()
  await ui.press({ key: 'go' })
  await ui.unmount()
  expect(sent).toEqual(['go'])
  expect((await card($))?.alt).not.toContain('Your turn')
})

test('a text ask says to answer in chat', async ($, on) => {
  engine(on)
  await $.turn.complete(done(ASKING))
  const drawn = await card($)
  expect(drawn?.alt).toContain('Boss: Your turn · 1 question.')
  expect(drawn?.alt).toContain('Answer in chat · waiting <1m')
  expect(drawn?.source).toContain('>1 question is waiting for you in the chat<')
  expect(drawn?.source).not.toContain('Where should login live')
})

// The native picker's dialog, as AskUserQuestion opens it with `n` questions.
const PICKER = (n: number) =>
  ({
    plugin: 'boss',
    component: 'AskUserQuestion',
    props: {
      tool: 'AskUserQuestion',
      questions: Array.from({ length: n }, (_, k) => ({ question: `Where should step ${k} live?`, header: 'Route', options: [{ label: 'Yes', description: 'y' }, { label: 'No', description: 'n' }], multiSelect: false })),
    },
  }) as const

test('the picker gets one quiet line about the run, only while boss works', async ($, on) => {
  engine(on)
  const drawn = async (n: number, surface: 'terminal' | 'desktop' = 'terminal') => {
    const ui = await $.ui.mount({ ...PICKER(n), surface })
    const all = await ui.findAll({})
    await ui.unmount()
    return all
  }
  // No boss run: the engine's picker alone, untouched.
  expect((await drawn(2)).map(el => el.type)).toEqual(['engine'])

  await spawn($, 'boss:builder', 'Build', 'haiku')
  for (const surface of ['terminal', 'desktop'] as const) {
    const all = await drawn(2, surface)
    expect(all.filter(el => el.type === 'engine')).toHaveLength(1)
    const texts = all.filter(el => el.type === 'Text')
    expect(texts.map(t => t.text)).toEqual(['2 questions from your team · Building'])
    expect((texts[0]?.props as { dimColor?: boolean }).dimColor).toBe(true)
    expect(all.map(el => el.text).join('\n')).not.toContain('Where should step')
  }
  expect((await drawn(1)).filter(el => el.type === 'Text').map(t => t.text)).toEqual(['1 question from your team · Building'])
})

test('a boss agent waiting on your approval makes it your turn, in plain words', async ($, on) => {
  const toasts = engine(on)
  on('classic.PermissionRequest', () => ({}))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await card($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build/secret-dir' }, agent_id: b } as never)
  {
    const [svg, alt, text] = await everywhere($)
    expect(alt).toContain('Boss: Your turn')
    expect(alt).toContain('Now: Asking you to run a command · Builder')
    expect(svg).toContain('>Your turn<')
    expect(svg).toContain('Asking you to run a command · Builder')
    expect(text).toContain('Asking you to run a command · Builder')
    // Amber, on the mark, the stage word and the current step; the builder's dot stays plain, and nothing moves.
    expect(tone(svg)).toBe('turn')
    expect(coloured(svg)).toEqual(['circle.c', 'circle.ring soft', 'rect.c grow', 'tspan.w6 c:Your turn'])
    expect(svg).toMatch(/<tspan class="t1" font-size="7"[^>]*>●<\/tspan><tspan[^>]*>Builder</)
    expect(svg).not.toContain('class="sheen"')
    for (const shown of [svg, alt, text]) for (const part of ['rm -rf', 'secret-dir']) expect(shown).not.toContain(part)
  }
  expect(toasts).toEqual([])

  // Its next tool call means the ask was answered.
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: b })
  const [svg, alt] = await everywhere($)
  expect(alt).toContain('Boss: Building')
  expect(alt).not.toContain('Asking you')
  expect(tone(svg)).toBe('build')
  expect(svg).toContain('class="sheen"')
})

test('an edit to a proven file asks for a re-check, until a new run', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.toast', () => ({ value: undefined }))
  const edit = (file_path: string, agentId?: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId })
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await edit('/repo/src/login.ts', b)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'haiku', 'ASK: x')
  await $.turn.complete(done(PASSED, i))

  // A file the builder never touched leaves the proof standing.
  await edit('/repo/src/other.ts')
  let [svg, alt, text] = await everywhere($)
  expect(svg).toMatch(/<text class="num t1"[^>]*>2 of 2 proven</)
  expect(tone(svg)).toBe('done')
  expect(alt).not.toContain('re-check')

  await $.tool.call({ tool: 'Write', file_path: '/repo/src/login.ts', content: 'x' })
  ;[svg, alt, text] = await everywhere($)
  expect(svg).not.toContain('2 of 2 proven')
  // Muted: never red, and no longer green.
  expect(svg).toMatch(/<text class="num t3"[^>]*>Re-check needed</)
  expect(tone(svg)).toBe('still')
  expect(svg).toContain('>Finished: a proven file changed since<')
  expect(alt).toContain('Your test: open /signin, type the test user, land on the dashboard, re-check needed')
  // The rest of the card agrees: no "test passed" beside a stale proof.
  expect(alt).toContain('Now: Finished: a proven file changed since')
  expect(alt).toContain('proven before the change')
  expect(alt).not.toContain('Finished: your test passed')
  expect(text).toContain('Re-check needed')
  for (const shown of [svg, alt, text]) expect(shown).not.toContain('login.ts')

  // A new run starts clean.
  await clock.advance(3 * 60_000)
  await spawn($, 'boss:builder', 'Next thing', 'haiku')
  ;[svg, alt, text] = await everywhere($)
  expect(svg).not.toContain('Re-check needed')
  expect(alt).not.toContain('re-check')
  expect(text).not.toContain('Re-check needed')
})

test('a Claude agent quiet for 3 minutes gets one toast; a tool call starts the count again', async ($, on) => {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const b = await spawn($, 'boss:builder', 'Build', 'haiku')
  await card($)
  await clock.advance(2 * 60_000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: b })
  await clock.advance(2 * 60_000)
  expect(toasts).toEqual([])
  await clock.advance(60_000)
  expect(toasts).toEqual(['Builder has been quiet for 3 min'])
  await clock.advance(5 * 60_000)
  expect(toasts).toEqual(['Builder has been quiet for 3 min'])
})

test('a quiet Codex job gets no toast', async ($, on) => {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('tool.call', (_, e) => ({
    result: { stdout: e.tool === 'Bash' && / task /.test(e.command) ? 'Codex Task started in the background as task-q-1.' : 'ok', stderr: '', interrupted: false },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: 'node $C task --cwd /s "design" --background' })
  expect((await card($))?.alt).toContain('Codex working')
  await clock.advance(4 * 60_000)
  expect(toasts).toEqual([])
})

test('a save outside any agent to a proven file asks for a re-check, and the file is watched', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.FileChanged', () => ({}))
  on('classic.SessionStart', () => ({ watchPaths: ['/repo/.envrc'] }))
  // The file on disk: the person's save moves its modified time on.
  const saved = new Map([['/repo/src/login.ts', 1000]])
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: 1, mtimeMs: saved.get(e.path) ?? 0, isLink: false } }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/login.ts', old_string: 'a', new_string: 'b', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'haiku', 'ASK: x')
  await $.turn.complete(done(PASSED, i))
  expect((await card($))?.alt).toContain('proven')

  // A later session start watches the proven file beside what others asked for.
  const started = await $.classic.SessionStart({ source: 'compact' } as never)
  expect(started.watchPaths).toEqual(['/repo/.envrc', '/repo/src/login.ts'])

  // Claude Code's file-change event for another file changes nothing; for the proven one, re-check.
  await $.classic.FileChanged({ file_path: '/repo/src/other.ts', event: 'change' })
  expect((await card($))?.alt).not.toContain('re-check needed')
  await $.classic.FileChanged({ file_path: '/repo/src/login.ts', event: 'change' })
  expect((await card($))?.alt).toContain('Your test: open /signin, type the test user, land on the dashboard, re-check needed')
})

test('a proven file saved with no change event still asks for a re-check at the next draw', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku', agentId: `${e.description}-id` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  const saved = new Map([['/repo/src/login.ts', 1000]])
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: 1, mtimeMs: saved.get(e.path) ?? 0, isLink: false } }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/login.ts', old_string: 'a', new_string: 'b', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'haiku', 'ASK: x')
  await $.turn.complete(done(PASSED, i))
  expect((await card($))?.alt).not.toContain('re-check needed')
  saved.set('/repo/src/login.ts', 2000)
  expect((await card($))?.alt).toContain('re-check needed')
})

test('Hide lasts until the person shows it again, and the status line says how', async ($, on) => {
  engine(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const status: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  const registered: { name: string; immediate?: boolean }[] = []
  on('command.register', (_, e) => {
    registered.push(e as never)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  const cmd = async (args: string) =>
    (await $.command.run({ command: 'boss-live', args, origin: { kind: 'composer' }, presentation: 'inline' } as never)).text

  await spawn($, 'boss:builder', 'Fix the parser')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'hide' })
  await ui.unmount()
  expect(await card($)).toBeNull()
  expect(store.get('isHidden')).toBe(true)
  expect(status.at(-1)).toBe('boss-live hidden · type /boss-live')

  // A new run, a question and a new session all keep it hidden.
  await $.turn.complete(done('finished', 'Fix the parser-id'))
  await spawn($, 'boss:builder', 'Next task')
  expect(await card($)).toBeNull()
  await $.session.start({ cwd: '/repo', surface: 'vscode' } as never)
  expect(await card($)).toBeNull()
  expect(status.at(-1)).toBe('boss-live hidden · type /boss-live')

  expect(await cmd('')).toContain('showing')
  expect(store.get('isHidden')).toBe(false)
  expect(status.at(-1)).toBeUndefined()
  expect(await card($)).not.toBeNull()

  expect(await cmd('')).toContain('Type /boss-live to show it again')
  expect(await card($)).toBeNull()
  // Typed mid-turn it runs at once, not after the turn.
  expect(registered.find(r => r.name === 'boss-live')?.immediate).toBe(true)
})

test('Show less shrinks the card to one line on every surface; Show more brings it back', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const press = async (key: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await ui.press({ key })
    await ui.unmount()
  }
  // The one line, its dot's colour and its buttons.
  const line = async (surface: 'vscode' | 'desktop' | 'terminal') => {
    const ui = await $.ui.mount({ ...BAND, surface })
    const texts = await ui.findAll({ type: 'Text' })
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => (b.props as { label?: string }).label)
    const all = await ui.findAll({})
    await ui.unmount()
    const dot = texts.find(t => t.text === '●')?.props
    return { text: texts[0]?.text, dot: dot?.color, isDotDim: dot?.dimColor === true, buttons, last: all.at(-1)?.type }
  }

  await spawn($, 'boss:builder', 'Fix the parser', 'sonnet', BRIEF)
  expect(await card($)).not.toBeNull()
  await press('size')
  expect(store.get('isCompact')).toBe(true)
  expect(await card($)).toBeNull()
  for (const surface of ['vscode', 'desktop', 'terminal'] as const) {
    const shown = await line(surface)
    expect(shown.text).toBe('● Building · Getting started · 0 of 2 proven · <1m')
    // Building: a blue dot, one tone that reads on dark and on light.
    expect(shown.dot).toBe('#3f8ae6')
    expect(shown.isDotDim).toBe(false)
    expect(shown.buttons).toEqual(['Show more', 'Hide'])
    // The buttons close the line.
    expect(shown.last).toBe('Button')
  }

  // Your turn: an amber dot, and the one press that answers.
  await $.turn.complete(done(ASKING))
  const asked = await line('vscode')
  expect(asked.text).toBe('● Your turn · 1 question in the chat · 0 of 2 proven · <1m')
  expect(asked.dot).toBe('#bf7a00')
  expect(asked.buttons).toEqual(['Go with my picks', 'Show more', 'Hide'])
  await press('go')

  await press('size')
  expect(store.get('isCompact')).toBe(false)
  expect(await card($)).not.toBeNull()
})

test('the compact dot takes the stage colour: green proven, red failed, grey when not checked', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-4-5', agentId: `${e.description}-id` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('store.get', (_, e) => ({ value: e.key === 'isCompact' ? true : undefined }))
  const dot = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const texts = await ui.findAll({ type: 'Text' })
    await ui.unmount()
    const props = texts.find(t => t.text === '●')?.props
    return [texts[0]?.text, props?.color, props?.dimColor === true]
  }
  const a = await spawn($, 'boss:fable-advisor', 'Review plan', 'haiku')
  expect(await dot()).toEqual(['● Reviewing the plan · Getting started · <1m', '#8f77f0', false])
  await $.turn.complete(done('ok', a))
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  // Past the 1.5 seconds a phrase is held.
  await clock.advance(2000)
  expect(await dot()).toEqual(['● Testing · Inspector trying your test · 0 of 2 proven · <1m', '#1f9aa6', false])
  await $.turn.complete(done(PASSED, i))
  expect(await dot()).toEqual(['● Done · Proven by your test · 2 of 2 proven · <1m', '#23a05a', false])
  const again = await spawn($, 'boss:builder', 'Fix login', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', again))
  const second = await spawn($, 'boss:inspector', 'Check the fix', 'sonnet', 'ASK: x')
  await $.turn.complete(done(FAILED, second))
  expect(await dot()).toEqual(['● Failed · “login route” did not pass · 1 of 2 proven · <1m', '#e5484d', false])
  const third = await spawn($, 'boss:builder', 'Fix login again', 'sonnet', BRIEF)
  await $.turn.complete(done('STATUS: DONE', third))
  const last = await spawn($, 'boss:inspector', 'Check it again', 'sonnet', 'ASK: x')
  await $.turn.complete(done('VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no logs', last))
  // Grey: no colour of its own, dimmed.
  expect(await dot()).toEqual(['● Done · Finished, not checked · 0 of 1 proven · <1m', undefined, true])
})

test('context and the usage limit show quietly left of the buttons, under the card', async ($, on) => {
  const T = Date.UTC(2026, 10, 27, 12)
  mock.clock(on, { now: T })
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-4-5', agentId: `${e.description}-id` }))
  const resetsAt = new Date(T + (3 * 60 + 41) * 60_000 + 20_000).toISOString()
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 22.4 }, rateLimits: [{ kind: 'five_hour', percentUsed: 18, resetsAt }] } }))
  await spawn($, 'boss:builder', 'Fix the parser')
  for (const surface of ['vscode', 'desktop'] as const) {
    expect(await band($, surface)).toContain('Context 22% · 5h limit 18% · resets in 3h 41m')
  }
})

// --- Real boss flows: the main turn's start and end driven as the engine raises them. ---

// A boss session whose main loop the test drives: no test leans on BAND's isWorking.
function session(on: On, tool?: (e: { tool: string; command?: string; file_path?: string }) => unknown) {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-4-5', agentId: `${e.description}-id` }))
  on('tool.call', (_, e) => (tool === undefined ? { result: {} } : tool(e as never)) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { toasts, clock }
}
const begin = ($: Engine, turnId: string, text = '/boss add login') => $.turn.start({ text, turnId })
const finish = ($: Engine, turnId: string, answer: string, reason: 'answer' | 'aborted' = 'answer') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId, reason })
const aborted = (agentId: string) => ({ answer: '', durationMs: 1, isAborted: true, turnId: `x-${agentId}`, agentId, reason: 'aborted' }) as const
// Typed at the prompt: with the running turn's id when typed over it.
const typed = ($: Engine, text: string, turnId?: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...(turnId === undefined ? {} : { turnId }) })
const notified = ($: Engine, text: string, turnId?: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' }, ...(turnId === undefined ? {} : { turnId }) })
const UNCHECKED = 'VERDICT: NOT CHECKED\nCHECKS:\n- login route: NOT CHECKED — no logs'
const LOGIN_FAILED = 'VERDICT: FAIL\nCHECKS:\n- login route: FAIL — setup `a`; `b` → 404'
async function inspected($: Engine, description: string, answer: string) {
  const id = await spawn($, 'boss:inspector', description, 'sonnet', 'ASK: x')
  await $.turn.complete(done(answer, id))
  return id
}
async function built($: Engine, description = 'Add login', brief = BRIEF) {
  const id = await spawn($, 'boss:builder', description, 'sonnet', brief)
  await $.turn.complete(done('STATUS: DONE', id))
  return id
}
const edit = ($: Engine, file_path: string, agentId?: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId })

test('A1: a run boss checks itself settles as not checked when its turn ends; a later inspector joins it', async ($, on) => {
  const { toasts, clock } = session(on)
  await begin($, 'm1')
  await built($)
  expect((await card($))?.alt).toContain('Boss: Reviewing the work')
  await finish($, 'm1', 'Login added. I ran the test myself: it passes.')
  let drawn = await card($)
  expect(drawn?.alt).toContain('Your test: open /signin, type the test user, land on the dashboard, not checked')
  expect(drawn?.alt).not.toContain('Reviewing the work')
  expect(drawn?.source).toContain('>Finished, not checked<')
  expect(toasts).toEqual([])

  await clock.advance(3 * 60_000)
  await notified($, 'Agent "Add login" finished')
  await begin($, 'm2', '<task-notification>Agent "Add login" finished</task-notification>')
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  drawn = await card($)
  expect(drawn?.alt).toContain('Builder done')
  expect(drawn?.alt).toContain('Inspector working')
  expect(drawn?.alt).toContain('Task: add a login page')
  await $.turn.complete(done(PASSED, i))
  expect((await card($))?.alt).toContain('2 agents')
  expect(toasts).toEqual(['Boss: proven 2/2'])
})

test('A1: a main turn that ends on a question mid-run is your turn, never "not checked"', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await finish($, 'm1', ASKING)
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Boss: Your turn')
  expect(alt).not.toContain('not checked')
})

test('A2: an aborted builder is stopped and stuck, never proving or ticked, until a bounce clears it', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(aborted(b))
  let lines = await band($)
  expect(lines).toContain('builder stuck')
  expect(lines).not.toContain('built, being proven')
  expect(lines).toContain('✗ Builder sonnet')
  let drawn = await card($)
  expect(drawn?.alt).toContain('Builder stopped')
  expect(drawn?.alt).not.toContain('proving')
  expect(drawn?.source).toContain('>✗ Builder stopped<')
  expect(drawn?.source).not.toContain('✓')
  expect(tone(drawn?.source)).toBe('failed')
  expect(toasts).toEqual(['Boss: stopped'])

  await resume($, 'boss:builder', 'Add login', 'Try again.')
  await $.turn.start({ text: 'Try again.', turnId: 'r1', agentId: b })
  drawn = await card($)
  expect(drawn?.alt).toContain('Builder working')
  expect(drawn?.alt).not.toContain('stopped')
  await $.turn.complete(done('STATUS: DONE', b))
  lines = await band($)
  expect(lines).toContain('built, being proven')
  expect(lines).toContain('✓ Builder sonnet')
})

test('A3: a message typed while the turn runs keeps the proven board and the task', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'Check login', PASSED)
  await typed($, 'also add logout', 'm1')
  const alt = (await card($))?.alt ?? 'NO CARD'
  expect(alt).toContain('Boss: Done')
  expect(alt).toContain('2 of 2 proven')
  expect(alt).toContain('Task: add a login page')
})

test('O4: a message typed while a turn runs clears an old wait', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await finish($, 'm1', ASKING)
  await notified($, 'Agent finished')
  await begin($, 'm2', '<task-notification>Agent finished</task-notification>')
  expect((await card($))?.alt).toContain('Boss: Your turn')
  await typed($, 'use postgres', 'm2')
  expect((await card($))?.alt).not.toContain('Your turn')
})

test('O4: a notification turn keeps the wait', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await finish($, 'm1', ASKING)
  await notified($, 'Agent "Check" finished')
  await begin($, 'm2', '<task-notification>Agent "Check" finished</task-notification>')
  expect((await card($))?.alt).toContain('Boss: Your turn')
})

test('O4: a message typed over a turn that then asks waits; the queued turn that carries it ends the wait', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  await built($)
  await typed($, 'use postgres', 'm1')
  await finish($, 'm1', ASKING)
  // The ask stands; its toast would only chase a message already sent.
  expect((await card($))?.alt).toContain('Boss: Your turn')
  expect(toasts).not.toContain('Boss needs your answer')
  await begin($, 'm2', 'use postgres')
  expect((await card($))?.alt).not.toContain('Your turn')
})

test('O4: a typed text ends one wait only; a later notification turn that contains it keeps the wait', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await typed($, 'go', 'm1')
  await finish($, 'm1', 'Working on it.')
  await begin($, 'm2', 'go')
  await finish($, 'm2', ASKING)
  expect((await card($))?.alt).toContain('Boss: Your turn')
  await notified($, 'Agent "go" finished')
  await begin($, 'm3', '<task-notification>Agent "go" finished</task-notification>')
  expect((await card($))?.alt).toContain('Boss: Your turn')
})

test('O10: Go keeps the proof, the task and the team', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await finish($, 'm1', ASKING)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'go' })
  await ui.unmount()
  // The prompt Go submits, as the engine raises it through this plugin's own hooks.
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'plugin', name: 'boss', asUser: true } })
  const alt = (await card($))?.alt ?? 'NO CARD'
  expect(alt).not.toContain('Your turn')
  expect(alt).toContain('Task: add a login page')
  expect(alt).toContain('Builder done')
  expect(alt).toContain('0 of 2 proven')
})

test('B1: an inspector woken for its second phase counts once', async ($, on) => {
  const { clock } = session(on)
  await begin($, 'm1')
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await clock.advance(2 * 60_000)
  await $.turn.complete(done('STATUS: DONE', b))
  const i = await inspected($, 'Check login', 'FIRST HUMAN TEST: open /signin and log in')
  await resume($, 'boss:inspector', 'Check login', 'CONTRACT: ...')
  await $.turn.start({ text: 'phase 2', turnId: 'p2', agentId: i })
  await $.turn.complete(done(PASSED, i))
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('2 agents')
  expect(alt).not.toContain('3 agents')
})

test('B2: a failed check, a bounce and a rebuild are being proven again, and a new pass ends green', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  const b = await built($)
  await inspected($, 'Check login', FAILED)
  await resume($, 'boss:builder', 'Add login', 'login route 404: fix it')
  await $.turn.start({ text: 'login route 404: fix it', turnId: 'r1', agentId: b })
  await $.turn.complete(done('STATUS: DONE', b))
  const lines = await band($)
  expect(lines).toContain('built, being proven')
  expect((await card($))?.alt).not.toContain('Boss: Failed')
  await inspected($, 'Check again', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
  expect(toasts).toEqual(['Boss: failed — login route', 'Boss: proven 2/2'])
})

test('B4: after a pass, a builder with CONTRACT: none reopens the proof, and the card names its goal', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'Check login', PASSED)
  await spawn($, 'boss:builder', 'Add logout', 'sonnet', 'GOAL: add a logout button\nFILES: src/logout.ts\nCONTRACT: none')
  const lines = await band($)
  expect(lines).not.toContain('passed')
  expect(lines).toContain('not proven yet')
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Task: add a logout button')
  expect(alt).toContain('0 of 2 proven')
})

test('B3: a builder woken minutes after the pass carries on the same run, its task kept', async ($, on) => {
  const { clock } = session(on)
  await begin($, 'm1')
  const b = await built($)
  await inspected($, 'Check login', PASSED)
  await finish($, 'm1', 'Done: login works.')
  await clock.advance(3 * 60_000)
  await begin($, 'm2', '<task-notification>x</task-notification>')
  // The woken run's start can come before the bounce settles.
  await $.turn.start({ text: 'one more fix', turnId: 'r1', agentId: b })
  const alt = (await card($))?.alt ?? ''
  expect(alt).toContain('Task: add a login page')
  expect(alt).toContain('Inspector done')
  expect(alt).toContain('Builder working')
})

test('B5: a harvested Codex job is not finished again by its 45-minute limit', async ($, on) => {
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('tool.call', (_, e) => ({
    result: { stdout: e.tool === 'Bash' && / task /.test(e.command) ? 'Codex Task started in the background as task-h-1.' : 'ok', stderr: '', interrupted: false },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: 'node $C task --cwd /s "review" --background' })
  await clock.advance(5 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'node $C result task-h-1 --cwd /s' })
  expect(toasts).toEqual(['Boss finished: 1 agent, 5:00'])
  await clock.advance(45 * 60_000)
  expect(toasts).toEqual(['Boss finished: 1 agent, 5:00'])
  expect(await card($)).toBeNull()
})

test('C1: the picker in a session that never ran boss draws no boss card', async ($, on) => {
  mock.clock(on)
  let seen: { alt: string } | null = null
  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') seen = await card($)
    return { result: {} }
  })
  const option = { label: 'Yes', description: 'x' }
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which?', header: 'H', options: [option, { label: 'No', description: 'y' }], multiSelect: false }] })
  expect(seen).toBeNull()
})

test('C2: a reply that only quotes the Reply "go" rule in code is not your turn', async ($, on) => {
  session(on)
  await begin($, 'm1', 'how does boss ask?')
  await finish($, 'm1', 'Boss ends each ask with the `Reply "go"` line, after numbered questions.')
  expect(await card($)).toBeNull()
})

test('C3: the reply check stays out of a session that never ran boss', async ($, on) => {
  session(on)
  await begin($, 'm1', 'explain the flags')
  const ran = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'The two flags conflict (noted below), so I kept the default.' })
  expect(ran.block).toBeUndefined()
})

// A boss session with a home folder, so memory files are known.
const MEM = '/home/me/.claude/projects/-repo/memory'
function boss(on: On, tool?: Parameters<typeof session>[1]) {
  const run = session(on, tool)
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('fs.exists', () => ({ value: false }))
  on('classic.UserPromptSubmit', () => ({}))
  return run
}

test('C4: a notification delivered mid-turn keeps what the turn already did', async ($, on) => {
  boss(on)
  await $.tool.call({ tool: 'Skill', skill: 'boss:boss' })
  await begin($, 'm1', '/boss keep reports short from now on')
  await $.tool.call({ tool: 'Write', file_path: `${MEM}/short-reports.md`, content: 'when reporting: keep it short' })
  await notified($, 'Agent "x" finished', 'm1')
  const stop = async () => (await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done. (learned: keep reports short)' })).block
  expect(await stop()).toBeUndefined()
  // A continuation starts with no text: still the same turn's work.
  await begin($, 'm2', '')
  expect(await stop()).toBeUndefined()
})

test('C5: the memory budget guard stays out of a session that never ran boss', async ($, on) => {
  boss(on)
  const big = `---\nname: t\n---\n${'line\n'.repeat(40)}`
  expect((await $.tool.call({ tool: 'Write', file_path: `${MEM}/notes.md`, content: big })).deny).toBeUndefined()
})

// Codex as boss launches it, by its full path.
const COMPANION = 'node /x/codex-companion.mjs'
test('D1: a Codex task sent to the background is one job', async ($, on) => {
  const { toasts, clock } = session(on, e => ({
    result: { stdout: e.tool === 'Bash' && / task /.test(e.command ?? '') ? 'Codex Task started in the background as task-abc-1.' : 'ok', stderr: '', interrupted: false },
  }))
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} task --cwd /s "review" --background`, tool_use_id: 'tu1' } as never)
  const alt = (await card($))?.alt ?? ''
  expect(alt.match(/Codex (working|done)/g)?.length).toBe(1)
  await clock.advance(5 * 60_000)
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} result task-abc-1 --cwd /s` })
  expect(toasts).toEqual(['Boss finished: 1 agent, 5:00'])
})

test('D2: adversarial-review is a Codex job, and it does not end the oldest one; result <id> still does', async ($, on) => {
  let during = ''
  session(on, async e => {
    if (e.tool === 'Bash' && e.command?.includes('adversarial-review') === true) during = (await card($))?.alt ?? ''
    return { result: { stdout: e.tool === 'Bash' && / task /.test(e.command ?? '') ? 'Codex Task started in the background as task-old-1.' : 'ok', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'node $C task --cwd /s "design" --background' })
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} adversarial-review --base main --cwd /s` })
  expect(during.match(/Codex working/g)?.length).toBe(2)
  expect((await card($))?.alt).toContain('Codex working')
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} result task-old-1 --cwd /s` })
  expect(await card($)).toBeNull()
})

test('D2: a Codex task Bash runs in the background stays until its output is read', async ($, on) => {
  session(on, e => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: e.tool === 'Bash' && e.command?.includes(' task ') === true ? 'bk7' : undefined },
  }))
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} task --cwd /s "review"`, run_in_background: true, tool_use_id: 'tu9' } as never)
  expect((await card($))?.alt).toContain('Codex working')
  await $.tool.call({ tool: 'Read', file_path: '/tmp/tasks/bk7.output' })
  expect(await card($)).toBeNull()
})

test('D3: a read-only Codex review draws on Check, a Codex build on Build', async ($, on) => {
  session(on, e => ({
    result: { stdout: e.tool === 'Bash' && / task /.test(e.command ?? '') ? `Codex Task started in the background as ${e.command?.includes('--write') === true ? 'task-w' : 'task-r'}.` : 'ok', stderr: '', interrupted: false },
  }))
  await $.tool.call({ tool: 'Bash', command: 'node $C task --cwd /s "review the diff" --background' })
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build skipped, Check now, Done next')
  await $.tool.call({ tool: 'Bash', command: 'node $C result task-r --cwd /s' })
  await $.tool.call({ tool: 'Bash', command: 'node $C task --write --cwd /s "build it" --background' })
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build now, Check next, Done next')
})

test('F1: an agent busy in one long tool call is not quiet', async ($, on) => {
  let release = () => undefined as void
  const { toasts, clock } = session(on, e =>
    e.tool === 'Bash' && e.command === 'npm test' ? new Promise(resolve => (release = () => resolve({ result: { stdout: '', stderr: '', interrupted: false } }))) : { result: {} },
  )
  const b = await spawn($, 'boss:builder', 'Build', 'haiku')
  await card($)
  const running = $.tool.call({ tool: 'Bash', command: 'npm test', agentId: b })
  await clock.advance(4 * 60_000)
  expect(toasts).toEqual([])
  release()
  await running
})

test('F3: a hidden card fires no quiet toast and runs no ticker', async ($, on) => {
  const { toasts, clock } = session(on)
  const b = await spawn($, 'boss:builder', 'Build', 'haiku')
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await ui.press({ key: 'hide' })
  await ui.unmount()
  await card($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: b })
  await clock.advance(5 * 60_000)
  expect(toasts).toEqual([])
})

test('F4: a failed or unchecked verdict reads the same in the picture, its alt and the terminal', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'Check login', FAILED)
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build done, Check failed, Done next')
  expect(await band($)).toContain(' › ✗ Check')
  await typed($, 'next')
  await built($, 'Add login 2')
  await inspected($, 'Check login 2', UNCHECKED)
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build done, Check open, Done next')
  await typed($, 'next')
  const b = await spawn($, 'boss:builder', 'Add login 3', 'sonnet', BRIEF)
  await edit($, '/repo/src/login.ts', b)
  await $.turn.complete(done('STATUS: DONE', b))
  await inspected($, 'Check login 3', PASSED)
  await edit($, '/repo/src/login.ts')
  expect((await card($))?.alt).toContain('Steps: Plan skipped, Build done, Check open, Done next')
  // A stale pass is no longer green in the terminal either.
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const head = await ui.find({ text: ' BOSS ' })
  await ui.unmount()
  expect((head?.props as { backgroundColor?: string }).backgroundColor).not.toBe('success')
})

test('F5: an edit that failed is not counted, and neither is a memory write that failed', async ($, on) => {
  boss(on, e => (e.file_path?.includes('broken') === true ? { isError: true, result: 'EACCES' } : { result: {} }))
  const b = await spawn($, 'boss:builder', 'Add login', 'haiku', BRIEF)
  await edit($, '/repo/src/broken.ts', b)
  expect((await card($))?.alt).not.toContain('Editing 1 file')
  await $.tool.call({ tool: 'Skill', skill: 'boss:boss' })
  await begin($, 'm1', 'keep it short from now on')
  await $.tool.call({ tool: 'Write', file_path: `${MEM}/broken.md`, content: 'when x: y' })
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done. (learned: keep it short)' })).block).toBe('Write the lesson and read it back before saying it is saved.')
})

// Proof lifecycle: which verdict stands when inspectors disagree.
test('v6: A PASS then B NOT CHECKED reads not checked', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', PASSED)
  await inspected($, 'B', UNCHECKED)
  expect((await card($))?.alt).toContain('not checked')
  expect(toasts.at(-1)).toBe('Boss: not checked')
})

test('v6: A PASS then B FAIL is red', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', PASSED)
  await inspected($, 'B', LOGIN_FAILED)
  expect(tone((await card($))?.source)).toBe('failed')
})

test('v6: A FAIL then B PASS with no edit stays red', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await inspected($, 'B', PASSED)
  expect(tone((await card($))?.source)).toBe('failed')
  expect(toasts).toEqual(['Boss: failed — login route'])
})

test('v6: A FAIL, a counted edit, then B PASS is green', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await edit($, '/repo/src/login.ts')
  await inspected($, 'B', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
})

test('v6: a subtask not checked, then the final inspector passing with no edit, is green and proven', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'Subtask', UNCHECKED)
  await inspected($, 'Final', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
  expect(toasts.at(-1)).toBe('Boss: proven 2/2')
})

test('pin 2: NOT CHECKED from another inspector keeps the first rows; from the same one takes its new rows', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', PASSED)
  await inspected($, 'B', UNCHECKED)
  expect((await card($))?.alt).toContain('1 of 2 proven')
  await typed($, 'next')
  await begin($, 'm2')
  await built($, 'Add login 2')
  const a = await inspected($, 'A2', PASSED)
  await $.turn.start({ text: 'again', turnId: 'a2', agentId: a })
  await $.turn.complete(done(UNCHECKED, a))
  expect((await card($))?.alt).toContain('0 of 1 proven')
})

test('pin 4: the day counts a run once when its verdict changes', async ($, on) => {
  session(on)
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await edit($, '/repo/src/login.ts')
  await inspected($, 'B', PASSED)
  expect([...store.values()][0]).toMatchObject({ runs: 1, proven: 1 })
})

// Counted edits: only a builder's or boss's own change to the project lets a pass replace a failure.
test('edits: after a FAIL, boss writing in the scratchpad does not let another inspector pass it', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await $.tool.call({ tool: 'Write', file_path: '/private/tmp/claude-501/p/s1/scratchpad/run.md', content: 'x' })
  await inspected($, 'B', PASSED)
  expect(tone((await card($))?.source)).toBe('failed')
})

test('edits: a lesson write neither stales a pass nor lets a pass replace a failure', async ($, on) => {
  boss(on)
  await $.tool.call({ tool: 'Skill', skill: 'boss:boss' })
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', PASSED)
  await $.tool.call({ tool: 'Write', file_path: `${MEM}/lesson.md`, content: 'when x: y' })
  expect(tone((await card($))?.source)).toBe('done')
  await typed($, 'next')
  await begin($, 'm2')
  await built($, 'Add login 2')
  await inspected($, 'B', FAILED)
  await $.tool.call({ tool: 'Write', file_path: `${MEM}/lesson2.md`, content: 'when x: y' })
  await inspected($, 'C', PASSED)
  expect(tone((await card($))?.source)).toBe('failed')
})

test('edits: after a FAIL, an inspector writing in the scratchpad cannot pass its own rerun', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  const i = await spawn($, 'boss:inspector', 'B', 'sonnet', 'ASK: x')
  await $.tool.call({ tool: 'Write', file_path: '/private/tmp/claude-501/p/s1/scratchpad/helper.py', content: 'x', agentId: i })
  await $.turn.complete(done(PASSED, i))
  expect(tone((await card($))?.source)).toBe('failed')
})

test('edits: after a FAIL, boss editing a repo file lets a fresh inspector pass it', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await edit($, '/repo/src/login.ts')
  await inspected($, 'B', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
})

test('edits: after a FAIL, a takeover builder with no contract lets a fresh inspector pass it', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', FAILED)
  await built($, 'Take over', 'GOAL: fix the login route')
  await inspected($, 'B', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
})

test('edits: after a PASS, a builder still at work editing a repo file asks for a re-check', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  const y = await spawn($, 'boss:builder', 'Add logout', 'sonnet', 'GOAL: add logout')
  await inspected($, 'A', PASSED)
  await edit($, '/repo/src/logout.ts', y)
  expect(await band($)).toContain('Re-check needed')
})

test('edits: after a PASS, boss editing a file the pass did not prove stays green', async ($, on) => {
  session(on)
  await begin($, 'm1')
  await built($)
  await inspected($, 'A', PASSED)
  await edit($, '/repo/src/other.ts')
  expect(tone((await card($))?.source)).toBe('done')
})

test('reload: a background outside run gets its 10 minutes again', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', (_, e) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: e.tool === 'Bash' ? 'bk1' : undefined } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.tool.call({ tool: 'Bash', command: 'ollama run qwen3:8b < brief.md > out.txt 2>&1 &' })
  await $.session.start({ cwd: '/repo', surface: 'vscode' } as never)
  expect((await card($))?.alt).toContain('Local model working')
  await clock.advance(10 * 60_000)
  expect(await card($)).toBeNull()
})

// The flows boss really runs, end to end.
test('flow 1: build, inspect, pass, a typed note, a bounce, a failure, a rebuild, a pass', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  const b = await built($)
  await inspected($, 'Check login', PASSED)
  expect(tone((await card($))?.source)).toBe('done')
  await typed($, 'also keep the old route', 'm1')
  expect(tone((await card($))?.source)).toBe('done')
  await resume($, 'boss:builder', 'Add login', 'Keep the old route too.')
  await $.turn.start({ text: 'Keep the old route too.', turnId: 'r1', agentId: b })
  expect(await band($)).toContain('not proven yet')
  await $.turn.complete(done('STATUS: DONE', b))
  expect(await band($)).toContain('built, being proven')
  await inspected($, 'Check again', FAILED)
  expect(tone((await card($))?.source)).toBe('failed')
  await resume($, 'boss:builder', 'Add login', 'login route 404: fix it')
  await $.turn.start({ text: 'fix it', turnId: 'r2', agentId: b })
  await edit($, '/repo/src/login.ts', b)
  await $.turn.complete(done('STATUS: DONE', b))
  await inspected($, 'Check the fix', PASSED)
  await finish($, 'm1', 'Done: login works, old route kept.')
  const drawn = await card($)
  expect(tone(drawn?.source)).toBe('done')
  expect(drawn?.alt).toContain('4 agents')
  expect(drawn?.alt).toContain('Task: add a login page')
  expect(toasts).toEqual(['Boss: proven 2/2', 'Boss: failed — login route', 'Boss: proven 2/2'])
})

test('flow 2: boss checks the work itself, then Esc', async ($, on) => {
  const { toasts, clock } = session(on)
  await begin($, 'm1')
  await built($)
  const i = await spawn($, 'boss:inspector', 'Check login', 'sonnet', 'ASK: x')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete(aborted(i))
  await finish($, 'm1', '', 'aborted')
  await clock.advance(10 * 60_000)
  const drawn = await card($)
  expect(drawn?.alt).not.toContain('Reviewing the work')
  expect(drawn?.alt).toContain('not checked')
  expect(drawn?.alt).toContain('Inspector stopped')
  expect(toasts).toEqual(['Boss: stopped'])
})

test('flow 3: an aborted builder, then a retry by a new builder', async ($, on) => {
  session(on)
  await begin($, 'm1')
  const b = await spawn($, 'boss:builder', 'Add login', 'sonnet', BRIEF)
  await $.turn.complete(aborted(b))
  expect(await band($)).toContain('builder stuck')
  await built($, 'Retry login')
  expect(await band($)).toContain('built, being proven')
  await inspected($, 'Check login', PASSED)
  await finish($, 'm1', 'Done.')
  const drawn = await card($)
  expect(tone(drawn?.source)).toBe('done')
  expect(drawn?.alt).toContain('Builder stopped. Builder done. Inspector done')
})

test('flow 4: a Codex job in the background, its harvest, then its 45-minute limit', async ($, on) => {
  const { toasts, clock } = session(on, e => ({
    result: { stdout: e.tool === 'Bash' && / task /.test(e.command ?? '') ? 'Codex Task started in the background as task-f-4.' : 'ok', stderr: '', interrupted: false },
  }))
  await begin($, 'm1', '/boss second opinion on the diff')
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} task --cwd /s "review" --background`, tool_use_id: 'tu4' } as never)
  expect(((await card($))?.alt ?? '').match(/Codex (working|done)/g)?.length).toBe(1)
  await finish($, 'm1', 'Codex is reviewing; I will read it when it is done.')
  expect((await card($))?.alt).toContain('Codex working')
  await clock.advance(5 * 60_000)
  await begin($, 'm2', '<task-notification>Codex finished</task-notification>')
  await $.tool.call({ tool: 'Bash', command: `${COMPANION} result task-f-4 --cwd /s` })
  expect(await card($)).toBeNull()
  await clock.advance(45 * 60_000)
  expect(toasts).toEqual(['Boss finished: 1 agent, 5:00'])
})

test('flow 5: a message delivered into the turn, which then asks, is your turn', async ($, on) => {
  const { toasts } = session(on)
  await begin($, 'm1')
  await built($)
  await typed($, 'what about logout?', 'm1')
  await finish($, 'm1', ASKING)
  expect((await card($))?.alt).toContain('Boss: Your turn')
  expect(toasts).not.toContain('Boss needs your answer')
})

test('flow 6: parallel units, A passes, B fails, boss fixes it, a fresh inspector passes', async ($, on) => {
  session(on)
  const UNIT_B = 'GOAL: add logout\nFILES: src/logout.ts\nCONTRACT:\n- logout route returns 200'
  await begin($, 'm1')
  const x = await spawn($, 'boss:builder', 'Unit A', 'sonnet', BRIEF)
  const y = await spawn($, 'boss:builder', 'Unit B', 'sonnet', UNIT_B)
  await $.turn.complete(done('STATUS: DONE', x))
  await $.turn.complete(done('STATUS: DONE', y))
  await inspected($, 'Check A', PASSED)
  await inspected($, 'Check B', 'VERDICT: FAIL\nCHECKS:\n- logout route returns 200: FAIL — setup `a`; `b` → 404')
  let drawn = await card($)
  expect(tone(drawn?.source)).toBe('failed')
  expect(drawn?.alt).toContain('2 of 3 proven')
  await edit($, '/repo/src/logout.ts')
  await inspected($, 'Check again', 'VERDICT: PASS\nCHECKS:\n- login route: PASS — ok\n- signin page: PASS — ok\n- logout route returns 200: PASS — ok')
  drawn = await card($)
  expect(tone(drawn?.source)).toBe('done')
  expect(drawn?.alt).toContain('3 of 3 proven')
})

// Subtask 2: the Bash guard reads the session's scratchpad, variables, loops and every REPO line.
const S2 = SCRATCH
const LITERAL = 'use a literal path'
const loopDeny = (name: string) =>
  `boss-live: this loop writes to a path built from \`$${name}\` that cannot be checked; use a \`for ${name} in <files>\` loop with literal words or a relative glob`

test('E1: every lane writes only in this session\'s scratchpad; with none known, any claude scratch folder', async ($, on) => {
  desk(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const write = async (file_path: string) => (await $.tool.call({ tool: 'Write', file_path, content: 'x', agentId: i })).deny

  expect(await write(`${S2}/notes.md`)).toBeUndefined()
  expect(await write('/private/tmp/claude-501/other/notes.md')).toContain('write files outside the scratchpad')
  expect(await bash($, 'echo x > /private/tmp/claude-501/other/r.txt', i)).toContain('outside the scratchpad')
  expect(await bash($, `echo x > ${S2}/r.txt`, i)).toBeUndefined()
})

test('E1: with no scratchpad known, a read-only lane may write in any claude-N scratch folder', async ($, on) => {
  engine(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  expect(await bash($, 'echo x > /private/tmp/claude-777/s/r.txt', i)).toBeUndefined()
  expect(await bash($, 'echo x > /private/tmp/other/r.txt', i)).toContain('outside the scratchpad')
})

test('E2: a read-only lane edits, installs, applies and clones only inside its scratchpad', async ($, on) => {
  desk(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const run = (command: string) => bash($, command, i)

  expect(await run(`sed -i '' s/a/b/ ${S2}/x/f.ts`)).toBeUndefined()
  expect(await run(`perl -pi -e 's/a/b/' ${S2}/x/f.ts`)).toBeUndefined()
  expect(await run(`sed -i '' s/a/b/ ${S2}/x/f.ts /repo/f.ts`)).toContain('sed -i')
  expect(await run(`cd ${S2}/x && npm ci`)).toBeUndefined()
  expect(await run(`npm --prefix ${S2}/x ci`)).toBeUndefined()
  expect(await run(`npm --prefix /repo install left-pad`)).toContain('install')
  expect(await run(`npm ci --prefix ${S2}/x`)).toBeUndefined()
  expect(await run('npm ci')).toContain('install')
  expect(await run(`cd ${S2}/x && npm install -g left-pad`)).toContain('install')
  expect(await run(`cd ${S2}/x && pip install left-pad`)).toContain('install')
  expect(await run(`git -C ${S2}/x apply p.diff`)).toBeUndefined()
  expect(await run(`cd ${S2}/x && git -C /repo apply p.diff`)).toContain('git apply')
  expect(await run(`cd ${S2} && git clone https://x.test/r.git r2`)).toBeUndefined()
  expect(await run(`cd ${S2} && git clone https://x.test/r.git /repo/r2`)).toContain('git clone')
  expect(await run('git apply p.diff')).toContain('git apply')
})

test('E2: a read-only lane may not point git at another folder; git stash list and show still read', async ($, on) => {
  desk(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const run = (command: string) => bash($, command, i)

  expect(await run(`cd ${S2}/x && git --git-dir=/repo/.git --work-tree=. apply p.diff`)).toContain('may not')
  expect(await run(`cd ${S2}/x && git --work-tree /repo status`)).toContain('may not')
  expect(await run(`cd ${S2}/x && git init --separate-git-dir /repo/.git`)).toContain('may not')
  expect(await run(`cd ${S2}/x && GIT_DIR=/repo/.git git apply p.diff`)).toContain('may not')
  expect(await run('git stash list')).toBeUndefined()
  expect(await run('git stash show -p')).toBeUndefined()
  expect(await run('git stash')).toContain('git stash')
  expect(await run('git stash pop')).toContain('git stash')
  expect(await bash($, 'git stash list', b)).toBeUndefined()
  expect(await bash($, 'git stash push', b)).toContain('git stash')
})

test('E3: a path built from a variable is checked as its value; ~ is never the scratchpad', async ($, on) => {
  desk(on)
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const ro = (command: string) => bash($, command, i)
  const build = (command: string) => bash($, command, b)

  expect(await build('S=/etc; touch $S/x')).toContain(OUTSIDE)
  expect(await build('echo x > $HOME/.zshrc')).toContain(OUTSIDE)
  expect(await ro('echo hi > $HOME/.zshrc')).toContain('outside the scratchpad')
  expect(await ro('rm -rf $HOME/y')).toContain('outside the scratchpad')
  expect(await ro(`cd ${S2}/x && rm -rf $HOME/y`)).toContain('outside the scratchpad')
  expect(await ro(`cd ${S2}/x && echo hi > $HOME/.zshrc`)).toContain('outside the scratchpad')
  expect(await ro(`cd ${S2}/x && rm -rf ~/y`)).toContain('outside the scratchpad')
  expect(await ro(`cd ${S2}/x && echo hi > ~/.zshrc`)).toContain('outside the scratchpad')
  expect(await ro('echo hi > ~/.zshrc')).toContain('outside the scratchpad')
  expect(await ro('cd $HOME && rm -rf x')).toContain('outside the scratchpad')
  expect(await ro('cd ${HOME} && rm -rf x')).toContain('outside the scratchpad')

  expect(await ro(`S=${S2}/a; mkdir -p "$S"`)).toBeUndefined()
  expect(await ro(`S=${S2}/a; cd "$S" && npm ci`)).toBeUndefined()
  expect(await ro(`cd ${S2}/x && mkdir -p $PWD/out && echo x > "$(pwd)/out/a" && touch \${PWD}/b`)).toBeUndefined()
  expect(await build('mkdir -p $PWD/out')).toBeUndefined()
  expect(await build('out=dist/app.js; echo x > $out')).toBeUndefined()
})

test('E3: two different assignments to one name forget it, inside a loop or not', async ($, on) => {
  desk(on)
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const build = (command: string) => bash($, command, b)

  expect(await build('if true; then S=/etc; else S=/x/DC\\ Home/a; fi; touch $S/x')).toContain(LITERAL)
  expect(await build('for f in a b; do if c; then S=/etc; else S=out; fi; touch $S/$f; done')).toContain(LITERAL)
  expect(await build('for f in a.ts b.ts; do out="$UNKNOWN/$f"; echo x > "$out"; done')).toContain(LITERAL)
  expect(await build('for f in a.ts b.ts; do out="dist/$f"; echo x > "$out"; done')).toBeUndefined()
  expect(await build('for f in a.ts /etc/passwd; do out="$f"; echo x > "$out"; done')).toContain(OUTSIDE)
})

test('N5: a loop writes only to paths it can check, and the refusal says what to do instead', async ($, on) => {
  desk(on)
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')
  const build = (command: string) => bash($, command, b)

  expect(await build("git ls-files | while read f; do sed -i '' 's/a/b/' \"$f\"; done")).toBe(loopDeny('f'))
  expect(await build('ls | while read f; do rm "$f"; done')).toBe(loopDeny('f'))
  expect(await build('for f in $(ls); do mv "$f" /etc/x; done')).toBe(loopDeny('f'))
  expect(await build('for g in $X; do touch "$g"; done')).toBe(loopDeny('g'))
  expect(await bash($, 'ls | while read f; do rm "$f"; done', i)).toBe(loopDeny('f'))
  expect(await build('git ls-files | while read f; do grep x "$f"; done')).toBeUndefined()
  expect(await build('while read -r l; do echo "$l"; done < file')).toBeUndefined()
  expect(await build('for f in src/*.ts; do mv "$f" "$f.bak"; done')).toBeUndefined()
  expect(await build('for f in src/a.ts src/b.ts; do sed -i \'\' \'s/a/b/\' "$f"; done')).toBeUndefined()
  expect(await build('for f in ../*.ts; do mv "$f" "$f.bak"; done')).toBe(loopDeny('f'))
})

test('E3: an unknown variable in a write target or a cd asks for a literal path', async ($, on) => {
  desk(on)
  const b = `${(await briefed($, '/x/DC Home')).agentId}`
  const i = await spawn($, 'inspector', 'Test the fix', 'haiku')

  for (const command of ['mkdir -p $UNKNOWN/x', 'cd $X && echo x > f', 'echo x > "$(mktemp -d)/f"', 'touch `pwd`/x']) {
    expect(await bash($, command, b)).toContain(LITERAL)
    expect(await bash($, command, i)).toContain(LITERAL)
  }
  expect(await bash($, 'echo $UNKNOWN > out.txt', b)).toBeUndefined()
})

// A disk with the given folders, each a git project.
function projects(on: On, folders: string[]) {
  engine(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/x/session' }))
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: SCRATCH } }))
  on('fs.list', (_, e) => (folders.includes(e.path) ? { value: [{ name: '.git', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] } : { deny: `ENOENT: ${e.path}` }))
  on('fs.exists', () => ({ value: false }))
}

test('E4: REPO lines in the shapes briefs use, and a second REPO line adds a root', async ($, on) => {
  projects(on, ['/x/Acme - Web', '/x/App (v2)', '/x/api', '/a/b', '/x/web'])
  const brief = async (repo: string, description: string) => {
    const ran = (await $.agent.spawn({
      tool_use_id: `t-${description}`, prompt: `GOAL: fix it\n${repo}\nFILES: a.ts`, description, subagentType: 'boss:builder',
      provider: { plugin: 'boss', tier: 'user' }, parentModel: 'claude-opus', background: true, fork: false,
    })) as { agentId?: string; deny?: string }
    return ran
  }
  const writes = async (agentId: string | undefined, file_path: string) => (await $.tool.call({ tool: 'Write', file_path, content: 'x', agentId })).deny

  const acme = await brief('REPO: /x/Acme - Web', 'acme')
  expect(acme.deny).toBeUndefined()
  expect(await writes(acme.agentId, '/x/Acme - Web/a.ts')).toBeUndefined()
  const app = await brief('REPO: /x/App (v2)', 'app')
  expect(await writes(app.agentId, '/x/App (v2)/a.ts')).toBeUndefined()
  const api = await brief('REPO: /x/api (the API repo)', 'api')
  expect(api.deny).toBeUndefined()
  expect(await writes(api.agentId, '/x/api/a.ts')).toBeUndefined()
  for (const [line, name] of [['REPO: /x/api — the API', 'dash'], ['REPO: /x/api - the API', 'hyphen'], ['REPO: /x/api # main', 'hash']] as const) {
    expect(await writes((await brief(line, name)).agentId, '/x/api/a.ts')).toBeUndefined()
  }
  const bold = await brief('**REPO:** `/a/b`', 'bold')
  expect(bold.deny).toBeUndefined()
  expect(await writes(bold.agentId, '/a/b/a.ts')).toBeUndefined()
  const two = await brief('REPO: /x/api\nREPO: /x/web', 'two')
  expect(await writes(two.agentId, '/x/web/a.ts')).toBeUndefined()
  expect(await writes(two.agentId, '/x/api/a.ts')).toBeUndefined()
  expect(await writes(two.agentId, '/x/other/a.ts')).toContain(OUTSIDE)
  expect((await brief('REPO: /x/api\nREPO: /home/me', 'home')).deny).toContain('REPO /home/me is your home folder')
})

test('C6: a model run is a job only when it runs; reading, testing or searching for one is not', () => {
  for (const command of ['pytest test_ollama.py', 'cat ollama_client.ts', 'grep -E "foo|gemini bar" x', 'rg ":11434/api/generate" docs',
    'git add scripts/ask_ollama.py', 'which gemini', 'sed -n 1,5p ask_ollama.py', 'head -5 run_ollama.sh'])
    expect(outsideRun(command)).toBeNull()
  expect(outsideRun('python3 ask_ollama.py')).toEqual({ lane: 'local', model: 'ollama', script: 'ask_ollama.py' })
  expect(outsideRun('timeout 60 python3 ask_ollama.py brief.txt')).toEqual({ lane: 'local', model: 'ollama', script: 'ask_ollama.py' })
  expect(outsideRun('nohup bash /s/run_ollama.sh &')).toEqual({ lane: 'local', model: 'ollama', script: '/s/run_ollama.sh' })
  expect(outsideRun('cd /s && exec node ./ask-ollama.mjs b.md')).toEqual({ lane: 'local', model: 'ollama', script: './ask-ollama.mjs' })
})
