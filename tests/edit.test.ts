import { describe, it, expect } from 'vitest'
import {
  applyDelete,
  applyRotate,
  identityPages,
  normalizeRotation,
  pagesEqual,
  rotatedSize
} from '../src/shared/edit'

describe('normalizeRotation', () => {
  it('wraps positive', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(450)).toBe(90)
  })
  it('wraps negative', () => {
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(-180)).toBe(180)
    expect(normalizeRotation(-450)).toBe(270)
  })
})

describe('rotatedSize', () => {
  const sz = { width: 100, height: 200 }
  it('keeps dims for 0/180', () => {
    expect(rotatedSize(sz, 0)).toEqual(sz)
    expect(rotatedSize(sz, 180)).toEqual(sz)
  })
  it('swaps dims for 90/270', () => {
    expect(rotatedSize(sz, 90)).toEqual({ width: 200, height: 100 })
    expect(rotatedSize(sz, 270)).toEqual({ width: 200, height: 100 })
  })
})

describe('identityPages', () => {
  it('produces N pages with sourceIndex 0..N-1', () => {
    const p = identityPages(4)
    expect(p).toHaveLength(4)
    expect(p.map((x) => x.sourceIndex)).toEqual([0, 1, 2, 3])
    expect(p.every((x) => x.rotation === 0)).toBe(true)
  })
  it('empty for 0', () => {
    expect(identityPages(0)).toEqual([])
  })
})

describe('pagesEqual', () => {
  it('detects equality', () => {
    expect(pagesEqual(identityPages(3), identityPages(3))).toBe(true)
  })
  it('detects length diff', () => {
    expect(pagesEqual(identityPages(2), identityPages(3))).toBe(false)
  })
  it('detects rotation diff', () => {
    const a = identityPages(2)
    const b = [{ sourceIndex: 0, rotation: 90 as const }, { sourceIndex: 1, rotation: 0 as const }]
    expect(pagesEqual(a, b)).toBe(false)
  })
})

describe('applyRotate', () => {
  it('returns a new array (immutability)', () => {
    const a = identityPages(3)
    const b = applyRotate(a, [0], 90)
    expect(b).not.toBe(a)
    expect(a[0].rotation).toBe(0) // input unchanged
  })
  it('only rotates the listed indices', () => {
    const a = identityPages(3)
    const b = applyRotate(a, [0, 2], 90)
    expect(b[0].rotation).toBe(90)
    expect(b[1].rotation).toBe(0)
    expect(b[2].rotation).toBe(90)
  })
  it('cumulates rotation', () => {
    const a = applyRotate(identityPages(1), [0], 90)
    const b = applyRotate(a, [0], 90)
    expect(b[0].rotation).toBe(180)
  })
})

describe('applyDelete', () => {
  it('removes the listed indices', () => {
    const a = identityPages(4)
    const b = applyDelete(a, [1, 3])
    expect(b.map((x) => x.sourceIndex)).toEqual([0, 2])
  })
  it('does not mutate input', () => {
    const a = identityPages(3)
    applyDelete(a, [0])
    expect(a).toHaveLength(3)
  })
})
