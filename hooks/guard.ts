// Best-effort Bash reading for the boss-live guard. Unclear parses lean to allow, except a
// write or delete target it cannot read (a $ or backtick left after the names it knows): refused.
// shortcut: no $(...), backtick or alias expansion; upgrade if builders route around it.

const DEVICES = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']
const WRAPPERS = ['sudo', 'env', 'command', 'nohup', 'exec', 'nice', 'xargs', 'timeout', 'time']
const NOISE = ['{', '}', '(', ')', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']
const NODE_INSTALLERS = ['npm', 'pnpm', 'yarn', 'bun']
const GIT_DENY = ['push', 'commit', 'stash', 'restore', 'checkout', 'switch']
const GIT_WRITES = ['add', 'rm', 'mv', 'apply', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'init', 'clone']
// git clone options whose value is the next word.
const CLONE_VALUES = ['-o', '--origin', '-b', '--branch', '--reference', '--reference-if-able', '--depth', '--shallow-since', '--shallow-exclude', '-j', '--jobs', '--filter', '--bundle-uri', '--server-option', '--revision']
const INSTALLERS = ['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'brew', 'apt', 'apt-get', 'cargo', 'gem', 'go']
const INSTALLS = ['install', 'i', 'add', 'ci', 'uninstall', 'remove', 'update', 'upgrade', 'get']

export type Segment = { words: string[]; outs: string[] }
// Where a builder may write: the folder it runs in, its brief's REPO folders, and the session's scratchpad (null: unknown).
export type Roots = { cwd: string; repos: string[]; scratch: string | null }
// What every lane's guard knows: the session's scratchpad and home folder (null: unknown), and where the shell starts.
export type Where = { scratch?: string | null; home?: string | null; cwd?: string | null }

// The absolute path with `.` and `..` resolved; null when relative with no cwd known.
export function clean(path: string, cwd: string | null = null): string | null {
  const full = path.startsWith('/') ? path : cwd === null ? null : `${cwd}/${path}`
  if (full === null) return null
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

// The clean path, or null for one the shell would change first: ~, $ or a backtick.
const resolved = (path: string, cwd: string | null) => (path.startsWith('~') || /[$`]/.test(path) ? null : clean(path, cwd))

// A claude-N folder: the session's own temp folder, only ever a root when no scratchpad is known.
// `claude-*` stands for any claude-N folder directly in the hook's TMPDIR (tool shells get one added).
const TEMP = /\/claude-\d+$/
const ANY = '/claude-*'

// Where read-only lanes may write: the session's scratchpad, else a TMPDIR named claude-N, else
// `<TMPDIR>/claude-*` (null: no TMPDIR known).
export function scratchRoot(scratchpadDir: string | null | undefined, tmpdir: string | null | undefined): string | null {
  if (scratchpadDir) return scratchpadDir
  const tmp = clean(tmpdir ?? '')
  return tmp === null || TEMP.test(tmp) ? tmp : `${tmp === '/' ? '' : tmp}${ANY}`
}

// /tmp and /private/tmp are one folder on macOS.
const slashTmp = (p: string) => p.replace(/^\/private\/tmp\//, '/tmp/')

// Inside the session's scratchpad, or strictly inside its claude-N temp folder (any, for `claude-*`);
// with no scratchpad known, inside any /tmp/claude-N folder too.
export function inScratch(path: string, cwd: string | null = null, scratch: string | null = null): boolean {
  const full = resolved(path, cwd)
  if (full === null) return false
  const isTemp = /^\/(?:private\/)?tmp\/claude-\d+\/./.test(full)
  if (scratch === null) return isTemp
  if (scratch.endsWith(ANY)) {
    const base = slashTmp(scratch.slice(0, -ANY.length))
    const [first = '', ...rest] = slashTmp(full).startsWith(`${base}/`) ? slashTmp(full).slice(base.length + 1).split('/') : []
    return isTemp || (/^claude-\d+$/.test(first) && rest.length > 0)
  }
  return within(full, scratch) && !(TEMP.test(scratch) && within(scratch, full))
}

// `path` (clean) is `root` or inside it; /tmp and /private/tmp are one folder on macOS.
export function within(path: string, root: string): boolean {
  const r = slashTmp(root.replace(/\/+$/, ''))
  return slashTmp(path) === r || slashTmp(path).startsWith(`${r}/`)
}

// Inside the folder, the REPO or the scratchpad itself.
export function inRoots(path: string, roots: Roots, cwd: string | null = roots.cwd): boolean {
  const full = resolved(path, cwd)
  if (full === null) return false
  const under = (root: string) => within(full, root)
  return under(roots.cwd) || roots.repos.some(under) || inScratch(full, null, roots.scratch)
}

// Splits on ; && || | & and newlines outside quotes, and pulls out `>` targets.
export function parse(command: string): Segment[] {
  const segments: Segment[] = []
  let seg: Segment = { words: [], outs: [] }
  let word: string | null = null
  let pending: 'out' | 'drop' | null = null
  let heredoc: string | null = null

  const endWord = () => {
    if (word !== null) {
      if (pending === 'out') seg.outs.push(word)
      else if (pending === null) seg.words.push(word)
      pending = null
    }
    word = null
  }
  const endSegment = () => {
    endWord()
    if (seg.words.length > 0 || seg.outs.length > 0) segments.push(seg)
    seg = { words: [], outs: [] }
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? ''
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end < 0 ? command.length : end
      word = (word ?? '') + command.slice(i + 1, stop)
      i = stop
    } else if (c === '"') {
      let j = i + 1
      let text = ''
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) j++
        text += command[j]
        j++
      }
      word = (word ?? '') + text
      i = j
    } else if (c === '\\') {
      if (command[i + 1] === '\n') i++
      else word = (word ?? '') + (command[++i] ?? '')
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === '\n') {
      endSegment()
      if (heredoc !== null) {
        // Skip the here-document's body up to its closing line.
        let next = command.indexOf('\n', i + 1)
        while (next >= 0 && command.slice(i + 1, next).trim() !== heredoc) {
          i = next
          next = command.indexOf('\n', i + 1)
        }
        i = next < 0 ? command.length : next
        heredoc = null
      }
    } else if (c === ';' || c === '&' || c === '|') {
      endSegment()
      while (';&|'.includes(command[i + 1] ?? 'x')) i++
    } else if (c === '>') {
      if (word !== null && /^\d+$/.test(word)) word = null
      endWord()
      if (command[i + 1] === '>' || command[i + 1] === '|') i++
      if (command[i + 1] === '&') {
        i++
        pending = 'drop'
      } else {
        pending = 'out'
      }
    } else if (c === '<') {
      endWord()
      if (command.startsWith('<<<', i)) {
        i += 2
        pending = 'drop'
      } else if (command[i + 1] === '<') {
        let j = i + 2
        while (command[j] === '-' || command[j] === ' ') j++
        const match = /^["']?([\w.-]+)["']?/.exec(command.slice(j))
        heredoc = match?.[1] ?? null
        i = j + (match?.[0].length ?? 0) - 1
      } else {
        pending = 'drop'
      }
    } else {
      word = (word ?? '') + c
    }
  }
  endSegment()

  return segments
}

function flagged(args: string[], test: (arg: string) => boolean): boolean {
  return args.some(arg => arg.startsWith('-') && test(arg))
}

function plain(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('-'))
}

// The folder a command works in: its -C, --prefix or --directory, else the shell's.
function folderOf(args: string[], cwd: string | null): string | null {
  const long = args.find(a => /^--(prefix|directory)=/.test(a))
  if (long !== undefined) return long.slice(long.indexOf('=') + 1)
  const at = args.findIndex(a => ['-C', '--prefix', '--directory'].includes(a))
  return at >= 0 ? (args[at + 1] ?? null) : cwd
}

// `prefix`: the words before `git`, its env assignments and wrappers.
function gitRule(args: string[], isReadOnly: boolean, cwd: string | null, scratch: string | null, prefix: string[] = []): string | null {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i] ?? '')) i++
    i++
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (sub === undefined) return null
  if (isReadOnly && args.some(a => /^--(git-dir|work-tree|separate-git-dir)\b/.test(a))) return 'point git at another folder'
  const isStashRead = sub === 'stash' && ['list', 'show'].includes(rest[0] ?? '')
  if (GIT_DENY.includes(sub) && !isStashRead) return `run git ${sub}`
  if (sub === 'reset' && rest.includes('--hard')) return 'run git reset --hard'
  if (sub === 'clean' && flagged(rest, a => a === '--force' || /^-[a-zA-Z]*f/.test(a))) return 'run git clean -f'
  if (sub === 'branch' && flagged(rest, a => /^-[a-zA-Z]*D/.test(a))) return 'run git branch -D'
  if (sub === 'worktree' && rest[0] === 'remove') return 'run git worktree remove'
  if (rest.some(a => a === '-f' || a.startsWith('--force'))) return `run git ${sub} with --force`
  if (isReadOnly && sub === 'apply') {
    const folder = folderOf(args, cwd)
    return folder !== null && inScratch(folder, cwd, scratch) ? null : 'run git apply outside the scratchpad'
  }
  if (isReadOnly && sub === 'clone') {
    // Upload-pack, config, hook templates, exec-path and GIT_* env can run code, even in a clone inside the scratchpad.
    const runsCode = args.some(a => /^--(upload-pack|template|config|config-env|exec-path)(=|$)|^-[a-zA-Z]*[uc]/.test(a)) || prefix.some(w => /^GIT_\w*=/.test(w))
    if (runsCode) return 'run git clone with options that run code'
    // It lands in the folders it names after the source, else in its folder under the source's name.
    const folder = folderOf(args, cwd)
    const into = folder === null ? null : clean(folder, cwd)
    const named = rest.filter((a, k) => !a.startsWith('-') && !CLONE_VALUES.includes(rest[k - 1] ?? '')).slice(1)
    const isInside = named.length > 0 ? named.every(p => inScratch(p, into, scratch)) : folder !== null && inScratch(folder, cwd, scratch)
    return isInside ? null : 'run git clone outside the scratchpad'
  }
  if (isReadOnly && GIT_WRITES.includes(sub)) return `run git ${sub}`
  return null
}

function ghRule(args: string[]): string | null {
  const [noun, verb] = args
  if (noun === 'pr' && ['create', 'merge', 'close', 'comment', 'edit', 'review', 'reopen'].includes(verb ?? '')) return `run gh pr ${verb}`
  if (noun === 'issue' && ['create', 'close', 'comment', 'edit', 'delete', 'reopen'].includes(verb ?? '')) return `run gh issue ${verb}`
  if ((noun === 'release' || noun === 'repo') && verb !== 'list' && verb !== 'view') return `run gh ${noun} ${verb ?? ''}`.trim()
  if (noun !== 'api') return null
  let method: string | null = null
  args.forEach((arg, i) => {
    if (arg === '-X' || arg === '--method') method = args[i + 1] ?? null
    else if (arg.startsWith('--method=')) method = arg.slice(9)
    else if (/^-X./.test(arg)) method = arg.slice(2)
  })
  const hasFields = flagged(args, a => /^-[fF]/.test(a) || /^--(raw-)?field|^--input/.test(a))
  const isWrite = method === null ? hasFields : (method as string).toUpperCase() !== 'GET'
  return isWrite ? 'run gh api writes' : null
}

function curlRule(cmd: string, args: string[]): string | null {
  if (cmd === 'wget') {
    const isWrite = args.some(a => /^--(post|body)-(data|file)/.test(a) || /^--method=(?!GET)/i.test(a))
    return isWrite ? 'send data with wget' : null
  }
  let method = ''
  args.forEach((arg, i) => {
    if (arg === '-X' || arg === '--request') method = args[i + 1] ?? ''
    else if (arg.startsWith('--request=')) method = arg.slice(10)
    else if (/^-X./.test(arg)) method = arg.slice(2)
  })
  const sendsData = args.some(
    a => /^--(data|form|json|upload-file)/.test(a) || /^-[a-zA-Z]*[dFT]/.test(a),
  )
  return sendsData || /^(POST|PUT|DELETE|PATCH)$/i.test(method) ? 'send data with curl' : null
}

// Where cp, install, rsync or ln put their copy: `-t DIR`, else the last of 2+ names.
function destination(args: string[], files: string[]): string[] {
  const long = args.find(a => a.startsWith('--target-directory='))
  if (long !== undefined) return [long.slice('--target-directory='.length)]
  const at = args.findIndex(a => a === '-t' || a === '--target-directory')
  if (at >= 0) return [args[at + 1] ?? '']
  return files.length > 1 ? files.slice(-1) : []
}

// The files a sed or perl script edits: a value after -e/-f is the script, else (sed) the first word is.
function scriptFiles(args: string[], isSed: boolean): string[] {
  const takesScript = isSed ? /^-[a-zA-Z]*[ef]$/ : /^-[a-zA-Z]*[eE]$/
  const files: string[] = []
  let hasScript = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? ''
    if (a.startsWith('-')) {
      if (takesScript.test(a)) {
        hasScript = true
        k++
      } else if (/^--(expression|file)=/.test(a)) hasScript = true
    } else if (a !== '') files.push(a)
  }
  return isSed && !hasScript ? files.slice(1) : files
}

// What a builder's command creates or changes on disk, for the REPO check.
// shortcut: interpreter one-liners (python -c, node -e) are not read; upgrade if builders route around it.
function builderWrites(cmd: string, args: string[], files: string[]): string[] {
  if (['cp', 'install', 'ln'].includes(cmd)) return destination(args, files)
  // A remote rsync target (host:path) leaves the machine: never inside.
  if (cmd === 'rsync') return destination(args, files).map(p => (/^[^/]*:/.test(p) ? '~remote' : p))
  // mv changes its sources too: they leave where they were.
  if (['mv', 'touch', 'mkdir', 'truncate'].includes(cmd)) return files
  if (cmd === 'dd') return args.filter(a => a.startsWith('of=')).map(a => a.slice(3))
  const isInPlace = flagged(args, a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))
  if ((cmd === 'sed' || cmd === 'perl') && isInPlace) return scriptFiles(args, cmd === 'sed')
  return []
}

// What a command's guard reads besides its words: the shell's folder, the roots, and the
// names a loop set that cannot be known, and the word that left the folder unknown.
type Ctx = { isReadOnly: boolean; cwd: string | null; roots: Roots | null; scratch: string | null; home: string | null; loops: Set<string>; lost: string | null }

const LOOP = (name: string) =>
  `boss-live: this loop writes to a path built from \`$${name}\` that cannot be checked; use a \`for ${name} in <files>\` loop with literal words or a relative glob`
const LITERAL = (word: string) => `boss-live: this command writes to a path built from \`${word}\` that cannot be checked; use a literal path`

// A refusal for a target the shell would build from what the guard cannot know; null when none is.
function unknownTarget(targets: string[], ctx: Ctx): string | null {
  for (const target of targets) {
    const left = /\$\{?(\w+)\}?|\$\(|`/.exec(target)
    if (left !== null) return left[1] !== undefined && ctx.loops.has(left[1]) ? LOOP(left[1]) : LITERAL(left[0])
    if (ctx.cwd === null && ctx.lost !== null && !target.startsWith('/') && !target.startsWith('~')) return LITERAL(ctx.lost)
  }
  return null
}

function commandRule(words: string[], outs: string[], ctx: Ctx): string | null {
  const { isReadOnly, cwd, roots, scratch } = ctx
  const outside = (paths: string[]) => paths.some(p => !inScratch(p, cwd, scratch))

  let i = 0
  while (i < words.length) {
    const w = words[i] ?? ''
    if (NOISE.includes(w) || /^[A-Za-z_]\w*=/.test(w)) i++
    else if (WRAPPERS.includes(w)) {
      i++
      while ((words[i] ?? '').startsWith('-')) i++
      if (w === 'timeout') i++
    } else break
  }
  const head = (words[i] ?? '').replace(/^\(+/, '')
  const cmd = head.split('/').pop() ?? ''
  const args = words.slice(i + 1).map(a => a.replace(/\)+$/, ''))
  const files = plain(args).filter(a => a !== '--')
  const targets = [...outs, ...(cmd === 'tee' ? files : []), ...builderWrites(cmd, args, files)].filter(p => !DEVICES.includes(p))
  const unknown = unknownTarget([...targets, ...(cmd === 'rm' ? files : [])], ctx)
  if (unknown !== null) return unknown
  if (isReadOnly && (cmd === 'export' ? args : words.slice(0, i)).some(w => /^GIT_(DIR|WORK_TREE)=/.test(w))) return 'point git at another folder'
  // Set or exported, these make later git commands run a program of the agent's choosing.
  if (isReadOnly && (cmd === 'export' ? args : words.slice(0, i)).some(w => /^GIT_(SSH|SSH_COMMAND|PROXY_COMMAND|ASKPASS|TEMPLATE_DIR|EXEC_PATH|CONFIG\w*)=/.test(w))) return 'set git variables that run code'
  if (isReadOnly && outs.some(p => !DEVICES.includes(p) && !inScratch(p, cwd, scratch))) return 'write files outside the scratchpad'
  if (roots !== null && targets.some(p => !inRoots(p, roots, cwd))) return 'write files outside REPO and the scratchpad'

  if (['sh', 'bash', 'zsh'].includes(cmd)) {
    const at = args.findIndex(a => /^-[a-z]*c$/.test(a))
    return at >= 0 ? bashRule(args[at + 1] ?? '', isReadOnly, roots, { scratch, home: ctx.home, cwd }) : null
  }
  if (cmd === 'find') {
    const at = args.findIndex(a => ['-exec', '-execdir', '-ok'].includes(a))
    if (at >= 0) return commandRule(args.slice(at + 1), [], ctx)
    return isReadOnly && args.includes('-delete') ? 'run find -delete' : null
  }
  if (cmd === 'git') return gitRule(args, isReadOnly, cwd, scratch, words.slice(0, i))
  if (cmd === 'gh') return ghRule(args)
  if (cmd === 'curl' || cmd === 'wget') return curlRule(cmd, args)
  if (cmd === 'rm') {
    const isRecursive = flagged(args, a => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a))
    if (isRecursive && outside(files)) return 'run rm -r outside the scratchpad'
    if (roots !== null && files.some(p => !inRoots(p, roots, cwd))) return 'delete files outside REPO and the scratchpad'
    if (isReadOnly && outside(files)) return 'delete files outside the scratchpad'
    return null
  }
  if (!isReadOnly) return null

  if (['tee', 'touch', 'mkdir', 'truncate'].includes(cmd) && outside(files)) return 'write files outside the scratchpad'
  if (cmd === 'mv' && outside(files)) return 'move files outside the scratchpad'
  if (cmd === 'cp') {
    const target = args[args.indexOf('-t') + 1]
    const dest = args.includes('-t') ? target : files.at(-1)
    if (dest !== undefined && !inScratch(dest, cwd, scratch)) return 'copy files outside the scratchpad'
  }
  const isInPlace = flagged(args, a => /^-[a-zA-Z]*i/.test(a) || (cmd === 'sed' && a.startsWith('--in-place')))
  if ((cmd === 'sed' || cmd === 'perl') && isInPlace && outside(scriptFiles(args, cmd === 'sed'))) return `run ${cmd} -i outside the scratchpad`
  const verb = args.find((a, k) => !a.startsWith('-') && !['-C', '--prefix', '--directory'].includes(args[k - 1] ?? ''))
  if (INSTALLERS.includes(cmd) && INSTALLS.includes(verb ?? '')) {
    // A project's own packages, put in a folder inside the scratchpad, may install.
    const folder = folderOf(args, cwd)
    const isLocal = NODE_INSTALLERS.includes(cmd) && !args.some(a => a === '-g' || a === '--global')
    return isLocal && folder !== null && inScratch(folder, cwd, scratch) ? null : 'install packages outside the scratchpad'
  }

  return null
}

// Each way the words read with the names the command bound (a for loop's name takes each of
// its words in turn); a name never bound, or bound to too many choices, stays as written.
const NAME = /\$\(pwd\)|\$\{(\w+)\}|\$(\w+)/g
function readings(words: string[], known: (name: string) => string[] | undefined): string[][] {
  const names = [...new Set(words.flatMap(w => [...w.matchAll(NAME)].map(m => m[1] ?? m[2] ?? 'PWD')))]
  let picks = [new Map<string, string>()]
  for (const name of names) {
    const values = known(name)
    if (values !== undefined) picks = picks.flatMap(pick => values.map(v => new Map([...pick, [name, v]])))
    if (picks.length > 256) return [words]
  }
  return picks.map(pick => words.map(w => w.replace(NAME, (all, a?: string, b?: string) => pick.get(a ?? b ?? 'PWD') ?? all)))
}

const isLiteral = (value: string) => !/[$`\s*?[~]/.test(value)
// A for loop's word the guard can follow: a literal, or a relative glob that stays below the folder
// (no `..`, and no `.*`, which some shells match to `..`).
const isLoopWord = (word: string) =>
  isLiteral(word) || (!/[$`\s~]/.test(word) && !word.startsWith('/') && !word.split('/').some(part => part === '..' || /^\.[^/]*[*?[]/.test(part)))

// What the command may not do, as "run git push", or a whole refusal starting "boss-live:", or
// null when it may run. `roots`, for a builder: what it writes must land inside them. `where.cwd`:
// where the shell starts, apart from the roots, so a `cd` never widens them.
export function bashRule(command: string, isReadOnly: boolean, roots: Roots | null = null, where: Where = {}): string | null {
  let cwd = where.cwd !== undefined ? where.cwd : (roots?.cwd ?? null)
  const scratch = roots?.scratch ?? where.scratch ?? null
  const home = where.home ?? null
  // Each name's values from a bare NAME=literal (null: forgotten), and its first assignment as written.
  const vars = new Map<string, string[] | null>()
  const said = new Map<string, string>()
  const loops = new Set<string>()
  let lost: string | null = null
  // $TMPDIR is known only as the claude-N temp folder that is the scratch root.
  const tmp = scratch !== null && TEMP.test(scratch) ? scratch : null
  const known = (name: string) =>
    vars.has(name) ? (vars.get(name) ?? undefined) : name === 'PWD' && cwd !== null ? [cwd] : name === 'HOME' && home !== null ? [home] : name === 'TMPDIR' && tmp !== null ? [tmp] : undefined
  // A second, different assignment forgets the name for good, inside a loop or not.
  const bind = (name: string, as: string, values: string[] | null) => {
    const isSecond = said.has(name) && (said.get(name) !== as || vars.get(name) === null)
    if (!said.has(name)) said.set(name, as)
    vars.set(name, isSecond || values === null || !values.every(isLiteral) ? null : values)
  }
  const forget = (name: string) => {
    said.set(name, '')
    vars.set(name, null)
  }

  for (const segment of parse(command)) {
    let h = 0
    while (NOISE.includes(segment.words[h] ?? '')) h++
    const raw = segment.words.slice(h)
    const first = raw[0] ?? ''
    if (first === 'cd' || first === 'pushd') {
      const tos = [...new Set(readings([raw[1] ?? ''], known).map(r => r[0] ?? ''))]
      const to = tos.length === 1 ? (tos[0] ?? '') : '$'
      // A bare `cd`, `cd -`, `cd ~` or a folder the guard cannot read leaves it unknown, so relative writes after it are outside.
      const isUnknown = to === '' || to === '-' || /^~|[$`]/.test(to) || (!to.startsWith('/') && cwd === null)
      // The word that left the folder unknown, kept while relative cds follow it.
      lost = /[$`]/.test(to) ? (/\$\{?\w+\}?|\$\(|`/.exec(raw[1] ?? '')?.[0] ?? to) : isUnknown && !/^(~|-?$)/.test(to) ? lost : null
      cwd = isUnknown ? null : to.startsWith('/') ? to : `${cwd}/${to}`
      continue
    }
    // popd goes back to a folder the stack holds, not one followed here.
    if (first === 'popd') {
      cwd = null
      lost = null
      continue
    }
    if (first === 'for') {
      const name = raw[1] ?? ''
      const words = raw[2] === 'in' ? raw.slice(3).flatMap(w => readings([w], known).map(r => r[0] ?? '')) : null
      if (/^[A-Za-z_]\w*$/.test(name)) {
        // A glob's matches lie where its fixed part points: one stand-in name per glob is checked.
        if (words !== null && words.every(isLoopWord)) bind(name, `for ${raw.slice(3).join(' ')}`, words.map(w => w.replace(/[*?[\]]/g, 'x')))
        else forget(name)
        if (vars.get(name) === null) loops.add(name)
      }
      continue
    }
    if (first === 'read') {
      for (const name of raw.slice(1).filter(w => /^[A-Za-z_]\w*$/.test(w))) {
        forget(name)
        loops.add(name)
      }
      continue
    }
    if (raw.length > 0 && segment.outs.length === 0 && raw.every(w => /^[A-Za-z_]\w*\+?=/.test(w))) {
      for (const word of raw) {
        const [, name = '', plus, value = ''] = /^([A-Za-z_]\w*)(\+?)=(.*)$/s.exec(word) ?? []
        if (plus === '+') forget(name)
        else bind(name, value, readings([value], known).map(r => r[0] ?? ''))
      }
      continue
    }
    if (['export', 'local', 'declare', 'typeset', 'readonly', 'unset'].includes(first)) {
      for (const word of raw.slice(1)) {
        const name = /^[A-Za-z_]\w*/.exec(word)?.[0]
        if (name !== undefined) forget(name)
      }
    }
    const parts = segment.words.length
    for (const reading of readings([...segment.words, ...segment.outs], known)) {
      const rule = commandRule(reading.slice(0, parts), reading.slice(parts), { isReadOnly, cwd, roots, scratch, home, loops, lost })
      if (rule !== null) return rule
    }
  }

  return null
}
