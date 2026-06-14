/**
 * v1 annotation schema. Geometry is stored in PDF page coordinates
 * (origin bottom-left, units = PDF points), so a saved annotation re-opens at
 * the same position regardless of zoom or display scale.
 *
 * v1 ships only the `rect` kind; oval / line / arrow / note / text reuse the
 * same envelope (id, page-coord geometry, style, author, timestamps).
 */

export type AnnotationKind = 'rect'

export interface RectAnnotation {
  id: string
  kind: 'rect'
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

export type Annotation = RectAnnotation

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeRect(
  init: Pick<RectAnnotation, 'x' | 'y' | 'w' | 'h'> &
    Partial<Pick<RectAnnotation, 'stroke' | 'strokeWidth' | 'fill' | 'opacity' | 'author'>>
): RectAnnotation {
  const now = Date.now()
  return {
    id: newId(),
    kind: 'rect',
    x: init.x,
    y: init.y,
    w: Math.max(0, init.w),
    h: Math.max(0, init.h),
    stroke: init.stroke ?? '#d33',
    strokeWidth: init.strokeWidth ?? 2,
    fill: init.fill,
    opacity: init.opacity ?? 1,
    author: init.author,
    created: now,
    modified: now
  }
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
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false
    if (x.stroke !== y.stroke || x.strokeWidth !== y.strokeWidth) return false
    if (x.fill !== y.fill || x.opacity !== y.opacity) return false
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
  a: RectAnnotation,
  pageHeightPt: number,
  scale: number
): { x: number; y: number; w: number; h: number } {
  const top = pageHeightPt - (a.y + a.h)
  return { x: a.x * scale, y: top * scale, w: a.w * scale, h: a.h * scale }
}

export function hitTestRect(
  a: RectAnnotation,
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
