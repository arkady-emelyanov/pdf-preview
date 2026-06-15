import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, computeFittedScale, virtualPageSizes } from './store'
import { PdfPage } from './PdfPage'

const PAGE_GAP = 16
const BUFFER = 2

export function Viewport(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const pages = useStore((s) => s.pages)
  const sources = useStore((s) => s.sources)
  const scale = useStore((s) => s.scale)
  const zoomMode = useStore((s) => s.zoomMode)
  const setCurrentPage = useStore((s) => s.setCurrentPage)
  const setViewportSize = useStore((s) => s.setViewportSize)
  const jumpRequest = useStore((s) => s.jumpRequest)
  const consumeJump = useStore((s) => s.consumeJump)
  const highlightsByPage = useStore((s) => s.highlightsByPage)
  const sourceSize = useStore((s) => s.sourceSize)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleSet, setVisibleSet] = useState<Set<number>>(new Set([0]))

  // Re-runs when `doc` flips because the scroll div is only mounted on the
  // happy-path return below — the placeholder branch has no ref to observe.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportSize(el.clientWidth, el.clientHeight)
    })
    ro.observe(el)
    setViewportSize(el.clientWidth, el.clientHeight)
    return () => ro.disconnect()
  }, [setViewportSize, doc])

  const vpSize = useStore((s) => s.viewportSize)
  useEffect(() => {
    if (!doc || zoomMode === 'custom') return
    const sizes = virtualPageSizes(pages, sourceSize)
    const s = computeFittedScale(sizes, zoomMode, vpSize)
    if (s && Math.abs(s - scale) > 0.001) {
      useStore.setState({ scale: s })
    }
  }, [doc, zoomMode, vpSize, scale, pages, sources, sourceSize])

  const layout = useMemo(() => {
    if (!doc || pages.length === 0) return null
    const sizes = virtualPageSizes(pages, sourceSize)
    let y = PAGE_GAP
    const tops: number[] = []
    const scaled = sizes.map((sz) => {
      const w = sz.width * scale
      const h = sz.height * scale
      tops.push(y)
      y += h + PAGE_GAP
      return { w, h }
    })
    return { tops, sizes: scaled, totalHeight: y }
    // sources participates so layout recomputes when a new source registers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pages, scale, sources])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !layout) return
    const update = (): void => {
      const top = el.scrollTop
      const bottom = top + el.clientHeight
      let first = 0
      let last = 0
      let currentByMidline = 0
      const midline = top + el.clientHeight / 2
      for (let i = 0; i < layout.tops.length; i++) {
        const pageTop = layout.tops[i]
        const pageBottom = pageTop + layout.sizes[i].h
        if (pageBottom < top) first = i + 1
        if (pageTop <= midline) currentByMidline = i
        if (pageTop < bottom) last = i
      }
      const newVisible = new Set<number>()
      for (
        let i = Math.max(0, first - BUFFER);
        i <= Math.min(layout.tops.length - 1, last + BUFFER);
        i++
      ) {
        newVisible.add(i)
      }
      setVisibleSet(newVisible)
      setCurrentPage(currentByMidline)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [layout, setCurrentPage])

  useEffect(() => {
    if (jumpRequest == null || !layout || !scrollRef.current) return
    const top = layout.tops[Math.max(0, Math.min(layout.tops.length - 1, jumpRequest))] - PAGE_GAP
    scrollRef.current.scrollTo({ top, behavior: 'instant' })
    consumeJump()
  }, [jumpRequest, layout, consumeJump])

  if (!doc) {
    return (
      <div
        className="placeholder"
        onDoubleClick={() => window.pdf.showOpenDialog()}
        title="Double-click to open a PDF"
      >
        Double-click to open a PDF · or File → Open…
      </div>
    )
  }
  if (!layout) return <div />

  return (
    <div ref={scrollRef} className="viewport-scroll">
      <div className="pages-spacer" style={{ height: layout.totalHeight }}>
        {pages.map((vp, i) => {
          const sz = layout.sizes[i]
          const src = sourceSize(vp.sourceId, vp.sourceIndex)
          return (
            <div
              key={`${vp.sourceId}:${vp.sourceIndex}:${i}`}
              className="page-row"
              style={{
                position: 'absolute',
                top: layout.tops[i],
                left: '50%',
                transform: 'translateX(-50%)',
                width: sz.w,
                height: sz.h
              }}
            >
              <PdfPage
                sourceId={vp.sourceId}
                sourceIndex={vp.sourceIndex}
                virtualIndex={i}
                rotation={vp.rotation}
                scale={scale}
                pageWidthPt={src.width}
                pageHeightPt={src.height}
                expectedWidth={sz.w}
                expectedHeight={sz.h}
                visible={visibleSet.has(i)}
                highlights={highlightsByPage.get(i)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
