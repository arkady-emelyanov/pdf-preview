import { describe, it, expect } from 'vitest'
import {
  addAnnotation,
  annotationsEqual,
  canvasToPoint,
  deleteAnnotation,
  hitTestRect,
  makeRect,
  parseHexColor,
  pointToCanvas,
  rectToCanvas,
  updateAnnotation,
  type Annotation
} from '../src/shared/annotations'

describe('makeRect', () => {
  it('clamps negative w/h to 0 and stamps timestamps', () => {
    const r = makeRect({ x: 10, y: 10, w: -5, h: 0 })
    expect(r.w).toBe(0)
    expect(r.h).toBe(0)
    expect(r.kind).toBe('rect')
    expect(r.id).toMatch(/^[a-z0-9]+$/)
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
