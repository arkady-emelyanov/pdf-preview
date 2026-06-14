import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { rotatedSize } from '../../shared/edit'

const THUMB_WIDTH = 120

function Thumb({
  sourceId,
  virtualIndex,
  sourceIndex,
  rotation,
  pageWidth,
  pageHeight,
  active,
  selected,
  fromSecondary,
  dropIndicator,
  onClick,
  onMouseDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: {
  sourceId: string
  virtualIndex: number
  sourceIndex: number
  rotation: number
  pageWidth: number
  pageHeight: number
  active: boolean
  selected: boolean
  fromSecondary: boolean
  dropIndicator: 'above' | 'below' | null
  onClick: (e: React.MouseEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
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
            const res = await window.pdf.renderPage(sourceId, sourceIndex, 0.25, rotation)
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
  }, [sourceId, sourceIndex, rotation])

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
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}${
        fromSecondary ? ' inserted' : ''
      }${dropIndicator ? ` drop-${dropIndicator}` : ''}`}
      draggable
      onClick={onClick}
      onMouseDown={onMouseDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <canvas ref={ref} style={{ width: THUMB_WIDTH, height: thumbHeight }} />
      <span className="thumb-label">{virtualIndex + 1}</span>
    </div>
  )
}

interface DragState {
  draggingIndices: number[]
  hover: { index: number; side: 'above' | 'below' } | null
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
  const movePages = useStore((s) => s.movePages)
  const sourceSize = useStore((s) => s.sourceSize)
  const anchorRef = useRef<number>(0)
  const [drag, setDrag] = useState<DragState | null>(null)

  if (!doc || !open) return null

  return (
    <div className="thumbnails">
      {pages.map((vp, i) => {
        const size = rotatedSize(sourceSize(vp.sourceId, vp.sourceIndex), vp.rotation)
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
          if (e.shiftKey) e.preventDefault()
        }
        const onDragStart = (e: React.DragEvent): void => {
          const inSel = selection.has(i)
          const indices = inSel ? [...selection].sort((a, b) => a - b) : [i]
          if (!inSel) selectOnly(i)
          setDrag({ draggingIndices: indices, hover: null })
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(i))
        }
        const onDragOver = (e: React.DragEvent): void => {
          if (!drag) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const side = e.clientY - rect.top < rect.height / 2 ? 'above' : 'below'
          setDrag((d) => (d ? { ...d, hover: { index: i, side } } : d))
        }
        const onDragLeave = (_e: React.DragEvent): void => {
          // intentionally left blank; replaced by next thumb's dragover
        }
        const onDrop = (e: React.DragEvent): void => {
          e.preventDefault()
          if (!drag) return
          const side = drag.hover?.side ?? 'above'
          const target = side === 'above' ? i : i + 1
          movePages(drag.draggingIndices, target)
          setDrag(null)
        }
        const onDragEnd = (_e: React.DragEvent): void => {
          setDrag(null)
        }
        const isHovered = drag?.hover?.index === i
        return (
          <Thumb
            key={`${vp.sourceId}:${vp.sourceIndex}:${i}`}
            sourceId={vp.sourceId}
            virtualIndex={i}
            sourceIndex={vp.sourceIndex}
            rotation={vp.rotation}
            pageWidth={size.width}
            pageHeight={size.height}
            active={i === currentPage}
            selected={selection.has(i)}
            fromSecondary={vp.sourceId !== doc.primary.sourceId}
            dropIndicator={isHovered ? (drag!.hover!.side as 'above' | 'below') : null}
            onClick={onClick}
            onMouseDown={onMouseDown}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        )
      })}
    </div>
  )
}
