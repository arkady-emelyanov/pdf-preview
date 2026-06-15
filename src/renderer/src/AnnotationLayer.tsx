import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  FREETEXT_LINE_HEIGHT,
  HANDLES,
  NOTE_SIZE_PT,
  arrowHeadSizePt,
  canvasToPoint,
  freeTextHeight,
  handleCenter,
  hitTest,
  isFreeText,
  isLine,
  isNote,
  makeBox,
  makeFreeText,
  makeLine,
  makeNote,
  pointToCanvas,
  rectToCanvas,
  resizeRect,
  type Annotation,
  type BoxAnnotationBase,
  type FreeTextAnnotation,
  type HandlePos,
  type LineAnnotation,
  type NoteAnnotation
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

type MoveState =
  | {
      kind: 'box'
      id: string
      startPtX: number
      startPtY: number
      origX: number
      origY: number
    }
  | {
      kind: 'line'
      id: string
      startPtX: number
      startPtY: number
      origX1: number
      origY1: number
      origX2: number
      origY2: number
    }

type ResizeState =
  | {
      kind: 'box'
      id: string
      pos: HandlePos
      startPtX: number
      startPtY: number
      origX: number
      origY: number
      origW: number
      origH: number
    }
  | {
      kind: 'line'
      id: string
      end: 'h1' | 'h2'
    }

function drawBox(
  ctx: CanvasRenderingContext2D,
  a: BoxAnnotationBase & { kind: 'rect' | 'oval'; fill?: string },
  pageHeightPt: number,
  scale: number
): void {
  const r = rectToCanvas(a, pageHeightPt, scale)
  ctx.globalAlpha = a.opacity
  ctx.lineWidth = a.strokeWidth
  ctx.strokeStyle = a.stroke
  if (a.kind === 'oval') {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    if (a.fill) {
      ctx.fillStyle = a.fill
      ctx.beginPath()
      ctx.ellipse(cx, cy, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.ellipse(cx, cy, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    if (a.fill) {
      ctx.fillStyle = a.fill
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    ctx.strokeRect(r.x, r.y, r.w, r.h)
  }
  ctx.globalAlpha = 1
}

function cssFontFamily(font: FreeTextAnnotation['font']): string {
  switch (font) {
    case 'Times':
      return '"Liberation Serif", "Tinos", "Times New Roman", Times, serif'
    case 'Courier':
      return '"Liberation Mono", "Cousine", "Courier New", Courier, monospace'
    default:
      return '"Liberation Sans", "Arimo", "Helvetica", Arial, sans-serif'
  }
}

function drawFreeText(
  ctx: CanvasRenderingContext2D,
  a: FreeTextAnnotation,
  pageHeightPt: number,
  scale: number
): void {
  const r = rectToCanvas(a, pageHeightPt, scale)
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.globalAlpha = a.opacity
  const sizePx = a.fontSize * scale
  ctx.font = `${sizePx}px ${cssFontFamily(a.font)}`
  ctx.fillStyle = a.color
  ctx.textBaseline = 'top'
  const lineHpx = sizePx * FREETEXT_LINE_HEIGHT
  const lines = a.body.length === 0 ? [''] : a.body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], r.x, r.y + i * lineHpx)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  a: NoteAnnotation,
  pageHeightPt: number,
  scale: number
): void {
  // Anchor is the icon's bottom-left in PDF coords; convert that corner.
  const tl = pointToCanvas(a.x, a.y + NOTE_SIZE_PT, pageHeightPt, scale)
  const size = NOTE_SIZE_PT * scale
  const fold = Math.max(4, size * 0.3)
  // Sticky-note background.
  ctx.fillStyle = a.color
  ctx.beginPath()
  ctx.moveTo(tl.cx, tl.cy)
  ctx.lineTo(tl.cx + size - fold, tl.cy)
  ctx.lineTo(tl.cx + size, tl.cy + fold)
  ctx.lineTo(tl.cx + size, tl.cy + size)
  ctx.lineTo(tl.cx, tl.cy + size)
  ctx.closePath()
  ctx.fill()
  // Folded corner shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
  ctx.beginPath()
  ctx.moveTo(tl.cx + size - fold, tl.cy)
  ctx.lineTo(tl.cx + size, tl.cy + fold)
  ctx.lineTo(tl.cx + size - fold, tl.cy + fold)
  ctx.closePath()
  ctx.fill()
  // Subtle outline so light-on-light pages still show the icon.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tl.cx, tl.cy)
  ctx.lineTo(tl.cx + size - fold, tl.cy)
  ctx.lineTo(tl.cx + size, tl.cy + fold)
  ctx.lineTo(tl.cx + size, tl.cy + size)
  ctx.lineTo(tl.cx, tl.cy + size)
  ctx.closePath()
  ctx.stroke()
  // Body-preview dots — three short lines.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  const pad = size * 0.18
  const innerW = size - pad * 2 - fold * 0.4
  for (let i = 0; i < 3; i++) {
    const y = tl.cy + size * 0.45 + i * size * 0.16
    ctx.beginPath()
    ctx.moveTo(tl.cx + pad, y)
    ctx.lineTo(tl.cx + pad + innerW, y)
    ctx.stroke()
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: LineAnnotation,
  pageHeightPt: number,
  scale: number
): void {
  const p1 = pointToCanvas(a.x1, a.y1, pageHeightPt, scale)
  const p2 = pointToCanvas(a.x2, a.y2, pageHeightPt, scale)
  ctx.globalAlpha = a.opacity
  ctx.strokeStyle = a.stroke
  ctx.lineWidth = a.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  drawSegmentWithHead(
    ctx,
    p1.cx,
    p1.cy,
    p2.cx,
    p2.cy,
    a.kind === 'arrow' ? arrowHeadSizePt(a.strokeWidth) * scale : 0
  )
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.globalAlpha = 1
}

/** Draw a line p1→p2 plus an open arrowhead at p2 when `headLen > 0`. */
function drawSegmentWithHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen: number
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  // Shorten the shaft so it ends just before the arrowhead, so the head's
  // open wedge isn't crossed by the shaft line.
  const shaftEndX = headLen > 0 ? x2 - (dx / len) * headLen * 0.6 : x2
  const shaftEndY = headLen > 0 ? y2 - (dy / len) * headLen * 0.6 : y2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(shaftEndX, shaftEndY)
  ctx.stroke()
  if (headLen <= 0) return
  const angle = Math.atan2(dy, dx)
  const a = Math.PI / 7 // ~25.7°
  const hx1 = x2 - headLen * Math.cos(angle - a)
  const hy1 = y2 - headLen * Math.sin(angle - a)
  const hx2 = x2 - headLen * Math.cos(angle + a)
  const hy2 = y2 - headLen * Math.sin(angle + a)
  ctx.beginPath()
  ctx.moveTo(hx1, hy1)
  ctx.lineTo(x2, y2)
  ctx.lineTo(hx2, hy2)
  ctx.stroke()
}

function lineEndpointHandles(
  a: LineAnnotation,
  pageHeightPt: number,
  scale: number
): { h1: { cx: number; cy: number }; h2: { cx: number; cy: number } } {
  return {
    h1: pointToCanvas(a.x1, a.y1, pageHeightPt, scale),
    h2: pointToCanvas(a.x2, a.y2, pageHeightPt, scale)
  }
}

function hitLineEndpoint(
  a: LineAnnotation,
  cx: number,
  cy: number,
  pageHeightPt: number,
  scale: number
): 'h1' | 'h2' | null {
  const { h1, h2 } = lineEndpointHandles(a, pageHeightPt, scale)
  if (Math.abs(cx - h1.cx) <= HANDLE_HIT_PX && Math.abs(cy - h1.cy) <= HANDLE_HIT_PX) return 'h1'
  if (Math.abs(cx - h2.cx) <= HANDLE_HIT_PX && Math.abs(cy - h2.cy) <= HANDLE_HIT_PX) return 'h2'
  return null
}

export function AnnotationLayer({
  virtualIndex,
  pageWidthPt,
  pageHeightPt,
  scale
}: Props): JSX.Element {
  const tool = useStore((s) => s.tool)
  const toolDefaults = useStore((s) => s.toolDefaults)
  const freeTextDefaults = useStore((s) => s.freeTextDefaults)
  const page = useStore((s) => s.pages[virtualIndex])
  const selected = useStore((s) => s.selectedAnnotation)
  const setSelected = useStore((s) => s.setSelectedAnnotation)
  const addAnnotation = useStore((s) => s.addAnnotation)
  const beginLiveEdit = useStore((s) => s.beginLiveEdit)
  const liveUpdateAnnotation = useStore((s) => s.liveUpdateAnnotation)

  const annotations = page?.annotations ?? []
  const clipboard = useStore((s) => s.clipboard)
  const copyAnnotation = useStore((s) => s.copyAnnotation)
  const cutAnnotation = useStore((s) => s.cutAnnotation)
  const pasteAnnotation = useStore((s) => s.pasteAnnotation)
  const deleteAnnotation = useStore((s) => s.deleteAnnotation)
  const ref = useRef<HTMLCanvasElement>(null)
  const [draw, setDraw] = useState<DrawState | null>(null)
  const [move, setMove] = useState<MoveState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)
  const [hoverHandle, setHoverHandle] = useState<HandlePos | 'h1' | 'h2' | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null
  )

  const drawingTool = tool === 'rect' || tool === 'oval' || tool === 'arrow'
  const noteTool = tool === 'note'
  const freeTextTool = tool === 'freetext'
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
      const isSelectedHere =
        !!selected && selected.page === virtualIndex && selected.id === a.id
      if (isLine(a)) drawArrow(ctx, a, pageHeightPt, scale)
      else if (isNote(a)) drawNote(ctx, a, pageHeightPt, scale)
      else if (isFreeText(a)) {
        // The textarea editor overlays the selected free-text. Drawing the
        // body here too would produce a doubled-text ghost as the user types
        // (canvas glyphs + DOM glyphs at slightly different rasterizations).
        if (!isSelectedHere) drawFreeText(ctx, a, pageHeightPt, scale)
      } else drawBox(ctx, a, pageHeightPt, scale)
      if (isSelectedHere) {
        drawSelectionChrome(ctx, a, pageHeightPt, scale)
      }
    }

    if (draw) {
      ctx.strokeStyle = toolDefaults.stroke
      ctx.lineWidth = toolDefaults.strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (tool === 'arrow') {
        drawSegmentWithHead(
          ctx,
          draw.startCx,
          draw.startCy,
          draw.curCx,
          draw.curCy,
          arrowHeadSizePt(toolDefaults.strokeWidth) * scale
        )
      } else {
        const x = Math.min(draw.startCx, draw.curCx)
        const y = Math.min(draw.startCy, draw.curCy)
        const w = Math.abs(draw.curCx - draw.startCx)
        const h = Math.abs(draw.curCy - draw.startCy)
        if (tool === 'oval') {
          ctx.beginPath()
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          ctx.strokeRect(x, y, w, h)
        }
      }
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'miter'
    }
  }, [
    annotations,
    draw,
    selected,
    virtualIndex,
    pageHeightPt,
    scale,
    cssW,
    cssH,
    tool,
    toolDefaults
  ])

  function drawSelectionChrome(
    ctx: CanvasRenderingContext2D,
    a: Annotation,
    pageH: number,
    sc: number
  ): void {
    if (isLine(a)) {
      const { h1, h2 } = lineEndpointHandles(a, pageH, sc)
      const half = HANDLE_SIZE_PX / 2
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#3aa0ff'
      ctx.lineWidth = 1
      for (const pt of [h1, h2]) {
        ctx.fillRect(pt.cx - half, pt.cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
        ctx.strokeRect(pt.cx - half, pt.cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
      }
      return
    }
    if (isNote(a)) {
      const tl = pointToCanvas(a.x, a.y + NOTE_SIZE_PT, pageH, sc)
      const sz = NOTE_SIZE_PT * sc
      ctx.strokeStyle = '#3aa0ff'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.strokeRect(tl.cx - 2, tl.cy - 2, sz + 4, sz + 4)
      ctx.setLineDash([])
      return
    }
    if (isFreeText(a)) {
      const r = rectToCanvas(a, pageH, sc)
      ctx.strokeStyle = '#3aa0ff'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
      ctx.setLineDash([])
      return
    }
    const r = rectToCanvas(a, pageH, sc)
    ctx.strokeStyle = '#3aa0ff'
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
    ctx.setLineDash([])
    const half = HANDLE_SIZE_PX / 2
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#3aa0ff'
    ctx.lineWidth = 1
    for (const pos of HANDLES) {
      const { cx, cy } = handleCenter(pos, a, pageH, sc)
      ctx.fillRect(cx - half, cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
      ctx.strokeRect(cx - half, cy - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX)
    }
  }

  const localCoords = (e: React.PointerEvent): { cx: number; cy: number } => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    // Don't let Electron's webContents handler pop up a native menu over ours.
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
    // Hit-test annotations top-most first.
    let hit: Annotation | null = null
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (hitTest(annotations[i], ptX, ptY)) {
        hit = annotations[i]
        break
      }
    }
    if (hit) {
      const hitId = hit.id
      setSelected({ page: virtualIndex, id: hitId })
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'Copy', onClick: () => copyAnnotation(virtualIndex, hitId) },
          { label: 'Cut', onClick: () => cutAnnotation(virtualIndex, hitId) },
          { label: 'Delete', onClick: () => deleteAnnotation(virtualIndex, hitId) }
        ]
      })
      return
    }
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Paste',
          enabled: !!clipboard,
          onClick: () => pasteAnnotation(virtualIndex, ptX, ptY)
        }
      ]
    })
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const { cx, cy } = localCoords(e)

    if (freeTextTool) {
      // Click drops an empty free-text whose bbox top-left sits at the cursor.
      // Don't capture the pointer — the editor overlay needs to receive focus
      // immediately, and a captured canvas would keep eating pointer events
      // until pointerup, dropping the focus we just gave the textarea.
      e.preventDefault()
      const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
      const h0 = freeTextHeight('', freeTextDefaults.fontSize)
      const ft = makeFreeText({
        x: ptX,
        y: ptY - h0,
        font: freeTextDefaults.font,
        fontSize: freeTextDefaults.fontSize,
        color: freeTextDefaults.color
      })
      addAnnotation(virtualIndex, ft)
      return
    }

    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)

    if (drawingTool) {
      setDraw({ startCx: cx, startCy: cy, curCx: cx, curCy: cy })
      return
    }

    if (noteTool) {
      // Click drops a note with its bottom-left at the cursor, then selects it
      // so the popover editor opens immediately.
      const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
      const note = makeNote({ x: ptX - NOTE_SIZE_PT / 2, y: ptY - NOTE_SIZE_PT / 2 })
      addAnnotation(virtualIndex, note)
      return
    }

    // Select tool. Endpoint / corner handles on the selected annotation win first.
    // Notes don't get handles — they're point-anchored, only drag-to-move.
    if (selected && selected.page === virtualIndex) {
      const sel = annotations.find((a) => a.id === selected.id)
      if (sel && !isNote(sel) && !isFreeText(sel)) {
        if (isLine(sel)) {
          const end = hitLineEndpoint(sel, cx, cy, pageHeightPt, scale)
          if (end) {
            beginLiveEdit()
            setResize({ kind: 'line', id: sel.id, end })
            return
          }
        } else {
          const hit = hitBoxHandle(sel, cx, cy, pageHeightPt, scale)
          if (hit) {
            const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
            beginLiveEdit()
            setResize({
              kind: 'box',
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
    }

    // Otherwise: pick top-most annotation under the cursor.
    const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
    let hit: Annotation | null = null
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i]
      if (hitTest(a, ptX, ptY)) {
        hit = a
        break
      }
    }
    if (hit) {
      const hitAnn: Annotation = hit
      setSelected({ page: virtualIndex, id: hitAnn.id })
      beginLiveEdit()
      if (isLine(hitAnn)) {
        setMove({
          kind: 'line',
          id: hitAnn.id,
          startPtX: ptX,
          startPtY: ptY,
          origX1: hitAnn.x1,
          origY1: hitAnn.y1,
          origX2: hitAnn.x2,
          origY2: hitAnn.y2
        })
      } else {
        setMove({
          kind: 'box',
          id: hitAnn.id,
          startPtX: ptX,
          startPtY: ptY,
          origX: hitAnn.x,
          origY: hitAnn.y
        })
      }
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
      if (move.kind === 'line') {
        liveUpdateAnnotation(virtualIndex, move.id, {
          x1: move.origX1 + dx,
          y1: move.origY1 + dy,
          x2: move.origX2 + dx,
          y2: move.origY2 + dy
        })
      } else {
        liveUpdateAnnotation(virtualIndex, move.id, {
          x: move.origX + dx,
          y: move.origY + dy
        })
      }
      return
    }
    if (resize) {
      if (resize.kind === 'line') {
        const { x: ptX, y: ptY } = canvasToPoint(cx, cy, pageHeightPt, scale)
        const patch =
          resize.end === 'h1' ? { x1: ptX, y1: ptY } : { x2: ptX, y2: ptY }
        liveUpdateAnnotation(virtualIndex, resize.id, patch)
      } else {
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
      }
      return
    }
    if (tool === 'select' && selected && selected.page === virtualIndex) {
      const sel = annotations.find((a) => a.id === selected.id)
      let h: HandlePos | 'h1' | 'h2' | null = null
      if (sel && !isNote(sel) && !isFreeText(sel)) {
        if (isLine(sel)) {
          h = hitLineEndpoint(sel, cx, cy, pageHeightPt, scale)
        } else {
          h = hitBoxHandle(sel, cx, cy, pageHeightPt, scale)
        }
      }
      if (h !== hoverHandle) setHoverHandle(h)
    } else if (hoverHandle) {
      setHoverHandle(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    if (draw) {
      const dCss = Math.hypot(draw.curCx - draw.startCx, draw.curCy - draw.startCy)
      const wasDraw = draw
      setDraw(null)
      if (dCss >= 4) {
        if (tool === 'arrow' || tool === 'line') {
          const p1 = canvasToPoint(wasDraw.startCx, wasDraw.startCy, pageHeightPt, scale)
          const p2 = canvasToPoint(wasDraw.curCx, wasDraw.curCy, pageHeightPt, scale)
          const shape = makeLine(tool, {
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            stroke: toolDefaults.stroke,
            strokeWidth: toolDefaults.strokeWidth,
            opacity: toolDefaults.opacity
          })
          addAnnotation(virtualIndex, shape)
        } else {
          const x0 = Math.min(wasDraw.startCx, wasDraw.curCx)
          const y0 = Math.min(wasDraw.startCy, wasDraw.curCy)
          const wCss = Math.abs(wasDraw.curCx - wasDraw.startCx)
          const hCss = Math.abs(wasDraw.curCy - wasDraw.startCy)
          if (wCss >= 4 && hCss >= 4) {
            const tl = canvasToPoint(x0, y0, pageHeightPt, scale)
            const br = canvasToPoint(x0 + wCss, y0 + hCss, pageHeightPt, scale)
            const x = Math.min(tl.x, br.x)
            const y = Math.min(tl.y, br.y)
            const w = Math.abs(br.x - tl.x)
            const h = Math.abs(br.y - tl.y)
            const kind = tool === 'oval' ? 'oval' : 'rect'
            const shape = makeBox(kind, { x, y, w, h, ...toolDefaults })
            addAnnotation(virtualIndex, shape)
          }
        }
      }
    }
    setMove(null)
    setResize(null)
  }

  function hitBoxHandle(
    a: BoxAnnotationBase,
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
    drawingTool || noteTool || freeTextTool
      ? 'crosshair'
      : hoverHandle === 'h1' || hoverHandle === 'h2'
        ? 'crosshair'
        : hoverHandle
          ? HANDLE_CURSORS[hoverHandle]
          : 'default'
  return (
    <>
      <canvas
        ref={ref}
        className="annotation-layer"
        style={{
          position: 'absolute',
          inset: 0,
          width: cssW,
          height: cssH,
          cursor,
          // Always capture pointer events so right-click reaches us (Paste menu
          // needs to work on empty pages too).
          pointerEvents: 'auto'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
      />
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
