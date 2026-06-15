import { BrowserWindow, Menu, dialog, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { basename, join } from 'node:path'

const windowsByPath = new Map<string, BrowserWindow>()
const blankWindows = new Set<BrowserWindow>()
const dirtyByWindow = new WeakMap<BrowserWindow, boolean>()
const hasTextSelByWindow = new WeakMap<BrowserWindow, boolean>()
/** Windows currently allowed to close without re-prompting (we said OK once). */
const closingApproved = new WeakSet<BrowserWindow>()

export function setWindowHasTextSelection(win: BrowserWindow, has: boolean): void {
  hasTextSelByWindow.set(win, has)
}

export function setWindowDirty(win: BrowserWindow, dirty: boolean): void {
  dirtyByWindow.set(win, dirty)
}

/** Approve the next close for this window (skip the dirty prompt). */
export function approveClose(win: BrowserWindow): void {
  closingApproved.add(win)
}

/**
 * Re-point a window at a new file path after Save As. Updates the
 * windowsByPath registry so future "open this file" routes here, and sets
 * the window title. No-ops if the new path equals the current one.
 */
export function rebindWindowPath(win: BrowserWindow, newPath: string): void {
  const key = canonical(newPath)
  // Find and remove the old key.
  for (const [path, w] of windowsByPath) {
    if (w === win) {
      if (path === key) return // already bound
      windowsByPath.delete(path)
      break
    }
  }
  // If another window owns this key, evict it from the map so the new owner
  // wins. The other window stays open but is no longer the canonical home for
  // this path; focusOrCreate calls on this path will now focus us.
  windowsByPath.set(key, win)
  win.setTitle(basename(key))
}

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

  win.webContents.on('context-menu', (_event, params) => {
    // Only show a native menu inside editable inputs (search bar, note body,
    // etc.). Everywhere else the renderer owns context menus via a React
    // popover so it can include in-app actions like Paste annotation.
    if (!params.isEditable) return
    const hasNativeSel = (params.selectionText ?? '').length > 0
    Menu.buildFromTemplate([
      { role: 'cut', enabled: hasNativeSel },
      { role: 'copy', enabled: hasNativeSel },
      { role: 'paste' }
    ]).popup({ window: win })
  })

  win.on('close', (event) => {
    if (closingApproved.has(win)) return
    if (!dirtyByWindow.get(win)) return
    event.preventDefault()
    const name = win.getTitle().replace(/^•\s+/, '') || 'this document'
    // Order matters: button index is platform-stable. We use buttons[response].
    const buttons = ["Don't Save", 'Cancel', 'Save']
    dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons,
        defaultId: 2,
        cancelId: 1,
        message: `Save changes to ${name} before closing?`,
        detail: 'Your edits will be lost if you don’t save.'
      })
      .then(({ response }) => {
        if (response === 1) return // Cancel
        if (response === 0) {
          // Don't save. Defer the close so the dialog's modal-parent state on
          // Linux fully unwinds before we re-enter the close path — otherwise
          // the window can hang in a half-closed state.
          closingApproved.add(win)
          dirtyByWindow.set(win, false)
          setImmediate(() => {
            if (!win.isDestroyed()) win.close()
          })
          return
        }
        // Save — renderer will save and then trigger close via saveAndCloseResult.
        win.webContents.send('menu:saveAndClose')
      })
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
