#!/usr/bin/env node
/**
 * AGENTS.md budget gate: keeps the instruction file a *router*, not a log.
 *
 * Why this exists: the workspace AGENTS.md had grown to 222 KB / 748 lines.
 * The harness injects at most 65536 bytes of workspace instructions, so it
 * silently truncated at 64 KB — roughly 158 KB of documented rules became
 * invisible to the agent while still looking authoritative to humans. Worse,
 * the truncation consumed the whole budget, so ~/.dsh/AGENTS.md was omitted
 * entirely.
 *
 * The fix was structural (dated batches moved to docs/agents/log-<YYYY-MM>.md,
 * see the maintenance rules at the top of AGENTS.md). This gate is what stops
 * it from growing back:
 *
 *   ① AGENTS.md must stay under 32 KB  — headroom below the 64 KB harness cap.
 *   ② The §4 pitfall table must stay under 80 rows — past that it needs a split,
 *      not another row.
 *
 * Both are hard failures so the drift cannot land unnoticed.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 32 * 1024
const MAX_TABLE_ROWS = 80

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const agentsPath = resolve(repoRoot, 'AGENTS.md')

if (!existsSync(agentsPath)) {
  console.error(`::error::agents-budget: ${agentsPath} not found`)
  process.exit(1)
}

const raw = readFileSync(agentsPath, 'utf8')
const bytes = Buffer.byteLength(raw, 'utf8')

// --- §4 pitfall table: data rows only (drop the header row + |---| separator) ---
const lines = raw.split(/\r?\n/)
const start = lines.findIndex((l) => /^##\s*4\./.test(l))
let tableRows = 0
if (start !== -1) {
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  const section = lines.slice(start + 1, end)
  const pipeRows = section.filter((l) => l.trimStart().startsWith('|'))
  // The separator row (|---|---|---|) is not a pitfall.
  tableRows = pipeRows.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length
  if (tableRows > 0) tableRows -= 1 // header row
}

const kb = (bytes / 1024).toFixed(1)
console.log(
  `agents-budget: ${bytes} B (${kb} KB) / ${MAX_BYTES} B, ` +
    `§4 table ${tableRows}/${MAX_TABLE_ROWS} rows`,
)

const failures = []
if (bytes > MAX_BYTES) {
  failures.push(
    `AGENTS.md is ${bytes} B, over the ${MAX_BYTES} B (32 KB) cap. ` +
      `Move dated batch notes into docs/agents/log-<YYYY-MM>.md — the file is a router, not a log.`,
  )
}
if (tableRows > MAX_TABLE_ROWS) {
  failures.push(
    `§4 pitfall table has ${tableRows} rows, over ${MAX_TABLE_ROWS}. ` +
      `Split it (e.g. by platform) instead of appending; drop stale rows as you add new ones.`,
  )
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error::agents-budget: ${f}`)
  process.exit(1)
}
