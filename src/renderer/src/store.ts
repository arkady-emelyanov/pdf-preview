import { create } from 'zustand'
import type { DocInfo, PageRect } from '../../shared/ipc'

export type ZoomMode = 'fit-width' | 'fit-page' | 'actual' | 'custom'

export interface SearchHit {
  page: number
  preview: string
  rects: PageRect[]
}

interface State {
  doc: DocInfo | null
  scale: number
  zoomMode: ZoomMode
  currentPage: number
  sidebarOpen: boolean
  searchOpen: boolean
  searchQuery: string
  searchHits: SearchHit[]
  searchCursor: number
  /** Per-page highlight rects (in PDF points). Driven by the current search query. */
  highlightsByPage: Map<number, PageRect[]>
  viewportSize: { w: number; h: number }
  jumpRequest: number | null

  setDoc: (d: DocInfo | null) => void
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
}

export const useStore = create<State>((set) => ({
  doc: null,
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

  setDoc: (d) =>
    set({
      doc: d,
      currentPage: 0,
      searchHits: [],
      searchQuery: '',
      searchCursor: -1,
      highlightsByPage: new Map()
    }),
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
  consumeJump: () => set({ jumpRequest: null })
}))

export function maxPageWidth(d: DocInfo): number {
  return d.pageSizes.reduce((m, s) => Math.max(m, s.width), 1)
}

export function maxPageHeight(d: DocInfo): number {
  return d.pageSizes.reduce((m, s) => Math.max(m, s.height), 1)
}

export function computeFittedScale(
  d: DocInfo,
  mode: ZoomMode,
  vp: { w: number; h: number }
): number | null {
  if (vp.w <= 0 || vp.h <= 0) return null
  const pad = 32
  if (mode === 'fit-width') return (vp.w - pad) / maxPageWidth(d)
  if (mode === 'fit-page') {
    const sw = (vp.w - pad) / maxPageWidth(d)
    const sh = (vp.h - pad) / maxPageHeight(d)
    return Math.min(sw, sh)
  }
  if (mode === 'actual') return 1
  return null
}
