import fs from 'node:fs'

/** Supported log profiles. A profile is a small, data-driven description; adding
 * a vendor means adding a detector + the regexes used by parse.js. */
export const PROFILE_NAMES = ['vcs', 'questa', 'verilator', 'icarus']

const DETECTORS = [
  ['verilator', /^%Error:|^%Warning:/m],
  ['questa', /^#\s\*\* (?:Error|Fatal)/m],
  ['questa', /^#\s*UVM_(?:ERROR|FATAL)/m],
  ['icarus', /^[^\s:]+\.(?:v|sv):\d+:\s*(?:error|syntax error)/m],
  ['vcs', /^Error-\[[A-Z0-9_]+\]/m],
  ['vcs', /^UVM_(?:ERROR|FATAL)\s*@/m],
  ['vcs', /^\s*"[^"]+\.(?:sv|svh|v|vh|vhd)",\s*\d+:\s*[\w.$]+:\s*started at/m],
]

/** Detect the simulator from the first bytes of a log. Defaults to vcs. */
export function detectProfile(text) {
  const head = text.slice(0, 64 * 1024)
  for (const [name, re] of DETECTORS) {
    if (re.test(head)) return name
  }
  return 'vcs'
}

/** Strip a leading Questa comment marker so one parser can read both styles. */
export function stripProfileLine(profile, line) {
  return profile === 'questa' ? line.replace(/^#\s?/, '') : line
}

export function profileExists(name) {
  return PROFILE_NAMES.includes(name)
}

/** Read a log defensively: normalize CRLF and invalid UTF-8. */
export function readLogText(filePath) {
  const buf = fs.readFileSync(filePath)
  return buf.toString('utf8').replace(/^\uFEFF/, '')
}
