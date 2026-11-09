import { primaryEvent, readExcerpt } from './parse.js'
import { clusterTitle, coarseKey, fineKey } from './normalize.js'
import { scoreCluster } from './rank.js'
import { verifySource } from './verify.js'

function uniqueBy(items, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * Build failure clusters: one cluster per coarse signature, one member per test.
 * Cluster ids are assigned after ranking so c01 is always the first thing to fix.
 */
export function buildClusters(tests, options = {}) {
  const { root = process.cwd(), baselineKeys } = options
  const map = new Map()

  for (const test of tests) {
    const event = primaryEvent(test)
    if (!event) continue
    const key = coarseKey(event)
    let cluster = map.get(key)
    if (!cluster) {
      cluster = {
        key,
        kind: event.kind,
        code: event.code,
        tag: event.tag,
        title: clusterTitle(event),
        size: 0,
        tests: [],
        events: [],
        fine: new Map(),
      }
      map.set(key, cluster)
    }
    cluster.size += 1
    cluster.tests.push(test)
    cluster.events.push({ test, event })
    const fk = fineKey(event)
    const bucket = cluster.fine.get(fk) ?? { key: fk, count: 0, sample: event.message }
    bucket.count += 1
    cluster.fine.set(fk, bucket)
  }

  const clusters = [...map.values()].map((cluster) => {
    cluster.novel = baselineKeys ? !baselineKeys.has(cluster.key) : false
    cluster.score = Number(scoreCluster(cluster).toFixed(2))
    cluster.fine = [...cluster.fine.values()].sort((a, b) => b.count - a.count)
    cluster.tests.sort((a, b) => a.test_id.localeCompare(b.test_id))
    return cluster
  })

  clusters.sort((a, b) => b.score - a.score || b.size - a.size || a.key.localeCompare(b.key))
  clusters.forEach((cluster, index) => {
    cluster.cluster_id = `c${String(index + 1).padStart(2, '0')}`
  })

  for (const cluster of clusters) {
    const suspects = []
    for (const { event } of cluster.events) {
      if (!event.file || event.srcLine === undefined) continue
      const needle = event.needle ?? (event.assertName ? event.assertName.split('.').pop() : event.code)
      const verified = verifySource(root, event.file, event.srcLine, needle)
      suspects.push({ ...verified, needle })
    }
    cluster.suspects = uniqueBy(suspects, (s) => `${s.file}:${s.line}`)

    const evidence = []
    for (const { test, event } of cluster.events.slice(0, 3)) {
      try {
        evidence.push({
          test_id: test.test_id,
          rel_log: test.rel_log,
          log: test.log,
          seed: test.seed,
          ...readExcerpt(test.log, event.line, event.excerptEnd),
        })
      } catch {
        // A log that disappeared between scan and evidence read is not fatal.
      }
    }
    cluster.evidence = evidence
    cluster.repro = buildRepro(cluster)
  }

  return clusters
}

/** Best-effort repro command; the real command usually lives in the site's Makefile. */
export function buildRepro(cluster) {
  const test = cluster.tests.find((t) => t.seed !== undefined) ?? cluster.tests[0]
  if (!test) return undefined
  const seed = test.seed !== undefined ? ` SEED=${test.seed}` : ''
  return `make run TEST=${test.test_id}${seed}`
}
