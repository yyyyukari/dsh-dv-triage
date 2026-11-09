import assert from 'node:assert/strict'
import test from 'node:test'
import { coarseKey, normalizeHierarchy, normalizeMessage } from '../lib/core/normalize.js'

test('normalizes volatile values but keeps diagnostics', () => {
  const a = normalizeMessage('UVM_ERROR @ 152300ns: env.agent[3].mon [SCB] addr=0x1f00 seed=12345')
  const b = normalizeMessage('UVM_ERROR @ 999ns: env.agent[7].mon [SCB] addr=0xbeef seed=999')
  const c = normalizeMessage('UVM_ERROR @ 1ns: env.agent[1].mon [OTHER] addr=0x1 seed=1')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /<t>/)
  assert.match(a, /0x<hex>/)
  assert.match(a, /env\.agent\[\*\]\.mon/)
})

test('coarse key ignores time, seed and instance index', () => {
  const one = { kind: 'uvm_error', tag: 'X_PROP', hierarchy: 'uvm_test_top.env.agent[2].mon' }
  const two = { kind: 'uvm_error', tag: 'X_PROP', hierarchy: 'uvm_test_top.env.agent[9].mon' }
  assert.equal(coarseKey(one), coarseKey(two))
})

test('coarse key separates different tags', () => {
  const a = { kind: 'uvm_error', tag: 'X_PROP', hierarchy: 'top.env.scb' }
  const b = { kind: 'uvm_error', tag: 'SCB_MISMATCH', hierarchy: 'top.env.scb' }
  assert.notEqual(coarseKey(a), coarseKey(b))
})

test('hierarchy normalization', () => {
  assert.equal(normalizeHierarchy('top.agent[12].mon'), 'top.agent[*].mon')
})
