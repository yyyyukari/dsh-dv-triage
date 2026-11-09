import fs from 'node:fs'
import path from 'node:path'

function fmtPct(n, total) {
  return total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`
}

function mdEscape(text = '') {
  return String(text).replace(/\|/g, '\\|')
}

export function renderMarkdown(run) {
  const { summary } = run
  const lines = []
  lines.push(`# DV triage — ${run.root}`)
  lines.push('')
  lines.push(`Run: \`${run.run_id}\` · profile: **${run.profile}** · ${new Date(run.created_at).toLocaleString()}`)
  lines.push('')
  lines.push(`**${summary.total} tests** · ${summary.pass} pass · ${summary.fail} fail · ${summary.blocked} blocked · **${summary.clusters} clusters**`)
  lines.push('')
  lines.push('## Clusters (fix order)')
  lines.push('')
  lines.push('| # | kind | tests | score | title | suspect |')
  lines.push('|---|---|---|---|---|---|')
  for (const cluster of run.clusters) {
    const suspect = cluster.suspects.find((s) => s.verified) ?? cluster.suspects[0]
    const where = suspect ? `\`${suspect.file}:${suspect.line}\`${suspect.verified ? '' : ' (unverified)'}` : '—'
    lines.push(`| ${cluster.cluster_id} | ${cluster.kind} | ${cluster.size} | ${cluster.score} | ${mdEscape(cluster.title)} | ${where} |`)
  }
  lines.push('')

  for (const cluster of run.clusters) {
    lines.push(`## ${cluster.cluster_id} · ${cluster.title}`)
    lines.push('')
    lines.push(`- 规模：${cluster.size} tests（${fmtPct(cluster.size, summary.total)}）`)
    lines.push(`- 类型：${cluster.kind}${cluster.tag ? ` · tag \`${cluster.tag}\`` : ''}`)
    if (cluster.repro) lines.push(`- 复现：\`${cluster.repro}\``)
    if (cluster.fine.length > 1) {
      lines.push(`- 簇内变体：${cluster.fine.length} 种（top: \`${cluster.fine[0].sample}\`）`)
    }
    if (cluster.suspects.length) {
      for (const suspect of cluster.suspects) {
        const mark = suspect.verified ? '✅ verified' : `⚠️ ${suspect.reason}`
        lines.push(`- 可疑源码：\`${suspect.file}:${suspect.line}\` — ${mark}`)
      }
    }
    lines.push('')
    lines.push('<details><summary>证据</summary>')
    lines.push('')
    for (const evidence of cluster.evidence) {
      lines.push(`### ${evidence.test_id} (${evidence.rel_log}:${evidence.start}-${evidence.end})`)
      lines.push('```')
      for (const line of evidence.lines) lines.push(`${String(line.line).padStart(6)} | ${line.text}`)
      lines.push('```')
      lines.push('')
    }
    lines.push('</details>')
    lines.push('')
  }

  if (run.errors.length) {
    lines.push('## Parse errors')
    lines.push('')
    for (const error of run.errors) lines.push(`- \`${error.file}\`: ${error.error}`)
    lines.push('')
  }
  return lines.join('\n')
}

function esc(text = '') {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

export function renderHtml(run) {
  const cards = run.clusters
    .map((cluster) => {
      const suspect = cluster.suspects.find((s) => s.verified) ?? cluster.suspects[0]
      const where = suspect
        ? `<code>${esc(suspect.file)}:${suspect.line}</code> ${suspect.verified ? '<span class="ok">verified</span>' : `<span class="warn">${esc(suspect.reason)}</span>`}`
        : '<span class="muted">no source pointer</span>'
      const evidence = cluster.evidence
        .map(
          (e) => `<pre><code>${esc(e.lines.map((l) => `${String(l.line).padStart(5)} | ${l.text}`).join('\n'))}</code></pre>`,
        )
        .join('')
      return `<section class="card">
  <header><span class="id">${cluster.cluster_id}</span><span class="kind ${cluster.kind}">${esc(cluster.kind)}</span><span class="size">${cluster.size} tests</span><span class="score">score ${cluster.score}</span></header>
  <h2>${esc(cluster.title)}</h2>
  <p>${where}</p>
  ${cluster.repro ? `<p class="repro">repro: <code>${esc(cluster.repro)}</code></p>` : ''}
  <details><summary>evidence</summary>${evidence}</details>
</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DV triage — ${esc(run.run_id)}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.5 -apple-system,"Segoe UI",sans-serif}
header.top{padding:24px 28px;border-bottom:1px solid #30363d}h1{margin:0 0 6px;font-size:20px}
.summary{color:#8b949e}.summary b{color:#e6edf3}
main{padding:20px 28px;display:grid;gap:14px}
.card{border:1px solid #30363d;border-radius:10px;padding:14px 16px;background:#161b22}
.card header{display:flex;gap:10px;align-items:center;font-size:12px;color:#8b949e}
.id{color:#58a6ff;font-weight:700}.kind{padding:1px 7px;border-radius:999px;border:1px solid #30363d}
.kind.compile,.kind.timeout{color:#f85149;border-color:#f8514955}.kind.uvm_fatal{color:#ff7b72}
.kind.assertion{color:#d29922}.size,.score{margin-left:auto}.score{color:#8b949e}
h2{font-size:15px;margin:8px 0 6px}code{background:#0d1117;padding:1px 5px;border-radius:4px}
.ok{color:#3fb950}.warn{color:#d29922}.muted{color:#6e7681}
pre{overflow:auto;background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:10px;font-size:12px}
details summary{cursor:pointer;color:#8b949e;font-size:12px}
.repro{color:#8b949e;font-size:13px}
</style></head><body>
<header class="top"><h1>DV triage</h1><div class="summary">${esc(run.root)}<br>run <code>${esc(run.run_id)}</code> · ${esc(run.profile)} · <b>${run.summary.total}</b> tests · <b>${run.summary.fail}</b> fail · <b>${run.summary.blocked}</b> blocked · <b>${run.summary.clusters}</b> clusters</div></header>
<main>${cards}</main></body></html>`
}

export function writeReport(run, format = 'md', outPath) {
  const root = run.root
  const ext = format === 'html' ? 'html' : 'md'
  const target = outPath ?? path.join(root, `.dsh-dv`, `triage-${run.run_id}.${ext}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, format === 'html' ? renderHtml(run) : renderMarkdown(run), 'utf8')
  return target
}
