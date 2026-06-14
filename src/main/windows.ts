import { BrowserWindow, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { basename, join } from 'node:path'

const windowsByPath = new Map<string, BrowserWindow>()
const blankWindows = new Set<BrowserWindow>()

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function buildWindow(title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function bindPath(win: BrowserWindow, path: string): void {
  blankWindows.delete(win)
  windowsByPath.set(path, win)
  win.setTitle(basename(path))
  win.on('closed', () => windowsByPath.delete(path))
  win.webContents.send('pdf:docAssigned')
}

export function focusOrCreate(path: string): BrowserWindow {
  const key = canonical(path)
  const existing = windowsByPath.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  // Reuse any blank window (focused first)
  const focused = BrowserWindow.getFocusedWindow()
  let win: BrowserWindow | undefined
  if (focused && blankWindows.has(focused)) win = focused
  else win = [...blankWindows][0]

  if (win) {
    bindPath(win, key)
    win.focus()
    return win
  }

  win = buildWindow(basename(key))
  bindPath(win, key)
  return win
}

export function createBlankWindow(): BrowserWindow {
  const win = buildWindow('Preview')
  blankWindows.add(win)
  win.on('closed', () => blankWindows.delete(win))
  return win
}

export function pathForWindow(win: BrowserWindow): string | undefined {
  for (const [path, w] of windowsByPath) {
    if (w === win) return path
  }
  return undefined
}
