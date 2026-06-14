import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, computeFittedScale, maxPageHeight, maxPageWidth } from '../src/renderer/src/store'
import type { DocInfo } from '../src/shared/ipc'

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

beforeEach(() => {
  useStore.setState({
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
    // (1000 - 32) / 612 = 1.5817...
    expect(s).toBeCloseTo((1000 - 32) / 612, 3)
  })

  it('fit-page picks smaller of width and height ratios', () => {
    const s = computeFittedScale(doc, 'fit-page', { w: 1000, h: 500 })
    const sw = (1000 - 32) / 612
    const sh = (500 - 32) / 842
    expect(s).toBeCloseTo(Math.min(sw, sh), 3)
  })
})
