import { useEffect, useRef, useState } from 'react'
import { useStore, type SearchHit } from './store'
import type { PageRect } from '../../shared/ipc'

const CONTEXT = 40

function makePreview(text: string, idx: number, q: number): string {
  const start = Math.max(0, idx - CONTEXT)
  const end = Math.min(text.length, idx + q + CONTEXT)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return (prefix + text.slice(start, end) + suffix).replace(/\s+/g, ' ')
}

export function SearchBar(): JSX.Element | null {
  const open = useStore((s) => s.searchOpen)
  const close = useStore((s) => s.closeSearch)
  const doc = useStore((s) => s.doc)
  const pages = useStore((s) => s.pages)
  const query = useStore((s) => s.searchQuery)
  const setQuery = useStore((s) => s.setSearchQuery)
  const hits = useStore((s) => s.searchHits)
  const setHits = useStore((s) => s.setSearchHits)
  const cursor = useStore((s) => s.searchCursor)
  const setCursor = useStore((s) => s.setSearchCursor)
  const setHighlights = useStore((s) => s.setHighlights)
  const clearSearch = useStore((s) => s.clearSearch)
  const requestJump = useStore((s) => s.requestJump)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const runSearch = async (): Promise<void> => {
    if (!doc || !query.trim()) {
      setHits([])
      setHighlights(new Map())
      return
    }
    setBusy(true)
    const q = query
    const results: SearchHit[] = []
    const rectsByPage = new Map<number, PageRect[]>()
    // Cache per (sourceId|sourceIndex) so virtual pages that reference the
    // same source page don't trigger duplicate IPC calls.
    const textCache = new Map<string, string>()
    const rectCache = new Map<string, PageRect[]>()

    for (let i = 0; i < pages.length; i++) {
      const vp = pages[i]
      const key = `${vp.sourceId}|${vp.sourceIndex}`
      let text = textCache.get(key)
      if (text === undefined) {
        text = (await window.pdf.getText(vp.sourceId, vp.sourceIndex)) ?? ''
        textCache.set(key, text)
      }
      const idx = text.toLowerCase().indexOf(q.toLowerCase())
      if (idx >= 0) {
        let rects = rectCache.get(key)
        if (!rects) {
          rects = (await window.pdf.findMatchRects(vp.sourceId, vp.sourceIndex, q)) ?? []
          rectCache.set(key, rects)
        }
        rectsByPage.set(i, rects)
        results.push({ page: i, preview: makePreview(text, idx, q.length), rects })
      }
    }
    setHits(results)
    setHighlights(rectsByPage)
    setBusy(false)
    if (results.length > 0) requestJump(results[0].page)
  }

  const next = (): void => {
    if (hits.length === 0) return
    const n = (cursor + 1) % hits.length
    setCursor(n)
    requestJump(hits[n].page)
  }

  const prev = (): void => {
    if (hits.length === 0) return
    const n = (cursor - 1 + hits.length) % hits.length
    setCursor(n)
    requestJump(hits[n].page)
  }

  if (!open) return null

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in document…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (hits.length === 0) runSearch()
            else if (e.shiftKey) prev()
            else next()
          } else if (e.key === 'Escape') {
            close()
          }
        }}
      />
      <button onClick={runSearch} disabled={busy}>
        {busy ? '…' : 'Find'}
      </button>
      <span className="meta">
        {hits.length === 0 ? (query ? 'No matches' : '') : `${cursor + 1} / ${hits.length}`}
      </span>
      <button onClick={prev} disabled={hits.length === 0}>
        ↑
      </button>
      <button onClick={next} disabled={hits.length === 0}>
        ↓
      </button>
      <button
        onClick={() => {
          clearSearch()
          close()
        }}
      >
        ✕
      </button>
    </div>
  )
}
