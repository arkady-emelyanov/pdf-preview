import type { PageSize } from './ipc'

export type Rotation = 0 | 90 | 180 | 270

export interface VirtualPage {
  /** Index into the source PDF's original page list. */
  sourceIndex: number
  /** Delta rotation applied on top of the source's own /Rotate. */
  rotation: Rotation
}

export function normalizeRotation(deg: number): Rotation {
  const n = ((deg % 360) + 360) % 360
  if (n === 0 || n === 90 || n === 180 || n === 270) return n
  // Snap to nearest quadrant; defensive.
  return (Math.round(n / 90) * 90) % 360 as Rotation
}

export function rotatedSize(size: PageSize, rotation: Rotation): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size
}

/** Create the identity edit state for a freshly opened document. */
export function identityPages(sourcePageCount: number): VirtualPage[] {
  const pages: VirtualPage[] = []
  for (let i = 0; i < sourcePageCount; i++) {
    pages.push({ sourceIndex: i, rotation: 0 })
  }
  return pages
}

export function pagesEqual(a: VirtualPage[], b: VirtualPage[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].sourceIndex !== b[i].sourceIndex || a[i].rotation !== b[i].rotation) return false
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
