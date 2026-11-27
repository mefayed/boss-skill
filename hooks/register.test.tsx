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
