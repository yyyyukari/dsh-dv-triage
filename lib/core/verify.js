import fs from 'node:fs'
import path from 'node:path'

/**
 * Verify a source pointer before it is shown as evidence.
 * A pointer is verified only when the file exists, the line is in range, and
 * the expected identifier appears on that line or within +/-2 lines.
 */
export function verifySource(root, file, line, needle) {
  if (!file) return { verified: false, reason: 'no-location' }
  const abs = path.resolve(root, file)
  let text
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    return { verified: false, reason: 'missing-file', file, line }
  }
  const lines = text.split(/\r?\n/)
  const want = Number(line)
  const index = want - 1
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return { verified: false, reason: 'line-out-of-range', file, line: want }
  }
  const local = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
  const hit = !needle || local.some((l) => l.toLowerCase().includes(String(needle).toLowerCase()))
  return {
    verified: hit,
    reason: hit ? 'ok' : 'identifier-not-found',
    file,
    line: want,
    text: lines[index].trim(),
  }
}
