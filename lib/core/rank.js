const SEVERITY = {
  compile: 3,
  timeout: 2.5,
  uvm_fatal: 3,
  assertion: 2,
  mismatch: 1.5,
  uvm_error: 1.5,
  error: 1.5,
}

const BLOCKING = new Set(['compile', 'timeout'])

/**
 * Priority score. The weights are deliberately simple and testable:
 * blocking first, then severity, then population, then reproducibility.
 * `novel` and `known` are reserved for the baseline/diff phase (v0.2).
 */
export function scoreCluster(cluster) {
  const blocking = BLOCKING.has(cluster.kind) ? 1 : 0
  const severity = SEVERITY[cluster.kind] ?? 1
  const repro = cluster.tests.some((t) => t.seed !== undefined) ? 1 : 0
  const novelty = cluster.novel ? 1.5 : 0
  const known = cluster.known ? 2 : 0
  return 3 * blocking + 2 * severity + Math.log2(1 + cluster.size) + repro + novelty - known
}
