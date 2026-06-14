import type { PageSize } from './ipc'

export type Rotation = 0 | 90 | 180 | 270

export interface VirtualPage {
  /** Stable id of the source PDF (typically its canonical path). */
  sourceId: string
  /** Index into the source PDF's original page list. */
  sourceIndex: number
  /** Delta rotation applied on top of the source's own /Rotate. */
  rotation: Rotation
}

export function normalizeRotation(deg: number): Rotation {
  const n = ((deg % 360) + 360) % 360
  if (n === 0 || n === 90 || n === 180 || n === 270) return n
  return (Math.round(n / 90) * 90) % 360 as Rotation
}

export function rotatedSize(size: PageSize, rotation: Rotation): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size
}

/** Create the identity edit state for a freshly opened document. */
export function identityPages(sourceId: string, sourcePageCount: number): VirtualPage[] {
  const pages: VirtualPage[] = []
  for (let i = 0; i < sourcePageCount; i++) {
    pages.push({ sourceId, sourceIndex: i, rotation: 0 })
  }
  return pages
}

export function pagesEqual(a: VirtualPage[], b: VirtualPage[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].sourceId !== b[i].sourceId ||
      a[i].sourceIndex !== b[i].sourceIndex ||
      a[i].rotation !== b[i].rotation
    )
      return false
  }
  return true
}

/** Apply a rotation delta to the given page indices and return a new array. */
export function applyRotate(pages: VirtualPage[], indices: number[], delta: number): VirtualPage[] {
  const set = new Set(indices)
  return pages.map((p, i) =>
    set.has(i) ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p
  )
}

export function applyDelete(pages: VirtualPage[], indices: number[]): VirtualPage[] {
  const set = new Set(indices)
  return pages.filter((_, i) => !set.has(i))
}

/**
 * Move the listed page indices to insertion point `target`.
 *
 * `target` is a position in the ORIGINAL array (0 = before first page,
 * pages.length = after last). The moved pages end up consecutive at the
 * adjusted target, in the order they originally appeared.
 */
export function applyMove(
  pages: VirtualPage[],
  indices: number[],
  target: number
): VirtualPage[] {
  const sorted = [...indices].sort((a, b) => a - b)
  if (sorted.length === 0) return pages
  if (sorted.some((i) => i < 0 || i >= pages.length)) return pages
  if (target < 0 || target > pages.length) return pages

  const moved = sorted.map((i) => pages[i])
  const set = new Set(sorted)
  const remaining = pages.filter((_, i) => !set.has(i))
  const adjustedTarget = target - sorted.filter((i) => i < target).length

  return [...remaining.slice(0, adjustedTarget), ...moved, ...remaining.slice(adjustedTarget)]
}

/** Insert a batch of new VirtualPages at insertion point `target`. */
export function applyInsert(
  pages: VirtualPage[],
  inserts: VirtualPage[],
  target: number
): VirtualPage[] {
  const t = Math.max(0, Math.min(pages.length, target))
  return [...pages.slice(0, t), ...inserts, ...pages.slice(t)]
}

export function moveIndexMap(
  pageCount: number,
  indices: number[],
  target: number
): number[] {
  const sorted = [...indices].sort((a, b) => a - b)
  const set = new Set(sorted)
  const adjustedTarget = target - sorted.filter((i) => i < target).length
  const out = new Array<number>(pageCount).fill(-1)
  let cursor = 0
  for (let i = 0; i < pageCount; i++) {
    if (set.has(i)) continue
    if (cursor === adjustedTarget) cursor += sorted.length
    out[i] = cursor++
  }
  for (let m = 0; m < sorted.length; m++) {
    out[sorted[m]] = adjustedTarget + m
  }
  return out
}
