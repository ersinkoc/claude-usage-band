// Regenerates plugin.json's userConfig from the pill and option lists in
// hooks/pills.ts, so the settings menu and the code never drift apart.
//
//   npm run manifest
import { readFileSync, writeFileSync } from 'node:fs'

import { SWITCHES, TOGGLES } from '../hooks/pills.ts'

const path = new URL('../.claude-plugin/plugin.json', import.meta.url)
const { userConfig: _old, ...manifest } = JSON.parse(readFileSync(path, 'utf8'))

const userConfig: Record<string, unknown> = {}
for (const one of [...TOGGLES, ...SWITCHES]) {
  userConfig[one.field] = {
    type: 'boolean',
    title: `Usage band: ${one.title.toLowerCase()}`,
    description: one.description,
    default: true,
  }
}
userConfig.layout = {
  type: 'string',
  title: 'Usage band: layout',
  description: 'full: icons and bars; compact: text only',
  default: 'full',
  options: ['full', 'compact'],
}
userConfig.warnAt = {
  type: 'number',
  title: 'Usage band: yellow from %',
  description: 'Bars turn yellow (and a toast fires) at this percent',
  default: 70,
  min: 1,
  max: 100,
}
userConfig.hotAt = {
  type: 'number',
  title: 'Usage band: red from %',
  description: 'Bars turn red (and a toast fires) at this percent',
  default: 90,
  min: 1,
  max: 100,
}
userConfig.refreshSeconds = {
  type: 'number',
  title: 'Usage band: refresh every (s)',
  description: 'Seconds between refreshes of limits, timers and totals (10 to 600)',
  default: 30,
  min: 10,
  max: 600,
}

writeFileSync(path, `${JSON.stringify({ ...manifest, userConfig }, null, 2)}\n`)
console.log(`plugin.json: ${Object.keys(userConfig).length} settings`)
