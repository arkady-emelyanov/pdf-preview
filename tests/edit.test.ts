import { describe, it, expect } from 'vitest'
import {
  applyDelete,
  applyMove,
  applyRotate,
  identityPages,
  moveIndexMap,
  normalizeRotation,
  pagesEqual,
  rotatedSize,
  type VirtualPage
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

describe('applyMove', () => {
  const a: VirtualPage[] = [
    { sourceIndex: 0, rotation: 0 },
    { sourceIndex: 1, rotation: 0 },
    { sourceIndex: 2, rotation: 0 },
    { sourceIndex: 3, rotation: 0 },
    { sourceIndex: 4, rotation: 0 }
  ]

  it('moves single page forward', () => {
    // [A,B,C,D,E] move A to index 2 → [B,A,C,D,E]
    const r = applyMove(a, [0], 2)
    expect(r.map((p) => p.sourceIndex)).toEqual([1, 0, 2, 3, 4])
  })

  it('moves single page backward', () => {
    // [A,B,C,D,E] move D to index 0 → [D,A,B,C,E]
    const r = applyMove(a, [3], 0)
    expect(r.map((p) => p.sourceIndex)).toEqual([3, 0, 1, 2, 4])
  })

  it('moves multiple non-contiguous to insertion point', () => {
    // [A,B,C,D,E] move A,C to insertion 4 → [B,D,A,C,E]
    const r = applyMove(a, [0, 2], 4)
    expect(r.map((p) => p.sourceIndex)).toEqual([1, 3, 0, 2, 4])
  })

  it('moves to end (target = length)', () => {
    const r = applyMove(a, [0], 5)
    expect(r.map((p) => p.sourceIndex)).toEqual([1, 2, 3, 4, 0])
  })

  it('moves to start (target = 0)', () => {
    const r = applyMove(a, [4], 0)
    expect(r.map((p) => p.sourceIndex)).toEqual([4, 0, 1, 2, 3])
  })

  it('is a no-op when moving back to same position', () => {
    const r = applyMove(a, [2], 2)
    expect(r).toEqual(a)
    const r2 = applyMove(a, [2], 3)
    expect(r2).toEqual(a)
  })

  it('rejects out-of-range indices', () => {
    expect(applyMove(a, [5], 0)).toEqual(a)
    expect(applyMove(a, [0], -1)).toEqual(a)
    expect(applyMove(a, [0], 99)).toEqual(a)
  })

  it('does not mutate input', () => {
    const r = applyMove(a, [0, 2], 4)
    expect(a.map((p) => p.sourceIndex)).toEqual([0, 1, 2, 3, 4])
    expect(r).not.toBe(a)
  })
})

describe('moveIndexMap', () => {
  it('maps single move correctly', () => {
    // 5 pages, move index 0 to insertion 3 → [B,C,A,D,E]
    // Original 0 lands at 2; original 1 → 0; original 2 → 1; original 3 → 3; original 4 → 4
    const m = moveIndexMap(5, [0], 3)
    expect(m).toEqual([2, 0, 1, 3, 4])
  })

  it('maps multi-move correctly', () => {
    // 5 pages, move [0,2] to insertion 4 → [B,D,A,C,E]
    // A(0)→2, B(1)→0, C(2)→3, D(3)→1, E(4)→4
    const m = moveIndexMap(5, [0, 2], 4)
    expect(m).toEqual([2, 0, 3, 1, 4])
  })
})
