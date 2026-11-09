#!/usr/bin/env node
import path from 'node:path'
import { makeDemo } from '../scripts/make-demo.mjs'
import { loadRun } from '../lib/core/store.js'
import { writeReport } from '../lib/core/report.js'
import { diffRuns, formatClusters, scan } from '../lib/core/triage.js'

function usage() {
  console.log(`dsh-dv-triage

Usage:
  dv-triage demo                     generate demo/ and triage it
  dv-triage scan <root> [--profile]  scan a regression directory
  dv-triage clusters <root> [--top]  show clusters from the latest run
  dv-triage cluster <root> <id>      show one cluster with evidence
  dv-triage diff <before> <after>    compare two regression directories
  dv-triage report <root> [--html]   write a report for the latest run
`)
}

function argValue(args, flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

function printRun(run, top = 5) {
  console.log(`\nDV TRIAGE  ${run.root}`)
  console.log(formatClusters(run, top))
  const md = writeReport(run, 'md')
  const html = writeReport(run, 'html')
  console.log(`\nreport: ${md}`)
  console.log(`report: ${html}`)
}

function printCluster(run, id) {
  const cluster = run.clusters.find((c) => c.cluster_id === id)
  if (!cluster) {
    console.error(`cluster ${id} not found; available: ${run.clusters.map((c) => c.cluster_id).join(', ')}`)
    process.exitCode = 1
    return
  }
  console.log(`\n${cluster.cluster_id} · ${cluster.title}`)
  console.log(`kind=${cluster.kind} size=${cluster.size} score=${cluster.score}`)
  if (cluster.repro) console.log(`repro: ${cluster.repro}`)
  if (cluster.fine.length > 1) {
    console.log(`fine variants (${cluster.fine.length}):`)
    for (const variant of cluster.fine.slice(0, 5)) console.log(`  ${variant.count}x  ${variant.sample}`)
  }
  for (const suspect of cluster.suspects) {
    console.log(`suspect: ${suspect.file}:${suspect.line} — ${suspect.verified ? 'verified' : `unverified (${suspect.reason})`}`)
  }
  for (const evidence of cluster.evidence) {
    console.log(`\nevidence ${evidence.test_id} (${evidence.rel_log}:${evidence.start}-${evidence.end})`)
    for (const line of evidence.lines) console.log(`${String(line.line).padStart(6)} | ${line.text}`)
  }
}

const [command, ...rest] = process.argv.slice(2)
try {
  switch (command) {
    case 'demo': {
      const { day1, day2 } = makeDemo(process.cwd())
      const run = scan(day2)
      printRun(run)
      const before = scan(day1)
      const { newFailures, fixed, persisting } = diffRuns(before, run)
      console.log(`\nDIFF  ${day1} → ${day2}`)
      console.log(`new failures: ${newFailures.length} · fixed: ${fixed.length} · persisting: ${persisting.length}`)
      for (const item of newFailures) console.log(`  + ${item.test_id} (${item.before} → ${item.after})`)
      for (const item of fixed) console.log(`  - ${item.test_id} (${item.before} → ${item.after})`)
      break
    }
    case 'scan': {
      const root = rest[0]
      if (!root) throw new Error('scan requires a root directory')
      printRun(scan(path.resolve(root), { profile: argValue(rest, '--profile') }), Number(argValue(rest, '--top') ?? 5))
      break
    }
    case 'clusters': {
      const root = rest[0]
      if (!root) throw new Error('clusters requires a root directory')
      const run = loadRun(path.resolve(root)) ?? scan(path.resolve(root))
      console.log(`\nDV TRIAGE  ${run.root}`)
      console.log(formatClusters(run, Number(argValue(rest, '--top') ?? run.clusters.length)))
      break
    }
    case 'cluster': {
      const [root, id] = rest
      if (!root || !id) throw new Error('cluster requires <root> <cluster_id>')
      const run = loadRun(path.resolve(root)) ?? scan(path.resolve(root))
      printCluster(run, id)
      break
    }
    case 'diff': {
      const [before, after] = rest
      if (!before || !after) throw new Error('diff requires <before> <after>')
      const a = scan(path.resolve(before))
      const b = scan(path.resolve(after))
      const { newFailures, fixed, persisting } = diffRuns(a, b)
      console.log(`\nDIFF  ${a.root} → ${b.root}`)
      console.log(`new failures: ${newFailures.length} · fixed: ${fixed.length} · persisting: ${persisting.length}`)
      for (const item of newFailures) console.log(`  + ${item.test_id} (${item.before} → ${item.after})`)
      for (const item of fixed) console.log(`  - ${item.test_id} (${item.before} → ${item.after})`)
      break
    }
    case 'report': {
      const root = rest[0]
      if (!root) throw new Error('report requires a root directory')
      const run = loadRun(path.resolve(root)) ?? scan(path.resolve(root))
      const file = writeReport(run, rest.includes('--html') ? 'html' : 'md', argValue(rest, '--out'))
      console.log(file)
      break
    }
    default:
      usage()
      if (command) process.exitCode = 1
  }
} catch (error) {
  console.error(`dv-triage: ${error.message}`)
  process.exitCode = 1
}
