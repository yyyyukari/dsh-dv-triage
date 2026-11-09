import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, createTools } from '../lib/index.js'
import { makeDemo } from '../scripts/make-demo.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-triage-plugin-'))
const { day1, day2 } = makeDemo(tmp)

test('plugin registers five dv_* tools with output renderers', () => {
  const defs = []
  const ctx = { tools: { register: (definition) => { defs.push(definition); return () => {} } } }
  const dispose = apply(ctx)
  assert.deepEqual(defs.map((d) => d.name).sort(), ['dv_cluster', 'dv_clusters', 'dv_diff', 'dv_report', 'dv_scan'])
  for (const def of defs) {
    assert.equal(typeof def.execute, 'function')
    assert.equal(typeof def.output.render, 'function')
    assert.equal(def.parameters.type, 'object')
  }
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('tools execute end to end on the demo regression', async () => {
  const defs = createTools()
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]))
  const exec = { agent: { session: { header: { cwd: tmp } } } }

  const scanned = await byName.dv_scan.execute({ root: day2, top: 3 }, exec)
  assert.equal(scanned.summary.total, 60)
  assert.equal(scanned.clusters.length, 3)
  assert.equal(scanned.clusters[0].kind, 'compile')

  const listed = await byName.dv_clusters.execute({ root: day2, top: 10 }, exec)
  assert.equal(listed.clusters.length, 5)

  const detail = await byName.dv_cluster.execute({ root: day2, cluster_id: 'c01' }, exec)
  assert.equal(detail.cluster_id, 'c01')
  assert.ok(detail.evidence.length > 0)
  assert.ok(detail.suspects.some((s) => s.verified))

  const report = await byName.dv_report.execute({ root: day2, format: 'html' }, exec)
  assert.ok(fs.existsSync(report.path))
  assert.match(fs.readFileSync(report.path, 'utf8'), /DV triage/)

  const diff = await byName.dv_diff.execute({ before: day1, after: day2 }, exec)
  assert.equal(diff.new_failures.length, 5)
  assert.equal(diff.fixed.length, 1)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
