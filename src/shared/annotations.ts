/**
 * v1 annotation schema. Geometry is stored in PDF page coordinates
 * (origin bottom-left, units = PDF points), so a saved annotation re-opens at
 * the same position regardless of zoom or display scale.
 *
 * Bbox shapes (`rect`, `oval`) share `BoxAnnotationBase`. Two-endpoint shapes
 * (`arrow`, `line`) share `LineAnnotation`. Sticky notes and text boxes will
 * add their own envelopes later but follow the same id/style/timestamp pattern.
 */

export type AnnotationKind = 'rect' | 'oval' | 'arrow' | 'line' | 'note'

/** Visual size of a sticky-note icon, in PDF points. Hit-test and save Rect
 *  also use this so the icon size in the saved PDF matches what we drew. */
export const NOTE_SIZE_PT = 18

/** Shared shape for any bbox-style annotation (rect, oval). */
export interface BoxAnnotationBase {
  id: string
  /** Bottom-left corner in PDF page points. */
  x: number
  y: number
  /** Width / height in PDF page points. Always positive. */
  w: number
  h: number
  stroke: string
  strokeWidth: number
  fill?: string
  /** 0..1 */
  opacity: number
  author?: string
  /** Epoch ms. */
  created: number
  modified: number
}

export interface RectAnnotation extends BoxAnnotationBase {
  kind: 'rect'
}

export interface OvalAnnotation extends BoxAnnotationBase {
  kind: 'oval'
}

/**
 * Two-endpoint annotation: a line segment between (x1,y1) and (x2,y2). When
 * `kind === 'arrow'`, an open arrowhead is drawn at (x2, y2). For `kind === 'line'`,
 * neither end gets a head. Both endpoints are in PDF page points.
 */
export interface LineAnnotation {
  id: string
  kind: 'arrow' | 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
  opacity: number
  author?: string
  created: number
  modified: number
}

/**
 * Sticky note. Anchored to a single point (bottom-left of a NOTE_SIZE_PT icon),
 * carries a body string for the editable note text. No bbox style — sticky
 * notes use a simple background color (the icon fill).
 */
export interface NoteAnnotation {
  id: string
  kind: 'note'
  /** Bottom-left of the icon, in PDF page points. */
  x: number
  y: number
  body: string
  /** Icon fill color (CSS hex). */
  color: string
  author?: string
  created: number
  modified: number
}

export type Annotation = RectAnnotation | OvalAnnotation | LineAnnotation | NoteAnnotation

export interface BoxStyle {
  stroke: string
  strokeWidth: number
  fill?: string
  opacity: number
}

export const defaultBoxStyle: BoxStyle = {
  stroke: '#d33',
  strokeWidth: 2,
  opacity: 1
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeBox(
  kind: 'rect' | 'oval',
  init: { x: number; y: number; w: number; h: number } & Partial<BoxStyle> & { author?: string }
): Annotation {
  const now = Date.now()
  return {
    id: newId(),
    kind,
    x: init.x,
    y: init.y,
    w: Math.max(0, init.w),
    h: Math.max(0, init.h),
    stroke: init.stroke ?? defaultBoxStyle.stroke,
    strokeWidth: init.strokeWidth ?? defaultBoxStyle.strokeWidth,
    fill: init.fill,
    opacity: init.opacity ?? defaultBoxStyle.opacity,
    author: init.author,
    created: now,
    modified: now
  } as Annotation
}

/** Back-compat alias used by older tests and call sites. */
export function makeRect(
  init: { x: number; y: number; w: number; h: number } & Partial<BoxStyle> & { author?: string }
): RectAnnotation {
  return makeBox('rect', init) as RectAnnotation
}

export function makeNote(
  init: { x: number; y: number } & Partial<Pick<NoteAnnotation, 'body' | 'color' | 'author'>>
): NoteAnnotation {
  const now = Date.now()
  return {
    id: newId(),
    kind: 'note',
    x: init.x,
    y: init.y,
    body: init.body ?? '',
    color: init.color ?? '#ffe066',
    author: init.author,
    created: now,
    modified: now
  }
}

export function makeLine(
  kind: 'arrow' | 'line',
  init: { x1: number; y1: number; x2: number; y2: number } & Partial<
    Pick<BoxStyle, 'stroke' | 'strokeWidth' | 'opacity'>
  > & { author?: string }
): LineAnnotation {
  const now = Date.now()
  return {
    id: newId(),
    kind,
    x1: init.x1,
    y1: init.y1,
    x2: init.x2,
    y2: init.y2,
    stroke: init.stroke ?? defaultBoxStyle.stroke,
    strokeWidth: init.strokeWidth ?? defaultBoxStyle.strokeWidth,
    opacity: init.opacity ?? defaultBoxStyle.opacity,
    author: init.author,
    created: now,
    modified: now
  }
}

/** Tight bbox containing the segment + an arrowhead-sized margin. Used for
 *  the selection marquee and for the saved PDF `/Rect`. */
export function lineBBox(
  a: LineAnnotation
): { x: number; y: number; w: number; h: number } {
  const headSize = a.kind === 'arrow' ? arrowHeadSizePt(a.strokeWidth) : 0
  const pad = Math.max(a.strokeWidth, headSize)
  const x = Math.min(a.x1, a.x2) - pad
  const y = Math.min(a.y1, a.y2) - pad
  const w = Math.abs(a.x2 - a.x1) + pad * 2
  const h = Math.abs(a.y2 - a.y1) + pad * 2
  return { x, y, w, h }
}

/** Length of the arrowhead along the segment direction, in PDF points. */
export function arrowHeadSizePt(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 4)
}

/** Distance from point (px,py) to segment (x1,y1)-(x2,y2) in the same units. */
export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

export function hitTestLine(
  a: LineAnnotation,
  ptX: number,
  ptY: number,
  tolerancePt = 6
): boolean {
  return (
    distanceToSegment(ptX, ptY, a.x1, a.y1, a.x2, a.y2) <=
    Math.max(tolerancePt, a.strokeWidth)
  )
}

export function addAnnotation(list: Annotation[] | undefined, a: Annotation): Annotation[] {
  return [...(list ?? []), a]
}

export function updateAnnotation(
  list: Annotation[] | undefined,
  id: string,
  patch: Partial<Annotation>
): Annotation[] {
  if (!list) return []
  return list.map((a) =>
    a.id === id ? ({ ...a, ...patch, modified: Date.now() } as Annotation) : a
  )
}

export function deleteAnnotation(list: Annotation[] | undefined, id: string): Annotation[] {
  if (!list) return []
  return list.filter((a) => a.id !== id)
}

export function isLine(a: Annotation): a is LineAnnotation {
  return a.kind === 'arrow' || a.kind === 'line'
}

export function isNote(a: Annotation): a is NoteAnnotation {
  return a.kind === 'note'
}

/** Hit-test a note via its icon's PDF-point bbox at (x, y, NOTE_SIZE, NOTE_SIZE). */
export function hitTestNote(
  a: NoteAnnotation,
  ptX: number,
  ptY: number,
  tolerancePt = 4
): boolean {
  const t = tolerancePt
  return (
    ptX >= a.x - t &&
    ptX <= a.x + NOTE_SIZE_PT + t &&
    ptY >= a.y - t &&
    ptY <= a.y + NOTE_SIZE_PT + t
  )
}

export function annotationsEqual(
  a: Annotation[] | undefined,
  b: Annotation[] | undefined
): boolean {
  const la = a ?? []
  const lb = b ?? []
  if (la.length !== lb.length) return false
  for (let i = 0; i < la.length; i++) {
    const x = la[i]
    const y = lb[i]
    if (x.id !== y.id) return false
    if (x.kind !== y.kind) return false
    if (isLine(x) && isLine(y)) {
      if (x.stroke !== y.stroke || x.strokeWidth !== y.strokeWidth) return false
      if (x.opacity !== y.opacity) return false
      if (x.x1 !== y.x1 || x.y1 !== y.y1 || x.x2 !== y.x2 || x.y2 !== y.y2) return false
    } else if (isNote(x) && isNote(y)) {
      if (x.x !== y.x || x.y !== y.y) return false
      if (x.body !== y.body) return false
      if (x.color !== y.color) return false
    } else if (!isLine(x) && !isLine(y) && !isNote(x) && !isNote(y)) {
      if (x.stroke !== y.stroke || x.strokeWidth !== y.strokeWidth) return false
      if (x.opacity !== y.opacity) return false
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false
      if (x.fill !== y.fill) return false
    }
  }
  return true
}

/**
 * Coordinate conversion. Canvas overlay has origin top-left, scaled by
 * `scale`. PDF page has origin bottom-left, in points.
 */
export function pointToCanvas(
  x: number,
  y: number,
  pageHeightPt: number,
  scale: number
): { cx: number; cy: number } {
  return { cx: x * scale, cy: (pageHeightPt - y) * scale }
}

export function canvasToPoint(
  cx: number,
  cy: number,
  pageHeightPt: number,
  scale: number
): { x: number; y: number } {
  return { x: cx / scale, y: pageHeightPt - cy / scale }
}

/** Top-left rect in canvas px, ready to draw on the overlay. */
export function rectToCanvas(
  a: BoxAnnotationBase,
  pageHeightPt: number,
  scale: number
): { x: number; y: number; w: number; h: number } {
  const top = pageHeightPt - (a.y + a.h)
  return { x: a.x * scale, y: top * scale, w: a.w * scale, h: a.h * scale }
}

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * Recompute a rect after dragging one handle by (dx, dy) in PDF page points.
 * If the user drags a side past the opposite side, the rect flips cleanly.
 */
export function resizeRect(
  orig: { x: number; y: number; w: number; h: number },
  pos: HandlePos,
  dx: number,
  dy: number
): { x: number; y: number; w: number; h: number } {
  let x1 = orig.x
  let y1 = orig.y
  let x2 = orig.x + orig.w
  let y2 = orig.y + orig.h
  if (pos.includes('w')) x1 += dx
  if (pos.includes('e')) x2 += dx
  if (pos.includes('n')) y2 += dy
  if (pos.includes('s')) y1 += dy
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1)
  }
}

/** Canvas-space center of a handle for a given rect annotation. */
export function handleCenter(
  pos: HandlePos,
  a: { x: number; y: number; w: number; h: number },
  pageHeightPt: number,
  scale: number
): { cx: number; cy: number } {
  const left = a.x * scale
  const right = (a.x + a.w) * scale
  const top = (pageHeightPt - (a.y + a.h)) * scale
  const bot = (pageHeightPt - a.y) * scale
  const mx = (left + right) / 2
  const my = (top + bot) / 2
  switch (pos) {
    case 'nw':
      return { cx: left, cy: top }
    case 'n':
      return { cx: mx, cy: top }
    case 'ne':
      return { cx: right, cy: top }
    case 'e':
      return { cx: right, cy: my }
    case 'se':
      return { cx: right, cy: bot }
    case 's':
      return { cx: mx, cy: bot }
    case 'sw':
      return { cx: left, cy: bot }
    case 'w':
      return { cx: left, cy: my }
  }
}

export function hitTestRect(
  a: BoxAnnotationBase,
  ptX: number,
  ptY: number,
  tolerancePt = 4
): boolean {
  const t = tolerancePt
  return (
    ptX >= a.x - t &&
    ptX <= a.x + a.w + t &&
    ptY >= a.y - t &&
    ptY <= a.y + a.h + t
  )
}

export function hitTestOval(
  a: BoxAnnotationBase,
  ptX: number,
  ptY: number,
  tolerancePt = 4
): boolean {
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  const rx = a.w / 2 + tolerancePt
  const ry = a.h / 2 + tolerancePt
  if (rx <= 0 || ry <= 0) return false
  const dx = (ptX - cx) / rx
  const dy = (ptY - cy) / ry
  return dx * dx + dy * dy <= 1
}

export function hitTest(a: Annotation, ptX: number, ptY: number, tolerancePt = 4): boolean {
  if (isLine(a)) return hitTestLine(a, ptX, ptY, tolerancePt + 2)
  if (isNote(a)) return hitTestNote(a, ptX, ptY, tolerancePt)
  if (a.kind === 'oval') return hitTestOval(a, ptX, ptY, tolerancePt)
  return hitTestRect(a, ptX, ptY, tolerancePt)
}

/** Parse '#rrggbb' (or '#rgb') into [r,g,b] in 0..1. Returns null on failure. */
export function parseHexColor(hex: string): [number, number, number] | null {
  let s = hex.trim().toLowerCase()
  if (!s.startsWith('#')) return null
  s = s.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (s.length !== 6) return null
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return [r / 255, g / 255, b / 255]
}
