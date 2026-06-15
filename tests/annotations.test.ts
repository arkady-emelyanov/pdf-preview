import { describe, it, expect } from 'vitest'
import {
  addAnnotation,
  annotationsEqual,
  arrowHeadSizePt,
  canvasToPoint,
  deleteAnnotation,
  distanceToSegment,
  handleCenter,
  hitTest,
  hitTestLine,
  hitTestNote,
  hitTestOval,
  hitTestRect,
  lineBBox,
  makeBox,
  makeLine,
  makeNote,
  makeRect,
  NOTE_SIZE_PT,
  parseHexColor,
  pointToCanvas,
  rectToCanvas,
  resizeRect,
  updateAnnotation,
  type Annotation
} from '../src/shared/annotations'

describe('makeRect', () => {
  it('clamps negative w/h to 0 and stamps timestamps', () => {
    const r = makeRect({ x: 10, y: 10, w: -5, h: 0 })
    expect(r.w).toBe(0)
    expect(r.h).toBe(0)
    expect(r.kind).toBe('rect')
    expect(r.id).toMatch(/^p4l-[a-z0-9]+$/)
    expect(r.created).toBeGreaterThan(0)
    expect(r.modified).toBe(r.created)
    expect(r.opacity).toBe(1)
  })
})

describe('add / update / delete annotation', () => {
  const r = makeRect({ x: 0, y: 0, w: 50, h: 50 })
  it('addAnnotation appends without mutating the input', () => {
    const orig: Annotation[] = []
    const next = addAnnotation(orig, r)
    expect(next).toHaveLength(1)
    expect(orig).toHaveLength(0)
  })
  it('updateAnnotation patches the right id', () => {
    const list = [r]
    const next = updateAnnotation(list, r.id, { x: 999 })
    expect(next[0].x).toBe(999)
    expect(list[0].x).toBe(0)
    expect(next[0].modified).toBeGreaterThanOrEqual(r.modified)
  })
  it('deleteAnnotation removes by id', () => {
    const next = deleteAnnotation([r], r.id)
    expect(next).toHaveLength(0)
  })
  it('updateAnnotation on undefined returns []', () => {
    expect(updateAnnotation(undefined, 'x', { x: 1 })).toEqual([])
  })
})

describe('annotationsEqual', () => {
  const a = makeRect({ x: 1, y: 2, w: 3, h: 4 })
  it('treats undefined and [] as equal', () => {
    expect(annotationsEqual(undefined, [])).toBe(true)
  })
  it('detects different id', () => {
    const b = { ...a, id: 'other' }
    expect(annotationsEqual([a], [b])).toBe(false)
  })
  it('detects geometry change', () => {
    const b = { ...a, x: 99 }
    expect(annotationsEqual([a], [b])).toBe(false)
  })
  it('detects length diff', () => {
    expect(annotationsEqual([a], [a, a])).toBe(false)
  })
})

describe('coordinate conversions', () => {
  const pageH = 792
  const scale = 2
  it('round-trip pointToCanvas / canvasToPoint', () => {
    const { cx, cy } = pointToCanvas(100, 200, pageH, scale)
    expect(cx).toBe(200)
    expect(cy).toBe((792 - 200) * 2)
    const back = canvasToPoint(cx, cy, pageH, scale)
    expect(back.x).toBeCloseTo(100, 6)
    expect(back.y).toBeCloseTo(200, 6)
  })
  it('rectToCanvas places bottom-left rect at correct top-left in canvas', () => {
    const a = makeRect({ x: 100, y: 100, w: 50, h: 50 })
    const r = rectToCanvas(a, pageH, scale)
    expect(r.x).toBe(200)
    // top-left y = (pageH - (y+h)) * scale = (792 - 150) * 2 = 1284
    expect(r.y).toBe(1284)
    expect(r.w).toBe(100)
    expect(r.h).toBe(100)
  })
})

describe('makeBox', () => {
  it('builds an oval that carries kind through hitTest', () => {
    const o = makeBox('oval', { x: 0, y: 0, w: 100, h: 50, stroke: '#0a0' })
    expect(o.kind).toBe('oval')
    expect(o.stroke).toBe('#0a0')
    // Centroid is inside the ellipse.
    expect(hitTest(o, 50, 25)).toBe(true)
    // Corner of the bounding box is outside the ellipse.
    expect(hitTest(o, 1, 1, 0)).toBe(false)
  })
})

describe('hitTestOval', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }
  it('inside the ellipse', () => {
    expect(hitTestOval(a, 50, 25, 0)).toBe(true)
  })
  it('outside the ellipse but inside the bbox', () => {
    expect(hitTestOval(a, 1, 1, 0)).toBe(false)
  })
  it('outside the bbox', () => {
    expect(hitTestOval(a, -50, 25, 0)).toBe(false)
  })
})

describe('hitTestRect', () => {
  const a = makeRect({ x: 10, y: 10, w: 20, h: 20 })
  it('hits inside', () => {
    expect(hitTestRect(a, 15, 15, 0)).toBe(true)
  })
  it('misses outside', () => {
    expect(hitTestRect(a, 0, 0, 0)).toBe(false)
  })
  it('tolerance grows the hit area', () => {
    expect(hitTestRect(a, 5, 5, 0)).toBe(false)
    expect(hitTestRect(a, 8, 8, 4)).toBe(true)
  })
})

describe('resizeRect', () => {
  const orig = { x: 100, y: 100, w: 80, h: 60 }

  it('se handle extends both width and height', () => {
    const r = resizeRect(orig, 'se', 20, -10) // PDF-y: down in screen = -dy
    expect(r.x).toBe(100)
    // 'se' moves the south (bottom) edge: y1 += dy → y goes down
    expect(r.y).toBe(90)
    expect(r.w).toBe(100)
    // top stays at 160; bottom moves to 90 → h = 70
    expect(r.h).toBe(70)
  })

  it('nw handle moves the top-left corner', () => {
    const r = resizeRect(orig, 'nw', -10, 20) // drag up-left
    expect(r.x).toBe(90)
    expect(r.y).toBe(100)
    expect(r.w).toBe(90)
    expect(r.h).toBe(80)
  })

  it('n only changes height; x/w/y unchanged', () => {
    const r = resizeRect(orig, 'n', 999, 25)
    expect(r.x).toBe(100)
    expect(r.w).toBe(80)
    expect(r.y).toBe(100)
    expect(r.h).toBe(85)
  })

  it('flips cleanly when dragged past the opposite edge', () => {
    const r = resizeRect(orig, 'e', -200, 0)
    // x2 = 180 - 200 = -20; new x = min(100, -20) = -20, w = 120
    expect(r.x).toBe(-20)
    expect(r.w).toBe(120)
  })
})

describe('makeLine + arrow geometry', () => {
  it('makeLine stamps endpoints and kind', () => {
    const l = makeLine('arrow', { x1: 10, y1: 20, x2: 50, y2: 60, stroke: '#0a0', strokeWidth: 3 })
    expect(l.kind).toBe('arrow')
    expect(l).toMatchObject({ x1: 10, y1: 20, x2: 50, y2: 60, stroke: '#0a0', strokeWidth: 3 })
  })

  it('lineBBox includes arrowhead padding for arrows', () => {
    const arrow = makeLine('arrow', { x1: 0, y1: 0, x2: 100, y2: 0, strokeWidth: 2 })
    const line = makeLine('line', { x1: 0, y1: 0, x2: 100, y2: 0, strokeWidth: 2 })
    const head = arrowHeadSizePt(2)
    expect(lineBBox(arrow)).toEqual({
      x: -head,
      y: -head,
      w: 100 + head * 2,
      h: head * 2
    })
    expect(lineBBox(line).h).toBe(2 * 2) // just stroke pad
  })

  it('arrowHeadSizePt grows with stroke width and has a floor', () => {
    expect(arrowHeadSizePt(1)).toBe(8) // floor
    expect(arrowHeadSizePt(4)).toBe(16) // 4*4
  })
})

describe('distanceToSegment', () => {
  it('zero for a point on the segment', () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBe(0)
  })
  it('perpendicular distance for a point above the segment middle', () => {
    expect(distanceToSegment(5, 4, 0, 0, 10, 0)).toBeCloseTo(4)
  })
  it('falls back to endpoint distance when projecting past the end', () => {
    expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBe(5)
    expect(distanceToSegment(20, 0, 0, 0, 10, 0)).toBe(10)
  })
  it('handles degenerate segment (p1 == p2)', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('hitTestLine', () => {
  const a = makeLine('arrow', { x1: 0, y1: 0, x2: 100, y2: 0, strokeWidth: 2 })
  it('hits ON the line', () => expect(hitTestLine(a, 50, 0, 6)).toBe(true))
  it('hits within tolerance band', () => expect(hitTestLine(a, 50, 4, 6)).toBe(true))
  it('misses outside tolerance band', () => expect(hitTestLine(a, 50, 50, 6)).toBe(false))
  it('hitTest dispatches arrows to the line tester', () => {
    expect(hitTest(a, 50, 2)).toBe(true)
    expect(hitTest(a, 50, 50)).toBe(false)
  })
})

describe('annotationsEqual across kinds', () => {
  it('treats two equal arrows as equal', () => {
    const a = makeLine('arrow', { x1: 0, y1: 0, x2: 10, y2: 10 })
    const b = { ...a }
    expect(annotationsEqual([a], [b])).toBe(true)
  })
  it('detects an endpoint change', () => {
    const a = makeLine('arrow', { x1: 0, y1: 0, x2: 10, y2: 10 })
    const b = { ...a, x2: 99 }
    expect(annotationsEqual([a], [b])).toBe(false)
  })
  it('detects a kind change (arrow vs line) with same endpoints', () => {
    const a = makeLine('arrow', { x1: 0, y1: 0, x2: 10, y2: 10 })
    const b = { ...a, kind: 'line' as const }
    expect(annotationsEqual([a], [b])).toBe(false)
  })
})

describe('makeNote + hit-test', () => {
  it('makeNote defaults body to empty and color to yellow', () => {
    const n = makeNote({ x: 100, y: 200 })
    expect(n.kind).toBe('note')
    expect(n.body).toBe('')
    expect(n.color).toBe('#ffe066')
    expect(n.x).toBe(100)
    expect(n.y).toBe(200)
  })

  it('hitTestNote returns true within the icon bbox + tolerance', () => {
    const n = makeNote({ x: 0, y: 0 })
    expect(hitTestNote(n, 5, 5, 0)).toBe(true)
    expect(hitTestNote(n, NOTE_SIZE_PT - 1, NOTE_SIZE_PT - 1, 0)).toBe(true)
    expect(hitTestNote(n, NOTE_SIZE_PT + 10, 0, 0)).toBe(false)
    expect(hitTestNote(n, NOTE_SIZE_PT + 2, 0, 4)).toBe(true)
  })

  it('hitTest dispatches notes through to hitTestNote', () => {
    const n = makeNote({ x: 100, y: 100 })
    expect(hitTest(n, 110, 110)).toBe(true)
    expect(hitTest(n, 5, 5)).toBe(false)
  })

  it('annotationsEqual notes detects body and color changes', () => {
    const a = makeNote({ x: 0, y: 0, body: 'hi', color: '#aaa' })
    const sameId = (o: typeof a, patch: Partial<typeof a>): typeof a => ({ ...o, ...patch })
    expect(annotationsEqual([a], [a])).toBe(true)
    expect(annotationsEqual([a], [sameId(a, { body: 'bye' })])).toBe(false)
    expect(annotationsEqual([a], [sameId(a, { color: '#bbb' })])).toBe(false)
    expect(annotationsEqual([a], [sameId(a, { x: 5 })])).toBe(false)
  })
})

describe('handleCenter', () => {
  const a = { x: 100, y: 100, w: 80, h: 60 }
  // pageHeight = 1000, scale = 1 → top of rect in canvas = 1000 - 160 = 840
  it('nw is at the canvas top-left corner of the rect', () => {
    const h = handleCenter('nw', a, 1000, 1)
    expect(h).toEqual({ cx: 100, cy: 840 })
  })
  it('se is at the canvas bottom-right of the rect', () => {
    const h = handleCenter('se', a, 1000, 1)
    expect(h).toEqual({ cx: 180, cy: 900 })
  })
  it('n midpoint of the top edge', () => {
    const h = handleCenter('n', a, 1000, 1)
    expect(h).toEqual({ cx: 140, cy: 840 })
  })
})

describe('parseHexColor', () => {
  it('parses #rrggbb', () => {
    const c = parseHexColor('#ff8000')
    expect(c).not.toBeNull()
    expect(c![0]).toBeCloseTo(1, 5)
    expect(c![1]).toBeCloseTo(128 / 255, 5)
    expect(c![2]).toBeCloseTo(0, 5)
  })
  it('parses #rgb shorthand', () => {
    const c = parseHexColor('#f80')
    expect(c![0]).toBeCloseTo(1, 5)
    expect(c![1]).toBeCloseTo(136 / 255, 5)
  })
  it('rejects garbage', () => {
    expect(parseHexColor('red')).toBeNull()
    expect(parseHexColor('#zz0000')).toBeNull()
  })
})

describe('rotated hit-tests', () => {
  it('hitTestRect rotates the test point into the un-rotated frame', () => {
    // 100×40 rect centered at (100, 100), rotated 90° CCW. The rotated shape
    // occupies a 40-wide × 100-tall slab in page coords.
    const a = makeBox('rect', { x: 50, y: 80, w: 100, h: 40 })
    a.rotation = Math.PI / 2
    // Point near the top of the rotated shape — well outside the axis-aligned
    // bbox to the right but inside the rotated one.
    expect(hitTestRect(a as never, 100, 145, 0)).toBe(true)
    // Point that WOULD hit if we ignored rotation but doesn't now.
    expect(hitTestRect(a as never, 145, 100, 0)).toBe(false)
  })

  it('handleCenter rotates handles around the bbox center', () => {
    const a = { x: 0, y: 0, w: 100, h: 40, rotation: Math.PI / 2 }
    const p = handleCenter('ne', a, 200 /* pageH */, 1 /* scale */)
    // 'ne' un-rotated is at (100, 40). After 90° CCW around (50, 20) it
    // becomes (30, 70) in PDF coords → (30, 130) in canvas (Y flipped).
    expect(p.cx).toBeCloseTo(30, 4)
    expect(p.cy).toBeCloseTo(200 - 70, 4)
  })
})
