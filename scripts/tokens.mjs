// Sums the token usage, tool calls and line churn of one Claude Code session
// from its transcript files: ~/.claude/projects/*/<id>.jsonl and
// <id>/subagents/*.jsonl.
//
//   node tokens.mjs <session-id>
//
// Prints one JSON object. The transcript writes an assistant message once per
// content block, so rows are keyed by message.id + requestId and each usage
// field keeps its largest value; a tool_use block counts once per id. Churn
// counts Edit, MultiEdit and Write calls whose result was not an error.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const id = process.argv[2]
if (!id || !/^[\w-]+$/.test(id)) {
  console.error('usage: node tokens.mjs <session-id>')
  process.exit(2)
}

const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const projects = join(base, 'projects')

const list = dir => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

let main = null
for (const dir of list(projects)) {
  const path = join(projects, dir, `${id}.jsonl`)
  if (!existsSync(path)) continue
  const stat = statSync(path)
  if (!main || stat.mtimeMs > main.stat.mtimeMs) main = { dir: join(projects, dir), path, stat }
}

if (!main) {
  process.stdout.write(JSON.stringify({ found: false }))
  process.exit(0)
}

const subagents = join(main.dir, id, 'subagents')
const files = [
  main.path,
  ...list(subagents)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => join(subagents, name)),
]

// [name, path into message.usage]
const FIELDS = [
  ['uncached', ['input_tokens']],
  ['cacheWrite', ['cache_creation_input_tokens']],
  ['cacheWrite1h', ['cache_creation', 'ephemeral_1h_input_tokens']],
  ['cacheWrite5m', ['cache_creation', 'ephemeral_5m_input_tokens']],
  ['output', ['output_tokens']],
  ['thinking', ['output_tokens_details', 'thinking_tokens']],
  ['cacheRead', ['cache_read_input_tokens']],
  ['webSearches', ['server_tool_use', 'web_search_requests']],
  ['webFetches', ['server_tool_use', 'web_fetch_requests']],
]
const zero = () => Object.fromEntries(FIELDS.map(([name]) => [name, 0]))
const rows = new Map()
const toolUses = new Map()
const failed = new Set()

for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') && !line.includes('"tool_use"') && !line.includes('"tool_result"')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const message = row?.message
    if (!message) continue
    const content = Array.isArray(message.content) ? message.content : []
    if (row.type === 'assistant') {
      if (message.usage) {
        const key = `${message.id ?? row.uuid}|${row.requestId ?? ''}`
        const seen = rows.get(key) ?? zero()
        for (const [name, path] of FIELDS) {
          const value = Number(path.reduce((at, part) => at?.[part], message.usage)) || 0
          if (value > seen[name]) seen[name] = value
        }
        rows.set(key, seen)
      }
      for (const block of content) {
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          toolUses.set(block.id, { name: String(block.name ?? 'unknown'), input: block.input ?? {} })
        }
      }
    } else if (row.type === 'user') {
      for (const block of content) {
        if (block?.type === 'tool_result' && block.is_error === true) failed.add(block.tool_use_id)
      }
    }
  }
}

const total = zero()
for (const seen of rows.values()) {
  for (const [name] of FIELDS) total[name] += seen[name]
}

const lines = text => (typeof text === 'string' && text.length > 0 ? text.replace(/\n$/, '').split('\n') : [])

/** Lines removed and added between two texts, ignoring their common head and tail. */
function diffCount(before, after) {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  return { removed: a.length - head - tail, added: b.length - head - tail }
}

const byTool = {}
const churn = { added: 0, removed: 0 }
const touched = new Set()
for (const [useId, use] of toolUses) {
  byTool[use.name] = (byTool[use.name] ?? 0) + 1
  if (failed.has(useId)) continue
  const input = use.input
  let changed = null
  if (use.name === 'Edit') {
    changed = diffCount(input.old_string, input.new_string)
  } else if (use.name === 'MultiEdit' && Array.isArray(input.edits)) {
    changed = { added: 0, removed: 0 }
    for (const edit of input.edits) {
      const one = diffCount(edit?.old_string, edit?.new_string)
      changed.added += one.added
      changed.removed += one.removed
    }
  } else if (use.name === 'Write') {
    changed = { added: lines(input.content).length, removed: 0 }
  }
  if (changed !== null) {
    churn.added += changed.added
    churn.removed += changed.removed
    if (typeof input.file_path === 'string') touched.add(input.file_path)
  }
}

process.stdout.write(
  JSON.stringify({
    found: true,
    path: main.path,
    size: main.stat.size,
    mtimeMs: main.stat.mtimeMs,
    files: files.length,
    requests: rows.size,
    ...total,
    toolCalls: toolUses.size,
    toolFailures: [...failed].filter(useId => toolUses.has(useId)).length,
    byTool,
    linesAdded: churn.added,
    linesRemoved: churn.removed,
    filesChanged: touched.size,
  }),
)
