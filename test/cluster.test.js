import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDemo } from '../scripts/make-demo.mjs'
import { scan } from '../lib/core/triage.js'
import { verifySource } from '../lib/core/verify.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-triage-cluster-'))
const { day1, day2 } = makeDemo(tmp)

test('demo scan yields five ranked clusters', () => {
  const run = scan(day2)
  assert.equal(run.summary.total, 60)
  assert.equal(run.summary.blocked, 12)
  assert.equal(run.clusters.length, 5)
  assert.equal(run.clusters[0].kind, 'compile')
  assert.equal(run.clusters[0].size, 12)
  assert.equal(run.clusters[0].suspects[0].verified, true)
  const assertion = run.clusters.find((c) => c.kind === 'assertion')
  assert.equal(assertion.size, 5)
  assert.equal(assertion.suspects[0].verified, true)
  const mismatch = run.clusters.find((c) => c.kind === 'mismatch')
  assert.equal(mismatch.size, 5)
  assert.equal(mismatch.fine.length, 5)
})

test('compile cluster ranks above a low-severity mismatch cluster', () => {
  const run = scan(day2)
  const compile = run.clusters.find((c) => c.kind === 'compile')
  const mismatch = run.clusters.find((c) => c.kind === 'mismatch')
  assert.ok(compile.score > mismatch.score)
})

test('diff reports new failures and one fixed test', () => {
  const before = scan(day1)
  const after = scan(day2)
  assert.equal(before.summary.total, 60)
  // diffRuns is imported lazily to keep this test readable.
  return import('../lib/core/triage.js').then(({ diffRuns }) => {
    const diff = diffRuns(before, after)
    assert.equal(diff.newFailures.length, 5)
    assert.equal(diff.fixed.length, 1)
  })
})

test('verifySource rejects a wrong line and a missing file', () => {
  const ok = verifySource(day2, 'rtl/arbiter.sv', 212, 'grant_q')
  assert.equal(ok.verified, true)
  const wrongLine = verifySource(day2, 'rtl/arbiter.sv', 1, 'grant_q')
  assert.equal(wrongLine.verified, false)
  const missing = verifySource(day2, 'rtl/nope.sv', 1, 'x')
  assert.equal(missing.verified, false)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
