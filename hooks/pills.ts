// The band's model and its desktop drawing: plain functions, no `$`, so the
// same code draws the pills in the engine and in a preview page.
import type {
  UsageActivity,
  UsageLimit,
  UsageSession,
  UsageSnapshot,
  UsageStream,
  UsageTokens,
  UsageTranscript,
} from '../types'

// ---- Settings ----

export type Toggle =
  | 'show5h'
  | 'show7d'
  | 'showSpendLimit'
  | 'showContext'
  | 'showInput'
  | 'showOutput'
  | 'showThinking'
  | 'showCacheRead'
  | 'showCacheHit'
  | 'showWeb'
  | 'showRequests'
  | 'showSpeed'
  | 'showCost'
  | 'showCostRate'
  | 'showLastTurn'
  | 'showTools'
  | 'showChurn'
  | 'showAgents'
  | 'showCompactions'
  | 'showPrompts'
  | 'showSessionAge'
  | 'showModel'
  | 'showEffort'
  | 'showFolder'
  | 'showGit'
  | 'showMemory'

export type Switch = 'limitProjection' | 'contextBreakdown' | 'alerts' | 'showInTerminal'

export type Layout = 'full' | 'compact'

/** What the drawing needs from the settings: thresholds and layout. */
export type Look = { warnAt: number; hotAt: number; isCompact: boolean }

export type Settings = Record<Toggle | Switch, boolean> & {
  refreshSeconds: number
  warnAt: number
  hotAt: number
  layout: Layout
}

export type SettingInfo<F extends string> = { field: F; title: string; description: string }

/** Every pill's switch, in the band's order; the manifest's userConfig mirrors it. */
export const TOGGLES: readonly SettingInfo<Toggle>[] = [
  { field: 'show5h', title: '5-hour limit', description: 'Usage of the 5-hour rate-limit window and time to reset' },
  { field: 'show7d', title: '7-day limit', description: 'Usage of the 7-day rate-limit window and time to reset' },
  { field: 'showSpendLimit', title: 'Spend limit', description: "A gateway's spend limit, when the account reports one" },
  { field: 'showContext', title: 'Context window', description: 'How full the context window is' },
  { field: 'showInput', title: 'Input tokens', description: 'Uncached input plus cache writes' },
  { field: 'showOutput', title: 'Output tokens', description: 'Tokens the model generated' },
  { field: 'showThinking', title: 'Thinking tokens', description: 'The part of output spent on extended thinking' },
  { field: 'showCacheRead', title: 'Cache read tokens', description: 'Input tokens served from the prompt cache' },
  { field: 'showCacheHit', title: 'Cache hit rate', description: 'Share of all input read from the prompt cache' },
  { field: 'showWeb', title: 'Web searches and fetches', description: 'Server-side web search and fetch requests' },
  { field: 'showRequests', title: 'API requests', description: 'Model requests, subagents included' },
  { field: 'showSpeed', title: 'Output speed', description: 'Tokens per second of the last response (hover for the average)' },
  { field: 'showCost', title: 'Session cost', description: 'Session cost at API list prices' },
  { field: 'showCostRate', title: 'Cost per hour', description: 'Average spend per hour since the session started' },
  { field: 'showLastTurn', title: 'Last turn', description: 'Duration, cost and output speed of the last turn' },
  { field: 'showTools', title: 'Tool calls', description: 'Tool calls, failures and the most used tools' },
  { field: 'showChurn', title: 'Lines changed', description: 'Lines added and removed by Edit, MultiEdit and Write' },
  { field: 'showAgents', title: 'Running subagents', description: 'Subagents running right now' },
  { field: 'showCompactions', title: 'Compactions', description: 'How often the context was compacted and what it freed' },
  { field: 'showPrompts', title: 'Prompts', description: 'Prompts sent this session' },
  { field: 'showSessionAge', title: 'Session age', description: 'Time since the session started' },
  { field: 'showModel', title: 'Model', description: 'The model that answered last, and the Claude Code version' },
  { field: 'showEffort', title: 'Thinking effort', description: 'The thinking effort of the last request (low to max)' },
  { field: 'showFolder', title: 'Folder', description: "The working directory's name (hover for the full path)" },
  { field: 'showGit', title: 'Git branch', description: 'Branch, uncommitted files, ahead and behind' },
  { field: 'showMemory', title: 'Machine memory', description: "This machine's memory in use" },
]

export const SWITCHES: readonly SettingInfo<Switch>[] = [
  {
    field: 'limitProjection',
    title: 'Limit projection',
    description: 'Project 5h/7d usage at reset from the pace so far and warn when it would pass 100%',
  },
  {
    field: 'contextBreakdown',
    title: 'Context breakdown',
    description: 'List what fills the context in the context tooltip (estimated locally)',
  },
  { field: 'alerts', title: 'Limit alerts', description: 'A toast when a limit crosses the yellow or red threshold' },
  {
    field: 'showInTerminal',
    title: 'Show in the terminal',
    description: 'Off to show the band only in the desktop app',
  },
]

export const LAYOUTS: readonly Layout[] = ['full', 'compact']

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)

  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  const settings = {
    refreshSeconds: clampNumber(options.refreshSeconds, 30, 10, 600),
    warnAt: clampNumber(options.warnAt, 70, 1, 100),
    hotAt: clampNumber(options.hotAt, 90, 1, 100),
    layout: options.layout === 'compact' ? 'compact' : 'full',
  } as Settings
  for (const { field } of [...TOGGLES, ...SWITCHES]) {
    settings[field] = options[field] !== false
  }

  return settings
}

export function lookOf(settings: Settings): Look {
  return { warnAt: settings.warnAt, hotAt: settings.hotAt, isCompact: settings.layout === 'compact' }
}

// ---- Pills ----

export type BarKind = 'fiveHour' | 'sevenDay' | 'spendLimit' | 'context'

export type ValueKind =
  | 'input'
  | 'output'
  | 'thinking'
  | 'cache'
  | 'cacheHit'
  | 'web'
  | 'requests'
  | 'speed'
  | 'cost'
  | 'costRate'
  | 'lastTurn'
  | 'tools'
  | 'churn'
  | 'agents'
  | 'compactions'
  | 'prompts'
  | 'age'
  | 'model'
  | 'effort'
  | 'folder'
  | 'git'
  | 'memory'

export type PillKind = BarKind | ValueKind

export type BarPill = {
  kind: BarKind
  key: string
  label: string
  percent: number
  /** 0..1: how much of the window has passed; null without a reset time. */
  elapsed: number | null
  remaining: string | null
  /** The pace so far would pass 100% before the window resets. */
  isAtRisk: boolean
  title: string
}

export type ValuePill = {
  kind: ValueKind
  key: string
  value: string
  title: string
}

export type Pill = BarPill | ValuePill

export function isBar(pill: Pill): pill is BarPill {
  return pill.kind === 'fiveHour' || pill.kind === 'sevenDay' || pill.kind === 'spendLimit' || pill.kind === 'context'
}

export type BandData = {
  snapshot: UsageSnapshot | null
  tokens: UsageTokens | null
  transcript: UsageTranscript | null
  activity: UsageActivity | null
  stream: UsageStream | null
  session: UsageSession | null
  now: number
  settings: Settings
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WINDOWS: Partial<Record<BarKind, number>> = { fiveHour: 5 * HOUR, sevenDay: 7 * DAY }

export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(Math.round(n))
  }
  if (n < 999_950) {
    return `${(n / 1000).toFixed(1)}k`
  }

  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Time to a reset: `2h 40m`, `1d 7h`, `12m`. */
export function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }

  return `${minutes}m`
}

/** A span that may be short: `42s`, `3m 12s`, `1h 5m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  return formatRemaining(ms)
}

export function formatPercent(n: number): string {
  return `${Math.round(n)}%`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`
}

export function barLevel(percent: number, look: Look): 'ok' | 'warn' | 'high' {
  if (percent >= look.hotAt) {
    return 'high'
  }

  return percent >= look.warnAt ? 'warn' : 'ok'
}

/** `mcp__plugin_playwright_playwright__browser_click` reads as `browser_click (mcp)`. */
function toolName(name: string): string {
  return name.startsWith('mcp__') ? `${name.split('__').at(-1)} (mcp)` : name
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path
}

const LIMIT_NAMES = { fiveHour: '5-hour window', sevenDay: '7-day window', spendLimit: 'Spend limit' } as const
const LIMIT_LABELS = { fiveHour: '5h', sevenDay: '7d', spendLimit: 'spend' } as const

function limitPill(kind: 'fiveHour' | 'sevenDay' | 'spendLimit', limit: UsageLimit, now: number, isProjected: boolean): BarPill {
  const span = WINDOWS[kind] ?? null
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  const left = Number.isFinite(resetsAt) && now > 0 ? Math.max(0, resetsAt - now) : null
  const elapsed = left === null || span === null ? null : Math.min(1, Math.max(0, 1 - left / span))
  const remaining = left === null ? null : formatRemaining(left)
  const lines = [`${LIMIT_NAMES[kind]}: ${formatPercent(limit.percent)} used`]
  let isAtRisk = false
  if (remaining !== null) {
    lines.push(`Resets in: ${remaining}`)
  }
  if (elapsed !== null && span !== null) {
    lines.push(`${formatPercent(elapsed * 100)} of the window has passed (vertical line)`)
    if (isProjected && elapsed >= 0.05 && limit.percent > 0) {
      const atReset = limit.percent / elapsed
      isAtRisk = atReset >= 100 && limit.percent < 100
      const perMs = limit.percent / (elapsed * span)
      const toFull = (100 - limit.percent) / perMs
      lines.push(
        isAtRisk
          ? `At this pace: 100% in ${formatRemaining(toFull)}, before the reset`
          : `At this pace: about ${formatPercent(atReset)} by the reset`,
      )
    }
  }

  return {
    kind,
    key: kind,
    label: LIMIT_LABELS[kind],
    percent: limit.percent,
    elapsed,
    remaining,
    isAtRisk,
    title: lines.join('\n'),
  }
}

function contextPill(snapshot: UsageSnapshot): BarPill | null {
  if (!snapshot.contextWindow) {
    return null
  }
  const used = snapshot.contextTokens ?? 0
  const percent = snapshot.contextPercent ?? (used / snapshot.contextWindow) * 100
  const lines = [`Context: ${formatTokens(used)} / ${formatTokens(snapshot.contextWindow)} (${formatPercent(percent)})`]
  if (snapshot.autoCompactAt) {
    lines.push(`Auto-compact at ${formatTokens(snapshot.autoCompactAt)}`)
  }
  if (snapshot.contextCategories && snapshot.contextCategories.length > 0) {
    lines.push('What fills it (estimate):')
    for (const one of snapshot.contextCategories.slice(0, 8)) {
      lines.push(`  ${one.name}: ${formatTokens(one.tokens)}`)
    }
  }

  return {
    kind: 'context',
    key: 'context',
    label: 'ctx',
    percent,
    elapsed: null,
    remaining: null,
    isAtRisk: false,
    title: lines.join('\n'),
  }
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/, ' 1M')
}

/** The pills to draw, in their groups; an empty group is left out. */
export function buildPills(band: BandData): Pill[][] {
  const { snapshot, tokens, transcript, activity, stream, session, now, settings: on } = band

  const limits: Pill[] = []
  if (on.show5h && snapshot?.fiveHour) {
    limits.push(limitPill('fiveHour', snapshot.fiveHour, now, on.limitProjection))
  }
  if (on.show7d && snapshot?.sevenDay) {
    limits.push(limitPill('sevenDay', snapshot.sevenDay, now, on.limitProjection))
  }
  if (on.showSpendLimit && snapshot?.spendLimit) {
    limits.push(limitPill('spendLimit', snapshot.spendLimit, now, false))
  }
  const context = on.showContext && snapshot ? contextPill(snapshot) : null
  if (context) {
    limits.push(context)
  }

  const counts: Pill[] = []
  if (tokens && tokens.requests > 0) {
    const mark = tokens.isEstimate ? '~' : ''
    const input = tokens.uncached + tokens.cacheWrite
    const allInput = input + tokens.cacheRead
    const footer: string[] = []
    if (snapshot?.contextWindow) {
      const used = snapshot.contextTokens ?? 0
      const percent = snapshot.contextPercent ?? (used / snapshot.contextWindow) * 100
      footer.push(`Context: ${formatTokens(used)} / ${formatTokens(snapshot.contextWindow)} (${formatPercent(percent)})`)
    }
    footer.push(
      tokens.isEstimate
        ? `${tokens.requests} turns (estimate: transcript not readable)`
        : `${tokens.requests} requests (subagents included)`,
    )
    if (on.showInput) {
      const ttl =
        tokens.cacheWrite1h + tokens.cacheWrite5m > 0
          ? [`    1-hour TTL: ${formatTokens(tokens.cacheWrite1h)}`, `    5-minute TTL: ${formatTokens(tokens.cacheWrite5m)}`]
          : []
      counts.push({
        kind: 'input',
        key: 'input',
        value: `${mark}${formatTokens(input)}`,
        title: [
          `Input: ${formatTokens(input)}`,
          `  uncached: ${formatTokens(tokens.uncached)}`,
          `  cache write: ${formatTokens(tokens.cacheWrite)}`,
          ...ttl,
          ...footer,
        ].join('\n'),
      })
    }
    if (on.showOutput) {
      const thinking =
        tokens.thinking > 0
          ? [`  thinking: ${formatTokens(tokens.thinking)}`, `  visible: ${formatTokens(tokens.output - tokens.thinking)}`]
          : []
      counts.push({
        kind: 'output',
        key: 'output',
        value: `${mark}${formatTokens(tokens.output)}`,
        title: [`Output: ${formatTokens(tokens.output)}`, ...thinking, ...footer].join('\n'),
      })
    }
    if (on.showThinking && tokens.thinking > 0) {
      const share = tokens.output > 0 ? (tokens.thinking / tokens.output) * 100 : 0
      counts.push({
        kind: 'thinking',
        key: 'thinking',
        value: `${mark}${formatTokens(tokens.thinking)}`,
        title: `Thinking: ${formatTokens(tokens.thinking)} (${formatPercent(share)} of output)`,
      })
    }
    if (on.showCacheRead) {
      counts.push({
        kind: 'cache',
        key: 'cache',
        value: `${mark}${formatTokens(tokens.cacheRead)}`,
        title: [`Cache read: ${formatTokens(tokens.cacheRead)}`, ...footer].join('\n'),
      })
    }
    if (on.showCacheHit && allInput > 0) {
      const hit = (tokens.cacheRead / allInput) * 100
      counts.push({
        kind: 'cacheHit',
        key: 'cacheHit',
        value: formatPercent(hit),
        title: `Cache hit rate: ${formatPercent(hit)}\n${formatTokens(tokens.cacheRead)} of ${formatTokens(allInput)} input tokens came from the cache`,
      })
    }
    const web = tokens.webSearches + tokens.webFetches
    if (on.showWeb && web > 0) {
      counts.push({
        kind: 'web',
        key: 'web',
        value: String(web),
        title: `Web searches: ${tokens.webSearches}\nWeb fetches: ${tokens.webFetches}`,
      })
    }
    if (on.showRequests) {
      counts.push({
        kind: 'requests',
        key: 'requests',
        value: `${mark}${tokens.requests}`,
        title: [
          tokens.isEstimate ? `Turns: ${tokens.requests} (estimate)` : `API requests: ${tokens.requests} (subagents included)`,
          `Average input: ${formatTokens(allInput / tokens.requests)}`,
          `Average output: ${formatTokens(tokens.output / tokens.requests)}`,
        ].join('\n'),
      })
    }
  }
  if (on.showSpeed && stream?.lastTps != null) {
    const average = stream.ms > 0 ? (stream.tokens / stream.ms) * 1000 : stream.lastTps
    counts.push({
      kind: 'speed',
      key: 'speed',
      value: `${Math.round(stream.lastTps)} t/s`,
      title: [
        `Last response: ${stream.lastTps.toFixed(1)} tokens/s (from its first streamed piece)`,
        `Average: ${average.toFixed(1)} tokens/s over ${stream.responses} responses since the band loaded`,
      ].join('\n'),
    })
  }

  const money: Pill[] = []
  if (snapshot?.costUsd != null) {
    const cost = snapshot.costUsd
    if (on.showCost) {
      const perRequest =
        tokens && tokens.requests > 0 && !tokens.isEstimate ? [`Average per request: $${(cost / tokens.requests).toFixed(3)}`] : []
      money.push({
        kind: 'cost',
        key: 'cost',
        value: formatUsd(cost),
        title: [`Session cost: $${cost.toFixed(4)}`, ...perRequest, 'At API list prices; not what a subscription actually pays'].join('\n'),
      })
    }
    const age = session?.startedAt && now > session.startedAt ? now - session.startedAt : 0
    if (on.showCostRate && age >= 5 * MINUTE) {
      money.push({
        kind: 'costRate',
        key: 'costRate',
        value: `${formatUsd(cost / (age / HOUR))}/h`,
        title: `Average spend per hour since the session started (${formatRemaining(age)} ago)\nAt API list prices`,
      })
    }
  }

  const work: Pill[] = []
  const turn = activity?.lastTurn
  if (on.showLastTurn && turn) {
    const cost = turn.startCost !== null && turn.endCost !== null ? Math.max(0, turn.endCost - turn.startCost) : null
    const speed = turn.durationMs > 0 ? turn.output / (turn.durationMs / 1000) : 0
    work.push({
      kind: 'lastTurn',
      key: 'lastTurn',
      value: cost === null ? formatDuration(turn.durationMs) : `${formatDuration(turn.durationMs)} · ${formatUsd(cost)}`,
      title: [
        `Last turn: ${formatDuration(turn.durationMs)}`,
        `Output: ${formatTokens(turn.output)} tokens (${Math.round(speed)} tokens/s over the whole turn)`,
        ...(cost === null ? [] : [`Cost: $${cost.toFixed(4)} (subagents included, API list prices)`]),
      ].join('\n'),
    })
  }
  // The transcript counts the whole session; the live hook only since the band loaded.
  const tools = transcript ?? (activity ? { ...activity, isLive: true } : null)
  if (on.showTools && tools && tools.toolCalls > 0) {
    const top = Object.entries(tools.byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => `  ${toolName(name)}: ${count}`)
    work.push({
      kind: 'tools',
      key: 'tools',
      value: tools.toolFailures > 0 ? `${tools.toolCalls} · ${tools.toolFailures}✗` : String(tools.toolCalls),
      title: [
        `Tool calls: ${tools.toolCalls} (${transcript ? 'this session' : 'since the band loaded'}, subagents included)`,
        `Failed or denied: ${tools.toolFailures}`,
        'Most used:',
        ...top,
      ].join('\n'),
    })
  }
  if (on.showChurn && transcript && transcript.linesAdded + transcript.linesRemoved > 0) {
    work.push({
      kind: 'churn',
      key: 'churn',
      value: `+${transcript.linesAdded} −${transcript.linesRemoved}`,
      title: [
        `Lines added: ${transcript.linesAdded}`,
        `Lines removed: ${transcript.linesRemoved}`,
        `Files touched: ${transcript.filesChanged}`,
        'By Edit, MultiEdit and Write this session; failed calls left out',
      ].join('\n'),
    })
  }
  if (on.showAgents && activity && activity.agentsRunning > 0) {
    work.push({
      kind: 'agents',
      key: 'agents',
      value: String(activity.agentsRunning),
      title: `Subagents running now: ${activity.agentsRunning}`,
    })
  }
  if (on.showCompactions && activity && activity.compactions > 0) {
    work.push({
      kind: 'compactions',
      key: 'compactions',
      value: String(activity.compactions),
      title: `Compactions: ${activity.compactions} (since the band loaded)\nTokens freed: ${formatTokens(activity.compactionFreed)}`,
    })
  }
  if (on.showPrompts && session?.prompts) {
    work.push({ kind: 'prompts', key: 'prompts', value: String(session.prompts), title: `Prompts sent this session: ${session.prompts}` })
  }

  const about: Pill[] = []
  if (on.showSessionAge && session?.startedAt && now > session.startedAt) {
    about.push({
      kind: 'age',
      key: 'age',
      value: formatRemaining(now - session.startedAt),
      title: `Session started ${formatRemaining(now - session.startedAt)} ago`,
    })
  }
  const model = stream?.model ?? session?.model ?? null
  if (on.showModel && model) {
    about.push({
      kind: 'model',
      key: 'model',
      value: shortModel(model),
      title: [`Model that answered last: ${model}`, ...(session?.version ? [`Claude Code ${session.version}`] : [])].join('\n'),
    })
  }
  if (on.showEffort && stream?.effort) {
    about.push({ kind: 'effort', key: 'effort', value: stream.effort, title: `Thinking effort of the last request: ${stream.effort}` })
  }
  if (on.showFolder && session?.cwd) {
    about.push({ kind: 'folder', key: 'folder', value: baseName(session.cwd), title: `Working directory: ${session.cwd}` })
  }
  if (on.showGit && session?.git) {
    const git = session.git
    const marks = [git.dirty > 0 ? `±${git.dirty}` : '', git.ahead > 0 ? `↑${git.ahead}` : '', git.behind > 0 ? `↓${git.behind}` : '']
      .filter(Boolean)
      .join(' ')
    about.push({
      kind: 'git',
      key: 'git',
      value: marks ? `${git.branch} ${marks}` : git.branch,
      title: [`Branch: ${git.branch}`, `Uncommitted files: ${git.dirty}`, `Ahead: ${git.ahead}, behind: ${git.behind}`].join('\n'),
    })
  }
  if (on.showMemory && session?.memory && session.memory.total > 0) {
    const used = session.memory.total - session.memory.free
    const percent = (used / session.memory.total) * 100
    about.push({
      kind: 'memory',
      key: 'memory',
      value: `${formatGiB(used)}/${formatGiB(session.memory.total)}`,
      title: `Machine memory in use: ${formatGiB(used)} of ${formatGiB(session.memory.total)} (${formatPercent(percent)})`,
    })
  }

  return [limits, counts, money, work, about].filter(group => group.length > 0)
}

// ---- Desktop: one SVG document per pill ----

type Palette = { bg: string; fg: string; darkBg: string; darkFg: string }

const PALETTE = {
  teal: { bg: '#d3f4ec', fg: '#0b4f45', darkBg: '#113d37', darkFg: '#9eecd9' },
  purple: { bg: '#ebe2fb', fg: '#47247d', darkBg: '#2f2249', darkFg: '#d7c5fb' },
  orange: { bg: '#fde5d0', fg: '#7a3808', darkBg: '#44280f', darkFg: '#f7bf8c' },
  red: { bg: '#fbe0dd', fg: '#7d2018', darkBg: '#46211d', darkFg: '#f6b4ac' },
  green: { bg: '#d9f2da', fg: '#1d5c22', darkBg: '#1c3b20', darkFg: '#a6e2a9' },
  lime: { bg: '#e8f5cf', fg: '#3d5208', darkBg: '#2c3610', darkFg: '#cfe89a' },
  pink: { bg: '#f8def0', fg: '#6e1d57', darkBg: '#3f1c36', darkFg: '#f0b2dd' },
  blue: { bg: '#dce8fb', fg: '#1b407c', darkBg: '#1b2d49', darkFg: '#a8c7f6' },
  sky: { bg: '#d7eff9', fg: '#0c4a63', darkBg: '#113240', darkFg: '#9ad7ef' },
  gold: { bg: '#f9eec6', fg: '#6c4e00', darkBg: '#3e3211', darkFg: '#f1d37b' },
  slate: { bg: '#e2e7ef', fg: '#2a3850', darkBg: '#252f41', darkFg: '#c0cce0' },
  indigo: { bg: '#e2e4fb', fg: '#2e3480', darkBg: '#23264a', darkFg: '#bcc1f7' },
  neutral: { bg: '#ebe9e3', fg: '#3b3a36', darkBg: '#34332f', darkFg: '#d8d6cd' },
} satisfies Record<string, Palette>

const PALETTES: Record<PillKind, Palette> = {
  fiveHour: PALETTE.teal,
  sevenDay: PALETTE.purple,
  spendLimit: PALETTE.gold,
  context: PALETTE.orange,
  input: PALETTE.red,
  output: PALETTE.green,
  thinking: PALETTE.pink,
  cache: PALETTE.blue,
  cacheHit: PALETTE.blue,
  web: PALETTE.sky,
  requests: PALETTE.neutral,
  speed: PALETTE.lime,
  cost: PALETTE.gold,
  costRate: PALETTE.gold,
  lastTurn: PALETTE.slate,
  tools: PALETTE.slate,
  churn: PALETTE.green,
  agents: PALETTE.indigo,
  compactions: PALETTE.orange,
  prompts: PALETTE.neutral,
  age: PALETTE.neutral,
  model: PALETTE.neutral,
  effort: PALETTE.pink,
  folder: PALETTE.neutral,
  git: PALETTE.slate,
  memory: PALETTE.neutral,
}

const BAR = {
  ok: { light: '#1f9d55', dark: '#4cc97f' },
  warn: { light: '#d49a00', dark: '#f0c23b' },
  high: { light: '#d93b40', dark: '#ff6b6f' },
}

const ICONS: Record<PillKind, string> = {
  // gauge: an arc and its needle
  fiveHour:
    '<path class="st" d="M2 10.5a5 5 0 0 1 10 0"/><path class="st" d="M7 10.5l2.6-3.4"/><circle class="fg" cx="7" cy="10.5" r="1.1"/>',
  sevenDay:
    '<rect class="st" x="1.8" y="2.8" width="10.4" height="9.4" rx="1.6"/><path class="st" d="M1.8 5.8h10.4M4.6 1.5v2.6M9.4 1.5v2.6"/><path class="st" d="M4.4 8.3h1M6.5 8.3h1M8.6 8.3h1M4.4 10.2h1M6.5 10.2h1"/>',
  // wallet
  spendLimit:
    '<rect class="st" x="1.8" y="3.4" width="10.4" height="8" rx="1.6"/><path class="st" d="M1.8 5.6h8.6M9.2 8.4h1.2"/>',
  // a half-filled circle
  context: '<circle class="st" cx="7" cy="7" r="5.2"/><path class="fg" d="M7 1.8a5.2 5.2 0 0 1 0 10.4Z"/>',
  input: '<path class="st" d="M7 12V2.4M3 6.2 7 2.2l4 4"/>',
  output: '<path class="st" d="M7 2v9.6M3 7.8l4 4 4-4"/>',
  // light bulb
  thinking:
    '<path class="st" d="M5.2 10.4h3.6M5.8 12.4h2.4M5 8.9C4 8.2 3.3 7.1 3.3 5.8 3.3 3.8 5 2.1 7 2.1s3.7 1.7 3.7 3.7c0 1.3-.7 2.4-1.7 3.1"/>',
  // layers
  cache:
    '<path class="st" d="M7 1.8 12.4 4.6 7 7.4 1.6 4.6Z"/><path class="st" d="M1.6 7.2 7 10l5.4-2.8M1.6 9.6 7 12.4l5.4-2.8"/>',
  // target
  cacheHit: '<circle class="st" cx="7" cy="7" r="5.2"/><circle class="st" cx="7" cy="7" r="2.4"/><circle class="fg" cx="7" cy="7" r=".9"/>',
  // globe
  web: '<circle class="st" cx="7" cy="7" r="5.2"/><path class="st" d="M1.8 7h10.4M7 1.8c1.6 1.5 2.4 3.3 2.4 5.2S8.6 10.7 7 12.2M7 1.8C5.4 3.3 4.6 5.1 4.6 7s.8 3.7 2.4 5.2"/>',
  // two opposing arrows
  requests: '<path class="st" d="M2.5 4.6h8.5M8.6 2.2 11 4.6 8.6 7M11.5 9.4H3M5.4 7 3 9.4l2.4 2.4"/>',
  // lightning bolt
  speed: '<path class="st" d="M8 1.6 3.4 7.8h3.6L6 12.4l4.6-6.2H7Z"/>',
  cost: '<path class="st" d="M10 4.3c-.5-.9-1.6-1.4-2.9-1.4-1.6 0-2.8.8-2.8 2 0 2.6 5.8 1.4 5.8 4.2 0 1.2-1.3 2-2.9 2-1.4 0-2.6-.6-3.1-1.6M7 1.2v11.6"/>',
  // a rising line
  costRate: '<path class="st" d="M1.8 10.8 5.2 7.4l2.4 2.2 4.6-5M9.2 4.6h3v3"/>',
  // hourglass
  lastTurn:
    '<path class="st" d="M3.5 1.8h7M3.5 12.2h7M4.3 1.8c0 2.6 2.7 3.6 2.7 5.2S4.3 9.6 4.3 12.2M9.7 1.8c0 2.6-2.7 3.6-2.7 5.2s2.7 2.6 2.7 5.2"/>',
  // wrench
  tools: '<path class="st" d="M8.6 2.2a3 3 0 0 0-3.2 4.1L1.9 9.8a1.3 1.3 0 0 0 1.8 1.8l3.5-3.5a3 3 0 0 0 4.1-3.2L9.6 6.6 7.9 6.1 7.4 4.4Z"/>',
  // plus over minus
  churn: '<path class="st" d="M4.4 2.4v4.4M2.2 4.6h4.4M7.6 10h4.2"/><path class="st" d="M11.6 2.4 2.4 11.6" opacity=".45"/>',
  // robot head
  agents:
    '<rect class="st" x="2.4" y="4.4" width="9.2" height="7.2" rx="2"/><path class="st" d="M7 4.4V2.6M5.3 7.8v.6M8.7 7.8v.6"/><circle class="fg" cx="7" cy="2" r=".9"/>',
  // two arrows pressing inward
  compactions: '<path class="st" d="M2 2l3.6 3.6M5.6 2.6v3H2.6M12 12 8.4 8.4M8.4 11.4v-3h3"/>',
  // speech bubble
  prompts:
    '<path class="st" d="M3.6 2.2h6.8a1.4 1.4 0 0 1 1.4 1.4v4.8a1.4 1.4 0 0 1-1.4 1.4H6.2l-2.6 2.2V9.8a1.4 1.4 0 0 1-1.4-1.4V3.6a1.4 1.4 0 0 1 1.4-1.4Z"/>',
  // clock
  age: '<circle class="st" cx="7" cy="7" r="5.2"/><path class="st" d="M7 4v3.2l2.2 1.4"/>',
  // chip
  model:
    '<rect class="st" x="3.6" y="3.6" width="6.8" height="6.8" rx="1.2"/><path class="st" d="M5.6 1.6v2M8.4 1.6v2M5.6 10.4v2M8.4 10.4v2M1.6 5.6h2M1.6 8.4h2M10.4 5.6h2M10.4 8.4h2"/>',
  // three rising bars
  effort: '<path class="st" d="M3 11.6V8.8M7 11.6V5.6M11 11.6V2.4"/>',
  // folder
  folder: '<path class="st" d="M1.8 4.2a1 1 0 0 1 1-1h2.8l1.2 1.4h4.4a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z"/>',
  // branch
  git: '<circle class="st" cx="4" cy="3" r="1.4"/><circle class="st" cx="4" cy="11" r="1.4"/><circle class="st" cx="10" cy="5" r="1.4"/><path class="st" d="M4 4.4v5.2M10 6.4c0 2.4-6 1.6-6 3.2"/>',
  // memory stick
  memory:
    '<rect class="st" x="1.6" y="3.8" width="10.8" height="5.6" rx="1"/><path class="st" d="M4 9.4v1.8M7 9.4v1.8M10 9.4v1.8M4.2 6.6h1.2M8.6 6.6h1.2"/>',
}

// stopwatch: the countdown to the reset
const COUNTDOWN =
  '<circle class="st" cx="6" cy="7" r="4.3"/><path class="st" d="M6 4.6V7l1.6 1.2M4.6 1.3h2.8M10 3.4l.9-.9"/>'

// a warning triangle with its mark
const WARNING = '<path class="wr" d="M6 1.4 11.2 10.8H.8Z"/><path class="wx" d="M6 4.8v3M6 9.2v.1"/>'

const FONT = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`
const SIZE = 12
const CHAR = SIZE * 0.61
const HEIGHT = 24
const BASELINE = 16.2

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function textWidth(text: string): number {
  return [...text].length * CHAR
}

/** The class a pill's root carries: every rule of its style is scoped under it. */
function scopeOf(kind: PillKind, bar?: keyof typeof BAR): string {
  return bar ? `ub-${kind}-${bar}` : `ub-${kind}`
}

/**
 * The pill's colors, every rule scoped under its root's class, so pills drawn
 * into one document (a preview page, a test) never restyle each other.
 */
function style(kind: PillKind, bar?: keyof typeof BAR): string {
  const p = PALETTES[kind]
  const fill = bar ? BAR[bar] : null
  const scope = `.${scopeOf(kind, bar)}`
  const rules = (list: [string, string][]) => list.map(([sel, body]) => `${scope} ${sel}{${body}}`).join('')
  const light = rules([
    ['text', `font-family:${FONT};font-size:${SIZE}px`],
    ['.b', 'font-weight:700'],
    ['.bg', `fill:${p.bg}`],
    ['.fg', `fill:${p.fg}`],
    ['.st', `stroke:${p.fg};fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round`],
    ['.tx', `fill:${p.fg}`],
    ['.tr', `fill:${p.fg};opacity:.18`],
    ['.sep', `stroke:${p.fg};opacity:.32`],
    ['.wr', `fill:${BAR.high.light}`],
    ['.wx', 'stroke:#fff;stroke-width:1.5;stroke-linecap:round'],
    ...(fill
      ? ([
          ['.bar', `fill:${fill.light}`],
          ['.mk', `stroke:${p.fg}`],
          ['.lv', `fill:${fill.light}`],
        ] as [string, string][])
      : []),
  ])
  const dark = rules([
    ['.bg', `fill:${p.darkBg}`],
    ['.fg', `fill:${p.darkFg}`],
    ['.st', `stroke:${p.darkFg}`],
    ['.tx', `fill:${p.darkFg}`],
    ['.tr', `fill:${p.darkFg};opacity:.2`],
    ['.sep', `stroke:${p.darkFg}`],
    ['.wr', `fill:${BAR.high.dark}`],
    ['.wx', `stroke:${p.darkBg}`],
    ...(fill
      ? ([
          ['.bar', `fill:${fill.dark}`],
          ['.mk', `stroke:${p.darkFg}`],
          ['.lv', `fill:${fill.dark}`],
        ] as [string, string][])
      : []),
  ])

  return `<style>${light}@media (prefers-color-scheme: dark){${dark}}</style>`
}

function frame(kind: PillKind, width: number, title: string, body: string, bar?: keyof typeof BAR): string {
  const w = Math.ceil(width)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${scopeOf(kind, bar)}" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}">` +
    `<title>${escapeXml(title)}</title>${style(kind, bar)}` +
    `<rect class="bg" x="0" y="0" width="${w}" height="${HEIGHT}" rx="${HEIGHT / 2}"/>` +
    `${body}</svg>`
  )
}

const icon = (svg: string, x: number, y: number) => `<g transform="translate(${x.toFixed(1)} ${y})">${svg}</g>`
const text = (value: string, x: number, className = 'tx') =>
  `<text class="${className}" x="${x.toFixed(1)}" y="${BASELINE}">${escapeXml(value)}</text>`

const NAMES: Record<ValueKind, string> = {
  input: 'Input',
  output: 'Output',
  thinking: 'Thinking',
  cache: 'Cache read',
  cacheHit: 'Cache hit rate',
  web: 'Web requests',
  requests: 'API requests',
  speed: 'Speed',
  cost: 'Cost',
  costRate: 'Cost per hour',
  lastTurn: 'Last turn',
  tools: 'Tool calls',
  churn: 'Lines changed',
  agents: 'Running subagents',
  compactions: 'Compactions',
  prompts: 'Prompts',
  age: 'Session age',
  model: 'Model',
  effort: 'Effort',
  folder: 'Folder',
  git: 'Git branch',
  memory: 'Memory',
}

/** Short words for the compact layout, where no icon says what a value is. */
const SHORT: Record<ValueKind, string> = {
  input: 'in',
  output: 'out',
  thinking: 'think',
  cache: 'cache',
  cacheHit: 'hit',
  web: 'web',
  requests: 'req',
  speed: '',
  cost: '',
  costRate: '',
  lastTurn: 'turn',
  tools: 'tools',
  churn: '',
  agents: 'agents',
  compactions: 'compact',
  prompts: 'prompts',
  age: 'age',
  model: '',
  effort: 'effort',
  folder: 'dir',
  git: 'git',
  memory: 'mem',
}

export function pillName(pill: Pill): string {
  return isBar(pill) ? pill.label : NAMES[pill.kind]
}

/** The words a value pill shows in the compact layout and the terminal summary. */
export function compactText(pill: ValuePill): string {
  const word = SHORT[pill.kind]

  return word ? `${word} ${pill.value}` : pill.value
}

export type PillDrawing = { key: string; svg: string; width: number; alt: string }

export function pillSvg(pill: Pill, look: Look): PillDrawing {
  const parts: string[] = []
  let x = look.isCompact ? 10 : 9
  if (!look.isCompact) {
    parts.push(icon(ICONS[pill.kind], x, 5))
    x += 14 + 5
  }

  if (isBar(pill)) {
    const level = barLevel(pill.percent, look)
    parts.push(text(pill.label, x))
    x += textWidth(pill.label) + 6
    if (!look.isCompact) {
      const barWidth = 36
      const filled = (Math.min(100, Math.max(0, pill.percent)) / 100) * barWidth
      parts.push(`<rect class="tr" x="${x.toFixed(1)}" y="9.5" width="${barWidth}" height="5" rx="2.5"/>`)
      if (filled > 0) {
        parts.push(
          `<rect class="bar" x="${x.toFixed(1)}" y="9.5" width="${Math.max(filled, 2.5).toFixed(1)}" height="5" rx="2.5"/>`,
        )
      }
      if (pill.elapsed !== null) {
        const mx = x + pill.elapsed * barWidth
        parts.push(
          `<line class="mk" x1="${mx.toFixed(1)}" y1="6" x2="${mx.toFixed(1)}" y2="18" stroke-width="1.5" stroke-linecap="round"/>`,
        )
      }
      x += barWidth + 7
    }
    const percent = formatPercent(pill.percent)
    // Compact has no bar, so the percent carries the level's color.
    parts.push(text(percent, x, look.isCompact && level !== 'ok' ? 'lv b' : 'tx b'))
    x += textWidth(percent)
    if (pill.isAtRisk) {
      x += 5
      parts.push(icon(WARNING, x, 5.5))
      x += 12
    }
    if (pill.remaining !== null) {
      x += 7
      parts.push(`<line class="sep" x1="${x.toFixed(1)}" y1="6.5" x2="${x.toFixed(1)}" y2="17.5" stroke-width="1"/>`)
      x += 7
      if (!look.isCompact) {
        parts.push(icon(COUNTDOWN, x, 5))
        x += 12 + 4
      }
      parts.push(text(pill.remaining, x))
      x += textWidth(pill.remaining)
    }
    x += 10

    return {
      key: pill.key,
      width: Math.ceil(x),
      alt: `${pill.label} ${percent}${pill.remaining ? `, ${pill.remaining}` : ''}${pill.isAtRisk ? ', at risk' : ''}`,
      svg: frame(pill.kind, x, pill.title, parts.join(''), level),
    }
  }

  const shown = look.isCompact ? compactText(pill) : pill.value
  parts.push(text(shown, x, 'tx b'))
  x += textWidth(shown) + 10

  return {
    key: pill.key,
    width: Math.ceil(x),
    alt: `${NAMES[pill.kind]} ${pill.value}`,
    svg: frame(pill.kind, x, pill.title, parts.join('')),
  }
}

// ---- Terminal: the same pills as colored text ----

export const TERMINAL_COLORS: Record<PillKind, string> = {
  fiveHour: '#2bb3a0',
  sevenDay: '#a27ee8',
  spendLimit: '#d4a72c',
  context: '#e8893a',
  input: '#e2665d',
  output: '#4cb860',
  thinking: '#d76bb4',
  cache: '#5b95e6',
  cacheHit: '#5b95e6',
  web: '#3fb0d8',
  requests: '#a8a69c',
  speed: '#9ccc3c',
  cost: '#d4a72c',
  costRate: '#d4a72c',
  lastTurn: '#8a9bbd',
  tools: '#8a9bbd',
  churn: '#4cb860',
  agents: '#8c93ea',
  compactions: '#e8893a',
  prompts: '#a8a69c',
  age: '#a8a69c',
  model: '#a8a69c',
  effort: '#d76bb4',
  folder: '#a8a69c',
  git: '#8a9bbd',
  memory: '#a8a69c',
}

export const TERMINAL_BAR = { ok: '#3fb96b', warn: '#e0b030', high: '#ea4d52' }

export const TERMINAL_ICONS: Record<PillKind, string> = {
  fiveHour: '◔',
  sevenDay: '▦',
  spendLimit: '$',
  context: '◑',
  input: '↑',
  output: '↓',
  thinking: '✻',
  cache: '≋',
  cacheHit: '◎',
  web: '⌕',
  requests: '⇅',
  speed: '»',
  cost: '$',
  costRate: '↗',
  lastTurn: '⧗',
  tools: '⚒',
  churn: '±',
  agents: '⧉',
  compactions: '⇲',
  prompts: '›',
  age: '◷',
  model: '◆',
  effort: '▁▃▅',
  folder: '▭',
  git: '⎇',
  memory: '▤',
}

/** A 10-cell bar: filled cells, empty cells, and the elapsed mark's cell. */
export function terminalBar(percent: number, elapsed: number | null): { cells: string[]; mark: number } {
  const size = 10
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * size)
  const cells = Array.from({ length: size }, (_, i) => (i < filled ? '█' : '░'))
  const mark = elapsed === null ? -1 : Math.min(size - 1, Math.floor(elapsed * size))

  return { cells, mark }
}
