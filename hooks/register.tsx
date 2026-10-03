import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type {
  UsageActivity,
  UsageAlerted,
  UsageGit,
  UsageLimit,
  UsageSnapshot,
  UsageTokens,
  UsageTranscript,
} from '../types'
import {
  barLevel,
  buildPills,
  compactText,
  formatPercent,
  isBar,
  LAYOUTS,
  lookOf,
  pillSvg,
  readSettings,
  SWITCHES,
  terminalBar,
  TERMINAL_BAR,
  TERMINAL_COLORS,
  TERMINAL_ICONS,
  TOGGLES,
} from './pills'
import type { Pill, Settings } from './pills'

const EMPTY_ACTIVITY: UsageActivity = {
  lastTurn: null,
  toolCalls: 0,
  toolFailures: 0,
  byTool: {},
  agentsRunning: 0,
  compactions: 0,
  compactionFreed: 0,
}
const NO_ALERTS: UsageAlerted = { fiveHour: 0, sevenDay: 0, spendLimit: 0 }

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, null)
const fallback = atom({ plugin: 'usage-band', key: 'fallback' } as const, null)
const transcript = atom({ plugin: 'usage-band', key: 'transcript' } as const, null)
const activity = atom({ plugin: 'usage-band', key: 'activity' } as const, EMPTY_ACTIVITY)
const stream = atom({ plugin: 'usage-band', key: 'stream' } as const, null)
const session = atom({ plugin: 'usage-band', key: 'session' } as const, null)
const alerted = atom({ plugin: 'usage-band', key: 'alerted' } as const, NO_ALERTS)
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

const HIDDEN_KEY = 'usage-band.isHidden'
const SETTINGS_PANE = 'usage-band-settings'
const REFRESH_CHOICES = [15, 30, 60, 120]
const WARN_CHOICES = [50, 60, 70, 80]
const HOT_CHOICES = [80, 85, 90, 95]
const NODES = ['node', '/usr/local/bin/node', '/opt/homebrew/bin/node', 'C:\\Program Files\\nodejs\\node.exe']
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const ALERT_NAMES: Record<keyof UsageAlerted, string> = {
  fiveHour: '5-hour limit',
  sevenDay: '7-day limit',
  spendLimit: 'Spend limit',
}

type Measured = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

type ScriptResult =
  | { found: false }
  | ({ found: true; path: string; size: number; mtimeMs: number } & Omit<UsageTokens, 'isEstimate'> &
      UsageTranscript)

// Module state: a reload starts these over; what the band draws lives in $.state.
let settings: Settings = readSettings({})
let counted: { path: string; size: number; mtimeMs: number } | null = null
let node: string | null = null
let counting: Promise<void> | null = null
/** Session cost when each turn started, by turn id, until the main turn ends. */
const turnStarts = new Map<string, number | null>()

function nextOf<T>(choices: readonly T[], current: T): T {
  return choices[(choices.indexOf(current) + 1) % choices.length] ?? choices[0]!
}

function toSnapshot(m: Measured, previous: UsageSnapshot | null): UsageSnapshot {
  const limit = (kind: string): UsageLimit | null => {
    const found = m.rateLimits.find(one => one.kind === kind)

    return found ? { percent: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
  }
  const breakdown = m.context.breakdown
  const categories = breakdown
    ? breakdown.categories
        .filter(one => one.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .map(one => ({ name: one.name, tokens: one.tokens }))
    : (previous?.contextCategories ?? null)

  return {
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
    spendLimit: limit('spend_limit'),
    contextTokens: m.context.tokens ?? null,
    contextWindow: m.context.window || null,
    contextPercent: m.context.percent ?? null,
    contextCategories: settings.contextBreakdown ? categories : null,
    autoCompactAt: breakdown ? (breakdown.autoCompactThreshold ?? null) : (previous?.autoCompactAt ?? null),
    costUsd: m.cost?.usd ?? null,
  }
}

/** Toasts once when a limit climbs into the yellow or red band; stays quiet on the way down. */
async function alertLimits($: EngineInterface, held: UsageSnapshot): Promise<void> {
  const look = lookOf(settings)
  const time = await read($, now)
  for (const which of ['fiveHour', 'sevenDay', 'spendLimit'] as const) {
    const limit = held[which]
    if (!limit) {
      continue
    }
    const levels = { ok: 0, warn: 1, high: 2 } as const
    const reached = levels[barLevel(limit.percent, look)]
    const before = (await read($, alerted))[which]
    if (reached === before) {
      continue
    }
    await update($, alerted, prev => ({ ...prev, [which]: reached }))
    if (!settings.alerts || reached < before) {
      continue
    }
    const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
    const left = Number.isFinite(resetsAt) && time > 0 ? `, resets in ${formatLeft(resetsAt - time)}` : ''
    $.ui.toast(`${reached === 2 ? '⚠ ' : ''}${ALERT_NAMES[which]} at ${formatPercent(limit.percent)}${left}`, {
      timeoutMs: reached === 2 ? 10_000 : 6000,
    })
  }
}

function formatLeft(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))

  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

async function measure($: EngineInterface, m: Measured): Promise<void> {
  // A measurement is a fresh moment: countdowns count from it.
  const time = await $.clock.now()
  await update($, now, () => time)
  const held = await update($, snapshot, previous => toSnapshot(m, previous))
  if (held) {
    await alertLimits($, held)
  }
}

/** Runs one of the mod's scripts with the first node that starts; null when none ran it cleanly. */
async function runNode($: EngineInterface, script: string, args: string[]): Promise<string | null> {
  const path = `${$.plugin.root}/scripts/${script}`
  for (const candidate of node ? [node] : NODES) {
    try {
      const run = await $.process.run([candidate, path, ...args], { timeoutMs: 20_000 })
      if (run.exitCode !== 0) {
        return null
      }
      node = candidate

      return run.stdout
    } catch {
      // This node did not start; try the next one.
    }
  }

  return null
}

async function recount($: EngineInterface, force: boolean): Promise<void> {
  if (!force && counted) {
    const stat = await $.fs.stat(counted.path).catch(() => null)
    if (stat && stat.size === counted.size && stat.mtimeMs === counted.mtimeMs) {
      return
    }
  }
  const stdout = await runNode($, 'tokens.mjs', [await $.session.id()])
  let result: ScriptResult | null = null
  try {
    result = stdout === null ? null : (JSON.parse(stdout) as ScriptResult)
  } catch {
    result = null
  }
  if (result === null || !result.found) {
    return
  }
  counted = { path: result.path, size: result.size, mtimeMs: result.mtimeMs }
  const totals: UsageTokens = {
    uncached: result.uncached,
    cacheWrite: result.cacheWrite,
    cacheWrite1h: result.cacheWrite1h ?? 0,
    cacheWrite5m: result.cacheWrite5m ?? 0,
    output: result.output,
    thinking: result.thinking ?? 0,
    cacheRead: result.cacheRead,
    webSearches: result.webSearches ?? 0,
    webFetches: result.webFetches ?? 0,
    requests: result.requests,
    isEstimate: false,
  }
  const edits: UsageTranscript = {
    toolCalls: result.toolCalls ?? 0,
    toolFailures: result.toolFailures ?? 0,
    byTool: result.byTool ?? {},
    linesAdded: result.linesAdded ?? 0,
    linesRemoved: result.linesRemoved ?? 0,
    filesChanged: result.filesChanged ?? 0,
  }
  await update($, tokens, () => totals)
  await update($, transcript, () => edits)
}

/** Counts the transcript's tokens unless its size and mtime are unchanged. */
async function countTokens($: EngineInterface, force = false): Promise<void> {
  if (!counting) {
    counting = recount($, force).finally(() => {
      counting = null
    })
  }

  return counting
}

/** Branch, uncommitted files, ahead and behind, from one `git status`. */
async function readGit($: EngineInterface): Promise<UsageGit | null> {
  if (!(await $.session.repo())) {
    return null
  }
  const run = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 10_000 }).catch(() => null)
  if (!run || run.exitCode !== 0) {
    return null
  }
  const [head = '', ...rest] = run.stdout.split('\n')
  const name = head.replace(/^## (No commits yet on )?/, '')
  const branch = name.split('...')[0]?.split(' ')[0] || 'HEAD'

  return {
    branch,
    dirty: rest.filter(line => line.trim() !== '').length,
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
  }
}

async function readMemory($: EngineInterface): Promise<{ total: number; free: number } | null> {
  const stdout = await runNode($, 'sysinfo.mjs', [])
  try {
    const parsed = stdout === null ? null : (JSON.parse(stdout) as { total: number; free: number })

    return parsed && parsed.total > 0 ? parsed : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface, force = false): Promise<void> {
  const time = await $.clock.now()
  await update($, now, () => time)
  const wantsBreakdown = settings.showContext && settings.contextBreakdown
  const usage = await $.session.usage(wantsBreakdown ? { breakdown: 'summary' } : undefined)
  await measure($, usage)
  const [model, version, prompts, cwd, git, memory] = await Promise.all([
    settings.showModel ? $.session.model() : Promise.resolve(null),
    settings.showModel ? $.session.version().then(v => v.version) : Promise.resolve(null),
    settings.showPrompts ? $.session.turns() : Promise.resolve(null),
    settings.showFolder ? $.session.cwd() : Promise.resolve(null),
    settings.showGit ? readGit($) : Promise.resolve(null),
    settings.showMemory ? readMemory($) : Promise.resolve(null),
  ])
  await update($, session, () => ({ startedAt: usage.startedAt, model, version, prompts, cwd, git, memory }))
  await countTokens($, force)
}

/** The pills as the band and /usage-band draw them, from the values held now. */
async function currentPills($: EngineInterface): Promise<Pill[][]> {
  // Until the transcript has been counted (or when it cannot be), turn usage stands in, marked "~".
  const counts = (await read($, tokens)) ?? (await read($, fallback))

  return buildPills({
    snapshot: await read($, snapshot),
    tokens: counts,
    transcript: await read($, transcript),
    activity: await read($, activity),
    stream: await read($, stream),
    session: await read($, session),
    now: await read($, now),
    settings,
  })
}

async function recordStream($: EngineInterface, model: string, effort: string | null, tokens: number, ms: number): Promise<void> {
  await update($, stream, prev => {
    const isTimed = ms >= 250 && tokens > 0

    return {
      model,
      effort: effort ?? prev?.effort ?? null,
      lastTps: isTimed ? (tokens / ms) * 1000 : (prev?.lastTps ?? null),
      tokens: (prev?.tokens ?? 0) + (isTimed ? tokens : 0),
      ms: (prev?.ms ?? 0) + (isTimed ? ms : 0),
      responses: (prev?.responses ?? 0) + (isTimed ? 1 : 0),
    }
  })
}

/** Writes one of this plugin's settings, as the /config menu would. */
async function setOption($: EngineInterface, field: string, value: boolean | number | string): Promise<string | null> {
  const rows = await $.config.list()
  const row = rows.find(one => one.key === `usage-band.${field}` || (one.key.startsWith('usage-band') && one.key.endsWith(`.${field}`)))
  if (!row) {
    return `no setting named ${field}`
  }
  const result = await $.config.set({ key: row.key, value })

  return result.deny ?? null
}

/** The setting a word names: `git`, `cost-rate`, `showGit`, `Cost per hour`. */
function findSetting(word: string): string | null {
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = squash(word)
  const found = [...TOGGLES, ...SWITCHES].find(
    one => squash(one.field) === wanted || squash(one.field.replace(/^show/, '')) === wanted || squash(one.title) === wanted,
  )

  return found?.field ?? null
}

/** `/usage-band set <option> <value>` for the settings that are not on/off. */
async function setValue($: EngineInterface, name: string, value: string): Promise<string> {
  const option = name.toLowerCase().replace(/[^a-z]/g, '')
  if (option === 'layout') {
    if (value !== 'full' && value !== 'compact') {
      return 'Layout is full or compact.'
    }

    return (await setOption($, 'layout', value)) ?? `Layout set to ${value}.`
  }
  const fields: Record<string, [string, number, number]> = {
    yellow: ['warnAt', 1, 100],
    warn: ['warnAt', 1, 100],
    warnat: ['warnAt', 1, 100],
    red: ['hotAt', 1, 100],
    hot: ['hotAt', 1, 100],
    hotat: ['hotAt', 1, 100],
    refresh: ['refreshSeconds', 10, 600],
    refreshseconds: ['refreshSeconds', 10, 600],
  }
  const target = fields[option]
  const n = Number(value)
  if (!target) {
    return 'Options: layout full|compact, yellow <percent>, red <percent>, refresh <seconds>'
  }
  if (!Number.isFinite(n) || n < target[1] || n > target[2]) {
    return `${name} takes a number from ${target[1]} to ${target[2]}.`
  }

  return (await setOption($, target[0], Math.round(n))) ?? `${name} set to ${Math.round(n)}.`
}

function describeSettings(): string {
  const on = TOGGLES.filter(one => settings[one.field]).map(one => one.title)
  const off = TOGGLES.filter(one => !settings[one.field]).map(one => one.title)
  const switches = SWITCHES.map(one => `${one.title} ${settings[one.field] ? 'on' : 'off'}`)

  return [
    `Shown: ${on.join(', ') || 'nothing'}`,
    `Hidden: ${off.join(', ') || 'nothing'}`,
    switches.join(', '),
    `Layout ${settings.layout} · yellow from ${settings.warnAt}% · red from ${settings.hotAt}% · refresh every ${settings.refreshSeconds}s`,
  ].join('\n')
}

const USAGE = 'Usage: /usage-band [settings|hide|show|on <pill>|off <pill>|set <option> <value>]'

export const register: Register = (on, options) => {
  settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Usage band: refresh and summarize · settings · hide/show · on/off <pill> · set <option> <value>',
      argumentHint: '[settings|hide|show|on <pill>|off <pill>|set <option> <value>]',
    })
    const stored = await $.store.get(HIDDEN_KEY)
    await update($, isHidden, () => stored === true)
    $.clock.every(settings.refreshSeconds * 1000, () => {
      void refresh($).catch(() => undefined)
    })
    void refresh($).catch(() => undefined)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)
    const cost = e.cost?.usd
    if (cost !== undefined && turnStarts.size === 0) {
      await update($, activity, held =>
        held.lastTurn ? { ...held, lastTurn: { ...held.lastTurn, endCost: cost } } : held,
      )
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const held = await read($, snapshot)
    turnStarts.set(e.turnId, held?.costUsd ?? null)

    return next(e)
  })

  // Model, effort and output speed of each main-loop response, timed from its first streamed piece.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const effort = e.effort === undefined ? null : String(e.effort)
    let firstAt: number | null = null
    const chunks = next(e)
    while (true) {
      const step = await chunks.next()
      if (step.done) {
        return step.value
      }
      const chunk = step.value
      if (firstAt === null && chunk.kind !== 'engine' && chunk.kind !== 'stop') {
        firstAt = Date.now()
      }
      if (chunk.kind === 'stop') {
        const ms = firstAt === null ? 0 : Date.now() - firstAt
        void recordStream($, chunk.usage?.model || e.model, effort, chunk.usage?.output_tokens ?? 0, ms).catch(() => undefined)
      }
      yield chunk
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = result.usage ?? e.usage
    if (usage) {
      await update($, fallback, held => ({
        uncached: (held?.uncached ?? 0) + usage.input_tokens,
        cacheWrite: (held?.cacheWrite ?? 0) + usage.cache_creation_input_tokens,
        cacheWrite1h: 0,
        cacheWrite5m: 0,
        output: (held?.output ?? 0) + usage.output_tokens,
        thinking: 0,
        cacheRead: (held?.cacheRead ?? 0) + usage.cache_read_input_tokens,
        webSearches: 0,
        webFetches: 0,
        requests: (held?.requests ?? 0) + 1,
        isEstimate: true,
      }))
    }
    if (e.agentId === undefined) {
      const startCost = turnStarts.get(e.turnId) ?? null
      turnStarts.clear()
      await update($, activity, held => ({
        ...held,
        lastTurn: { durationMs: e.durationMs, output: usage?.output_tokens ?? 0, startCost, endCost: null },
      }))
    }
    void countTokens($).catch(() => undefined)

    return result
  })

  on('tool.call', async ($, e, next) => {
    const isAgent = AGENT_TOOLS.has(e.tool)
    if (isAgent) {
      await update($, activity, held => ({ ...held, agentsRunning: held.agentsRunning + 1 }))
    }
    try {
      const result = await next(e)
      const isFailed = result.deny !== undefined || result.isError === true
      await update($, activity, held => ({
        ...held,
        toolCalls: held.toolCalls + 1,
        toolFailures: held.toolFailures + (isFailed ? 1 : 0),
        byTool: { ...held.byTool, [e.tool]: (held.byTool[e.tool] ?? 0) + 1 },
      }))

      return result
    } finally {
      if (isAgent) {
        await update($, activity, held => ({ ...held, agentsRunning: Math.max(0, held.agentsRunning - 1) }))
      }
    }
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.messages) {
      const freed =
        result.tokensBefore !== undefined && result.tokensAfter !== undefined
          ? Math.max(0, result.tokensBefore - result.tokensAfter)
          : 0
      await update($, activity, held => ({
        ...held,
        compactions: held.compactions + 1,
        compactionFreed: held.compactionFreed + freed,
      }))
    }

    return result
  })

  on('command.run', { command: 'usage-band' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = verb.toLowerCase()
    if (arg === 'hide') {
      await update($, isHidden, () => true)
      await $.store.set(HIDDEN_KEY, true)

      return { text: 'Usage band hidden. Bring it back with /usage-band show' }
    }
    if (arg === 'show') {
      await update($, isHidden, () => false)
      await $.store.set(HIDDEN_KEY, false)

      return { text: 'Usage band shown.' }
    }
    if (arg === 'settings') {
      await $.ui.open({ id: SETTINGS_PANE, title: 'Usage band settings' })

      return { text: describeSettings() }
    }
    if (arg === 'set') {
      const [name = '', value = ''] = rest

      return { text: await setValue($, name, value.toLowerCase()) }
    }
    if (arg === 'on' || arg === 'off') {
      const names = rest.join(' ').split(',').map(word => word.trim()).filter(Boolean)
      if (names.length === 0) {
        return { text: `Usage: /usage-band ${arg} <pill>[, <pill>...]  (e.g. git, cost-rate, thinking)` }
      }
      const lines: string[] = []
      for (const name of names) {
        const field = findSetting(name)
        const problem = field ? await setOption($, field, arg === 'on') : `unknown pill "${name}"`
        lines.push(problem ? `${name}: ${problem}` : `${name}: ${arg}`)
      }

      return { text: lines.join('\n') }
    }
    if (arg !== '') {
      return { text: USAGE }
    }

    await refresh($, true)
    const groups = await currentPills($)
    const parts = groups.map(group =>
      group
        .map(one =>
          isBar(one)
            ? `${one.label} ${formatPercent(one.percent)}${one.remaining ? ` (${one.remaining})` : ''}${one.isAtRisk ? ' !' : ''}`
            : compactText(one),
        )
        .join(' · '),
    )
    const text = parts.length > 0 ? parts.join(' | ') : 'No usage data yet (it arrives with the first model response).'
    const note = groups.some(group => group.some(one => one.kind === 'cost')) ? ' (cost at API list prices)' : ''

    return { text: `${text}${note}` }
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const mark = (isOn: boolean) => (isOn ? '[x]' : '[ ]')
    const refreshNext = nextOf(REFRESH_CHOICES, settings.refreshSeconds)
    const warnNext = nextOf(WARN_CHOICES, settings.warnAt)
    const hotNext = nextOf(HOT_CHOICES, settings.hotAt)
    const layoutNext = nextOf(LAYOUTS, settings.layout)

    return (
      <Box flexDirection="column">
        <Text bold>Pills</Text>
        {TOGGLES.map(one => (
          <Button
            key={one.field}
            plain
            label={`${mark(settings[one.field])} ${one.title}`}
            onPress={() => setOption($, one.field, !settings[one.field])}
          />
        ))}
        <Text bold>Options</Text>
        {SWITCHES.map(one => (
          <Button
            key={one.field}
            plain
            label={`${mark(settings[one.field])} ${one.title}`}
            onPress={() => setOption($, one.field, !settings[one.field])}
          />
        ))}
        <Button
          key="layout"
          plain
          label={`Layout: ${settings.layout} (press for ${layoutNext})`}
          onPress={() => setOption($, 'layout', layoutNext)}
        />
        <Button
          key="warnAt"
          plain
          label={`Yellow from ${settings.warnAt}% (press for ${warnNext}%)`}
          onPress={() => setOption($, 'warnAt', warnNext)}
        />
        <Button
          key="hotAt"
          plain
          label={`Red from ${settings.hotAt}% (press for ${hotNext}%)`}
          onPress={() => setOption($, 'hotAt', hotNext)}
        />
        <Button
          key="refreshSeconds"
          plain
          label={`Refresh every ${settings.refreshSeconds}s (press for ${refreshNext}s)`}
          onPress={() => setOption($, 'refreshSeconds', refreshNext)}
        />
        <Text dimColor>Each change is saved to your settings and reloads the band.</Text>
        <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: SETTINGS_PANE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }
    if (e.surface === 'terminal' && !settings.showInTerminal) {
      return next(e)
    }
    const groups = await currentPills($)
    if (groups.length === 0) {
      return next(e)
    }
    const look = lookOf(settings)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const pill = (one: Pill) => {
        const color = TERMINAL_COLORS[one.kind]
        if (isBar(one)) {
          const level = TERMINAL_BAR[barLevel(one.percent, look)]
          const { cells, mark } = terminalBar(one.percent, one.elapsed)

          return (
            <Box key={one.key} flexDirection="row">
              <Text color={color}>
                {look.isCompact ? '' : `${TERMINAL_ICONS[one.kind]} `}
                {one.label}{' '}
              </Text>
              {!look.isCompact &&
                cells.map((cell, i) =>
                  i === mark ? (
                    <Text key={`c${i}`} bold>
                      │
                    </Text>
                  ) : (
                    <Text key={`c${i}`} color={cell === '█' ? level : undefined} dimColor={cell !== '█'}>
                      {cell}
                    </Text>
                  ),
                )}
              <Text color={look.isCompact ? level : color} bold>
                {look.isCompact ? '' : ' '}
                {formatPercent(one.percent)}
              </Text>
              {one.isAtRisk && (
                <Text color={TERMINAL_BAR.high} bold>
                  {' '}!
                </Text>
              )}
              {one.remaining !== null && (
                <Text dimColor>
                  {' · '}
                  {look.isCompact ? '' : '⏱ '}
                  {one.remaining}
                </Text>
              )}
            </Box>
          )
        }

        return (
          <Box key={one.key} flexDirection="row">
            {!look.isCompact && <Text color={color}>{TERMINAL_ICONS[one.kind]} </Text>}
            <Text color={color} bold>
              {look.isCompact ? compactText(one) : one.value}
            </Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {groups.map((group, i) => (
            <Box key={`g${i}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
              {group.map(pill)}
            </Box>
          ))}
        </Box>
      )
    }

    const { Box, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
        {groups.map((group, i) => (
          <Box key={`g${i}`} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
            {group.map(one => {
              const drawing = pillSvg(one, look)

              return (
                <Svg
                  key={drawing.key}
                  source={drawing.svg}
                  alt={drawing.alt}
                  width={drawing.width}
                  height={24}
                  isInteractive
                />
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
