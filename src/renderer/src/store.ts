import { create } from 'zustand'
import type { DocInfo, PageRect, SourceInfo } from '../../shared/ipc'
import {
  applyDelete,
  applyInsert,
  applyMove,
  applyRotate,
  identityPages,
  moveIndexMap,
  pagesEqual,
  rotatedSize,
  type Rotation,
  type VirtualPage
} from '../../shared/edit'
import {
  FREETEXT_DEFAULT_COLOR,
  FREETEXT_DEFAULT_FONT,
  FREETEXT_DEFAULT_SIZE,
  NOTE_SIZE_PT,
  addAnnotation as addAnnFn,
  defaultBoxStyle,
  deleteAnnotation as delAnnFn,
  isFreeText,
  isLine,
  isNote,
  newId,
  updateAnnotation as updAnnFn,
  type Annotation,
  type BoxStyle,
  type FreeTextFont
} from '../../shared/annotations'

/** Sticky style applied to the next free-text drawn (and shown in the props
 *  panel when no annotation is selected). */
export interface FreeTextDefaults {
  font: FreeTextFont
  fontSize: number
  color: string
}

export type Tool = 'select' | 'rect' | 'oval' | 'arrow' | 'line' | 'text' | 'note' | 'freetext'

export interface PageChars {
  text: string
  boxes: PageRect[]
}

export interface TextSelection {
  /** Virtual page index — selection is single-page in v1. */
  page: number
  /** Inclusive char start. */
  start: number
  /** Inclusive char end. */
  end: number
}

export type ZoomMode = 'fit-width' | 'fit-page' | 'actual' | 'custom'

export interface SearchHit {
  page: number
  preview: string
  rects: PageRect[]
}

const UNDO_LIMIT = 200

interface State {
  doc: DocInfo | null
  /** All source PDFs registered with this window, keyed by sourceId. */
  sources: Record<string, SourceInfo>

  // Edit graph
  pages: VirtualPage[]
  undoStack: VirtualPage[][]
  redoStack: VirtualPage[][]
  savedPages: VirtualPage[]
  selection: Set<number>

  // View state
  scale: number
  zoomMode: ZoomMode
  currentPage: number
  sidebarOpen: boolean
  searchOpen: boolean
  searchQuery: string
  searchHits: SearchHit[]
  searchCursor: number
  highlightsByPage: Map<number, PageRect[]>
  viewportSize: { w: number; h: number }
  jumpRequest: number | null

  // Annotations
  tool: Tool
  /** Style applied to the next shape drawn (and shown in the props panel when nothing's selected). */
  toolDefaults: BoxStyle
  freeTextDefaults: FreeTextDefaults
  selectedAnnotation: { page: number; id: string } | null

  // Annotation clipboard (in-app — not the system clipboard).
  clipboard: Annotation | null

  // Text selection
  textSelection: TextSelection | null
  /** Cache keyed by `${sourceId}|${sourceIndex}` — virtual pages that share a
   *  source page only fetch char data once. */
  pageCharsCache: Map<string, PageChars>

  // View setters
  setDoc: (d: DocInfo | null) => void
  registerSource: (s: SourceInfo) => void
  setScale: (s: number) => void
  setZoomMode: (m: ZoomMode) => void
  setCurrentPage: (p: number) => void
  toggleSidebar: () => void
  openSearch: () => void
  closeSearch: () => void
  setSearchQuery: (q: string) => void
  setSearchHits: (hits: SearchHit[]) => void
  setSearchCursor: (i: number) => void
  setHighlights: (m: Map<number, PageRect[]>) => void
  clearSearch: () => void
  setViewportSize: (w: number, h: number) => void
  requestJump: (p: number) => void
  consumeJump: () => void

  // Selection
  setSelection: (s: Set<number>) => void
  selectOnly: (i: number) => void
  toggleSelect: (i: number) => void
  selectRange: (anchor: number, target: number) => void
  clearSelection: () => void
  getActionTargets: () => number[]

  // Edits
  rotateSelection: (delta: number) => void
  deleteSelection: () => void
  movePages: (indices: number[], target: number) => void
  insertPages: (inserts: VirtualPage[], target: number) => void

  // Text selection
  setTextSelection: (sel: TextSelection | null) => void
  /** Returns char data for a virtual page, fetching + caching as needed. */
  ensurePageChars: (page: number) => Promise<PageChars | null>

  // Annotations
  setTool: (t: Tool) => void
  setToolDefaults: (patch: Partial<BoxStyle>) => void
  setFreeTextDefaults: (patch: Partial<FreeTextDefaults>) => void
  addAnnotation: (page: number, a: Annotation) => void
  updateAnnotation: (page: number, id: string, patch: Partial<Annotation>) => void
  deleteAnnotation: (page: number, id: string) => void
  setSelectedAnnotation: (sel: { page: number; id: string } | null) => void

  // Annotation clipboard
  copyAnnotation: (page: number, id: string) => void
  cutAnnotation: (page: number, id: string) => void
  pasteAnnotation: (page: number, ptX: number, ptY: number) => void
  /** Snapshot current pages onto the undo stack — call once at drag start. */
  beginLiveEdit: () => void
  /** Patch an annotation without touching the undo stack — call during drag. */
  liveUpdateAnnotation: (page: number, id: string, patch: Partial<Annotation>) => void

  // Undo/redo
  undo: () => void
  redo: () => void

  // Save sync
  markSaved: () => void
  /** Re-point the doc identity at a new path after Save As, and treat the
   *  current edit graph as the clean state. */
  renameDoc: (newPath: string, newName: string) => void

  // Helpers
  sourcePaths: () => Record<string, string>
  sourceSize: (sourceId: string, sourceIndex: number) => { width: number; height: number }
}

function isDirty(pages: VirtualPage[], saved: VirtualPage[]): boolean {
  return !pagesEqual(pages, saved)
}

export const useStore = create<State>((set, get) => ({
  doc: null,
  sources: {},
  pages: [],
  undoStack: [],
  redoStack: [],
  savedPages: [],
  selection: new Set(),

  scale: 1.25,
  zoomMode: 'custom',
  currentPage: 0,
  sidebarOpen: true,
  searchOpen: false,
  searchQuery: '',
  searchHits: [],
  searchCursor: -1,
  highlightsByPage: new Map(),
  viewportSize: { w: 0, h: 0 },
  jumpRequest: null,

  tool: 'select',
  toolDefaults: { ...defaultBoxStyle },
  freeTextDefaults: {
    font: FREETEXT_DEFAULT_FONT,
    fontSize: FREETEXT_DEFAULT_SIZE,
    color: FREETEXT_DEFAULT_COLOR
  },
  selectedAnnotation: null,
  clipboard: null,
  textSelection: null,
  pageCharsCache: new Map(),

  setDoc: (d) => {
    const pages = d
      ? identityPages(d.primary.sourceId, d.primary.pageCount, d.primary.annotations)
      : []
    const sources: Record<string, SourceInfo> = d ? { [d.primary.sourceId]: d.primary } : {}
    set({
      doc: d,
      sources,
      pages,
      undoStack: [],
      redoStack: [],
      savedPages: pages,
      selection: new Set(),
      currentPage: 0,
      searchHits: [],
      searchQuery: '',
      searchCursor: -1,
      highlightsByPage: new Map(),
      tool: 'select',
      selectedAnnotation: null,
      textSelection: null,
      pageCharsCache: new Map()
    })
    window.pdf.setDirty(false)
  },
  registerSource: (s) =>
    set((st) => ({ sources: { ...st.sources, [s.sourceId]: s } })),
  setScale: (s) => set({ scale: s, zoomMode: 'custom' }),
  setZoomMode: (m) => set({ zoomMode: m }),
  setCurrentPage: (p) => set({ currentPage: p }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchHits: (hits) => set({ searchHits: hits, searchCursor: hits.length > 0 ? 0 : -1 }),
  setSearchCursor: (i) => set({ searchCursor: i }),
  setHighlights: (m) => set({ highlightsByPage: m }),
  clearSearch: () =>
    set({
      searchQuery: '',
      searchHits: [],
      searchCursor: -1,
      highlightsByPage: new Map()
    }),
  setViewportSize: (w, h) => set({ viewportSize: { w, h } }),
  requestJump: (p) => set({ jumpRequest: p }),
  consumeJump: () => set({ jumpRequest: null }),

  setSelection: (s) => set({ selection: new Set(s) }),
  selectOnly: (i) => set({ selection: new Set([i]) }),
  toggleSelect: (i) =>
    set((st) => {
      const ns = new Set(st.selection)
      if (ns.has(i)) ns.delete(i)
      else ns.add(i)
      return { selection: ns }
    }),
  selectRange: (anchor, target) => {
    const [lo, hi] = anchor <= target ? [anchor, target] : [target, anchor]
    const ns = new Set<number>()
    for (let i = lo; i <= hi; i++) ns.add(i)
    set({ selection: ns })
  },
  clearSelection: () => set({ selection: new Set() }),

  getActionTargets: () => {
    const s = get()
    if (s.selection.size > 0) return [...s.selection].sort((a, b) => a - b)
    return s.pages.length > 0 ? [s.currentPage] : []
  },

  rotateSelection: (delta) => {
    const s = get()
    const targets = s.getActionTargets()
    if (targets.length === 0) return
    const next = applyRotate(s.pages, targets, delta)
    if (pagesEqual(next, s.pages)) return
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({ pages: next, undoStack, redoStack: [] })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  deleteSelection: () => {
    const s = get()
    const targets = s.getActionTargets()
    if (targets.length === 0 || targets.length >= s.pages.length) return
    const next = applyDelete(s.pages, targets)
    const undoStack = pushUndo(s.undoStack, s.pages)
    const minDel = Math.min(...targets)
    const newCurrent = Math.max(0, Math.min(next.length - 1, minDel))
    set({
      pages: next,
      undoStack,
      redoStack: [],
      selection: new Set(),
      currentPage: newCurrent
    })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  movePages: (indices, target) => {
    const s = get()
    if (indices.length === 0) return
    const next = applyMove(s.pages, indices, target)
    if (pagesEqual(next, s.pages)) return
    const map = moveIndexMap(s.pages.length, indices, target)
    const newSelection = new Set<number>()
    for (const idx of s.selection) {
      const m = map[idx]
      if (m >= 0) newSelection.add(m)
    }
    const newCurrent = map[s.currentPage] >= 0 ? map[s.currentPage] : 0
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({
      pages: next,
      undoStack,
      redoStack: [],
      selection: newSelection,
      currentPage: newCurrent
    })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  insertPages: (inserts, target) => {
    const s = get()
    if (inserts.length === 0) return
    const next = applyInsert(s.pages, inserts, target)
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({
      pages: next,
      undoStack,
      redoStack: [],
      selection: new Set(
        Array.from({ length: inserts.length }, (_, i) => target + i)
      ),
      currentPage: target
    })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  setTool: (t) =>
    set((st) => ({
      tool: t,
      selectedAnnotation: t === 'select' ? st.selectedAnnotation : null,
      // Switching tool always drops any active text selection.
      textSelection: t === 'text' ? st.textSelection : null
    })),

  setTextSelection: (sel) => set({ textSelection: sel }),

  ensurePageChars: async (page) => {
    const s = get()
    if (page < 0 || page >= s.pages.length) return null
    const vp = s.pages[page]
    const key = `${vp.sourceId}|${vp.sourceIndex}`
    const cached = s.pageCharsCache.get(key)
    if (cached) return cached
    const data = await window.pdf.getChars(vp.sourceId, vp.sourceIndex)
    if (!data) return null
    set((st) => {
      const next = new Map(st.pageCharsCache)
      next.set(key, data)
      return { pageCharsCache: next }
    })
    return data
  },

  setToolDefaults: (patch) =>
    set((st) => ({ toolDefaults: { ...st.toolDefaults, ...patch } })),

  setFreeTextDefaults: (patch) =>
    set((st) => ({ freeTextDefaults: { ...st.freeTextDefaults, ...patch } })),

  addAnnotation: (page, a) => {
    const s = get()
    if (page < 0 || page >= s.pages.length) return
    const next = s.pages.map((vp, i) =>
      i === page ? { ...vp, annotations: addAnnFn(vp.annotations, a) } : vp
    )
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({
      pages: next,
      undoStack,
      redoStack: [],
      selectedAnnotation: { page, id: a.id }
    })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  updateAnnotation: (page, id, patch) => {
    const s = get()
    if (page < 0 || page >= s.pages.length) return
    const next = s.pages.map((vp, i) =>
      i === page ? { ...vp, annotations: updAnnFn(vp.annotations, id, patch) } : vp
    )
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({ pages: next, undoStack, redoStack: [] })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  deleteAnnotation: (page, id) => {
    const s = get()
    if (page < 0 || page >= s.pages.length) return
    const next = s.pages.map((vp, i) =>
      i === page ? { ...vp, annotations: delAnnFn(vp.annotations, id) } : vp
    )
    const undoStack = pushUndo(s.undoStack, s.pages)
    const sel =
      s.selectedAnnotation && s.selectedAnnotation.id === id ? null : s.selectedAnnotation
    set({ pages: next, undoStack, redoStack: [], selectedAnnotation: sel })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  setSelectedAnnotation: (sel) => set({ selectedAnnotation: sel }),

  copyAnnotation: (page, id) => {
    const s = get()
    const ann = s.pages[page]?.annotations?.find((a) => a.id === id)
    if (ann) set({ clipboard: ann })
  },

  cutAnnotation: (page, id) => {
    const s = get()
    const ann = s.pages[page]?.annotations?.find((a) => a.id === id)
    if (!ann) return
    set({ clipboard: ann })
    s.deleteAnnotation(page, id)
  },

  pasteAnnotation: (page, ptX, ptY) => {
    const s = get()
    if (!s.clipboard) return
    if (page < 0 || page >= s.pages.length) return
    const src = s.clipboard
    const now = Date.now()
    let copy: Annotation
    if (isLine(src)) {
      const cx = (src.x1 + src.x2) / 2
      const cy = (src.y1 + src.y2) / 2
      const dx = ptX - cx
      const dy = ptY - cy
      copy = {
        ...src,
        id: newId(),
        x1: src.x1 + dx,
        y1: src.y1 + dy,
        x2: src.x2 + dx,
        y2: src.y2 + dy,
        created: now,
        modified: now
      }
    } else if (isNote(src)) {
      copy = {
        ...src,
        id: newId(),
        x: ptX - NOTE_SIZE_PT / 2,
        y: ptY - NOTE_SIZE_PT / 2,
        created: now,
        modified: now
      }
    } else if (isFreeText(src)) {
      copy = {
        ...src,
        id: newId(),
        x: ptX - src.w / 2,
        y: ptY - src.h / 2,
        created: now,
        modified: now
      }
    } else {
      // Box: center on the click point.
      copy = {
        ...src,
        id: newId(),
        x: ptX - src.w / 2,
        y: ptY - src.h / 2,
        created: now,
        modified: now
      }
    }
    s.addAnnotation(page, copy)
  },

  beginLiveEdit: () => {
    const s = get()
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({ undoStack, redoStack: [] })
  },

  liveUpdateAnnotation: (page, id, patch) => {
    const s = get()
    if (page < 0 || page >= s.pages.length) return
    const next = s.pages.map((vp, i) =>
      i === page ? { ...vp, annotations: updAnnFn(vp.annotations, id, patch) } : vp
    )
    set({ pages: next })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  undo: () => {
    const s = get()
    if (s.undoStack.length === 0) return
    const prev = s.undoStack[s.undoStack.length - 1]
    const undoStack = s.undoStack.slice(0, -1)
    const redoStack = [...s.redoStack, s.pages]
    set({ pages: prev, undoStack, redoStack, selection: new Set(), selectedAnnotation: null })
    window.pdf.setDirty(isDirty(prev, s.savedPages))
  },

  redo: () => {
    const s = get()
    if (s.redoStack.length === 0) return
    const next = s.redoStack[s.redoStack.length - 1]
    const redoStack = s.redoStack.slice(0, -1)
    const undoStack = pushUndo(s.undoStack, s.pages)
    set({ pages: next, undoStack, redoStack, selection: new Set(), selectedAnnotation: null })
    window.pdf.setDirty(isDirty(next, s.savedPages))
  },

  markSaved: () => {
    const s = get()
    set({ savedPages: s.pages })
    window.pdf.setDirty(false)
  },

  renameDoc: (newPath, newName) => {
    set((s) => {
      if (!s.doc) return s
      return {
        doc: { ...s.doc, id: newPath, path: newPath, name: newName },
        savedPages: s.pages
      }
    })
    window.pdf.setDirty(false)
  },

  sourcePaths: () => {
    const s = get()
    const out: Record<string, string> = {}
    for (const id of Object.keys(s.sources)) out[id] = id
    return out
  },

  sourceSize: (sourceId, sourceIndex) => {
    const s = get()
    const src = s.sources[sourceId]
    if (!src) return { width: 612, height: 792 }
    return src.pageSizes[sourceIndex] ?? { width: 612, height: 792 }
  }
}))

function pushUndo(stack: VirtualPage[][], snapshot: VirtualPage[]): VirtualPage[][] {
  const next = [...stack, snapshot]
  if (next.length > UNDO_LIMIT) next.shift()
  return next
}

/** Virtual-page sizes accounting for rotation, looking up each source. */
export function virtualPageSizes(
  pages: VirtualPage[],
  lookup: (sourceId: string, sourceIndex: number) => { width: number; height: number }
): { width: number; height: number }[] {
  return pages.map((vp) => rotatedSize(lookup(vp.sourceId, vp.sourceIndex), vp.rotation))
}

export function maxPageWidth(sizes: { width: number; height: number }[]): number {
  return sizes.reduce((m, s) => Math.max(m, s.width), 1)
}

export function maxPageHeight(sizes: { width: number; height: number }[]): number {
  return sizes.reduce((m, s) => Math.max(m, s.height), 1)
}

export function computeFittedScale(
  sizes: { width: number; height: number }[],
  mode: ZoomMode,
  vp: { w: number; h: number }
): number | null {
  // Actual Size has a known answer regardless of viewport — short-circuit so
  // it works even before the first ResizeObserver tick.
  if (mode === 'actual') return 1
  if (vp.w <= 0 || vp.h <= 0) return null
  const pad = 32
  const maxW = maxPageWidth(sizes)
  const maxH = maxPageHeight(sizes)
  if (mode === 'fit-width') return (vp.w - pad) / maxW
  if (mode === 'fit-page') {
    const sw = (vp.w - pad) / maxW
    const sh = (vp.h - pad) / maxH
    return Math.min(sw, sh)
  }
  return null
}

export type { Rotation, VirtualPage }
