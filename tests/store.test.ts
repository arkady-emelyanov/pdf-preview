import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useStore,
  computeFittedScale,
  maxPageHeight,
  maxPageWidth,
  virtualPageSizes
} from '../src/renderer/src/store'
import type { DocInfo } from '../src/shared/ipc'
import { identityPages } from '../src/shared/edit'

const doc: DocInfo = {
  id: '/x/doc.pdf',
  path: '/x/doc.pdf',
  name: 'doc.pdf',
  pageCount: 3,
  pageSizes: [
    { width: 595, height: 842 },
    { width: 612, height: 792 },
    { width: 200, height: 400 }
  ]
}

// The store calls window.pdf.setDirty as a side effect on every mutation.
// Stub the bridge so tests don't blow up.
const setDirty = vi.fn()
beforeEach(() => {
  setDirty.mockClear()
  ;(globalThis as unknown as { window: Window }).window =
    (globalThis as unknown as { window?: Window }).window ?? ({} as Window)
  ;(window as unknown as { pdf: { setDirty: (b: boolean) => void } }).pdf = {
    setDirty
  }
  useStore.setState({
    doc: null,
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
    jumpRequest: null
  })
})

describe('store: setDoc', () => {
  it('replaces doc and resets per-doc state', () => {
    useStore.setState({ currentPage: 5, searchQuery: 'foo', searchCursor: 2 })
    useStore.getState().setDoc(doc)
    const s = useStore.getState()
    expect(s.doc).toEqual(doc)
    expect(s.currentPage).toBe(0)
    expect(s.searchQuery).toBe('')
    expect(s.searchCursor).toBe(-1)
    expect(s.pages).toHaveLength(3)
    expect(s.pages.every((p, i) => p.sourceIndex === i && p.rotation === 0)).toBe(true)
    expect(setDirty).toHaveBeenCalledWith(false)
  })
})

describe('store: setScale flips zoomMode to custom', () => {
  it('zoomMode → custom when scale is set manually', () => {
    useStore.setState({ zoomMode: 'fit-width' })
    useStore.getState().setScale(2)
    const s = useStore.getState()
    expect(s.scale).toBe(2)
    expect(s.zoomMode).toBe('custom')
  })
})

describe('store: search', () => {
  it('setSearchHits puts cursor at 0 when non-empty, -1 when empty', () => {
    const api = useStore.getState()
    api.setSearchHits([
      { page: 0, preview: 'a', rects: [] },
      { page: 2, preview: 'b', rects: [] }
    ])
    expect(useStore.getState().searchCursor).toBe(0)
    api.setSearchHits([])
    expect(useStore.getState().searchCursor).toBe(-1)
  })

  it('clearSearch wipes query/hits/highlights', () => {
    const api = useStore.getState()
    api.setSearchQuery('foo')
    api.setSearchHits([{ page: 0, preview: 'x', rects: [] }])
    api.setHighlights(new Map([[0, [{ x: 1, y: 2, w: 3, h: 4 }]]]))
    api.clearSearch()
    const s = useStore.getState()
    expect(s.searchQuery).toBe('')
    expect(s.searchHits).toEqual([])
    expect(s.searchCursor).toBe(-1)
    expect(s.highlightsByPage.size).toBe(0)
  })
})

describe('store: jumpRequest is consumable', () => {
  it('requestJump then consumeJump clears it', () => {
    const api = useStore.getState()
    api.requestJump(2)
    expect(useStore.getState().jumpRequest).toBe(2)
    api.consumeJump()
    expect(useStore.getState().jumpRequest).toBeNull()
  })
})

describe('layout helpers', () => {
  it('maxPageWidth picks the largest', () => {
    expect(maxPageWidth(doc)).toBe(612)
  })
  it('maxPageHeight picks the largest', () => {
    expect(maxPageHeight(doc)).toBe(842)
  })
  it('virtualPageSizes swaps width/height for 90/270 rotation', () => {
    const sizes = virtualPageSizes(doc, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 0, rotation: 90 },
      { sourceIndex: 0, rotation: 180 },
      { sourceIndex: 0, rotation: 270 }
    ])
    expect(sizes[0]).toEqual({ width: 595, height: 842 })
    expect(sizes[1]).toEqual({ width: 842, height: 595 })
    expect(sizes[2]).toEqual({ width: 595, height: 842 })
    expect(sizes[3]).toEqual({ width: 842, height: 595 })
  })
})

describe('computeFittedScale', () => {
  it('returns null for zero viewport', () => {
    expect(computeFittedScale(doc, 'fit-width', { w: 0, h: 0 })).toBeNull()
  })

  it('actual mode returns 1', () => {
    expect(computeFittedScale(doc, 'actual', { w: 1000, h: 1000 })).toBe(1)
  })

  it('custom mode returns null (caller keeps current scale)', () => {
    expect(computeFittedScale(doc, 'custom', { w: 1000, h: 1000 })).toBeNull()
  })

  it('fit-width scales by widest page minus padding', () => {
    const s = computeFittedScale(doc, 'fit-width', { w: 1000, h: 1000 })
    expect(s).toBeCloseTo((1000 - 32) / 612, 3)
  })

  it('fit-page picks smaller of width and height ratios', () => {
    const s = computeFittedScale(doc, 'fit-page', { w: 1000, h: 500 })
    const sw = (1000 - 32) / 612
    const sh = (500 - 32) / 842
    expect(s).toBeCloseTo(Math.min(sw, sh), 3)
  })

  it('honors rotated page sizes when pages are passed', () => {
    // After rotating page 0 to 90°, its width = 842 (was its height).
    const pages = [
      { sourceIndex: 0 as number, rotation: 90 as const },
      { sourceIndex: 2 as number, rotation: 0 as const }
    ]
    const s = computeFittedScale(doc, 'fit-width', { w: 1000, h: 1000 }, pages)
    // Widest is now 842 (rotated page 0).
    expect(s).toBeCloseTo((1000 - 32) / 842, 3)
  })
})

describe('store: edit ops', () => {
  beforeEach(() => {
    useStore.getState().setDoc(doc)
  })

  it('rotateSelection rotates current page when nothing selected', () => {
    useStore.setState({ currentPage: 1 })
    useStore.getState().rotateSelection(90)
    const s = useStore.getState()
    expect(s.pages[1].rotation).toBe(90)
    expect(s.pages[0].rotation).toBe(0)
    expect(s.undoStack).toHaveLength(1)
    expect(setDirty).toHaveBeenLastCalledWith(true)
  })

  it('rotateSelection rotates all selected pages', () => {
    useStore.getState().setSelection(new Set([0, 2]))
    useStore.getState().rotateSelection(-90)
    const s = useStore.getState()
    expect(s.pages[0].rotation).toBe(270)
    expect(s.pages[1].rotation).toBe(0)
    expect(s.pages[2].rotation).toBe(270)
  })

  it('rotations are cumulative modulo 360', () => {
    useStore.setState({ currentPage: 0 })
    const api = useStore.getState()
    api.rotateSelection(90)
    api.rotateSelection(90)
    api.rotateSelection(90)
    api.rotateSelection(90)
    expect(useStore.getState().pages[0].rotation).toBe(0)
  })

  it('deleteSelection removes pages and clamps currentPage', () => {
    useStore.getState().setSelection(new Set([1]))
    useStore.getState().deleteSelection()
    const s = useStore.getState()
    expect(s.pages).toHaveLength(2)
    expect(s.pages[0].sourceIndex).toBe(0)
    expect(s.pages[1].sourceIndex).toBe(2)
    expect(s.selection.size).toBe(0)
    expect(s.currentPage).toBe(1)
    expect(setDirty).toHaveBeenLastCalledWith(true)
  })

  it('deleteSelection refuses to delete the last page', () => {
    useStore.setState({ pages: identityPages(1) })
    useStore.getState().setSelection(new Set([0]))
    useStore.getState().deleteSelection()
    expect(useStore.getState().pages).toHaveLength(1)
  })

  it('undo restores prior snapshot; redo replays', () => {
    const api = useStore.getState()
    useStore.setState({ currentPage: 0 })
    api.rotateSelection(90)
    expect(useStore.getState().pages[0].rotation).toBe(90)

    api.undo()
    expect(useStore.getState().pages[0].rotation).toBe(0)
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().redoStack).toHaveLength(1)
    expect(setDirty).toHaveBeenLastCalledWith(false)

    api.redo()
    expect(useStore.getState().pages[0].rotation).toBe(90)
    expect(useStore.getState().redoStack).toHaveLength(0)
    expect(useStore.getState().undoStack).toHaveLength(1)
    expect(setDirty).toHaveBeenLastCalledWith(true)
  })

  it('any new mutation clears the redo stack', () => {
    const api = useStore.getState()
    useStore.setState({ currentPage: 0 })
    api.rotateSelection(90)
    api.undo()
    expect(useStore.getState().redoStack).toHaveLength(1)
    api.rotateSelection(180)
    expect(useStore.getState().redoStack).toHaveLength(0)
  })

  it('markSaved snapshots the current pages → not dirty', () => {
    const api = useStore.getState()
    useStore.setState({ currentPage: 0 })
    api.rotateSelection(90)
    expect(setDirty).toHaveBeenLastCalledWith(true)
    api.markSaved()
    expect(setDirty).toHaveBeenLastCalledWith(false)
    expect(useStore.getState().savedPages[0].rotation).toBe(90)
  })

  it('undoing back to saved state clears the dirty flag', () => {
    const api = useStore.getState()
    useStore.setState({ currentPage: 0 })
    api.rotateSelection(90)
    expect(setDirty).toHaveBeenLastCalledWith(true)
    api.undo()
    expect(setDirty).toHaveBeenLastCalledWith(false)
  })
})

describe('store: selection helpers', () => {
  beforeEach(() => useStore.getState().setDoc(doc))

  it('selectOnly replaces selection with one index', () => {
    useStore.getState().selectOnly(2)
    expect([...useStore.getState().selection]).toEqual([2])
  })

  it('toggleSelect adds and removes', () => {
    const api = useStore.getState()
    api.toggleSelect(1)
    api.toggleSelect(2)
    expect(useStore.getState().selection.size).toBe(2)
    api.toggleSelect(1)
    expect(useStore.getState().selection.size).toBe(1)
    expect(useStore.getState().selection.has(2)).toBe(true)
  })

  it('selectRange covers contiguous range either direction', () => {
    useStore.getState().selectRange(2, 0)
    expect([...useStore.getState().selection].sort()).toEqual([0, 1, 2])
  })

  it('getActionTargets falls back to currentPage when nothing selected', () => {
    useStore.setState({ currentPage: 1 })
    expect(useStore.getState().getActionTargets()).toEqual([1])
  })

  it('getActionTargets returns sorted selection when not empty', () => {
    useStore.getState().setSelection(new Set([2, 0, 1]))
    expect(useStore.getState().getActionTargets()).toEqual([0, 1, 2])
  })
})
