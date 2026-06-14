import { useEffect, useRef } from 'react'
import { useStore } from './store'

const THUMB_WIDTH = 120

function Thumb({
  docId,
  pageIndex,
  active,
  onClick
}: {
  docId: string
  pageIndex: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          io.disconnect()
          ;(async () => {
            const res = await window.pdf.renderPage(docId, pageIndex, 0.25)
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
  }, [docId, pageIndex])

  // Scroll active thumb into view
  useEffect(() => {
    if (active && containerRef.current) {
      containerRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [active])

  return (
    <div
      ref={containerRef}
      className={`thumb ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <canvas ref={ref} style={{ width: THUMB_WIDTH }} />
      <span className="thumb-label">{pageIndex + 1}</span>
    </div>
  )
}

export function Thumbnails(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const open = useStore((s) => s.sidebarOpen)
  const currentPage = useStore((s) => s.currentPage)
  const requestJump = useStore((s) => s.requestJump)

  if (!doc || !open) return null

  return (
    <div className="thumbnails">
      {doc.pageSizes.map((_, i) => (
        <Thumb
          key={i}
          docId={doc.id}
          pageIndex={i}
          active={i === currentPage}
          onClick={() => requestJump(i)}
        />
      ))}
    </div>
  )
}
