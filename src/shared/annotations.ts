/**
 * v1 annotation schema. Geometry is stored in PDF page coordinates
 * (origin bottom-left, units = PDF points), so a saved annotation re-opens at
 * the same position regardless of zoom or display scale.
 *
 * Bbox shapes (`rect`, `oval`) share `BoxAnnotationBase`. Two-endpoint shapes
 * (`arrow`, `line`) share `LineAnnotation`. Sticky notes and text boxes will
 * add their own envelopes later but follow the same id/style/timestamp pattern.
 */

export type AnnotationKind = 'rect' | 'oval' | 'arrow' | 'line' | 'note' | 'freetext'

/** PDF standard families we expose in the free-text font picker. Each maps
 *  to a font tag in the /DA string we write (and parse back) on save / load. */
export type FreeTextFont = 'Helvetica' | 'Times' | 'Courier'
export const FREETEXT_FONTS: FreeTextFont[] = ['Helvetica', 'Times', 'Courier']
export const FREETEXT_DEFAULT_FONT: FreeTextFont = 'Helvetica'
export const FREETEXT_DEFAULT_SIZE = 14
export const FREETEXT_DEFAULT_COLOR = '#1a1a1a'
export const FREETEXT_DEFAULT_W = 200
export const FREETEXT_LINE_HEIGHT = 1.35
/** Minimum bbox height so an empty free-text still gets a hit-target. */
export const FREETEXT_MIN_H = 18

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
  /**
   * CCW rotation in radians around the bbox center, in PDF coords (Y-up).
   * Omitted / 0 means axis-aligned. (x, y, w, h) describe the un-rotated bbox
   * so geometry doesn't have to change every frame of a rotate drag.
   */
  rotation?: number
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

/**
 * Free-text annotation: a free-floating text label. Bottom-left of the bbox
 * is (x, y) in PDF page points; the bbox `(w, h)` is what we draw on the
 * overlay and bake into the saved /Rect. The body string can hold multiple
 * lines (`\n` separated).
 */
export interface FreeTextAnnotation {
  id: string
  kind: 'freetext'
  x: number
  y: number
  w: number
  h: number
  body: string
  font: FreeTextFont
  fontSize: number
  /** CSS hex (`#rrggbb`). */
  color: string
  opacity: number
  /** Same convention as `BoxAnnotationBase.rotation`. */
  rotation?: number
  author?: string
  created: number
  modified: number
}

export type Annotation =
  | RectAnnotation
  | OvalAnnotation
  | LineAnnotation
  | NoteAnnotation
  | FreeTextAnnotation

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

/**
 * Identifies annotations we own when reading back a previously-saved PDF.
 * Foreign annotations (made by Acrobat, etc.) lack this prefix and are left
 * alone on both load and save.
 */
export const OWN_NM_PREFIX = 'p4l-'

export function newId(): string {
  return (
    OWN_NM_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  )
}

export function makeBox(
  kind: 'rect' | 'oval',
  init: { x: number; y: number; w: number; h: number; rotation?: number } & Partial<BoxStyle> & {
    author?: string
  }
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
    rotation: init.rotation,
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

export function freeTextHeight(body: string, fontSize: number): number {
  const lines = Math.max(1, body.split('\n').length)
  return Math.max(FREETEXT_MIN_H, lines * fontSize * FREETEXT_LINE_HEIGHT)
}

export function makeFreeText(init: {
  x: number
  y: number
  w?: number
  h?: number
  body?: string
  font?: FreeTextFont
  fontSize?: number
  color?: string
  opacity?: number
  rotation?: number
  author?: string
}): FreeTextAnnotation {
  const now = Date.now()
  const font = init.font ?? FREETEXT_DEFAULT_FONT
  const fontSize = init.fontSize ?? FREETEXT_DEFAULT_SIZE
  const body = init.body ?? ''
  const w = init.w ?? FREETEXT_DEFAULT_W
  const h = init.h ?? freeTextHeight(body, fontSize)
  return {
    id: newId(),
    kind: 'freetext',
    x: init.x,
    y: init.y,
    w,
    h,
    body,
    font,
    fontSize,
    color: init.color ?? FREETEXT_DEFAULT_COLOR,
    opacity: init.opacity ?? 1,
    rotation: init.rotation,
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

export function isFreeText(a: Annotation): a is FreeTextAnnotation {
  return a.kind === 'freetext'
}

export function hitTestFreeText(
  a: FreeTextAnnotation,
  ptX: number,
  ptY: number,
  tolerancePt = 4
): boolean {
  const { x: lx, y: ly } = toLocalFrame(a, ptX, ptY)
  const t = tolerancePt
  return (
    lx >= a.x - t &&
    lx <= a.x + a.w + t &&
    ly >= a.y - t &&
    ly <= a.y + a.h + t
  )
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
    } else if (isFreeText(x) && isFreeText(y)) {
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false
      if (x.body !== y.body) return false
      if (x.font !== y.font) return false
      if (x.fontSize !== y.fontSize) return false
      if (x.color !== y.color) return false
      if (x.opacity !== y.opacity) return false
      if ((x.rotation ?? 0) !== (y.rotation ?? 0)) return false
    } else if (
      !isLine(x) && !isLine(y) && !isNote(x) && !isNote(y) && !isFreeText(x) && !isFreeText(y)
    ) {
      if (x.stroke !== y.stroke || x.strokeWidth !== y.strokeWidth) return false
      if (x.opacity !== y.opacity) return false
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false
      if (x.fill !== y.fill) return false
      if ((x.rotation ?? 0) !== (y.rotation ?? 0)) return false
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
  a: { x: number; y: number; w: number; h: number },
  pageHeightPt: number,
  scale: number
): { x: number; y: number; w: number; h: number } {
  const top = pageHeightPt - (a.y + a.h)
  return { x: a.x * scale, y: top * scale, w: a.w * scale, h: a.h * scale }
}

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Distance above the bbox top edge where the rotate handle sits, in PDF
 *  points. Far enough that it doesn't overlap the `n` handle. */
export const ROTATE_HANDLE_OFFSET_PT = 18

export interface RotatableBox {
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

/** Rotate (px, py) around (cx, cy) by `angle` radians (CCW). */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angle: number
): { x: number; y: number } {
  if (angle === 0) return { x: px, y: py }
  const dx = px - cx
  const dy = py - cy
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }
}

/**
 * Transform a PDF-point (ptX, ptY) into the annotation's local (un-rotated)
 * frame so existing axis-aligned hit-tests still work.
 */
export function toLocalFrame(
  a: RotatableBox,
  ptX: number,
  ptY: number
): { x: number; y: number } {
  const rot = a.rotation ?? 0
  if (rot === 0) return { x: ptX, y: ptY }
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  const p = rotatePoint(ptX, ptY, cx, cy, -rot)
  return p
}

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

/** Handle center in PDF coords for a (possibly rotated) bbox. */
export function handleCenterPt(
  pos: HandlePos,
  a: RotatableBox
): { x: number; y: number } {
  // Un-rotated handle positions in PDF coords first.
  const left = a.x
  const right = a.x + a.w
  const bot = a.y
  const top = a.y + a.h
  const mx = (left + right) / 2
  const my = (bot + top) / 2
  let px: number, py: number
  switch (pos) {
    case 'nw': px = left;  py = top;  break
    case 'n':  px = mx;    py = top;  break
    case 'ne': px = right; py = top;  break
    case 'e':  px = right; py = my;   break
    case 'se': px = right; py = bot;  break
    case 's':  px = mx;    py = bot;  break
    case 'sw': px = left;  py = bot;  break
    case 'w':  px = left;  py = my;   break
  }
  if (a.rotation) {
    const c = rotatePoint(px, py, mx, my, a.rotation)
    return { x: c.x, y: c.y }
  }
  return { x: px, y: py }
}

/** Canvas-space center of a handle for a given rect annotation. */
export function handleCenter(
  pos: HandlePos,
  a: RotatableBox,
  pageHeightPt: number,
  scale: number
): { cx: number; cy: number } {
  const p = handleCenterPt(pos, a)
  return { cx: p.x * scale, cy: (pageHeightPt - p.y) * scale }
}

/** Rotate-handle anchor in PDF coords: midpoint of the top edge plus an
 *  offset in the rotated +y direction. */
export function rotateHandleCenterPt(a: RotatableBox): { x: number; y: number } {
  const mx = a.x + a.w / 2
  const top = a.y + a.h
  const rot = a.rotation ?? 0
  // The "up from the top edge" direction in PDF coords is (0, +1) un-rotated,
  // rotated by `rot` becomes (-sin rot, cos rot).
  const dx = -Math.sin(rot) * ROTATE_HANDLE_OFFSET_PT
  const dy = Math.cos(rot) * ROTATE_HANDLE_OFFSET_PT
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  const top0 = { x: mx, y: top }
  const topR = rotatePoint(top0.x, top0.y, cx, cy, rot)
  return { x: topR.x + dx, y: topR.y + dy }
}

export function rotateHandleCenter(
  a: RotatableBox,
  pageHeightPt: number,
  scale: number
): { cx: number; cy: number } {
  const p = rotateHandleCenterPt(a)
  return { cx: p.x * scale, cy: (pageHeightPt - p.y) * scale }
}

export function hitTestRect(
  a: BoxAnnotationBase,
  ptX: number,
  ptY: number,
  tolerancePt = 4
): boolean {
  const { x: lx, y: ly } = toLocalFrame(a, ptX, ptY)
  const t = tolerancePt
  return (
    lx >= a.x - t &&
    lx <= a.x + a.w + t &&
    ly >= a.y - t &&
    ly <= a.y + a.h + t
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
  const { x: lx, y: ly } = toLocalFrame(a, ptX, ptY)
  const dx = (lx - cx) / rx
  const dy = (ly - cy) / ry
  return dx * dx + dy * dy <= 1
}

export function hitTest(a: Annotation, ptX: number, ptY: number, tolerancePt = 4): boolean {
  if (isLine(a)) return hitTestLine(a, ptX, ptY, tolerancePt + 2)
  if (isNote(a)) return hitTestNote(a, ptX, ptY, tolerancePt)
  if (isFreeText(a)) return hitTestFreeText(a, ptX, ptY, tolerancePt)
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
