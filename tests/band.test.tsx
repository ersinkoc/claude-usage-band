import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const START = Date.UTC(2026, 9, 3, 12, 0, 0)
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const at = (ms: number) => new Date(START + ms).toISOString()

type SvgSeen = { alt: string; source: string; isInteractive: unknown }

/** Every Svg in a drawn tree, in order. */
function svgs(children: unknown[]): SvgSeen[] {
  const found: SvgSeen[] = []
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue
    const el = child as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (el.type === 'Svg') {
      found.push({ alt: String(el.props?.alt), source: String(el.props?.source), isInteractive: el.props?.isInteractive })
    }
    found.push(...svgs(el.children ?? []))
  }

  return found
}

// What the engine would do beneath the plugin: draw an empty band of its own, echo a measure,
// place a pane, keep the store in memory and run the clock only when the test moves it.
function world(on: On) {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine-band" />
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  mock.store(on)

  return mock.clock(on, { now: START })
}

const TURN = {
  answer: 'ok',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: {
    model: 'claude-opus-5-5',
    input_tokens: 12_600,
    cache_creation_input_tokens: 3_000,
    output_tokens: 3_000,
    cache_read_input_tokens: 954_200,
  },
} as const

test('band stays empty before the first reading, then shows limits, context and cost', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /5h/ })).toBeUndefined()
    await ui.unmount()
  }

  await $.session.measure({
    context: { tokens: 45_000, window: 200_000, percent: 23 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 20, resetsAt: at(2 * HOUR + 40 * MINUTE) },
      { kind: 'seven_day', percentUsed: 58, resetsAt: at(31 * HOUR) },
    ],
    cost: { usd: 4.32 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: /20%/ })).toBeDefined()
  expect(await terminal.find({ text: /58%/ })).toBeDefined()
  expect(await terminal.find({ text: '$4.32' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pills = svgs((await desktop.find({ type: 'Box' }))?.children ?? [])
  expect(pills.map(p => p.alt)).toEqual(['5h 20%, 2h 40m', '7d 58%, 1d 7h', 'ctx 23%', 'Cost $4.32'])
  for (const pill of pills) {
    expect(pill.isInteractive).toBe(true)
    expect(pill.source).toContain('prefers-color-scheme: dark')
    expect(pill.source).toContain('<title>')
  }
  await desktop.unmount()
})

test('every style rule is scoped under the pill root, so pills in one page keep their colors', async ($, on) => {
  world(on)
  await $.session.measure({
    context: { tokens: 45_000, window: 200_000, percent: 23 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: at(2 * HOUR) }],
    cost: { usd: 4.32 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pills = svgs((await desktop.find({ type: 'Box' }))?.children ?? [])
  expect(pills.length).toBe(3)
  const scopes = pills.map(pill => /<svg[^>]* class="(ub-[\w-]+)"/.exec(pill.source)?.[1])
  expect(new Set(scopes).size).toBe(3)
  for (const [i, pill] of pills.entries()) {
    expect(pill.source).toContain(`.${scopes[i]} .bg{`)
    // No rule starts bare after the <style> tag or a closing brace.
    expect(pill.source).not.toMatch(/[>}]\s*\.(bg|fg|st|tx|bar)\{/)
  }
  await desktop.unmount()
})

test('band yields to a survey', async ($, on) => {
  world(on)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 75 }],
    cost: { usd: 1 },
    changed: ['rateLimits', 'cost'],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('token pills fall back to turn usage with a ~ until the transcript is counted', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete(TURN)
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: /~15\.6k/ })).toBeDefined()
  expect(await terminal.find({ text: /~3\.0k/ })).toBeDefined()
  expect(await terminal.find({ text: /~954\.2k/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(svgs((await desktop.find({ type: 'Box' }))?.children ?? []).map(p => p.alt)).toEqual([
    'Input ~15.6k',
    'Output ~3.0k',
    'Cache read ~954.2k',
    'Cache hit rate 98%',
    'API requests ~1',
    'Last turn 1s',
  ])
  await desktop.unmount()
})

test('/usage-band hide and show toggle the band', async ($, on) => {
  world(on)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 4.32 }, changed: ['cost'] })
  const hidden = await $.command.run({ ...RUN, command: 'usage-band', args: 'hide' })
  expect(hidden.text).toContain('hidden')
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: '$4.32' })).toBeUndefined()
  await ui.unmount()

  await $.command.run({ ...RUN, command: 'usage-band', args: 'show' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: '$4.32' })).toBeDefined()
  await ui.unmount()
})

test('settings turn pills off and compact drops bars and icons', { options: { showContext: false, layout: 'compact' } }, async ($, on) => {
  world(on)
  await $.session.measure({
    context: { tokens: 45_000, window: 200_000, percent: 23 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: at(2 * HOUR) }],
    cost: { usd: 4.32 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pills = svgs((await desktop.find({ type: 'Box' }))?.children ?? [])
  expect(pills.map(p => p.alt)).toEqual(['5h 20%, 2h 0m', 'Cost $4.32'])
  expect(pills[0]?.source).not.toContain('class="tr"')
  expect(pills[0]?.source).not.toContain('class="bar"')
  expect(pills[0]?.source).not.toContain('<g transform')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: /█|░/ })).toBeUndefined()
  expect(await terminal.find({ text: /ctx/ })).toBeUndefined()
  await terminal.unmount()
})

test('compact labels say what each bare number is', { options: { layout: 'compact' } }, async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete(TURN)
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const label of ['in ~15.6k', 'out ~3.0k', 'cache ~954.2k', 'req ~1', 'turn 1s']) {
    expect(await terminal.find({ text: label })).toBeDefined()
  }
  await terminal.unmount()
})

test('/usage-band settings lists every pill, and unknown names are refused', async ($, on) => {
  world(on)
  const out = await $.command.run({ ...RUN, command: 'usage-band', args: 'settings' })
  for (const name of ['5-hour limit', '7-day limit', 'Context window', 'Output speed', 'Thinking effort', 'Folder', 'Git branch', 'Machine memory', 'Prompts']) {
    expect(out.text).toContain(name)
  }
  const bad = await $.command.run({ ...RUN, command: 'usage-band', args: 'off nonsense' })
  expect(bad.text).toContain('unknown pill "nonsense"')
  const big = await $.command.run({ ...RUN, command: 'usage-band', args: 'set yellow 300' })
  expect(big.text).toContain('from 1 to 100')
  const what = await $.command.run({ ...RUN, command: 'usage-band', args: 'set bogus 1' })
  expect(what.text).toContain('Options:')
})

test('the last turn pill shows the main-loop turn length', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'ok', durationMs: 34_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: '34s' })).toBeDefined()
  await ui.unmount()
})

test('a pace that would pass 100% before the reset marks the pill at risk', async ($, on) => {
  world(on)
  // 75% used with 3h of 5h left: 40% of the window gone, about 188% by the reset.
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 75, resetsAt: at(3 * HOUR) }],
    changed: ['rateLimits'],
  })
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pills = svgs((await desktop.find({ type: 'Box' }))?.children ?? [])
  expect(pills[0]?.alt).toBe('5h 75%, 3h 0m, at risk')
  expect(pills[0]?.source).toContain('class="wr"')
  expect(pills[0]?.source).toContain('100% in')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ text: /!/ })).toBeDefined()
  await terminal.unmount()
})
