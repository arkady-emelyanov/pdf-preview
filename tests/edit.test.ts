import { describe, it, expect } from 'vitest'
import {
  applyDelete,
  applyInsert,
  applyMove,
  applyRotate,
  identityPages,
  moveIndexMap,
  normalizeRotation,
  pagesEqual,
  rotatedSize,
  type VirtualPage
} from '../src/shared/edit'

const SID = '/x/a.pdf'

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
  it('produces N pages carrying sourceId', () => {
    const p = identityPages(SID, 4)
    expect(p).toHaveLength(4)
    expect(p.map((x) => x.sourceIndex)).toEqual([0, 1, 2, 3])
    expect(p.every((x) => x.sourceId === SID)).toBe(true)
    expect(p.every((x) => x.rotation === 0)).toBe(true)
  })
  it('empty for 0', () => {
    expect(identityPages(SID, 0)).toEqual([])
  })
})

describe('pagesEqual', () => {
  it('detects equality', () => {
    expect(pagesEqual(identityPages(SID, 3), identityPages(SID, 3))).toBe(true)
  })
  it('detects length diff', () => {
    expect(pagesEqual(identityPages(SID, 2), identityPages(SID, 3))).toBe(false)
  })
  it('detects sourceId diff', () => {
    const a = identityPages(SID, 1)
    const b = [{ sourceId: '/y/b.pdf', sourceIndex: 0, rotation: 0 as const }]
    expect(pagesEqual(a, b)).toBe(false)
  })
  it('detects rotation diff', () => {
    const a = identityPages(SID, 2)
    const b: VirtualPage[] = [
      { sourceId: SID, sourceIndex: 0, rotation: 90 },
      { sourceId: SID, sourceIndex: 1, rotation: 0 }
    ]
    expect(pagesEqual(a, b)).toBe(false)
  })
})

describe('applyRotate', () => {
  it('returns a new array (immutability)', () => {
    const a = identityPages(SID, 3)
    const b = applyRotate(a, [0], 90)
    expect(b).not.toBe(a)
    expect(a[0].rotation).toBe(0)
  })
  it('only rotates the listed indices', () => {
    const a = identityPages(SID, 3)
    const b = applyRotate(a, [0, 2], 90)
    expect(b[0].rotation).toBe(90)
    expect(b[1].rotation).toBe(0)
    expect(b[2].rotation).toBe(90)
  })
  it('cumulates rotation', () => {
    const a = applyRotate(identityPages(SID, 1), [0], 90)
    const b = applyRotate(a, [0], 90)
    expect(b[0].rotation).toBe(180)
  })
})

describe('applyDelete', () => {
  it('removes the listed indices', () => {
    const a = identityPages(SID, 4)
    const b = applyDelete(a, [1, 3])
    expect(b.map((x) => x.sourceIndex)).toEqual([0, 2])
  })
  it('does not mutate input', () => {
    const a = identityPages(SID, 3)
    applyDelete(a, [0])
    expect(a).toHaveLength(3)
  })
})

describe('applyMove', () => {
  const a: VirtualPage[] = identityPages(SID, 5)

  it('moves single page forward', () => {
    const r = applyMove(a, [0], 2)
    expect(r.map((p) => p.sourceIndex)).toEqual([1, 0, 2, 3, 4])
  })

  it('moves single page backward', () => {
    const r = applyMove(a, [3], 0)
    expect(r.map((p) => p.sourceIndex)).toEqual([3, 0, 1, 2, 4])
  })

  it('moves multiple non-contiguous to insertion point', () => {
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
    const m = moveIndexMap(5, [0], 3)
    expect(m).toEqual([2, 0, 1, 3, 4])
  })
  it('maps multi-move correctly', () => {
    const m = moveIndexMap(5, [0, 2], 4)
    expect(m).toEqual([2, 0, 3, 1, 4])
  })
})

describe('applyInsert', () => {
  const a = identityPages(SID, 3)
  const inserts = identityPages('/y/b.pdf', 2)

  it('inserts at the beginning', () => {
    const r = applyInsert(a, inserts, 0)
    expect(r.map((p) => p.sourceId)).toEqual(['/y/b.pdf', '/y/b.pdf', SID, SID, SID])
  })

  it('inserts in the middle', () => {
    const r = applyInsert(a, inserts, 2)
    expect(r.map((p) => p.sourceId)).toEqual([SID, SID, '/y/b.pdf', '/y/b.pdf', SID])
  })

  it('inserts at the end', () => {
    const r = applyInsert(a, inserts, 3)
    expect(r.map((p) => p.sourceId)).toEqual([SID, SID, SID, '/y/b.pdf', '/y/b.pdf'])
  })

  it('clamps target out of range', () => {
    const r1 = applyInsert(a, inserts, -1)
    expect(r1).toHaveLength(5)
    expect(r1[0].sourceId).toBe('/y/b.pdf')
    const r2 = applyInsert(a, inserts, 99)
    expect(r2[r2.length - 1].sourceId).toBe('/y/b.pdf')
  })

  it('preserves both arrays', () => {
    const r = applyInsert(a, inserts, 1)
    expect(a).toHaveLength(3)
    expect(inserts).toHaveLength(2)
    expect(r).toHaveLength(5)
    expect(r).not.toBe(a)
  })
})
