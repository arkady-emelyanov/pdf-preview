import { app, BrowserWindow, screen } from 'electron'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Persistent app state — everything that should survive across launches and
 * isn't part of any particular document. One JSON file under userData
 * (`~/.config/pdf-preview/state.json`), one in-memory cache, one writer.
 */
export interface AppState {
  /** Last window geometry. `x`/`y` are unset on first run. */
  window: {
    x?: number
    y?: number
    width: number
    height: number
    maximized: boolean
  }
  /** Last directory the user opened a PDF from. Drives the open dialog's
   *  default path. Unset means "fall back to homedir". */
  lastOpenDir?: string
  /** Status of the "make us the default PDF handler" prompt.
   *    unset       → still pending; show on next startup
   *    'dismissed' → user clicked "Don't show again"; Help menu offers it
   *    'agreed'    → user already opted in (we ran xdg-mime default once);
   *                  no auto-prompt and Help-menu entry hidden. */
  defaultPrompt?: 'dismissed' | 'agreed'
}

const DEFAULT: AppState = {
  window: { width: 1200, height: 800, maximized: false }
}

let cache: AppState | null = null
let storePath: string | null = null

function file(): string {
  if (!storePath) storePath = join(app.getPath('userData'), 'state.json')
  return storePath
}

function isDir(p: string | undefined): p is string {
  if (!p) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function read(): AppState {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8'))
    const w = parsed?.window ?? {}
    if (typeof w.width === 'number' && typeof w.height === 'number') {
      cache = {
        window: {
          x: typeof w.x === 'number' ? w.x : undefined,
          y: typeof w.y === 'number' ? w.y : undefined,
          width: w.width,
          height: w.height,
          maximized: !!w.maximized
        },
        lastOpenDir: typeof parsed.lastOpenDir === 'string' ? parsed.lastOpenDir : undefined,
        defaultPrompt:
          parsed.defaultPrompt === 'dismissed' || parsed.defaultPrompt === 'agreed'
            ? parsed.defaultPrompt
            : undefined
      }
      return cache
    }
  } catch {
    // missing / corrupt — start from defaults
  }
  cache = { window: { ...DEFAULT.window } }
  return cache
}

function write(): void {
  if (!cache) return
  try {
    const p = file()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(cache, null, 2), 'utf8')
  } catch {
    // best-effort
  }
}

// ─── Window state ──────────────────────────────────────────────────────────

/**
 * Initial bounds for a new window: saved geometry clamped to a visible display
 * area, so a window saved on an unplugged monitor still opens somewhere
 * reachable.
 */
export function getInitialWindowState(): AppState['window'] {
  const s = read().window
  if (s.x === undefined || s.y === undefined) return s
  const display = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height })
  const wa = display.workArea
  const width = Math.min(s.width, wa.width)
  const height = Math.min(s.height, wa.height)
  const x = Math.min(Math.max(s.x, wa.x), wa.x + wa.width - width)
  const y = Math.min(Math.max(s.y, wa.y), wa.y + wa.height - height)
  return { x, y, width, height, maximized: s.maximized }
}

export function trackWindow(win: BrowserWindow): void {
  const persist = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const s = read()
    // Snapshot pre-maximize geometry so unmaximizing later still has good bounds.
    const bounds = maximized ? s.window : win.getNormalBounds()
    s.window = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized
    }
    write()
  }

  win.on('resize', persist)
  win.on('move', persist)
  win.on('maximize', persist)
  win.on('unmaximize', persist)
  win.on('close', persist)
}

// ─── Last open directory ───────────────────────────────────────────────────

/**
 * Directory to seed the open dialog with. Returns the last directory the user
 * opened a PDF from; falls back to $HOME when no value is stored or the
 * remembered directory has gone away (USB unmounted, etc.).
 */
export function getLastOpenDir(): string {
  const s = read()
  return isDir(s.lastOpenDir) ? s.lastOpenDir : homedir()
}

/** Record the parent directory of a path the user just opened so the next
 *  open dialog lands there. Persists alongside window state. */
export function rememberOpenedPath(path: string): void {
  if (!path) return
  const dir = dirname(path)
  if (!isDir(dir)) return
  const s = read()
  if (s.lastOpenDir === dir) return
  s.lastOpenDir = dir
  write()
}

// ─── Default-handler prompt ────────────────────────────────────────────────

export function getDefaultPromptState(): AppState['defaultPrompt'] {
  return read().defaultPrompt
}

export function setDefaultPromptState(v: AppState['defaultPrompt']): void {
  const s = read()
  if (s.defaultPrompt === v) return
  s.defaultPrompt = v
  write()
}
