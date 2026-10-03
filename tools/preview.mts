// Draws every pill with sample data into docs/preview.html, using the mod's
// own drawing code, so the desktop look can be checked in any browser (light
// and dark follow the system theme).
//
//   npm run preview
import { writeFileSync } from 'node:fs'

import { buildPills, lookOf, pillSvg, readSettings } from '../hooks/pills.ts'
import type { BandData } from '../hooks/pills.ts'

const now = Date.parse('2026-10-03T12:00:00Z')
const at = (ms: number) => new Date(now + ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const all = readSettings({})

const snapshot = (o: Partial<BandData['snapshot'] & object> = {}): NonNullable<BandData['snapshot']> => ({
  fiveHour: { percent: 20, resetsAt: at(2 * HOUR + 40 * MINUTE + 30_000) },
  sevenDay: { percent: 58, resetsAt: at(31 * HOUR + 20 * MINUTE) },
  spendLimit: null,
  contextTokens: 118_400,
  contextWindow: 1_000_000,
  contextPercent: 12,
  contextCategories: [
    { name: 'Messages', tokens: 92_000 },
    { name: 'System tools', tokens: 18_300 },
  ],
  autoCompactAt: 900_000,
  costUsd: 4.32,
  ...o,
})

const tokens = (o: Partial<NonNullable<BandData['tokens']>> = {}): NonNullable<BandData['tokens']> => ({
  uncached: 12_600,
  cacheWrite: 3_000,
  cacheWrite1h: 3_000,
  cacheWrite5m: 0,
  output: 3_000,
  thinking: 1_100,
  cacheRead: 954_200,
  webSearches: 3,
  webFetches: 1,
  requests: 42,
  isEstimate: false,
  ...o,
})

const activity: NonNullable<BandData['activity']> = {
  lastTurn: { durationMs: 42_000, output: 3_100, startCost: 4.01, endCost: 4.32 },
  toolCalls: 57,
  toolFailures: 2,
  byTool: { Bash: 21, Read: 18, Edit: 9, Grep: 6, Agent: 3 },
  agentsRunning: 2,
  compactions: 1,
  compactionFreed: 612_000,
}

const session: NonNullable<BandData['session']> = {
  startedAt: now - (HOUR + 12 * MINUTE),
  model: 'claude-opus-5-5',
  version: '2.1.286',
  prompts: 14,
  cwd: '~/code/my-app',
  git: { branch: 'main', dirty: 3, ahead: 1, behind: 0 },
  memory: { total: 32 * 1024 ** 3, free: 13.4 * 1024 ** 3 },
}

const transcript: NonNullable<BandData['transcript']> = {
  toolCalls: 100,
  toolFailures: 3,
  byTool: { Bash: 58, Write: 10, Read: 8, mcp__plugin_playwright_playwright__browser_take_screenshot: 6 },
  linesAdded: 2463,
  linesRemoved: 6,
  filesChanged: 4,
}

const stream: NonNullable<BandData['stream']> = {
  model: 'claude-opus-5-5',
  effort: 'high',
  lastTps: 84.2,
  tokens: 60_000,
  ms: 800_000,
  responses: 40,
}

const base = { now, activity, session, transcript, stream }

const rows: { name: string; data: BandData }[] = [
  { name: 'Every pill', data: { ...base, snapshot: snapshot(), tokens: tokens(), settings: all } },
  {
    name: 'Thresholds: 75% yellow with the projection warning, 93% red, a spend limit, context 91%, fallback counts (~)',
    data: {
      ...base,
      snapshot: snapshot({
        fiveHour: { percent: 75, resetsAt: at(3 * HOUR) },
        sevenDay: { percent: 93, resetsAt: at(5 * HOUR) },
        spendLimit: { percent: 64, resetsAt: at(9 * 24 * HOUR) },
        contextTokens: 910_000,
        contextPercent: 91,
        costUsd: 128.5,
      }),
      tokens: tokens({ uncached: 1_250_000, cacheWrite: 0, output: 41_300, thinking: 0, cacheRead: 12_480_000, webSearches: 0, webFetches: 0, requests: 9, isEstimate: true }),
      activity: { ...activity, agentsRunning: 0, compactions: 0 },
      session: { ...session, git: null },
      settings: all,
    },
  },
  {
    name: 'Settings: only 5h, 7d, cost and git',
    data: {
      ...base,
      snapshot: snapshot(),
      tokens: tokens(),
      settings: readSettings(
        Object.fromEntries(
          Object.keys(all)
            .filter(key => key.startsWith('show') && !['show5h', 'show7d', 'showCost', 'showGit'].includes(key))
            .map(key => [key, false]),
        ),
      ),
    },
  },
  {
    name: 'Compact layout, yellow from 60%, red from 85%',
    data: {
      ...base,
      snapshot: snapshot({ fiveHour: { percent: 62, resetsAt: at(2 * HOUR) } }),
      tokens: tokens(),
      settings: readSettings({ layout: 'compact', warnAt: 60, hotAt: 85 }),
    },
  },
]

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Inline SVG on purpose: every pill shares this one document, which is what
// the scoped style rules exist for.
const band = (data: BandData) =>
  `<div class="band">${buildPills(data)
    .map(
      group =>
        `<div class="group">${group
          .map(pill => {
            const drawing = pillSvg(pill, lookOf(data.settings))

            return `<span class="pill" title="${escape(pill.title)}" aria-label="${escape(drawing.alt)}">${drawing.svg}</span>`
          })
          .join('')}</div>`,
    )
    .join('')}</div>`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Usage band preview</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:24px 16px;background:#faf9f5;color:#1f1e1d;font:14px system-ui,sans-serif}
@media (prefers-color-scheme: dark){body{background:#262624;color:#e8e6dc}.prompt{background:#30302e!important;border-color:#4a4a47!important}}
h2{font-size:12px;font-weight:500;opacity:.6;margin:20px 0 8px}
.band{display:flex;flex-wrap:wrap;gap:6px 14px;max-width:760px}
.group{display:flex;flex-wrap:wrap;gap:6px}
.pill svg{display:block}
.prompt{max-width:760px;margin-top:8px;height:48px;border:1px solid #ddd9cc;border-radius:12px;background:#fff;opacity:.85}
</style></head><body>
${rows.map(row => `<h2>${escape(row.name)}</h2>${band(row.data)}<div class="prompt"></div>`).join('\n')}
</body></html>
`

const out = new URL('../docs/preview.html', import.meta.url)
writeFileSync(out, html)
console.log(`docs/preview.html: ${rows.length} rows`)
