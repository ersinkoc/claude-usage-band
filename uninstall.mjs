#!/usr/bin/env node
// Removes the usage band: the same as `node install.mjs --uninstall`.
//
//   node uninstall.mjs            unregister the band and delete ~/.claude/mods/usage-band
//   node uninstall.mjs --dry-run  print what would change, change nothing
//
// It takes the mod's folder out of CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
// (or $CLAUDE_CONFIG_DIR/settings.json), keeping any other folders listed there, and
// backs settings.json up before writing it. CLAUDE_CODE_ENABLE_FUNCTION_HOOKS stays
// on because other mods may rely on it. The folder you cloned is not touched.

const args = process.argv.slice(2)
const known = new Set(['--dry-run', '--help', '-h'])
const unknown = args.filter(arg => !known.has(arg))

if (args.includes('--help') || args.includes('-h') || unknown.length > 0) {
  if (unknown.length > 0) console.error(`Unknown option: ${unknown.join(' ')}\n`)
  console.log('Usage: node uninstall.mjs [--dry-run]')
  process.exit(unknown.length > 0 ? 2 : 0)
}

process.argv.splice(2, process.argv.length, '--uninstall', ...args)
await import('./install.mjs')
