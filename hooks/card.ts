// The boss card as one SVG, for the surfaces that draw images (VS Code,
// Desktop, mobile). One look, and one calm colour at a time that names the stage:
// violet planning, blue building, teal testing, amber your turn, green proven, red
// failed, grey when finished unproven. It is drawn only on the status mark, the stage
// word and the current step; all else is monochrome. Light and dark are in the same
// image, switched by the system's setting. Motion rules:
// - One loop, only while the team works: a light crosses the current step, phased
//   on the wall clock, so a new image picks it up where the old one left it.
// - Every other effect plays once, keyed to the time its event happened:
//   animation-delay = stagger - (ms since), fill both.
//   The SVG is replaced when its content changes, so this lands an old effect on
//   its last frame instead of replaying it.
// - The markup's own attributes are the resting frame, so reduced motion and late
//   redraws always land on a complete, readable card.

// `still`: finished with nothing to colour (not checked, or a proof gone stale).
export type CardKind = 'working' | 'turn' | 'done' | 'failed' | 'still'

export type CardModel = {
  kind: CardKind
  // The colour of a working stage; the other kinds have their own.
  hue: 'plan' | 'build' | 'check' | null
  // The stage word: "Testing", "Your turn", "Done".
  stage: string
  // Beside it, what happens right now, and when that phrase last changed.
  doing: string
  doingAt: number | null
  clock: string | null
  task: string | null
  team: { role: string; state: 'run' | 'done' }[]
  proof: {
    test: string
    // At the right of the row: "1 of 4 proven", "Check 3 of 4 failed".
    word: string
    // A file the pass proved changed since: the words ask for a re-check, muted.
    isStale: boolean
    checks: ('pass' | 'fail' | 'pending')[]
    // When the inspector reported the checks.
    checkAt: number | null
  } | null
  // Plan › Build › Check › Done, and when the current one began. `open`: reached, not passed.
  steps: { label: string; state: 'done' | 'skipped' | 'current' | 'failed' | 'open' | 'next' }[]
  stepAt: number | null
  // When this stage began: times the tick, the cross and the coloured step.
  stageAt: number | null
  now: number
}

export const CARD_HEIGHT = 118
const W = 680
const L = 18
const R = 662
// Where the text starts, and the Task and Your test sentences.
const TX = 40
const VX = 104
// The light's loop, and the longest an entrance is counted as old.
const LOOP_MS = 2400
const OLD_MS = 100_000
// More checks than this are told by the count alone.
const MAX_PIPS = 8

const CSS = `
svg{--surface:rgba(255,255,255,.04);--line:rgba(255,255,255,.08);--t1:#ededed;--t2:#a8a8a8;--t3:#868686;
--track:rgba(255,255,255,.11);--fill:rgba(255,255,255,.62);--knock:#161616;
--plan:#a895f7;--build:#6eaaf5;--check:#48c2c8;--turn:#f5a623;--done:#3ecf8e;--failed:#ff6166;--still:#a8a8a8}
@media (prefers-color-scheme:light){svg{--surface:rgba(0,0,0,.025);--line:rgba(0,0,0,.09);--t1:#171717;--t2:#5c5c5c;--t3:#767676;
--track:rgba(0,0,0,.09);--fill:rgba(0,0,0,.58);--knock:#fff;
--plan:#6a50d3;--build:#1d68c9;--check:#0b7a85;--turn:#a86500;--done:#17813f;--failed:#d4222b;--still:#5c5c5c}}
text{font-family:-apple-system,"SF Pro Text","Segoe UI",system-ui,Inter,sans-serif;font-size:12.5px;fill:var(--t2)}
.h{font-size:16px;letter-spacing:-.01em;fill:var(--t1)}.b{font-size:13.5px}.w6{font-weight:600}
.t1{fill:var(--t1)}.t2{fill:var(--t2)}.t3{fill:var(--t3)}.num{font-variant-numeric:tabular-nums}
.c{fill:var(--c)}
.surface{fill:var(--surface);stroke:var(--line)}.track{fill:var(--track)}.live{fill:var(--c);fill-opacity:.3}.fill{fill:var(--fill)}
.ring{fill:none;stroke:var(--c);stroke-width:1.5}.soft{stroke-opacity:.45}
.skip{stroke:var(--track);stroke-width:3;stroke-dasharray:.5 7;stroke-linecap:round}
.open{fill:none;stroke:var(--t3);stroke-opacity:.7}.dim{fill-opacity:.55}
.knock{fill:none;stroke:var(--knock);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1}
.sh{stop-color:var(--c)}.half{display:none}
@keyframes sweep{0%{transform:translateX(0)}78%,100%{transform:translateX(232px)}}
@keyframes fade{from{fill-opacity:0}to{fill-opacity:1}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.sheen{animation:sweep 2.4s cubic-bezier(.45,0,.55,1) infinite}
.fade{animation:fade .32s cubic-bezier(.2,.7,.2,1) both}
.grow{transform-box:fill-box;transform-origin:0 50%;animation:grow .5s cubic-bezier(.2,.7,.2,1) both}
.draw{animation:draw .36s cubic-bezier(.3,.7,.2,1) both}
@media (prefers-reduced-motion:reduce){.sheen,.fade,.grow,.draw{animation:none}.sheen{display:none}.half{display:inline}}`.replace(/\n/g, '')

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A cautious guess at a string's width in the system font, in px: an image cannot measure
// its text. About a tenth over the real width in SF Pro, so a sentence cut to it stays clear.
function widthOf(text: string, size: number): number {
  let em = 0
  for (const ch of text) {
    em += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 1.1 : /[ijl.,:;'!| ]/.test(ch) ? 0.33 : /[ftr()[\]{}/\\"*-]/.test(ch) ? 0.44 : /[mwMW@%—…✓]/.test(ch) ? 1 : /[A-Z0-9<>=+~#$&?_]/.test(ch) ? 0.76 : 0.63
  }
  return em * size
}

// The sentence whole if it fits `px`; else cut after a whole word, ending in an ellipsis.
function fit(text: string, px: number, size: number): string {
  if (widthOf(text, size) <= px) return text
  let end = text.length
  while (end > 0 && widthOf(`${text.slice(0, end)}…`, size) > px) end -= 1
  // Back to the last whole word, unless one long word is most of the line.
  const space = text.lastIndexOf(' ', end - 1)
  if (text[end] !== ' ' && space > end * 0.6) end = space
  const cut = text.slice(0, end).replace(/[\s,.;:-]+$/, '')
  return cut === '' ? '' : `${cut}…`
}

// The card: each right-hand group is one end-anchored text, and a sentence at its left is
// cut to the room that group leaves, so the two never touch.
export function cardSvg(model: CardModel): string {
  const { kind, now } = model
  // One play, begun `stagger` after `at`: an old one lands on its last frame.
  const enter = (at: number | null, stagger = 0) =>
    `style="animation-delay:${Math.round(stagger - (at === null ? OLD_MS : Math.min(Math.max(0, now - at), OLD_MS)))}ms"`
  // The stage's colour: every part drawn in it reads --c, which the root sets.
  const tone = kind === 'working' ? (model.hue ?? 'build') : kind
  const o: string[] = []
  const defs: string[] = []
  const steps = model.steps

  o.push(`<rect class="surface" x=".5" y=".5" width="${W - 1}" height="${CARD_HEIGHT - 1}" rx="10"/>`)

  // The status mark: a ring that fills with the steps done; a solid mark only for the three moments.
  const cx = 25
  const cy = 22.5
  if (kind === 'done') {
    o.push(`<circle class="c" cx="${cx}" cy="${cy}" r="6.5"/><path class="knock draw" ${enter(model.stageAt, 380)} pathLength="1" d="M21.8 22.8l2.2 2.2 4.2-4.8"/>`)
  } else if (kind === 'failed') {
    o.push(`<circle class="c" cx="${cx}" cy="${cy}" r="6.5"/><path class="knock draw" ${enter(model.stageAt, 380)} pathLength="1" d="M22.6 20.1l4.8 4.8M27.4 20.1l-4.8 4.8"/>`)
  } else if (kind === 'turn') {
    o.push(`<circle class="ring soft" cx="${cx}" cy="${cy}" r="5.75"/><circle class="c" cx="${cx}" cy="${cy}" r="3"/>`)
  } else {
    // A finished run fills the ring, proven or not; the rail says which.
    const f = kind === 'still' ? 1 : steps.length === 0 ? 0 : steps.filter(step => step.state === 'done' || step.state === 'skipped').length / steps.length
    const a = f * 2 * Math.PI
    const r = 3.2
    o.push(`<circle class="ring" cx="${cx}" cy="${cy}" r="5.75"/>`)
    if (f >= 1) o.push(`<circle class="c" cx="${cx}" cy="${cy}" r="${r}"/>`)
    else if (f > 0) o.push(`<path class="c" d="M${cx} ${cy}V${cy - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}Z"/>`)
  }

  // Headline right: the team, then the clock.
  const working = model.team.filter(member => member.state !== 'done').length
  let team: string
  let teamW: number
  if (model.team.length > 0 && (kind === 'done' || model.team.length > 3)) {
    const count = `${model.team.length} agent${model.team.length === 1 ? '' : 's'}${working > 0 ? ` · ${working} working` : ''}`
    team = `<tspan>${esc(count)}</tspan>`
    teamW = widthOf(count, 12.5)
  } else {
    team = model.team
      .map((member, i) =>
        member.state === 'done'
          ? `<tspan class="t3"${i > 0 ? ' dx="12"' : ''}>✓ ${esc(member.role)}</tspan>`
          : `<tspan class="t1" font-size="7" dy="-1.6"${i > 0 ? ' dx="12"' : ''}>●</tspan><tspan dy="1.6" dx="5">${esc(member.role)}</tspan>`,
      )
      .join('')
    // A name with its mark (the dot is 6 wide and 5 off), 12 between two.
    teamW = model.team.reduce((sum, member, i) => sum + (i > 0 ? 12 : 0) + (member.state === 'done' ? widthOf(`✓ ${member.role}`, 12.5) : 11 + widthOf(member.role, 12.5)), 0)
  }
  const clock = model.clock ?? ''
  if (team !== '' || clock !== '') {
    o.push(`<text x="${R}" y="28" text-anchor="end">${team}${clock === '' ? '' : `<tspan class="num"${team === '' ? '' : ' dx="14"'}>${esc(clock)}</tspan>`}</text>`)
  }
  const headEnd = R - 16 - teamW - (clock === '' ? 0 : 14 + widthOf(clock, 12.5))

  // Headline left: the stage word, then what is happening now in the room that is left.
  const doing = fit(model.doing, headEnd - (TX + widthOf(model.stage, 16) + 8), 16)
  o.push(`<text class="h" x="${TX}" y="28"><tspan class="w6 c">${esc(model.stage)}</tspan><tspan class="fade" ${enter(model.doingAt)} dx="8">${esc(doing)}</tspan></text>`)

  // The task and your test; a row with nothing to say stays empty, so the card keeps its height.
  if (model.task !== null) o.push(`<text class="t3" x="${TX}" y="51">Task</text><text class="b" x="${VX}" y="51">${esc(fit(model.task, R - VX, 13.5))}</text>`)
  const proof = model.proof
  if (proof !== null) {
    const checks = proof.checks.length > MAX_PIPS ? [] : proof.checks
    const pipW = checks.length > 0 ? checks.length * 17 - 3 : 0
    const proofX = R - pipW - (pipW > 0 ? 10 : 0)
    const testEnd = proofX - 14 - widthOf(proof.word, 12.5)
    o.push(`<text class="t3" x="${TX}" y="71">Your test</text><text class="b" x="${VX}" y="71">${esc(fit(proof.test, testEnd - VX, 13.5))}</text>`)
    // A verdict reads at full strength, a count in progress quieter, a stale one muted.
    const ink = proof.isStale ? 't3' : kind === 'done' || kind === 'failed' ? 't1' : proof.checks.length > 0 ? 't2' : 't3'
    o.push(`<text class="num ${ink}" x="${proofX}" y="71" text-anchor="end">${esc(proof.word)}</text>`)
    const lastPass = checks.lastIndexOf('pass')
    checks.forEach((check, i) => {
      const x = R - pipW + i * 17
      const grow = i === lastPass || check === 'fail' ? ` grow" ${enter(proof.checkAt)}` : '"'
      // A check that passed is filled, one that failed hollow: the colour stays on the stage.
      if (check === 'fail') o.push(`<rect class="pip open${grow} x="${x + 0.5}" y="65.5" width="13" height="2" rx="1"/>`)
      else o.push(`<rect class="pip track" x="${x}" y="65" width="14" height="3" rx="1.5"/>` + (check === 'pass' ? `<rect class="pip fill${grow} x="${x}" y="65" width="14" height="3" rx="1.5"/>` : ''))
    })
  }

  // The rail: one segment per step; the current one carries the only loop on the card.
  const segW = steps.length === 0 ? 0 : (R - L - 4 * (steps.length - 1)) / steps.length
  const lastDone = steps.map(step => step.state).lastIndexOf('done')
  steps.forEach((step, i) => {
    const x = L + i * (segW + 4)
    const isCurrent = step.state === 'current' || step.state === 'failed'
    // A skipped step is dimmer than one still ahead, over faint dots.
    o.push(`<text class="${isCurrent ? 't1 w6' : step.state === 'done' ? 't2' : step.state === 'skipped' ? 't3 dim' : 't3'}" x="${x}" y="93">${esc(step.label)}</text>`)
    if (step.state === 'skipped') {
      o.push(`<line class="skip" x1="${x + 2}" x2="${x + segW - 2}" y1="101.5" y2="101.5"/>`)
      return
    }
    // Reached but not passed: a hollow segment, so it never reads as done.
    if (step.state === 'open') {
      o.push(`<rect class="open" x="${x + 0.5}" y="100.5" width="${segW - 1}" height="2" rx="1"/>`)
      return
    }
    const bar = (cls: string, extra = '') => `<rect class="${cls}" ${extra}x="${x}" y="100" width="${segW}" height="3" rx="1.5"/>`
    o.push(bar(isCurrent && kind === 'working' ? 'live' : 'track'))
    if (step.state === 'done') o.push(i === lastDone ? bar('fill grow', `${enter(model.stepAt)} `) : bar('fill'))
    else if (isCurrent && kind !== 'working') o.push(bar('c grow', `${enter(model.stageAt, kind === 'done' ? 80 : 0)} `))
    else if (isCurrent) {
      defs.push(
        `<clipPath id="cur"><rect x="${x}" y="100" width="${segW}" height="3" rx="1.5"/></clipPath>` +
          `<linearGradient id="sh"><stop class="sh" offset="0" stop-opacity="0"/><stop class="sh" offset=".6" stop-opacity=".95"/><stop class="sh" offset="1" stop-opacity="0"/></linearGradient>`,
      )
      // The phase comes from the wall clock, so a new image picks the light up where the old one left it.
      o.push(
        `<g clip-path="url(#cur)"><rect class="sheen" style="animation-delay:-${now % LOOP_MS}ms" x="${x - 72}" y="100" width="72" height="3" fill="url(#sh)"/></g>` +
          // Reduced motion: the current step half filled, still.
          `<rect class="c half" x="${x}" y="100" width="${segW / 2}" height="3" rx="1.5"/>`,
      )
    }
  })

  const label = [model.stage, model.doing, proof?.word ?? ''].filter(part => part !== '').join('. ')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${CARD_HEIGHT}" viewBox="0 0 ${W} ${CARD_HEIGHT}" role="img" aria-label="${esc(label)}" style="--c:var(--${tone})">` +
    `<style>${CSS}</style><defs>${defs.join('')}</defs>${o.join('')}</svg>`
  )
}
