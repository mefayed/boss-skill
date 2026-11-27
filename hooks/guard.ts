// Best-effort Bash reading for the boss-live guard. Unclear parses lean to allow.
// shortcut: no $(...), backtick or alias expansion; upgrade if builders route around it.

const SCRATCH = ['/private/tmp/claude-501/', '/tmp/claude-501/']
const DEVICES = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']
const WRAPPERS = ['sudo', 'env', 'command', 'nohup', 'exec', 'nice', 'xargs', 'timeout', 'time']
const NOISE = ['{', '}', '(', ')', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']
const GIT_DENY = ['push', 'commit', 'stash', 'restore', 'checkout', 'switch']
const GIT_WRITES = ['add', 'rm', 'mv', 'apply', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'init', 'clone']
const INSTALLERS = ['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'brew', 'apt', 'apt-get', 'cargo', 'gem', 'go']
const INSTALLS = ['install', 'i', 'add', 'ci', 'uninstall', 'remove', 'update', 'upgrade', 'get']

type Segment = { words: string[]; outs: string[] }
// Where a builder may write: the folder it runs in, its brief's REPO, and the session's scratchpad (null: unknown).
export type Roots = { cwd: string; repo: string | null; scratch: string | null }

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

export function inScratch(path: string, cwd: string | null = null): boolean {
  const full = clean(path, cwd)
  return full !== null && SCRATCH.some(root => full.startsWith(root) && full.length > root.length)
}

// `path` (clean) is `root` or inside it; /tmp and /private/tmp are one folder on macOS.
export function within(path: string, root: string): boolean {
  const tmp = (p: string) => p.replace(/^\/private\/tmp\//, '/tmp/')
  const r = tmp(root.replace(/\/+$/, ''))
  return tmp(path) === r || tmp(path).startsWith(`${r}/`)
}

// Inside the folder, the REPO or the scratchpad itself.
export function inRoots(path: string, roots: Roots, cwd: string | null = roots.cwd): boolean {
  const full = path.startsWith('~') ? null : clean(path, cwd)
  if (full === null) return false
  const under = (root: string) => within(full, root)
  return under(roots.cwd) || (roots.repo !== null && under(roots.repo)) || (roots.scratch === null ? inScratch(full) : under(roots.scratch))
}

// Splits on ; && || | & and newlines outside quotes, and pulls out `>` targets.
function parse(command: string): Segment[] {
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

function gitRule(args: string[], isReadOnly: boolean): string | null {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i] ?? '')) i++
    i++
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (sub === undefined) return null
  if (GIT_DENY.includes(sub)) return `run git ${sub}`
  if (sub === 'reset' && rest.includes('--hard')) return 'run git reset --hard'
  if (sub === 'clean' && flagged(rest, a => a === '--force' || /^-[a-zA-Z]*f/.test(a))) return 'run git clean -f'
  if (sub === 'branch' && flagged(rest, a => /^-[a-zA-Z]*D/.test(a))) return 'run git branch -D'
  if (sub === 'worktree' && rest[0] === 'remove') return 'run git worktree remove'
  if (rest.some(a => a === '-f' || a.startsWith('--force'))) return `run git ${sub} with --force`
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
// shortcut: interpreter one-liners (python -c, node -e) and $VAR paths are not read; upgrade if builders route around it.
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

function commandRule(words: string[], outs: string[], isReadOnly: boolean, cwd: string | null, roots: Roots | null = null): string | null {
  const outside = (paths: string[]) => paths.some(p => !inScratch(p, cwd))
  if (isReadOnly && outs.some(p => !DEVICES.includes(p) && !inScratch(p, cwd))) return 'write files outside the scratchpad'

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
  if (roots !== null && targets.some(p => !inRoots(p, roots, cwd))) return 'write files outside REPO and the scratchpad'

  if (['sh', 'bash', 'zsh'].includes(cmd)) {
    const at = args.findIndex(a => /^-[a-z]*c$/.test(a))
    return at >= 0 ? bashRule(args[at + 1] ?? '', isReadOnly, roots, cwd) : null
  }
  if (cmd === 'find') {
    const at = args.findIndex(a => ['-exec', '-execdir', '-ok'].includes(a))
    if (at >= 0) return commandRule(args.slice(at + 1), [], isReadOnly, cwd, roots)
    return isReadOnly && args.includes('-delete') ? 'run find -delete' : null
  }
  if (cmd === 'git') return gitRule(args, isReadOnly)
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
    if (dest !== undefined && !inScratch(dest, cwd)) return 'copy files outside the scratchpad'
  }
  if (cmd === 'sed' && flagged(args, a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return 'run sed -i'
  if (cmd === 'perl' && flagged(args, a => /^-[a-zA-Z]*i/.test(a))) return 'run perl -i'
  if (INSTALLERS.includes(cmd) && INSTALLS.includes(args[0] ?? '')) return 'install packages'

  return null
}

// What the command may not do, as "run git push", or null when it may run.
// `roots`, for a builder: `>`, `>>` and `tee` must land inside them. `cwd`: where the shell
// starts, apart from the roots, so a `cd` never widens them.
export function bashRule(command: string, isReadOnly: boolean, roots: Roots | null = null, cwd: string | null = roots?.cwd ?? null): string | null {
  for (const { words, outs } of parse(command)) {
    if (words[0] === 'cd' || words[0] === 'pushd') {
      const to = words[1] ?? ''
      // A bare `cd`, `cd -`, `cd ~` or `cd $X` leaves the folder unknown, so relative writes after it are outside.
      cwd = to.startsWith('/') ? to : cwd === null || to === '' || to === '-' || /^[~$]/.test(to) ? null : `${cwd}/${to}`
      continue
    }
    // popd goes back to a folder the stack holds, not one followed here.
    if (words[0] === 'popd') {
      cwd = null
      continue
    }
    const rule = commandRule(words, outs, isReadOnly, cwd, roots)
    if (rule !== null) return rule
  }

  return null
}
