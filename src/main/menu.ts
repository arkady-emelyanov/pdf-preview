import { Menu, dialog, BrowserWindow } from 'electron'
import { focusOrCreate } from './windows'

/**
 * Application-menu state pushed from the renderer via `pdf:setMenuState`.
 * We rebuild the menu whenever any of these flip so enable/disable reflects
 * what's actually possible right now (no doc, no undo history, etc.).
 */
export interface MenuState {
  hasDoc: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
}

let state: MenuState = {
  hasDoc: false,
  dirty: false,
  canUndo: false,
  canRedo: false,
  hasSelection: false
}

function send(channel: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.webContents.send(channel)
}

export async function showOpenDialog(parent?: BrowserWindow): Promise<void> {
  const res = await dialog.showOpenDialog(parent ?? (undefined as never), {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  })
  if (!res.canceled && res.filePaths[0]) focusOrCreate(res.filePaths[0])
}

export function setMenuState(patch: Partial<MenuState>): void {
  const next = { ...state, ...patch }
  // Skip rebuild if nothing actually changed — Menu.setApplicationMenu is cheap
  // but rebuilds the menu bar each time and flickers some WMs.
  if (
    next.hasDoc === state.hasDoc &&
    next.dirty === state.dirty &&
    next.canUndo === state.canUndo &&
    next.canRedo === state.canRedo &&
    next.hasSelection === state.hasSelection
  ) {
    return
  }
  state = next
  buildMenu()
}

export function buildMenu(): void {
  const { hasDoc, dirty, canUndo, canRedo, hasSelection } = state
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: async (_item, win) => showOpenDialog(win as BrowserWindow | undefined)
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          enabled: hasDoc && dirty,
          click: () => send('menu:save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: hasDoc,
          click: () => send('menu:saveAs')
        },
        {
          label: 'Export Selection As…',
          enabled: hasDoc && hasSelection,
          click: () => send('menu:extractSelection')
        },
        { type: 'separator' },
        {
          label: 'Insert Pages from PDF…',
          enabled: hasDoc,
          click: () => send('menu:insertPages')
        },
        { label: 'Merge PDFs…', click: () => send('menu:mergePdfs') },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          enabled: hasDoc && canUndo,
          click: () => send('menu:undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          enabled: hasDoc && canRedo,
          click: () => send('menu:redo')
        },
        { type: 'separator' },
        { role: 'cut' },
        {
          // Custom so we can copy PDF text selection too; renderer decides
          // whether to copy our own selection or fall through to execCommand.
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => send('menu:copy')
        },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Page',
      submenu: [
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          enabled: hasDoc,
          click: () => send('menu:find')
        },
        { type: 'separator' },
        {
          label: 'Rotate Left',
          accelerator: 'CmdOrCtrl+[',
          enabled: hasDoc,
          click: () => send('menu:rotateLeft')
        },
        {
          label: 'Rotate Right',
          accelerator: 'CmdOrCtrl+]',
          enabled: hasDoc,
          click: () => send('menu:rotateRight')
        },
        { type: 'separator' },
        {
          // Intentionally no accelerator — the renderer's Delete-key handler
          // routes between "delete selected annotation" and "delete selected
          // page(s)" based on what's selected, and we don't want the menu
          // accelerator to pre-empt that decision.
          label: 'Delete Selected Page(s)',
          enabled: hasDoc && hasSelection,
          click: () => send('menu:deletePages')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
