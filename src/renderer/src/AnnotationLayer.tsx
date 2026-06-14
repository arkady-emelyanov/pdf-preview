import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import {
  HANDLES,
  canvasToPoint,
  handleCenter,
  hitTestRect,
  makeRect,
  rectToCanvas,
  resizeRect,
  type HandlePos,
  type RectAnnotation
} from '../../shared/annotations'

const HANDLE_SIZE_PX = 8
const HANDLE_HIT_PX = 10

const HANDLE_CURSORS: Record<HandlePos, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize'
}

interface Props {
  virtualIndex: number
  pageWidthPt: number
  pageHeightPt: number
  scale: number
}

interface DrawState {
  startCx: number
  startCy: number
  curCx: number
  curCy: number
}

interface MoveState {
  id: string
  startPtX: number
  startPtY: number
  origX: number
  origY: number
}

interface ResizeState {
  id: string
  pos: HandlePos
  startPtX: number
  startPtY: number
  origX: number
  origY: number
  origW: number
  origH: number
}

export function AnnotationLayer({
  virtualIndex,
  pageWidthPt,
  pageHeightPt,
  scale
}: Props): JSX.Element {
  const tool = useStore((s) => s.tool)
  const page = useStore((s) => s.pages[virtualIndex])
  const selected = useStore((s) => s.selectedAnnotation)
  const setSelected = useStore((s) => s.setSelectedAnnotation)
  const addAnnotation = useStore((s) => s.addAnnotation)
  const beginLiveEdit = useStore((s) => s.beginLiveEdit)
  const liveUpdateAnnotation = useStore((s) => s.liveUpdateAnnotation)

  const annotations = page?.annotations ?? []
  const ref = useRef<HTMLCanvasElement>(null)
  const [draw, setDraw] = useState<DrawState | null>(null)
  const [move, setMove] = useState<MoveState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)
  const [hoverHandle, setHoverHandle] = useState<HandlePos | null>(null)

  const cssW = pageWidthPt * scale
  const cssH = pageHeightPt * scale

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(cssW * dpr)
    c.height = Math.round(cssH * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    for (const a of annotations) {
      if (a.kind !== 'rect') continue
      const r = rectToCanvas(a, pageHeightPt, scale)
      ctx.globalAlpha = a.opacity
      if (a.fill) {
        ctx.fillStyle = a.fill
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
      ctx.strokeStyle = a.stroke
      ctx.lineWidth = a.strokeWidth
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.globalAlpha = 1
      if (selected && selected.page === virtualIndex && selected.id === a.id) {
        ctx.strokeStyle = '#3aa0ff'
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1
        ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
        ctx.setLineDash([])
        // Handles
        const half = HANDLE_SIZE_PX / 2
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#3aa0ff'
        ctx.lineWidth = 1
        for (const pos of HANDLES) {
          const { cx, cy } = handleCenter(pos, a, pageHeightPt, scale)
          ctx.fillRect(cx - half, cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
          ctx.strokeRect(cx - half, cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
        }
      }
    }

    if (draw) {
      const x = Math.min(draw.startCx, draw.curCx)
      const y = Math.min(draw.startCy, draw.curCy)
      const w = Math.abs(draw.curCx - draw.startCx)
      const h = Math.abs(draw.curCy - draw.startCy)
      ctx.strokeStyle = '#d33'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)
    }
  }, [annotations, draw, selected, virtualIndex, pageHeightPt, scale, cssW, cssH])

  const localCoords = (e: React.PointerEvent): { cx: number; cy: number } => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const { cx, cy } = localCoords(e)
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)

    if (tool === 'rect') {
      setDraw({ startCx: cx, startCy: cy, curCx: cx, curCy: cy })
      return
    }

    // Select tool. Handles on the currently-selected annotation get first dibs.
    if (selected && selected.page === virtualIndex) {
      const sel = annotations.find((a) => a.id === selected.id) as
        | RectAnnotation
        | undefined
      if (sel && sel.kind === 'rect') {
        const hit = hitHandle(sel, cx, cy, pageHeightPt, scale)
        if (hit) {
          const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
          beginLiveEdit()
          setResize({
            id: sel.id,
            pos: hit,
            startPtX: ptX,
            startPtY: ptY,
            origX: sel.x,
            origY: sel.y,
            origW: sel.w,
            origH: sel.h
          })
          return
        }
      }
    }

    // Otherwise: pick top-most annotation under the cursor.
    const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
    let hit: RectAnnotation | null = null
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i]
      if (a.kind === 'rect' && hitTestRect(a, ptX, ptY)) {
        hit = a
        break
      }
    }
    if (hit) {
      setSelected({ page: virtualIndex, id: hit.id })
      beginLiveEdit()
      setMove({
        id: hit.id,
        startPtX: ptX,
        startPtY: ptY,
        origX: hit.x,
        origY: hit.y
      })
    } else {
      setSelected(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const { cx, cy } = localCoords(e)
    if (draw) {
      setDraw({ ...draw, curCx: cx, curCy: cy })
      return
    }
    if (move) {
      const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
      const dx = ptX - move.startPtX
      const dy = ptY - move.startPtY
      liveUpdateAnnotation(virtualIndex, move.id, {
        x: move.origX + dx,
        y: move.origY + dy
      })
      return
    }
    if (resize) {
      const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
      const dx = ptX - resize.startPtX
      const dy = ptY - resize.startPtY
      const r = resizeRect(
        { x: resize.origX, y: resize.origY, w: resize.origW, h: resize.origH },
        resize.pos,
        dx,
        dy
      )
      liveUpdateAnnotation(virtualIndex, resize.id, r)
      return
    }
    // Hover: update cursor when over a handle of the selected annotation.
    if (tool === 'select' && selected && selected.page === virtualIndex) {
      const sel = annotations.find((a) => a.id === selected.id) as
        | RectAnnotation
        | undefined
      const h = sel && sel.kind === 'rect' ? hitHandle(sel, cx, cy, pageHeightPt, scale) : null
      if (h !== hoverHandle) setHoverHandle(h)
    } else if (hoverHandle) {
      setHoverHandle(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    if (draw) {
      const x0 = Math.min(draw.startCx, draw.curCx)
      const y0 = Math.min(draw.startCy, draw.curCy)
      const wCss = Math.abs(draw.curCx - draw.startCx)
      const hCss = Math.abs(draw.curCy - draw.startCy)
      setDraw(null)
      // Discard near-zero drags.
      if (wCss >= 4 && hCss >= 4) {
        const tl = canvasToPoint(x0, y0, pageHeightPt, scale)
        const br = canvasToPoint(x0 + wCss, y0 + hCss, pageHeightPt, scale)
        const x = Math.min(tl.x, br.x)
        const y = Math.min(tl.y, br.y)
        const w = Math.abs(br.x - tl.x)
        const h = Math.abs(br.y - tl.y)
        const rect = makeRect({ x, y, w, h })
        addAnnotation(virtualIndex, rect)
      }
    }
    setMove(null)
    setResize(null)
  }

  function hitHandle(
    a: RectAnnotation,
    cx: number,
    cy: number,
    pageH: number,
    sc: number
  ): HandlePos | null {
    for (const pos of HANDLES) {
      const { cx: hx, cy: hy } = handleCenter(pos, a, pageH, sc)
      if (Math.abs(cx - hx) <= HANDLE_HIT_PX && Math.abs(cy - hy) <= HANDLE_HIT_PX) {
        return pos
      }
    }
    return null
  }

  const cursor =
    tool === 'rect' ? 'crosshair' : hoverHandle ? HANDLE_CURSORS[hoverHandle] : 'default'
  return (
    <canvas
      ref={ref}
      className="annotation-layer"
      style={{
        position: 'absolute',
        inset: 0,
        width: cssW,
        height: cssH,
        cursor,
        // Only swallow pointer events when the layer can do something useful.
        pointerEvents: tool === 'rect' || annotations.length > 0 ? 'auto' : 'none'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
