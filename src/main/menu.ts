import { Menu, dialog, BrowserWindow } from 'electron'
import { focusOrCreate } from './windows'

export function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: async (_item, win) => {
            const res = await dialog.showOpenDialog(win ?? undefined as never, {
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
              properties: ['openFile']
            })
            if (!res.canceled && res.filePaths[0]) focusOrCreate(res.filePaths[0])
          }
        },
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
