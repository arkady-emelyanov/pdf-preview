import { useEffect, useRef, useState } from 'react'
import type { PageRect } from '../../shared/ipc'

interface Props {
  docId: string
  sourceIndex: number
  rotation: number
  scale: number
  expectedWidth: number
  expectedHeight: number
  visible: boolean
  highlights?: PageRect[]
}

export function PdfPage({
  docId,
  sourceIndex,
  rotation,
  scale,
  expectedWidth,
  expectedHeight,
  visible,
  highlights
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    ;(async () => {
      const res = await window.pdf.renderPage(docId, sourceIndex, scale, rotation)
      if (cancelled || !res || !canvasRef.current) return
      const canvas = canvasRef.current
      canvas.width = res.width
      canvas.height = res.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const buf = new ArrayBuffer(res.data.length)
      const rgba = new Uint8ClampedArray(buf)
      rgba.set(res.data)
      const img = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, res.width, res.height)
      ctx.putImageData(img, 0, 0)
      setRendered(true)
    })()
    return () => {
      cancelled = true
    }
  }, [docId, sourceIndex, rotation, scale, visible])

  useEffect(() => {
    setRendered(false)
  }, [scale, rotation])

  // Rotation note: highlights are PDF-page coords for the *unrotated* page.
  // When the page is rotated for display, the cleanest fix is to either
  // re-project rects through the rotation, or hide highlights on rotated
  // pages. For v1 we hide them on rotated pages to avoid misleading boxes.
  const showHighlights = rotation === 0 && highlights && highlights.length > 0

  return (
    <div className="pdf-page-slot" style={{ width: expectedWidth, height: expectedHeight }}>
      <canvas
        ref={canvasRef}
        className="pdf-page"
        style={{
          width: expectedWidth,
          height: expectedHeight,
          visibility: rendered ? 'visible' : 'hidden'
        }}
      />
      {!rendered && (
        <div className="pdf-page-placeholder">
          <span>{sourceIndex + 1}</span>
        </div>
      )}
      {showHighlights && (
        <div className="highlight-layer">
          {highlights!.map((r, i) => (
            <div
              key={i}
              className="highlight"
              style={{
                left: r.x * scale,
                top: r.y * scale,
                width: r.w * scale,
                height: r.h * scale
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
