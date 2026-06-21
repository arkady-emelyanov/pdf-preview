import { useEffect, useRef, useState } from 'react'
import { useStore, type PageChars } from './store'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { copyTextSelection } from './keys'
import type { PageRect } from '../../shared/ipc'

interface Props {
  virtualIndex: number
  pageWidthPt: number
  pageHeightPt: number
  scale: number
}

/**
 * Find the char index closest to canvas point (cx, cy). The check has two
 * phases: an "exact" hit (point inside box) for unambiguous targeting, and a
 * fallback that picks the nearest char on the closest line (so clicks in the
 * gap between two words still snap somewhere reasonable).
 */
function charIndexAt(chars: PageChars, cx: number, cy: number, scale: number): number {
  if (chars.boxes.length === 0) return -1
  // First pass: any box that strictly contains the point.
  for (let i = 0; i < chars.boxes.length; i++) {
    const b = chars.boxes[i]
    if (b.w === 0 || b.h === 0) continue
    const x = b.x * scale
    const y = b.y * scale
    if (cx >= x && cx <= x + b.w * scale && cy >= y && cy <= y + b.h * scale) {
      return i
    }
  }
  // Second pass: nearest box by squared distance, line-first.
  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < chars.boxes.length; i++) {
    const b = chars.boxes[i]
    if (b.w === 0 || b.h === 0) continue
    const x = b.x * scale
    const y = b.y * scale
    const w = b.w * scale
    const h = b.h * scale
    // Line bias: penalize chars whose y-range doesn't include cy.
    const dy = cy < y ? y - cy : cy > y + h ? cy - (y + h) : 0
    const dx = cx < x ? x - cx : cx > x + w ? cx - (x + w) : 0
    const d = dx * dx + dy * dy * 4 // weight y harder so we stay on the right line
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

/**
 * Expand `idx` to the surrounding whitespace-bounded word, returning
 * `[wordStart, wordEnd]` (inclusive char indices). Punctuation is treated as
 * part of the word, matching Acrobat / Preview's double-click behavior.
 * Returns `null` if the clicked char is itself whitespace.
 */
function wordRangeAt(chars: PageChars, idx: number): [number, number] | null {
  const text = chars.text
  if (idx < 0 || idx >= text.length) return null
  if (/\s/.test(text[idx])) return null
  let lo = idx
  while (lo > 0 && !/\s/.test(text[lo - 1])) lo--
  let hi = idx
  while (hi < text.length - 1 && !/\s/.test(text[hi + 1])) hi++
  return [lo, hi]
}

/** Merge consecutive selected char rects into per-line spans. */
function mergeLineSpans(chars: PageChars, start: number, end: number): PageRect[] {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const out: PageRect[] = []
  let cur: PageRect | null = null
  for (let i = lo; i <= hi; i++) {
    const b = chars.boxes[i]
    if (!b || b.w === 0 || b.h === 0) continue
    if (!cur) {
      cur = { ...b }
      continue
    }
    const sameLine = Math.abs(b.y + b.h / 2 - (cur.y + cur.h / 2)) <= b.h * 0.5
    const adjacent = b.x <= cur.x + cur.w + b.h * 0.5
    if (sameLine && adjacent) {
      const right = Math.max(cur.x + cur.w, b.x + b.w)
      const top = Math.min(cur.y, b.y)
      const bot = Math.max(cur.y + cur.h, b.y + b.h)
      cur.x = Math.min(cur.x, b.x)
      cur.w = right - cur.x
      cur.y = top
      cur.h = bot - top
    } else {
      out.push(cur)
      cur = { ...b }
    }
  }
  if (cur) out.push(cur)
  return out
}

export function TextSelectionLayer({
  virtualIndex,
  pageWidthPt,
  pageHeightPt,
  scale
}: Props): JSX.Element | null {
  const tool = useStore((s) => s.tool)
  const textSelection = useStore((s) => s.textSelection)
  const setTextSelection = useStore((s) => s.setTextSelection)
  const ensurePageChars = useStore((s) => s.ensurePageChars)
  const pageCharsCache = useStore((s) => s.pageCharsCache)
  const pages = useStore((s) => s.pages)

  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null
  )

  const vp = pages[virtualIndex]
  const key = vp ? `${vp.sourceId}|${vp.sourceIndex}` : null
  const chars = key ? pageCharsCache.get(key) ?? null : null
  const active = tool === 'text'
  const hasSelectionHere = textSelection?.page === virtualIndex

  useEffect(() => {
    if (!active) return
    void ensurePageChars(virtualIndex)
  }, [active, virtualIndex, ensurePageChars])

  if (!active && !hasSelectionHere) return null

  const cssW = pageWidthPt * scale
  const cssH = pageHeightPt * scale

  const localCoords = (e: React.PointerEvent): { cx: number; cy: number } => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !active) return
    // chars should already be cached because of the useEffect above; if a fast
    // user out-races the fetch, the next click will succeed.
    if (!chars) return
    const { cx, cy } = localCoords(e)
    const idx = charIndexAt(chars, cx, cy, scale)
    if (idx < 0) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    setDragging(true)
    setTextSelection({ page: virtualIndex, start: idx, end: idx })
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging || !chars || !textSelection) return
    const { cx, cy } = localCoords(e)
    const idx = charIndexAt(chars, cx, cy, scale)
    if (idx < 0 || idx === textSelection.end) return
    setTextSelection({ page: virtualIndex, start: textSelection.start, end: idx })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (!active || !chars) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const idx = charIndexAt(chars, cx, cy, scale)
    if (idx < 0) return
    const range = wordRangeAt(chars, idx)
    if (!range) return
    // Cancel any drag that the second pointerdown left active so the next
    // mouse-move doesn't extend the selection back to a single char.
    setDragging(false)
    setTextSelection({ page: virtualIndex, start: range[0], end: range[1] })
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    if (!hasSelectionHere) return
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ label: 'Copy', onClick: () => void copyTextSelection() }]
    })
  }

  const spans =
    chars && hasSelectionHere
      ? mergeLineSpans(chars, textSelection!.start, textSelection!.end)
      : []

  return (
    <>
      <div
        ref={ref}
        className="text-select-layer"
        style={{
          position: 'absolute',
          inset: 0,
          width: cssW,
          height: cssH,
          cursor: active ? 'text' : 'default',
          // Keep capturing right-clicks while a selection exists, even after
          // the user switched away from the text tool, so they can still copy.
          pointerEvents: active || hasSelectionHere ? 'auto' : 'none'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {spans.map((r, i) => (
          <div
            key={i}
            className="text-select-rect"
            style={{
              position: 'absolute',
              left: r.x * scale,
              top: r.y * scale,
              width: r.w * scale,
              height: r.h * scale
            }}
          />
        ))}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}
