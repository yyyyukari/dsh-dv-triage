import crypto from 'node:crypto'
import path from 'node:path'
import { buildClusters } from './cluster.js'
import { discoverLogs, sniffRoot } from './discover.js'
import { parseLog } from './parse.js'
import { saveRun } from './store.js'

function makeRunId(root) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hash = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 6)
  return `${stamp}-${hash}`
}

export function summarize(tests, clusters) {
  const by = { pass: 0, fail: 0, blocked: 0 }
  for (const test of tests) by[test.status] = (by[test.status] ?? 0) + 1
  return {
    total: tests.length,
    pass: by.pass,
    fail: by.fail,
    blocked: by.blocked,
    clusters: clusters.length,
  }
}

/**
 * Scan a regression root: discover logs, parse, cluster, rank, persist the run.
 * @param {string} root
 * @param {{profile?: string}} options
 */
export function scan(root, options = {}) {
  const abs = path.resolve(root)
  const files = discoverLogs(abs)
  if (files.length === 0) {
    throw new Error(`dv-triage: no *.log files found under ${abs}`)
  }
  const tests = []
  const errors = []
  for (const file of files) {
    try {
      tests.push(parseLog(file, { root: abs, profile: options.profile }))
    } catch (error) {
      errors.push({ file: path.relative(abs, file), error: error.message })
    }
  }
  const clusters = buildClusters(tests, { root: abs })
  const run = {
    run_id: makeRunId(abs),
    root: abs,
    created_at: new Date().toISOString(),
    profile: options.profile ?? sniffRoot(abs),
    summary: summarize(tests, clusters),
    errors,
    tests,
    clusters,
  }
  saveRun(abs, run)
  return run
}

/** Compare two roots (or two persisted runs) by test id. */
export function diffRuns(beforeRun, afterRun) {
  const before = new Map(beforeRun.tests.map((t) => [t.test_id, t]))
  const after = new Map(afterRun.tests.map((t) => [t.test_id, t]))
  const newFailures = []
  const fixed = []
  const persisting = []
  for (const [id, next] of after) {
    const prev = before.get(id)
    if (!prev) continue
    const bad = (t) => t.status !== 'pass'
    if (!bad(prev) && bad(next)) newFailures.push({ test_id: id, before: prev.status, after: next.status, reason: next.reason })
    else if (bad(prev) && !bad(next)) fixed.push({ test_id: id, before: prev.status, after: next.status })
    else if (bad(prev) && bad(next)) persisting.push({ test_id: id, before: prev.status, after: next.status })
  }
  return { newFailures, fixed, persisting }
}

export function formatSummary(run) {
  const { total, pass, fail, blocked, clusters } = run.summary
  return `${total} tests | ${pass} pass | ${fail} fail | ${blocked} blocked | ${clusters} clusters | profile: ${run.profile ?? 'auto'}`
}

export function formatClusters(run, limit = 5) {
  const lines = [formatSummary(run), '']
  const clusters = run.clusters.slice(0, limit)
  if (clusters.length === 0) {
    lines.push('no clusters (all tests passed)')
    return lines.join('\n')
  }
  const width = Math.max(...clusters.map((c) => c.title.length), 10)
  clusters.forEach((cluster) => {
    const suspects = cluster.suspects ?? (cluster.suspect ? [cluster.suspect] : [])
    const suspect = suspects.find((s) => s.verified) ?? suspects[0]
    const where = suspect
      ? `${suspect.file}:${suspect.line} ${suspect.verified ? '(verified)' : '(unverified)'}`
      : '-'
    lines.push(
      `${cluster.cluster_id}  ${String(cluster.size).padStart(3)} tests  ${cluster.title.padEnd(width)}  score=${cluster.score}  ${where}`,
    )
  })
  return lines.join('\n')
}
