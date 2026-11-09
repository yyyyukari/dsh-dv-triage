import fs from 'node:fs'
import path from 'node:path'
import { detectProfile, readLogText, stripProfileLine } from './profiles.js'

const RE_UVM = /^UVM_(ERROR|FATAL)\s*@\s*([\d.]+)\s*(fs|ps|ns|us|ms|s)?\s*:\s*(.*)$/
const RE_UVM_HEAD = /^([A-Za-z_][\w.$[\]]*)\s*(?:\[([^\]]*)\])?\s*(.*)$/
const RE_ASSERT = /^\s*"([^"]+\.(?:sv|svh|v|vh|vhd))",\s*(\d+):\s*([\w.$]+):\s*started at .*?failed at/i
const RE_TEST = /Running test\s+([A-Za-z_][\w$]*)/i
const RE_SEED = /\+ntb_random_seed[= ]+(\d+)|(?:^|\s)seed[=: ]+(\d+)/i
const RE_COMPILE_CODE = /^Error-\[([A-Z0-9_]+)\]\s*(.*)$/i
const RE_QUOTED_LOC = /^\s*"([^"]+\.(?:sv|svh|v|vh|vhd))",\s*(\d+):\s*(.*)$/
const RE_VERILATOR = /^%Error:\s*([^:\s]+):(\d+):\s*(.*)$/
const RE_ICARUS = /^([^\s:]+\.(?:v|sv)):(\d+):\s*(?:error|syntax error):?\s*(.*)$/i
const RE_NEEDLE = /([A-Za-z_]\w*)\s+is not declared/
const RE_OFFENDING = /^(?:Offending|Scope|File|at time)\b/i

const PRIORITY = ['compile', 'timeout', 'uvm_fatal', 'assertion', 'mismatch', 'uvm_error', 'error']

export function deriveStatus(events) {
  const kinds = new Set(events.map((e) => e.kind))
  if (kinds.has('compile')) return { status: 'blocked', reason: 'compile' }
  if (kinds.has('timeout')) return { status: 'fail', reason: 'timeout' }
  if (kinds.has('uvm_fatal')) return { status: 'fail', reason: 'fatal' }
  if (kinds.has('assertion')) return { status: 'fail', reason: 'assertion' }
  if (kinds.has('mismatch')) return { status: 'fail', reason: 'mismatch' }
  if (kinds.has('uvm_error')) return { status: 'fail', reason: 'error' }
  if (kinds.has('error')) return { status: 'fail', reason: 'error' }
  return { status: 'pass', reason: 'pass' }
}

/** Pick the event that represents a test for clustering. */
export function primaryEvent(test) {
  if (!test.events.length) return undefined
  for (const kind of PRIORITY) {
    const hit = test.events.find((e) => e.kind === kind)
    if (hit) return hit
  }
  return test.events[0]
}

function parseUvm(rest) {
  const m = rest.match(RE_UVM_HEAD)
  if (!m) return { hierarchy: '', tag: '', message: rest }
  return { hierarchy: m[1], tag: m[2] ?? '', message: m[3] ?? '' }
}

function testIdFromFile(filePath) {
  const base = path.basename(filePath).replace(/\.(?:log|txt)$/i, '')
  return base.replace(/(?:__|_)\d{3,}$/, '') || base
}

function seedFromFile(filePath) {
  const m = path.basename(filePath).match(/(?:__|_)(\d{3,})(?:\.|$)/)
  return m ? Number(m[1]) : undefined
}

function siblingWave(filePath) {
  for (const ext of ['.vcd', '.fst', '.fsdb']) {
    const candidate = filePath.replace(/\.(?:log|txt)$/i, ext)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Parse one log file into a TestResult.
 * v0.1 reads the file fully; logs > 64 MiB are rejected with a clear error.
 */
export function parseLog(filePath, options = {}) {
  const { root = path.dirname(filePath), profile: forcedProfile } = options
  const raw = readLogText(filePath)
  if (raw.length > 64 * 1024 * 1024) {
    throw new Error(`dv-triage: log too large for v0.1 (${raw.length} bytes): ${filePath}`)
  }
  const lines = raw.split(/\r?\n/)
  const detected = forcedProfile || detectProfile(raw)
  const events = []
  const testName = lines.map((l) => l.match(RE_TEST)?.[1]).find(Boolean)
  const seedLine = lines.map((l) => l.match(RE_SEED)).find(Boolean)
  let lastCompile

  for (let i = 0; i < lines.length; i++) {
    const line = stripProfileLine(detected, lines[i])
    const trimmed = line.trim()
    if (!trimmed) continue

    // Assertion failure and its multi-line block. Checked before the generic
    // quoted-location pattern, because assertion lines also start with
    // "file.sv", <line>:.
    const assertMatch = line.match(RE_ASSERT)
    if (assertMatch) {
      const evt = {
        kind: 'assertion',
        code: 'SVA',
        file: assertMatch[1],
        srcLine: Number(assertMatch[2]),
        assertName: assertMatch[3],
        message: trimmed,
        line: i + 1,
        excerptEnd: i + 1,
      }
      events.push(evt)
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const next = stripProfileLine(detected, lines[j]).trim()
        if (!next) break
        if (!RE_OFFENDING.test(next)) break
        evt.message += ' | ' + next
        evt.excerptEnd = j + 1
        i = j
      }
      continue
    }

    // A compile error block: Error-[CODE] on one line, quoted location on the next.
    const codeMatch = line.match(RE_COMPILE_CODE)
    if (codeMatch) {
      lastCompile = {
        kind: 'compile',
        code: codeMatch[1],
        message: codeMatch[2].trim(),
        line: i + 1,
        excerptEnd: i + 1,
      }
      events.push(lastCompile)
      continue
    }

    const locMatch = line.match(RE_QUOTED_LOC)
    if (locMatch) {
      const evt = lastCompile && i - (lastCompile.line - 1) <= 4 ? lastCompile : undefined
      const target = evt ?? {
        kind: 'compile',
        code: 'LOC',
        message: '',
        line: i + 1,
        excerptEnd: i + 1,
      }
      target.file = locMatch[1]
      target.srcLine = Number(locMatch[2])
      target.message = [target.message, locMatch[3]].filter(Boolean).join(' ').trim()
      target.needle = target.message.match(RE_NEEDLE)?.[1]
      target.excerptEnd = Math.max(target.excerptEnd ?? i + 1, i + 1)
      if (!evt) events.push(target)
      continue
    }

    // UVM report line.
    const uvmMatch = line.match(RE_UVM)
    if (uvmMatch) {
      const [, severity, time, unit, rest] = uvmMatch
      const { hierarchy, tag, message } = parseUvm(rest)
      let kind = severity === 'FATAL' ? 'uvm_fatal' : 'uvm_error'
      if (/TIMEOUT|WATCHDOG/i.test(tag) || /TIMEOUT|WATCHDOG/i.test(message)) kind = 'timeout'
      else if (/MISMATCH/i.test(tag)) kind = 'mismatch'
      events.push({
        kind,
        code: tag || severity,
        tag,
        hierarchy,
        message,
        time: Number(time),
        unit: unit ?? 'ns',
        line: i + 1,
        excerptEnd: i + 1,
      })
      continue
    }

    // Verilator / Icarus single-line errors.
    const vMatch = line.match(RE_VERILATOR)
    if (vMatch) {
      const message = vMatch[3]
      const kind = /Assertion|assert/i.test(message) ? 'assertion' : /Cannot find|syntax|Parse/i.test(message) ? 'compile' : 'error'
      events.push({
        kind,
        code: 'VERILATOR',
        file: vMatch[1],
        srcLine: Number(vMatch[2]),
        message,
        line: i + 1,
        excerptEnd: i + 1,
        assertName: kind === 'assertion' ? (message.match(/Assertion\s+([\w.$]+)/i)?.[1] ?? '') : undefined,
      })
      continue
    }
    const iMatch = line.match(RE_ICARUS)
    if (iMatch) {
      events.push({
        kind: 'compile',
        code: 'ICARUS',
        file: iMatch[1],
        srcLine: Number(iMatch[2]),
        message: iMatch[3],
        line: i + 1,
        excerptEnd: i + 1,
      })
    }
  }

  const { status, reason } = deriveStatus(events)
  return {
    test_id: testName ?? testIdFromFile(filePath),
    log: path.resolve(filePath),
    rel_log: path.relative(root, filePath),
    profile: detected,
    seed: seedLine ? Number(seedLine[1] ?? seedLine[2]) : seedFromFile(filePath),
    status,
    reason,
    wave: siblingWave(filePath),
    events,
  }
}

/** Extract the log excerpt around an event (used for evidence). */
export function readExcerpt(filePath, line, endLine, radius = 2) {
  const raw = readLogText(filePath)
  const lines = raw.split(/\r?\n/)
  const start = Math.max(1, line - radius)
  let end = Math.min(lines.length, (endLine ?? line) + radius)
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return {
    start,
    end,
    lines: lines.slice(start - 1, end).map((text, idx) => ({ line: start + idx, text })),
  }
}
