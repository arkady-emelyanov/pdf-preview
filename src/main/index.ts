import { app, ipcMain, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog } from 'electron'
import { focusOrCreate, createBlankWindow, pathForWindow } from './windows'
import { buildMenu, showOpenDialog } from './menu'
import { realpathSync } from 'node:fs'
import {
  openDoc,
  closeDoc,
  getAllPageSizes,
  renderPage,
  getPageText,
  findMatchRects
} from './pdfium'
import { saveDoc } from './save'
import type { VirtualPage } from '../shared/edit'

function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

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
    return {
      id: path,
      path,
      name: basename(path),
      primary: { sourceId: path, name: basename(path), pageCount, pageSizes }
    }
  })

  ipcMain.handle('pdf:registerSource', async (_evt, path: string) => {
    const id = canonical(path)
    if (!getAllPageSizes(id)) {
      const bytes = await readFile(id)
      await openDoc(id, bytes)
    }
    const pageSizes = getAllPageSizes(id) ?? []
    return {
      sourceId: id,
      name: basename(id),
      pageCount: pageSizes.length,
      pageSizes
    }
  })

  ipcMain.handle('pdf:pickFiles', async (evt, multi: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: multi ? 'Choose PDFs' : 'Choose a PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (res.canceled) return []
    return res.filePaths
  })

  ipcMain.handle(
    'pdf:renderPage',
    async (_evt, id: string, pageIndex: number, scale: number, rotation = 0) => {
      const r = await renderPage(id, pageIndex, scale, rotation)
      if (!r) return null
      return { width: r.width, height: r.height, data: r.data }
    }
  )

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

  ipcMain.on('pdf:showOpenDialog', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? undefined
    showOpenDialog(win)
  })

  ipcMain.on('pdf:openPath', (_evt, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith('.pdf')) {
      focusOrCreate(path)
    }
  })

  ipcMain.handle(
    'pdf:save',
    async (
      evt,
      sources: Record<string, string>,
      destId: string,
      pages: VirtualPage[]
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { ok: false, error: 'no window' }
      try {
        await saveDoc(sources, destId, pages)
        // Reopen primary so PDFium picks up the new file for renders.
        const bytes = await readFile(destId)
        await openDoc(destId, bytes)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) }
      }
    }
  )

  ipcMain.handle(
    'pdf:saveAs',
    async (
      evt,
      sources: Record<string, string>,
      pages: VirtualPage[],
      defaultName: string
    ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { ok: false, error: 'no window' }
      const res = await dialog.showSaveDialog(win, {
        title: 'Save PDF',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false }
      const dest = res.filePath.toLowerCase().endsWith('.pdf')
        ? res.filePath
        : `${res.filePath}.pdf`
      try {
        await saveDoc(sources, dest, pages)
        return { ok: true, path: dest }
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) }
      }
    }
  )

  ipcMain.on('pdf:setDirty', (evt, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    win.setDocumentEdited(dirty)
    const cur = win.getTitle().replace(/^•\s+/, '')
    win.setTitle(dirty ? `• ${cur}` : cur)
  })

  if (initialFiles.length) initialFiles.forEach(focusOrCreate)
  else createBlankWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBlankWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
