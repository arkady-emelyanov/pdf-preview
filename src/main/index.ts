import { app, ipcMain, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'


// Pin our config under XDG-style ~/.config/pdf-preview regardless of the
// productName Electron would otherwise derive ("Preview"). Must run before
// anything reads userData (recents, window state, etc.). Some Electron
// versions silently no-op setPath if the target directory doesn't exist, so
// mkdir first.
const userDataDir = join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'pdf-preview')
try {
  mkdirSync(userDataDir, { recursive: true })
} catch {
  // best-effort — setPath below may still succeed
}
app.setPath('userData', userDataDir)

// Lock the X11/Wayland WM class to "pdf-preview" so docks (Plank, KDE,
// gnome-shell) can match the running window against our installed .desktop's
// StartupWMClass. Without this, Chromium derives the class from the binary
// name ("preview-linux" via package.json), which we'd otherwise have to
// rename to keep the two ends in sync.
app.commandLine.appendSwitch('class', 'pdf-preview')

// Force the GTK file-chooser instead of routing through xdg-desktop-portal.
// The portal's OpenFile method has no "default folder" field, so Chromium's
// `defaultPath` is silently dropped under GNOME / KDE / Plasma. Multiple
// belt-and-braces switches because Chromium's portal selection logic has
// changed across versions:
//   - --xdg-portal-required-version=999 tells Chromium no installed portal
//     meets our needs, so it falls back to the native GTK file chooser.
//   - --gtk-version=3 picks GTK3's chooser (doesn't use portal at all).
//   - --enable-features=GtkUi keeps the GTK file picker enabled even on
//     Wayland/Ozone where Chromium would otherwise prefer the portal.
app.commandLine.appendSwitch('xdg-portal-required-version', '999')
app.commandLine.appendSwitch('gtk-version', '3')
app.commandLine.appendSwitch('enable-features', 'GtkUi')
import { dialog } from 'electron'
import {
  focusOrCreate,
  createBlankWindow,
  pathForWindow,
  setWindowDirty,
  approveClose,
  rebindWindowPath
} from './windows'
import { buildMenu, setMenuState, showOpenDialog, type MenuState } from './menu'
import { onRecentsChanged } from './recents'
import { realpathSync } from 'node:fs'
import {
  openDoc,
  closeDoc,
  getAllPageSizes,
  renderPage,
  getPageText,
  getPageChars,
  findMatchRects,
  getFormInfo,
  getFormFieldValues,
  dispatchFormEvent,
  saveDocViaPdfium,
  refreshFormBaseline
} from './pdfium'
import type { FormEvent } from '../shared/ipc'
import type { VirtualPage as VP } from '../shared/edit'
import { saveDoc } from './save'
import { exportPagesAsImages } from './exportImages'
import {
  cancelJob as printCancelJob,
  getJobStatus as printGetJobStatus,
  getPrinterOptions,
  listPrinters,
  print as printJob
} from './print'
import { loadAnnotations } from './loadAnnotations'
import { getAuthor } from './author'
import { registerMimeAssociation } from './mime'
import { getLastOpenDir } from './appState'
import { maybePromptOnStartup } from './defaultHandler'
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
  onRecentsChanged(() => buildMenu())
  void registerMimeAssociation()

  ipcMain.handle('pdf:open', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return null
    const path = pathForWindow(win)
    if (!path) return null
    const bytes = await readFile(path)
    const pageCount = await openDoc(path, bytes)
    const pageSizes = getAllPageSizes(path) ?? []
    const annotations = await loadAnnotations(path)
    const formInfo = getFormInfo(path)
    return {
      id: path,
      path,
      name: basename(path),
      author: getAuthor(),
      primary: {
        sourceId: path,
        name: basename(path),
        pageCount,
        pageSizes,
        annotations,
        hasForm: formInfo.hasForm,
        isXFA: formInfo.isXFA
      }
    }
  })

  ipcMain.handle('pdf:registerSource', async (_evt, path: string) => {
    const id = canonical(path)
    if (!getAllPageSizes(id)) {
      const bytes = await readFile(id)
      await openDoc(id, bytes)
    }
    const pageSizes = getAllPageSizes(id) ?? []
    const annotations = await loadAnnotations(id)
    const formInfo = getFormInfo(id)
    return {
      sourceId: id,
      name: basename(id),
      pageCount: pageSizes.length,
      pageSizes,
      annotations,
      hasForm: formInfo.hasForm,
      isXFA: formInfo.isXFA
    }
  })

  ipcMain.handle(
    'pdf:formEvent',
    (_evt, id: string, pageIndex: number, ev: FormEvent) =>
      dispatchFormEvent(id, pageIndex, ev)
  )

  ipcMain.handle('pdf:formFieldValues', (_evt, id: string) => getFormFieldValues(id))

  ipcMain.handle('pdf:pickFiles', async (evt, multi: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: multi ? 'Choose PDFs' : 'Choose a PDF',
      defaultPath: getLastOpenDir(),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (res.canceled) return []
    return res.filePaths
  })

  ipcMain.handle(
    'pdf:renderPage',
    async (
      _evt,
      id: string,
      pageIndex: number,
      scale: number,
      rotation = 0,
      noFormHighlight = false
    ) => {
      const r = await renderPage(id, pageIndex, scale, rotation, noFormHighlight)
      if (!r) return null
      return { width: r.width, height: r.height, data: r.data }
    }
  )

  ipcMain.handle('pdf:getText', async (_evt, id: string, pageIndex: number) => {
    return getPageText(id, pageIndex)
  })

  ipcMain.handle('pdf:getChars', async (_evt, id: string, pageIndex: number) => {
    return getPageChars(id, pageIndex)
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
        await routeSave(sources, destId, pages, destId)
        // Reopen primary so PDFium picks up the new file for renders.
        const bytes = await readFile(destId)
        await openDoc(destId, bytes)
        // PDFium-fast-path saves keep the same doc handle; the pdf-lib
        // path re-opens above. Either way the in-memory form values are
        // now the saved truth — reset the baseline so further edits
        // re-trigger dirty.
        await refreshFormBaseline(destId)
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
        await routeSave(sources, dest, pages, null)
        await refreshFormBaseline(dest)
        return { ok: true, path: dest }
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) }
      }
    }
  )

  ipcMain.handle(
    'pdf:exportFlattened',
    async (
      evt,
      sources: Record<string, string>,
      pages: VirtualPage[],
      defaultName: string
    ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { ok: false, error: 'no window' }
      const res = await dialog.showSaveDialog(win, {
        title: 'Export Flattened Copy',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false }
      const dest = res.filePath.toLowerCase().endsWith('.pdf')
        ? res.filePath
        : `${res.filePath}.pdf`
      try {
        // Always go through pdf-lib so form.flatten() actually runs. The
        // PDFium fast-path would preserve interactivity, which is the
        // opposite of what "flatten" means.
        await saveDoc(sources, dest, pages, { flattenForms: true })
        return { ok: true, path: dest }
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) }
      }
    }
  )

  ipcMain.handle(
    'pdf:exportImages',
    async (
      evt,
      pages: VirtualPage[],
      defaultBaseName: string
    ): Promise<{ ok: true; dir: string; count: number } | { ok: false; error?: string }> => {
      const win = BrowserWindow.fromWebContents(evt.sender)
      if (!win) return { ok: false, error: 'no window' }
      const res = await dialog.showOpenDialog(win, {
        title: 'Export Pages as Images',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export'
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false }
      try {
        await exportPagesAsImages(pages, res.filePaths[0], defaultBaseName)
        return { ok: true, dir: res.filePaths[0], count: pages.length }
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) }
      }
    }
  )

  ipcMain.handle('pdf:rebindPath', async (evt, newPath: string) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return null
    const key = canonical(newPath)
    rebindWindowPath(win, key)
    // Open the new file in PDFium under its own id so loadAnnotations can
    // re-parse what we just wrote, and so subsequent operations that key off
    // the new path (saveDoc reopen, future open) see a fresh document.
    try {
      const bytes = await readFile(key)
      await openDoc(key, bytes)
    } catch {
      // ignore — saveDoc just wrote it; if the read fails, the rename still
      // happened and the user can recover.
    }
    const pageSizes = getAllPageSizes(key) ?? []
    const annotations = await loadAnnotations(key)
    const formInfo = getFormInfo(key)
    return {
      sourceId: key,
      name: basename(key),
      pageCount: pageSizes.length,
      pageSizes,
      annotations,
      hasForm: formInfo.hasForm,
      isXFA: formInfo.isXFA
    }
  })

  ipcMain.on('pdf:saveAndCloseResult', (evt, ok: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win || !ok) return
    approveClose(win)
    setWindowDirty(win, false)
    setImmediate(() => {
      if (!win.isDestroyed()) win.close()
    })
  })

  ipcMain.handle('pdf:listPrinters', () => listPrinters())
  ipcMain.handle('pdf:printerOptions', (_evt, name: string) =>
    getPrinterOptions(name)
  )
  ipcMain.handle('pdf:print', (_evt, job) => printJob(job))
  ipcMain.handle('pdf:jobStatus', (_evt, jobId: string) => printGetJobStatus(jobId))
  ipcMain.handle('pdf:cancelJob', (_evt, jobId: string) => printCancelJob(jobId))

  ipcMain.on('pdf:setMenuState', (_evt, patch: Partial<MenuState>) => {
    setMenuState(patch)
  })

  ipcMain.on('pdf:setDirty', (evt, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    win.setDocumentEdited(dirty)
    setWindowDirty(win, dirty)
    const cur = win.getTitle().replace(/^•\s+/, '')
    win.setTitle(dirty ? `• ${cur}` : cur)
  })

  if (initialFiles.length) initialFiles.forEach(focusOrCreate)
  else createBlankWindow()

  // Wait until mime.ts has had a chance to install the .desktop so xdg-mime
  // has a target it'll accept, then ask. Best-effort — if mime registration
  // hasn't run (dev, sandbox, no $APPIMAGE), the prompt no-ops via the
  // `isPackaged` guard inside.
  setTimeout(() => {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined
    void maybePromptOnStartup(parent).then((r) => {
      if (r.changed) buildMenu()
    })
  }, 1500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBlankWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Decide which save backend to use. PDFium's SaveAsCopy is the only path
 * that preserves AcroForm field values the user filled in this session
 * (pdf-lib's copyPages drops /AcroForm). So when:
 *   - the source has a non-XFA AcroForm, AND
 *   - the edit graph is still the identity over that single source
 *     (no reorder, rotate, insert, delete, or annotation edits)
 * we save through PDFium. Otherwise we go through the pdf-lib pipeline,
 * which understands page reorders + our annotations but not form values.
 */
async function routeSave(
  sources: Record<string, string>,
  destPath: string,
  pages: VP[],
  /** Source id we'd ask PDFium to write from — the primary doc on `Save`,
   *  unknown until the user picks a path on `Save As`. */
  pdfiumSourceId: string | null
): Promise<void> {
  const srcId = pdfiumSourceId ?? pages[0]?.sourceId ?? null
  if (srcId) {
    const info = getFormInfo(srcId)
    if (info.hasForm && !info.isXFA && isUnchangedIdentity(srcId, pages)) {
      await saveDocViaPdfium(srcId, destPath)
      return
    }
  }
  await saveDoc(sources, destPath, pages)
}

function isUnchangedIdentity(sourceId: string, pages: VP[]): boolean {
  const sizes = getAllPageSizes(sourceId)
  if (!sizes) return false
  if (pages.length !== sizes.length) return false
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.sourceId !== sourceId) return false
    if (p.sourceIndex !== i) return false
    if (p.rotation !== 0) return false
    if (p.annotations && p.annotations.length > 0) return false
  }
  return true
}
