import { app, ipcMain, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { focusOrCreate, createBlankWindow, pathForWindow } from './windows'
import { buildMenu } from './menu'
import {
  openDoc,
  closeDoc,
  getAllPageSizes,
  renderPage,
  getPageText,
  findMatchRects
} from './pdfium'

const initialFiles: string[] = process.argv
  .slice(app.isPackaged ? 1 : 2)
  .filter((a) => a.toLowerCase().endsWith('.pdf'))

app.on('second-instance', (_evt, argv) => {
  const files = argv.filter((a) => a.toLowerCase().endsWith('.pdf'))
  if (files.length) files.forEach(focusOrCreate)
  else createBlankWindow()
})

app.on('open-file', (evt, path) => {
  evt.preventDefault()
  if (app.isReady()) focusOrCreate(path)
  else app.once('ready', () => focusOrCreate(path))
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.whenReady().then(() => {
  buildMenu()

  ipcMain.handle('pdf:open', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return null
    const path = pathForWindow(win)
    if (!path) return null
    const bytes = await readFile(path)
    const pageCount = await openDoc(path, bytes)
    const pageSizes = getAllPageSizes(path) ?? []
    return { id: path, path, name: basename(path), pageCount, pageSizes }
  })

  ipcMain.handle('pdf:renderPage', async (_evt, id: string, pageIndex: number, scale: number) => {
    const r = await renderPage(id, pageIndex, scale)
    if (!r) return null
    return { width: r.width, height: r.height, data: r.data }
  })

  ipcMain.handle('pdf:getText', async (_evt, id: string, pageIndex: number) => {
    return getPageText(id, pageIndex)
  })

  ipcMain.handle(
    'pdf:findMatchRects',
    async (_evt, id: string, pageIndex: number, query: string) => {
      return findMatchRects(id, pageIndex, query)
    }
  )

  ipcMain.on('pdf:close', (_evt, id: string) => closeDoc(id))

  if (initialFiles.length) initialFiles.forEach(focusOrCreate)
  else createBlankWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBlankWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
