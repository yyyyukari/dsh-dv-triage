import fs from 'node:fs'
import path from 'node:path'

export function runsDir(root) {
  return path.join(path.resolve(root), '.dsh-dv', 'runs')
}

function runPath(root, id) {
  return path.join(runsDir(root), `${id}.json`)
}

export function saveRun(root, run) {
  const dir = runsDir(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = runPath(root, run.run_id)
  fs.writeFileSync(file, JSON.stringify(run, null, 2), 'utf8')
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ run_id: run.run_id }), 'utf8')
  return file
}

export function loadRun(root, id) {
  const file = id ? runPath(root, id) : latestRunPath(root)
  if (!file) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

export function latestRunPath(root) {
  const pointer = path.join(runsDir(root), 'latest.json')
  try {
    const { run_id } = JSON.parse(fs.readFileSync(pointer, 'utf8'))
    return runPath(root, run_id)
  } catch {
    return undefined
  }
}

export function listRuns(root) {
  try {
    return fs
      .readdirSync(runsDir(root))
      .filter((name) => /^[\w.-]+\.json$/.test(name) && name !== 'latest.json')
      .map((name) => name.replace(/\.json$/, ''))
      .sort()
      .reverse()
  } catch {
    return []
  }
}
