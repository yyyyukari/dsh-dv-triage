import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

function fillLines(count, marker) {
  return Array.from({ length: count }, (_, i) => `// ${marker} line ${i + 1}`)
}

/** Create small but realistic RTL/TB stubs so source pointers can be verified. */
function makeSources(root) {
  const arbiter = fillLines(240, 'arbiter.sv')
  arbiter[211] = '  assign grant_q = req & ~ack;  // grant_q: undeclared in this scope'
  write(path.join(root, 'rtl', 'arbiter.sv'), arbiter.join('\n'))

  const scoreboard = fillLines(140, 'scoreboard.sv')
  scoreboard[87] = '    if (!flush) compare(expected, actual);  // flush missing after reset'
  write(path.join(root, 'rtl', 'scoreboard.sv'), scoreboard.join('\n'))

  const iface = fillLines(80, 'if.sv')
  iface[41] = '  assert property (a_req_ack) else $error("req/ack violation");'
  write(path.join(root, 'tb', 'if.sv'), iface.join('\n'))
}

function compileLog(n) {
  return [
    'Command: vcs -full64 -sverilog -ntb_opts uvm tb/top.sv rtl/arbiter.sv',
    'Error-[SE] Syntax error',
    '  "rtl/arbiter.sv", 212: grant_q is not declared',
    '',
  ].join('\n')
}

function xpropLog(n, pass) {
  const name = `xprop_${String(n).padStart(2, '0')}`
  return [
    `UVM_INFO @ 0: reporter [RNTST] Running test ${name}...`,
    pass
      ? 'UVM_INFO @ 2040ns: reporter [TEST_DONE] test passed'
      : 'UVM_ERROR @ 152300ns: uvm_test_top.env.scoreboard [X_PROP] X detected on data_bus',
  ].join('\n')
}

function assertLog(n, pass) {
  const name = `assert_${String(n).padStart(2, '0')}`
  return [
    `UVM_INFO @ 0: reporter [RNTST] Running test ${name}...`,
    pass
      ? 'UVM_INFO @ 150ns: reporter [TEST_DONE] test passed'
      : [
          '"tb/if.sv", 42: tb.dut.a_req_ack: started at 100ns failed at 150ns',
          "Offending '(req && !ack)'",
        ].join('\n'),
  ].join('\n')
}

function timeoutLog(n) {
  const name = `timeout_${String(n).padStart(2, '0')}`
  return [
    `UVM_INFO @ 0: reporter [RNTST] Running test ${name}...`,
    'UVM_FATAL @ 1000000ns: uvm_test_top.env.agent [TIMEOUT] Timeout waiting for response',
  ].join('\n')
}

function mismatchLog(n, pass) {
  const name = `mismatch_${String(n).padStart(2, '0')}`
  const value = (0x1000 + n * 0x111).toString(16)
  return [
    `UVM_INFO @ 0: reporter [RNTST] Running test ${name}...`,
    pass
      ? 'UVM_INFO @ 88000ns: reporter [TEST_DONE] test passed'
      : `UVM_ERROR @ 88000ns: uvm_test_top.env.scoreboard [SCB_MISMATCH] addr=0x1f0${n} data=0x${value} expected=0x00000001`,
  ].join('\n')
}

function passLog(n) {
  const name = `pass_${String(n).padStart(2, '0')}`
  return [
    `UVM_INFO @ 0: reporter [RNTST] Running test ${name}...`,
    'UVM_INFO @ 2000ns: reporter [TEST_DONE] test passed',
  ].join('\n')
}

/**
 * Build a two-day synthetic regression under `<root>/demo`:
 * - day 1: 7 xprop failures, 5 assert failures, 12 compile-blocked, 4 timeouts
 * - day 2: xprop_08 fixed; assert_06 and all 5 mismatches newly fail
 */
export function makeDemo(root = process.cwd()) {
  const demo = path.join(root, 'demo')
  const day1 = path.join(demo, 'regress-2026-11-08')
  const day2 = path.join(demo, 'regress-2026-11-09')
  for (const dir of [day1, day2]) {
    fs.rmSync(dir, { recursive: true, force: true })
    makeSources(dir)
  }

  let seed = 100
  // Day 1
  for (let n = 1; n <= 12; n++) write(path.join(day1, `compile_${String(n).padStart(2, '0')}__${++seed}.log`), compileLog(n))
  for (let n = 1; n <= 8; n++) write(path.join(day1, `xprop_${String(n).padStart(2, '0')}__${++seed}.log`), xpropLog(n, n === 8))
  for (let n = 1; n <= 6; n++) write(path.join(day1, `assert_${String(n).padStart(2, '0')}__${++seed}.log`), assertLog(n, false))
  for (let n = 1; n <= 4; n++) write(path.join(day1, `timeout_${String(n).padStart(2, '0')}__${++seed}.log`), timeoutLog(n))
  for (let n = 1; n <= 5; n++) write(path.join(day1, `mismatch_${String(n).padStart(2, '0')}__${++seed}.log`), mismatchLog(n, true))
  for (let n = 1; n <= 25; n++) write(path.join(day1, `pass_${String(n).padStart(2, '0')}__${++seed}.log`), passLog(n))

  // Day 2: xprop_08 fixed, assert_06 and all mismatches fail.
  for (let n = 1; n <= 12; n++) write(path.join(day2, `compile_${String(n).padStart(2, '0')}__${++seed}.log`), compileLog(n))
  for (let n = 1; n <= 8; n++) write(path.join(day2, `xprop_${String(n).padStart(2, '0')}__${++seed}.log`), xpropLog(n, n === 8))
  for (let n = 1; n <= 6; n++) write(path.join(day2, `assert_${String(n).padStart(2, '0')}__${++seed}.log`), assertLog(n, n === 6))
  for (let n = 1; n <= 4; n++) write(path.join(day2, `timeout_${String(n).padStart(2, '0')}__${++seed}.log`), timeoutLog(n))
  for (let n = 1; n <= 5; n++) write(path.join(day2, `mismatch_${String(n).padStart(2, '0')}__${++seed}.log`), mismatchLog(n, false))
  for (let n = 1; n <= 25; n++) write(path.join(day2, `pass_${String(n).padStart(2, '0')}__${++seed}.log`), passLog(n))

  write(
    path.join(demo, 'README.md'),
    [
      '# Synthetic regression demo',
      '',
      'Generated by `node bin/dv-triage.js demo`.',
      '',
      '- `regress-2026-11-08/`: baseline (xprop_08 fails, mismatch_01..05 pass)',
      '- `regress-2026-11-09/`: 60 tests, 12 compile-blocked, 23 failing, 25 passing',
      '',
      'Try:',
      '',
      '```sh',
      'node bin/dv-triage.js demo',
      'node bin/dv-triage.js scan demo/regress-2026-11-09',
      'node bin/dv-triage.js diff demo/regress-2026-11-08 demo/regress-2026-11-09',
      '```',
    ].join('\n'),
  )

  return { demo, day1, day2 }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { demo } = makeDemo(process.cwd())
  console.log(`demo regression generated at ${demo}`)
}
