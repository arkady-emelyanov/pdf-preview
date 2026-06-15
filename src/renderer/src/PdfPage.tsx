import { useEffect, useRef, useState } from 'react'
import type { PageRect } from '../../shared/ipc'
import { AnnotationLayer } from './AnnotationLayer'
import { NotePopover } from './NotePopover'
import { TextSelectionLayer } from './TextSelectionLayer'

interface Props {
  sourceId: string
  sourceIndex: number
  virtualIndex: number
  rotation: number
  scale: number
  /** Unrotated source page size in PDF points (for annotation coords). */
  pageWidthPt: number
  pageHeightPt: number
  expectedWidth: number
  expectedHeight: number
  visible: boolean
  highlights?: PageRect[]
}

export function PdfPage({
  sourceId,
  sourceIndex,
  virtualIndex,
  rotation,
  scale,
  pageWidthPt,
  pageHeightPt,
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
      const res = await window.pdf.renderPage(sourceId, sourceIndex, scale, rotation)
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
  }, [sourceId, sourceIndex, rotation, scale, visible])

  useEffect(() => {
    setRendered(false)
  }, [scale, rotation])

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
      {rotation === 0 && (
        <AnnotationLayer
          virtualIndex={virtualIndex}
          pageWidthPt={pageWidthPt}
          pageHeightPt={pageHeightPt}
          scale={scale}
        />
      )}
      {rotation === 0 && (
        <TextSelectionLayer
          virtualIndex={virtualIndex}
          pageWidthPt={pageWidthPt}
          pageHeightPt={pageHeightPt}
          scale={scale}
        />
      )}
      {rotation === 0 && (
        <NotePopover
          virtualIndex={virtualIndex}
          pageHeightPt={pageHeightPt}
          scale={scale}
        />
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
