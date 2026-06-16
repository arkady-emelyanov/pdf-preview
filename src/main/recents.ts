import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_RECENTS = 10

let cache: string[] | null = null
let storePath: string | null = null

function file(): string {
  if (!storePath) storePath = join(app.getPath('userData'), 'recents.json')
  return storePath
}

function load(): string[] {
  if (cache) return cache
  try {
    const raw = readFileSync(file(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      cache = parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS)
      return cache
    }
  } catch {
    // missing / corrupt — start empty
  }
  cache = []
  return cache
}

function save(list: string[]): void {
  cache = list
  try {
    const path = file()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(list, null, 2), 'utf8')
  } catch {
    // best-effort
  }
}

let listener: (() => void) | null = null

export function onRecentsChanged(fn: () => void): void {
  listener = fn
}

export function getRecents(): string[] {
  return [...load()]
}

export function pushRecent(path: string): void {
  if (!path) return
  const list = load().filter((p) => p !== path)
  list.unshift(path)
  save(list.slice(0, MAX_RECENTS))
  app.addRecentDocument(path)
  listener?.()
}

export function removeRecent(path: string): void {
  const list = load().filter((p) => p !== path)
  if (list.length === load().length) return
  save(list)
  listener?.()
}

export function clearRecents(): void {
  save([])
  app.clearRecentDocuments()
  listener?.()
}
