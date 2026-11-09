import path from 'node:path'
import { loadRun } from './core/store.js'
import { diffRuns, formatClusters, scan } from './core/triage.js'
import { writeReport } from './core/report.js'

export const name = 'dv-triage'
export const inject = ['tools']

const CLUSTER_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    cluster_id: { type: 'string' },
    kind: { type: 'string' },
    size: { type: 'integer' },
    score: { type: 'number' },
    title: { type: 'string' },
    repro: { type: 'string' },
    suspect: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        line: { type: 'integer' },
        verified: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['file', 'line', 'verified'],
    },
  },
  required: ['cluster_id', 'kind', 'size', 'score', 'title'],
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    pass: { type: 'integer' },
    fail: { type: 'integer' },
    blocked: { type: 'integer' },
    clusters: { type: 'integer' },
  },
  required: ['total', 'pass', 'fail', 'blocked', 'clusters'],
}

function cwdOf(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

function resolveRoot(root, exec) {
  return path.isAbsolute(root) ? root : path.resolve(cwdOf(exec), root)
}

function summarizeCluster(cluster) {
  const suspect = cluster.suspects?.find((s) => s.verified) ?? cluster.suspects?.[0]
  return {
    cluster_id: cluster.cluster_id,
    kind: cluster.kind,
    size: cluster.size,
    score: cluster.score,
    title: cluster.title,
    ...(cluster.repro ? { repro: cluster.repro } : {}),
    ...(suspect
      ? { suspect: { file: suspect.file, line: suspect.line, verified: Boolean(suspect.verified), reason: suspect.reason } }
      : {}),
  }
}

function loadFrom(root, runId, exec) {
  const absolute = resolveRoot(root, exec)
  const run = loadRun(absolute, runId)
  if (!run) {
    throw new Error(
      runId
        ? `dv-triage: run "${runId}" not found under ${absolute}/.dsh-dv/runs`
        : `dv-triage: no run index under ${absolute}; call dv_scan first`,
    )
  }
  return run
}

function renderText(text) {
  return [{ type: 'text', text }]
}

export function createTools() {
  return [
    {
      name: 'dv_scan',
      description:
        'Scan a regression result directory (VCS/Xcelium/Questa/Verilator/Icarus logs), cluster failures by root cause, rank them, and persist a run index. Read-only w.r.t. the simulator: no simulation is started. Returns the run id plus the top failure clusters with evidence pointers and repro commands.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', description: 'Regression result directory, absolute or relative to the workspace' },
          profile: { type: 'string', enum: ['vcs', 'questa', 'verilator', 'icarus'], description: 'Force a log profile (default: auto-detect)' },
          top: { type: 'integer', minimum: 1, maximum: 20, description: 'Clusters to return (default 5)' },
        },
        required: ['root'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            run_id: { type: 'string' },
            root: { type: 'string' },
            profile: { type: 'string' },
            summary: SUMMARY_SCHEMA,
            clusters: { type: 'array', items: CLUSTER_SUMMARY_SCHEMA },
          },
          required: ['run_id', 'root', 'profile', 'summary', 'clusters'],
        },
        render: (_args, value) =>
          renderText(
            [
              `run ${value.run_id} · ${value.profile}`,
              formatClusters(value, value.clusters.length),
              '',
              'Next: dv_cluster {root, cluster_id} for evidence; dv_report for Markdown/HTML.',
            ].join('\n'),
          ),
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const root = resolveRoot(args.root, exec)
        const run = scan(root, { profile: args.profile })
        const top = args.top ?? 5
        return {
          run_id: run.run_id,
          root: run.root,
          profile: run.profile,
          summary: run.summary,
          clusters: run.clusters.slice(0, top).map(summarizeCluster),
        }
      },
    },

    {
      name: 'dv_clusters',
      description:
        'List ranked failure clusters from a persisted dv_scan run. Use this to re-read a run without rescanning or to page through clusters beyond the top 5.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', description: 'Regression result directory used for dv_scan' },
          run_id: { type: 'string', description: 'Run id (default: latest)' },
          top: { type: 'integer', minimum: 1, maximum: 50, description: 'Clusters to return (default 10)' },
        },
        required: ['root'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            run_id: { type: 'string' },
            profile: { type: 'string' },
            summary: SUMMARY_SCHEMA,
            clusters: { type: 'array', items: CLUSTER_SUMMARY_SCHEMA },
          },
          required: ['run_id', 'profile', 'summary', 'clusters'],
        },
        render: (_args, value) =>
          renderText([formatClusters(value, value.clusters.length), '', `run ${value.run_id}`].join('\n')),
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const run = loadFrom(args.root, args.run_id, exec)
        return {
          run_id: run.run_id,
          profile: run.profile,
          summary: run.summary,
          clusters: run.clusters.slice(0, args.top ?? 10).map(summarizeCluster),
        }
      },
    },

    {
      name: 'dv_cluster',
      description:
        'Show one failure cluster in detail: evidence log excerpts with line numbers, the repro command, fine-signature variants, and verified source suspects. Every shown source pointer has been re-read and verified; unverified pointers are labelled.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', description: 'Regression result directory used for dv_scan' },
          cluster_id: { type: 'string', description: 'Cluster id, e.g. c01' },
          run_id: { type: 'string', description: 'Run id (default: latest)' },
        },
        required: ['root', 'cluster_id'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            cluster_id: { type: 'string' },
            title: { type: 'string' },
            kind: { type: 'string' },
            size: { type: 'integer' },
            score: { type: 'number' },
            repro: { type: 'string' },
            suspects: { type: 'array', items: { type: 'object' } },
            evidence: { type: 'array', items: { type: 'object' } },
          },
          required: ['cluster_id', 'title', 'kind', 'size', 'score', 'suspects', 'evidence'],
        },
        render: (_args, value) =>
          renderText(
            [
              `${value.cluster_id} · ${value.title}`,
              `kind=${value.kind} size=${value.size} score=${value.score}`,
              ...(value.repro ? [`repro: ${value.repro}`] : []),
              '',
              ...value.evidence.map((e) =>
                [
                  `evidence ${e.test_id} (${e.rel_log}:${e.start}-${e.end}):`,
                  ...e.lines.map((l) => `  ${String(l.line).padStart(6)} | ${l.text}`),
                ].join('\n'),
              ),
            ].join('\n'),
          ),
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const run = loadFrom(args.root, args.run_id, exec)
        const cluster = run.clusters.find((c) => c.cluster_id === args.cluster_id)
        if (!cluster) throw new Error(`dv-triage: cluster "${args.cluster_id}" not found in run ${run.run_id}`)
        return {
          cluster_id: cluster.cluster_id,
          title: cluster.title,
          kind: cluster.kind,
          size: cluster.size,
          score: cluster.score,
          ...(cluster.repro ? { repro: cluster.repro } : {}),
          suspects: cluster.suspects,
          evidence: cluster.evidence,
        }
      },
    },

    {
      name: 'dv_diff',
      description:
        'Compare two regression result directories by test id and report new failures, fixed tests, and persisting failures. Useful for nightly triage: "what broke since yesterday".',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          before: { type: 'string', description: 'Older regression directory' },
          after: { type: 'string', description: 'Newer regression directory' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Items per list (default 10)' },
        },
        required: ['before', 'after'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            before: { type: 'string' },
            after: { type: 'string' },
            new_failures: { type: 'array', items: { type: 'object' } },
            fixed: { type: 'array', items: { type: 'object' } },
            persisting: { type: 'integer' },
          },
          required: ['before', 'after', 'new_failures', 'fixed', 'persisting'],
        },
        render: (_args, value) =>
          renderText(
            [
              `diff ${value.before} → ${value.after}`,
              `new failures: ${value.new_failures.length} · fixed: ${value.fixed.length} · persisting: ${value.persisting}`,
              '',
              ...value.new_failures.map((t) => `+ ${t.test_id} (${t.before} → ${t.after})`),
              ...value.fixed.map((t) => `- ${t.test_id} (${t.before} → ${t.after})`),
            ].join('\n'),
          ),
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const beforeRoot = resolveRoot(args.before, exec)
        const afterRoot = resolveRoot(args.after, exec)
        const beforeRun = scan(beforeRoot)
        const afterRun = scan(afterRoot)
        const { newFailures, fixed, persisting } = diffRuns(beforeRun, afterRun)
        const limit = args.limit ?? 10
        return {
          before: beforeRun.root,
          after: afterRun.root,
          new_failures: newFailures.slice(0, limit),
          fixed: fixed.slice(0, limit),
          persisting: persisting.length,
        }
      },
    },

    {
      name: 'dv_report',
      description:
        'Write a Markdown or HTML triage report (cluster table, evidence excerpts, repro commands, verified suspects) for a persisted run. Returns the report path.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', description: 'Regression result directory used for dv_scan' },
          run_id: { type: 'string', description: 'Run id (default: latest)' },
          format: { type: 'string', enum: ['md', 'html'], description: 'Report format (default md)' },
          out: { type: 'string', description: 'Output path (default <root>/.dsh-dv/triage-<run>.md)' },
        },
        required: ['root'],
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, format: { type: 'string' }, run_id: { type: 'string' } },
          required: ['path', 'format', 'run_id'],
        },
        render: (_args, value) => renderText(`${value.format} report: ${value.path}`),
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const run = loadFrom(args.root, args.run_id, exec)
        const format = args.format ?? 'md'
        const out = args.out ? path.resolve(cwdOf(exec), args.out) : undefined
        return { path: writeReport(run, format, out), format, run_id: run.run_id }
      },
    },
  ]
}

export function apply(ctx) {
  const disposers = createTools().map((tool) => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
