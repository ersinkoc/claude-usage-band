#!/usr/bin/env node
// Installs the usage band for every Claude Code session (terminal and desktop).
//
//   node install.mjs              copy the mod to ~/.claude/mods/usage-band and register it
//   node install.mjs --link       register this folder itself (edits apply live; for development)
//   node install.mjs --uninstall  unregister it and remove the installed copy
//   node install.mjs --dry-run    print what would change, change nothing
//
// Registering means two entries in the `env` block of ~/.claude/settings.json
// (or $CLAUDE_CONFIG_DIR/settings.json): CLAUDE_CODE_PLUGIN_DIRS gains the
// mod's folder (other folders already there are kept), and
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is set to "1". Every other setting is left
// as it is, and settings.json is backed up before it is written.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'usage-band'
const PARTS = ['.claude-plugin/plugin.json', 'hooks', 'scripts', 'types', 'tests']

const args = new Set(process.argv.slice(2))
const isLink = args.has('--link')
const isUninstall = args.has('--uninstall')
const isDry = args.has('--dry-run')
const known = new Set(['--link', '--uninstall', '--dry-run', '--help', '-h'])
const unknown = [...args].filter(arg => !known.has(arg))
if (args.has('--help') || args.has('-h') || unknown.length > 0) {
  if (unknown.length > 0) console.error(`Unknown option: ${unknown.join(' ')}\n`)
  console.log('Usage: node install.mjs [--link | --uninstall] [--dry-run]')
  process.exit(unknown.length > 0 ? 2 : 0)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 18 || (major === 18 && minor < 3)) {
  console.error(`Node 18.3 or newer is needed (this is ${process.versions.node}).`)
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const config = process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude')
const copyDir = join(config, 'mods', NAME)
const settingsPath = join(config, 'settings.json')
const target = isLink ? here : copyDir

const same = (a, b) => {
  const norm = path => resolve(path.replace(/^~(?=$|[\\/])/, homedir())).replace(/[\\/]+$/, '')

  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}
const say = line => console.log(isDry ? `[dry run] ${line}` : line)

function readSettings() {
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch (error) {
    console.error(`Cannot parse ${settingsPath}: ${error.message}\nFix it, or add the two env entries by hand (see README).`)
    process.exit(1)
  }
}

function writeSettings(settings) {
  if (isDry) return
  mkdirSync(config, { recursive: true })
  if (existsSync(settingsPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${settingsPath}.${NAME}-${stamp}.bak`
    copyFileSync(settingsPath, backup)
    console.log(`Backed up settings to ${backup}`)
  }
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}

const settings = readSettings()
const env = { ...(settings.env ?? {}) }
const dirs = (env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(delimiter).filter(Boolean)

if (isUninstall) {
  const kept = dirs.filter(dir => !same(dir, copyDir) && !same(dir, here))
  if (kept.length === dirs.length) {
    say('The usage band is not in CLAUDE_CODE_PLUGIN_DIRS; settings left as they are.')
  } else {
    if (kept.length > 0) env.CLAUDE_CODE_PLUGIN_DIRS = kept.join(delimiter)
    else delete env.CLAUDE_CODE_PLUGIN_DIRS
    say(`Removed the usage band from CLAUDE_CODE_PLUGIN_DIRS in ${settingsPath}.`)
    say('CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is left on: other mods may use it.')
    writeSettings({ ...settings, env })
  }
  if (existsSync(copyDir)) {
    say(`Removing ${copyDir}`)
    if (!isDry) rmSync(copyDir, { recursive: true, force: true })
  }
  say('Done. New sessions start without the band.')
  process.exit(0)
}

for (const part of PARTS) {
  if (!existsSync(join(here, part))) {
    console.error(`Missing ${part} next to install.mjs: run it from the mod's folder.`)
    process.exit(1)
  }
}

if (isLink) {
  say(`Linking ${here} (edits here apply to new sessions, and reload live in watched ones).`)
} else {
  say(`Copying the mod to ${copyDir}`)
  if (!isDry) {
    rmSync(copyDir, { recursive: true, force: true })
    for (const part of PARTS) {
      cpSync(join(here, part), join(copyDir, part), { recursive: true })
    }
  }
}

// A link replaces the copy in the list and the other way round, so only one loads.
const others = dirs.filter(dir => !same(dir, copyDir) && !same(dir, here))
const next = [...others, target]
const hadIt = dirs.some(dir => same(dir, target)) && dirs.length === others.length + 1
if (hadIt && env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1') {
  say(`${settingsPath} already registers the band.`)
} else {
  env.CLAUDE_CODE_PLUGIN_DIRS = next.join(delimiter)
  env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
  say(`Registered in ${settingsPath}:`)
  say(`  CLAUDE_CODE_PLUGIN_DIRS = ${env.CLAUDE_CODE_PLUGIN_DIRS}`)
  say('  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = 1')
  writeSettings({ ...settings, env })
}

say('Done. Start a new Claude Code session (or restart the desktop app); type /usage-band settings to pick the pills.')
