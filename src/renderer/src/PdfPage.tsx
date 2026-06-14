import { useEffect, useRef, useState } from 'react'
import type { PageRect } from '../../shared/ipc'

interface Props {
  docId: string
  pageIndex: number
  scale: number
  expectedWidth: number
  expectedHeight: number
  visible: boolean
  highlights?: PageRect[]
}

export function PdfPage({
  docId,
  pageIndex,
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
      const res = await window.pdf.renderPage(docId, pageIndex, scale)
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
  }, [docId, pageIndex, scale, visible])

  useEffect(() => {
    setRendered(false)
  }, [scale])

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
          <span>{pageIndex + 1}</span>
        </div>
      )}
      {highlights && highlights.length > 0 && (
        <div className="highlight-layer">
          {highlights.map((r, i) => (
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
