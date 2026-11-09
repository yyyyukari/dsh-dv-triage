import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['.git', '.svn', 'node_modules', '.dsh-dv', '__pycache__'])

/**
 * Find candidate regression logs under a root directory.
 * v0.1: `*.log` only, depth <= 6, skips VCS metadata and node_modules.
 */
export function discoverLogs(root, options = {}) {
  const maxDepth = options.maxDepth ?? 6
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full, depth + 1)
      } else if (entry.isFile() && /\.log$/i.test(entry.name)) {
        found.push(full)
      }
    }
  }
  walk(path.resolve(root), 0)
  found.sort()
  return found
}

/** Cheap content sniff for a regression root (reports the first profile seen). */
export function sniffRoot(root) {
  const files = discoverLogs(root).slice(0, 5)
  const counts = new Map()
  for (const file of files) {
    let head = ''
    try {
      head = fs.readFileSync(file, 'utf8').slice(0, 8192)
    } catch {
      continue
    }
    const name = /^%Error:/m.test(head)
      ? 'verilator'
      : /^#\s\*\* (?:Error|Fatal)/m.test(head)
        ? 'questa'
        : /^Error-\[[A-Z0-9_]+\]/m.test(head) ||
            /^UVM_(?:ERROR|FATAL)\s*@/m.test(head) ||
            /^\s*"[^"]+\.(?:sv|svh|v|vh|vhd)",\s*\d+:\s*[\w.$]+:\s*started at/m.test(head)
          ? 'vcs'
          : 'unknown'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = 'unknown'
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}
