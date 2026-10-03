/** One rate-limit window: how much of it is used, and when it resets. */
export type UsageLimit = { percent: number; resetsAt: string | null }

/** One category of the context window, as /context names it. */
export type UsageContextCategory = { name: string; tokens: number }

/** What `$.session.usage()` and `session.measure` report, kept for the band. */
export type UsageSnapshot = {
  fiveHour: UsageLimit | null
  sevenDay: UsageLimit | null
  /** A Claude gateway's spend limit, when the account reports one. */
  spendLimit: UsageLimit | null
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  /** Largest categories first; null unless the breakdown setting is on. */
  contextCategories: UsageContextCategory[] | null
  autoCompactAt: number | null
  costUsd: number | null
}

/** Token totals of the session; `isEstimate` when summed from turn.complete. */
export type UsageTokens = {
  uncached: number
  cacheWrite: number
  cacheWrite1h: number
  cacheWrite5m: number
  output: number
  thinking: number
  cacheRead: number
  webSearches: number
  webFetches: number
  requests: number
  isEstimate: boolean
}

/** What the transcript says about tools and edits over the whole session. */
export type UsageTranscript = {
  toolCalls: number
  toolFailures: number
  byTool: Record<string, number>
  linesAdded: number
  linesRemoved: number
  filesChanged: number
}

/** The last main-loop turn: how long it took, what it wrote and cost. */
export type UsageTurn = {
  durationMs: number
  output: number
  startCost: number | null
  endCost: number | null
}

/** What the session's hooks counted since the mod loaded. */
export type UsageActivity = {
  lastTurn: UsageTurn | null
  toolCalls: number
  toolFailures: number
  byTool: Record<string, number>
  agentsRunning: number
  compactions: number
  compactionFreed: number
}

/** The main loop's requests as they streamed: model, effort and output speed. */
export type UsageStream = {
  model: string | null
  effort: string | null
  /** Tokens per second of the last response, from its first streamed piece. */
  lastTps: number | null
  /** Sums for the average speed since the band loaded. */
  tokens: number
  ms: number
  responses: number
}

/** The git working copy the session runs in. */
export type UsageGit = { branch: string; dirty: number; ahead: number; behind: number }

/** Facts about the session and the machine. */
export type UsageSession = {
  startedAt: number | null
  model: string | null
  version: string | null
  prompts: number | null
  cwd: string | null
  git: UsageGit | null
  memory: { total: number; free: number } | null
}

/** The highest alert level already toasted per window: 0 none, 1 yellow, 2 red. */
export type UsageAlerted = { fiveHour: number; sevenDay: number; spendLimit: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: UsageSnapshot | null
      tokens: UsageTokens | null
      fallback: UsageTokens | null
      transcript: UsageTranscript | null
      activity: UsageActivity
      stream: UsageStream | null
      session: UsageSession | null
      alerted: UsageAlerted
      isHidden: boolean
      now: number
    }
  }
}
