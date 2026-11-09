/**
 * Message normalization: the single most important knob for cluster quality.
 * Goal: the same root cause must normalize to the same key; different root
 * causes must not. We therefore strip volatile values (time, seed, addresses,
 * instance indices) but keep diagnostics (error codes, UVM tags, module and
 * signal names, file basenames).
 */

const RE_TIME = /\b\d+(?:\.\d+)?\s*(?:fs|ps|ns|us|ms|s)\b/gi
const RE_WINPATH = /[A-Za-z]:\\[^\s"']+/g
const RE_POSIXPATH = /(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/g
const RE_HEX = /\b0x[0-9a-f]+\b/gi
const RE_SEED = /\bseed\s*[=:]\s*\d+/gi
const RE_BIGINT = /\b\d{4,}\b/g
const RE_INSTANCE = /([A-Za-z_]\w*)\[(\d+)\](?=\.)/g
const RE_WS = /\s+/g

export function normalizeMessage(message = '') {
  let text = String(message)
  text = text.replace(RE_TIME, '<t>')
  text = text.replace(RE_WINPATH, '<path>')
  text = text.replace(RE_POSIXPATH, ' <path>')
  text = text.replace(RE_HEX, '0x<hex>')
  text = text.replace(RE_SEED, 'seed=<n>')
  text = text.replace(RE_BIGINT, '<n>')
  text = text.replace(RE_INSTANCE, '$1[*]')
  text = text.replace(RE_WS, ' ').trim()
  return text
}

/** Hierarchy without volatile array indices, e.g. env.agent[3].mon → env.agent[*].mon */
export function normalizeHierarchy(hierarchy = '') {
  return String(hierarchy).replace(/\[(\d+)\]/g, '[*]')
}

export function basename(filePath = '') {
  const parts = String(filePath).split(/[\\/]/)
  return parts[parts.length - 1]
}

/**
 * Coarse key decides cluster membership. Deliberately structural: kind, code,
 * tag, hierarchy and source location. Volatile data values never enter it.
 */
export function coarseKey(event) {
  switch (event.kind) {
    case 'compile':
      return `compile|${event.code ?? 'SE'}|${basename(event.file)}|${event.srcLine ?? ''}`
    case 'assertion':
      return `assertion|${basename(event.file)}:${event.srcLine ?? ''}|${event.assertName ?? ''}`
    case 'timeout':
      return `timeout|${event.code ?? 'TIMEOUT'}|${normalizeHierarchy(event.hierarchy)}`
    case 'uvm_fatal':
    case 'uvm_error':
    case 'mismatch':
      return `${event.kind}|${event.tag ?? ''}|${normalizeHierarchy(event.hierarchy)}`
    default:
      return `${event.kind}|${event.code ?? ''}|${basename(event.file)}|${event.srcLine ?? ''}`
  }
}

/**
 * Fine-signature normalizer: strips volatility that never identifies a bug
 * (time, seed, path, instance index) but keeps data values, so a cluster can
 * show "which addresses actually mismatch".
 */
export function normalizeFineMessage(message = '') {
  let text = String(message)
  text = text.replace(RE_TIME, '<t>')
  text = text.replace(RE_WINPATH, '<path>')
  text = text.replace(RE_POSIXPATH, ' <path>')
  text = text.replace(RE_SEED, 'seed=<n>')
  text = text.replace(RE_INSTANCE, '$1[*]')
  text = text.replace(RE_WS, ' ').trim()
  return text
}

/** Fine key keeps stable data values; used for within-cluster distribution. */
export function fineKey(event) {
  return `${coarseKey(event)}|${normalizeFineMessage(event.message)}`
}

/** Human title for a cluster. */
export function clusterTitle(event) {
  const where = event.file ? `${basename(event.file)}:${event.srcLine ?? '?'}` : event.hierarchy || ''
  const code = event.code || event.tag || ''
  return [event.kind, code, where].filter(Boolean).join(' · ')
}
