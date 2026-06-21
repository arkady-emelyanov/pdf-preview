import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DocInfo,
  FormEvent,
  FormFieldValue,
  JobStatus,
  PageRect,
  PrintJob,
  PrintResult,
  PrinterInfo,
  PrinterOption,
  RenderedPageMsg,
  SourceInfo
} from '../shared/ipc'
import type { VirtualPage } from '../shared/edit'

type MenuChannel =
  | 'save'
  | 'saveAs'
  | 'extractSelection'
  | 'insertPages'
  | 'mergePdfs'
  | 'saveAndClose'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'rotateLeft'
  | 'rotateRight'
  | 'deletePages'
  | 'find'
  | 'print'
  | 'exportFlattened'
  | 'exportImages'

interface MenuStatePatch {
  hasDoc?: boolean
  dirty?: boolean
  canUndo?: boolean
  canRedo?: boolean
  hasSelection?: boolean
  hasTextSelection?: boolean
  hasAnnotationSelection?: boolean
  hasClipboard?: boolean
  hasInputFocus?: boolean
}

const api = {
  openCurrent: (): Promise<DocInfo | null> => ipcRenderer.invoke('pdf:open'),
  renderPage: (
    sourceId: string,
    pageIndex: number,
    scale: number,
    rotation = 0,
    noFormHighlight = false
  ): Promise<RenderedPageMsg | null> =>
    ipcRenderer.invoke(
      'pdf:renderPage',
      sourceId,
      pageIndex,
      scale,
      rotation,
      noFormHighlight
    ),
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
  rebindPath: (newPath: string): Promise<SourceInfo | null> =>
    ipcRenderer.invoke('pdf:rebindPath', newPath),
  pickFiles: (multi: boolean): Promise<string[]> => ipcRenderer.invoke('pdf:pickFiles', multi),
  formEvent: (sourceId: string, pageIndex: number, ev: FormEvent): Promise<boolean> =>
    ipcRenderer.invoke('pdf:formEvent', sourceId, pageIndex, ev),
  formFieldValues: (sourceId: string): Promise<FormFieldValue[]> =>
    ipcRenderer.invoke('pdf:formFieldValues', sourceId),
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
  exportFlattened: (
    sources: Record<string, string>,
    pages: VirtualPage[],
    defaultName: string
  ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> =>
    ipcRenderer.invoke('pdf:exportFlattened', sources, pages, defaultName),
  exportImages: (
    pages: VirtualPage[],
    defaultBaseName: string
  ): Promise<{ ok: true; dir: string; count: number } | { ok: false; error?: string }> =>
    ipcRenderer.invoke('pdf:exportImages', pages, defaultBaseName),
  listPrinters: (): Promise<PrinterInfo[]> => ipcRenderer.invoke('pdf:listPrinters'),
  printerOptions: (name: string): Promise<PrinterOption[]> =>
    ipcRenderer.invoke('pdf:printerOptions', name),
  print: (job: PrintJob): Promise<PrintResult> => ipcRenderer.invoke('pdf:print', job),
  jobStatus: (jobId: string): Promise<JobStatus> =>
    ipcRenderer.invoke('pdf:jobStatus', jobId),
  cancelJob: (jobId: string): Promise<void> => ipcRenderer.invoke('pdf:cancelJob', jobId),
  setDirty: (dirty: boolean): void => ipcRenderer.send('pdf:setDirty', dirty),
  setMenuState: (patch: MenuStatePatch): void =>
    ipcRenderer.send('pdf:setMenuState', patch),
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
