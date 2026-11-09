import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDemo } from '../scripts/make-demo.mjs'
import { parseLog } from '../lib/core/parse.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-triage-'))
const { day2 } = makeDemo(tmp)
const log = (name) => path.join(day2, fs.readdirSync(day2).find((f) => f.startsWith(name)))

test('compile failure is blocked and carries a verified location', () => {
  const result = parseLog(log('compile_01'), { root: day2 })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'compile')
  assert.equal(result.events[0].kind, 'compile')
  assert.equal(result.events[0].file, 'rtl/arbiter.sv')
  assert.equal(result.events[0].srcLine, 212)
  assert.equal(result.events[0].needle, 'grant_q')
})

test('assertion failure is an assertion event, not a compile event', () => {
  const result = parseLog(log('assert_01'), { root: day2 })
  assert.equal(result.status, 'fail')
  assert.equal(result.reason, 'assertion')
  assert.equal(result.events[0].kind, 'assertion')
  assert.equal(result.events[0].assertName, 'tb.dut.a_req_ack')
  assert.equal(result.events[0].file, 'tb/if.sv')
})

test('timeout outranks a generic UVM error', () => {
  const result = parseLog(log('timeout_01'), { root: day2 })
  assert.equal(result.reason, 'timeout')
  assert.equal(result.events[0].kind, 'timeout')
})

test('passing test has no failure events', () => {
  const result = parseLog(log('pass_01'), { root: day2 })
  assert.equal(result.status, 'pass')
  assert.equal(result.events.length, 0)
})

test('seed is read from the file name', () => {
  const result = parseLog(log('pass_01'), { root: day2 })
  assert.equal(typeof result.seed, 'number')
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
