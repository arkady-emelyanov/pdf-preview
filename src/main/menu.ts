import { Menu, dialog, BrowserWindow } from 'electron'
import { focusOrCreate } from './windows'

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

export function buildMenu(): void {
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
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:saveAs')
        },
        {
          label: 'Export Selection As…',
          click: () => send('menu:extractSelection')
        },
        { type: 'separator' },
        { label: 'Insert Pages from PDF…', click: () => send('menu:insertPages') },
        { label: 'Merge PDFs…', click: () => send('menu:mergePdfs') },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }]
    },
    // Hidden DevTools accelerator (not visible in menu)
    {
      label: '',
      visible: false,
      submenu: [
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
        { role: 'reload', accelerator: 'CmdOrCtrl+R' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
