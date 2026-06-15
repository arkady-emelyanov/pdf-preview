import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DocInfo, PageRect, RenderedPageMsg, SourceInfo } from '../shared/ipc'
import type { VirtualPage } from '../shared/edit'

type MenuChannel =
  | 'save'
  | 'saveAs'
  | 'extractSelection'
  | 'insertPages'
  | 'mergePdfs'
  | 'saveAndClose'
  | 'copy'

const api = {
  openCurrent: (): Promise<DocInfo | null> => ipcRenderer.invoke('pdf:open'),
  renderPage: (
    sourceId: string,
    pageIndex: number,
    scale: number,
    rotation = 0
  ): Promise<RenderedPageMsg | null> =>
    ipcRenderer.invoke('pdf:renderPage', sourceId, pageIndex, scale, rotation),
  getText: (sourceId: string, pageIndex: number): Promise<string | null> =>
    ipcRenderer.invoke('pdf:getText', sourceId, pageIndex),
  getChars: (
    sourceId: string,
    pageIndex: number
  ): Promise<{ text: string; boxes: PageRect[] } | null> =>
    ipcRenderer.invoke('pdf:getChars', sourceId, pageIndex),
  findMatchRects: (
    sourceId: string,
    pageIndex: number,
    query: string
  ): Promise<PageRect[] | null> =>
    ipcRenderer.invoke('pdf:findMatchRects', sourceId, pageIndex, query),
  registerSource: (path: string): Promise<SourceInfo> =>
    ipcRenderer.invoke('pdf:registerSource', path),
  pickFiles: (multi: boolean): Promise<string[]> => ipcRenderer.invoke('pdf:pickFiles', multi),
  save: (
    sources: Record<string, string>,
    destId: string,
    pages: VirtualPage[]
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('pdf:save', sources, destId, pages),
  saveAs: (
    sources: Record<string, string>,
    pages: VirtualPage[],
    defaultName: string
  ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> =>
    ipcRenderer.invoke('pdf:saveAs', sources, pages, defaultName),
  setDirty: (dirty: boolean): void => ipcRenderer.send('pdf:setDirty', dirty),
  setHasTextSelection: (has: boolean): void =>
    ipcRenderer.send('pdf:setHasTextSelection', has),
  saveAndCloseResult: (ok: boolean): void =>
    ipcRenderer.send('pdf:saveAndCloseResult', ok),
  close: (id: string): void => ipcRenderer.send('pdf:close', id),
  showOpenDialog: (): void => ipcRenderer.send('pdf:showOpenDialog'),
  openPath: (path: string): void => ipcRenderer.send('pdf:openPath', path),
  pathForDroppedFile: (file: File): string => webUtils.getPathForFile(file),
  onDocAssigned: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('pdf:docAssigned', handler)
    return () => ipcRenderer.off('pdf:docAssigned', handler)
  },
  onMenu: (channel: MenuChannel, cb: () => void): (() => void) => {
    const ch = `menu:${channel}`
    const handler = (): void => cb()
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.off(ch, handler)
  }
}

contextBridge.exposeInMainWorld('pdf', api)

export type PdfApi = typeof api
