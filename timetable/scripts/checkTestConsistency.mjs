#!/usr/bin/env node
/**
 * Test-collection consistency gate: `vitest list` (what WOULD run) must equal
 * `vitest run` (what DID run). Catches silent include-pattern drift — e.g. a
 * subdirectory falling out of the default glob — which makes suite totals lie
 * while everything still shows green.
 *
 * Exit 1 with a diff on any mismatch; exit 0 when counts agree.
 */
import { execFileSync } from 'node:child_process'

function sh(cmd, args) {
  // Windows needs shell:true to resolve `npx` (no PATHEXT lookup without it);
  // Linux CI runs bash where shell:true is equally safe for these fixed args.
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: true })
}

// --- ① collected: vitest list prints "file > suite > test" lines (one per test) ---
const listed = sh('npx', ['vitest', 'list'])
  .split('\n')
  .filter((l) => l.includes(' > '))
const collected = listed.length

// --- ② executed: parse vitest run summary (strip ANSI colours first —
// vitest colourises even when piped; the control-char match is intentional,
// so oxlint's no-control-regex is acknowledged here) ---
// oxlint-disable-next-line no-control-regex
const ran = sh('npx', ['vitest', 'run']).replace(/\x1b\[[0-9;]*m/g, '')
const m = ran.match(/Tests\s+(\d+)\s+passed/)
if (!m) {
  console.error('checkTestConsistency: could not parse vitest run summary ("Tests N passed")')
  process.exit(1)
}
const executed = Number(m[1])

console.log(`test-consistency: collected=${collected} executed=${executed}`)
if (collected !== executed) {
  console.error(
    `::error::test-collection drift: vitest list collected ${collected} tests ` +
      `but vitest run executed ${executed}. ` +
      `Check vitest include patterns (a subdirectory may have fallen out of the default glob).`,
  )
  process.exit(1)
}
