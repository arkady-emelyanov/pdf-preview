import { useEffect, useRef } from 'react'
import { useStore } from './store'
import { rotatedSize } from '../../shared/edit'

const THUMB_WIDTH = 120

function Thumb({
  docId,
  virtualIndex,
  sourceIndex,
  rotation,
  pageWidth,
  pageHeight,
  active,
  selected,
  onClick,
  onMouseDown
}: {
  docId: string
  virtualIndex: number
  sourceIndex: number
  rotation: number
  pageWidth: number
  pageHeight: number
  active: boolean
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // (Re)render whenever rotation changes
  useEffect(() => {
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          io.disconnect()
          ;(async () => {
            const res = await window.pdf.renderPage(docId, sourceIndex, 0.25, rotation)
            if (cancelled || !res || !ref.current) return
            ref.current.width = res.width
            ref.current.height = res.height
            const ctx = ref.current.getContext('2d')
            if (!ctx) return
            const buf = new ArrayBuffer(res.data.length)
            const rgba = new Uint8ClampedArray(buf)
            rgba.set(res.data)
            const img = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, res.width, res.height)
            ctx.putImageData(img, 0, 0)
          })()
        }
      },
      { root: containerRef.current?.parentElement, rootMargin: '200px' }
    )
    if (containerRef.current) io.observe(containerRef.current)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [docId, sourceIndex, rotation])

  useEffect(() => {
    if (active && containerRef.current) {
      containerRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [active])

  const aspect = pageHeight / pageWidth
  const thumbHeight = THUMB_WIDTH * aspect

  return (
    <div
      ref={containerRef}
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <canvas ref={ref} style={{ width: THUMB_WIDTH, height: thumbHeight }} />
      <span className="thumb-label">{virtualIndex + 1}</span>
    </div>
  )
}

export function Thumbnails(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.sidebarOpen)
  const currentPage = useStore((s) => s.currentPage)
  const selection = useStore((s) => s.selection)
  const requestJump = useStore((s) => s.requestJump)
  const selectOnly = useStore((s) => s.selectOnly)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const selectRange = useStore((s) => s.selectRange)
  const setCurrentPage = useStore((s) => s.setCurrentPage)
  const anchorRef = useRef<number>(0)

  if (!doc || !open) return null

  return (
    <div className="thumbnails">
      {pages.map((vp, i) => {
        const size = rotatedSize(doc.pageSizes[vp.sourceIndex], vp.rotation)
        const onClick = (e: React.MouseEvent): void => {
          if (e.shiftKey) {
            selectRange(anchorRef.current, i)
          } else if (e.ctrlKey || e.metaKey) {
            toggleSelect(i)
            anchorRef.current = i
          } else {
            selectOnly(i)
            anchorRef.current = i
            setCurrentPage(i)
            requestJump(i)
          }
        }
        const onMouseDown = (e: React.MouseEvent): void => {
          // Prevent text selection on shift-click
          if (e.shiftKey) e.preventDefault()
        }
        return (
          <Thumb
            key={`${vp.sourceIndex}:${i}`}
            docId={doc.id}
            virtualIndex={i}
            sourceIndex={vp.sourceIndex}
            rotation={vp.rotation}
            pageWidth={size.width}
            pageHeight={size.height}
            active={i === currentPage}
            selected={selection.has(i)}
            onClick={onClick}
            onMouseDown={onMouseDown}
          />
        )
      })}
    </div>
  )
}
