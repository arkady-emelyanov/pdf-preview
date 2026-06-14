import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DocInfo, PageRect, RenderedPageMsg } from '../shared/ipc'

const api = {
  openCurrent: (): Promise<DocInfo | null> => ipcRenderer.invoke('pdf:open'),
  renderPage: (id: string, pageIndex: number, scale: number): Promise<RenderedPageMsg | null> =>
    ipcRenderer.invoke('pdf:renderPage', id, pageIndex, scale),
  getText: (id: string, pageIndex: number): Promise<string | null> =>
    ipcRenderer.invoke('pdf:getText', id, pageIndex),
  findMatchRects: (id: string, pageIndex: number, query: string): Promise<PageRect[] | null> =>
    ipcRenderer.invoke('pdf:findMatchRects', id, pageIndex, query),
  close: (id: string): void => ipcRenderer.send('pdf:close', id),
  showOpenDialog: (): void => ipcRenderer.send('pdf:showOpenDialog'),
  openPath: (path: string): void => ipcRenderer.send('pdf:openPath', path),
  pathForDroppedFile: (file: File): string => webUtils.getPathForFile(file),
  onDocAssigned: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('pdf:docAssigned', handler)
    return () => ipcRenderer.off('pdf:docAssigned', handler)
  }
}

contextBridge.exposeInMainWorld('pdf', api)

export type PdfApi = typeof api
