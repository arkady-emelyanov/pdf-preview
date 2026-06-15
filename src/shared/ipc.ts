import type { Annotation } from './annotations'

export type DocId = string

export interface PageSize {
  width: number
  height: number
}

export interface PageRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SourceInfo {
  sourceId: string
  /** Display name (basename of the file). */
  name: string
  pageCount: number
  pageSizes: PageSize[]
  /** Annotations parsed from the file on open, one array per source page.
   *  Only contains annotations whose `/NM` carries our `OWN_NM_PREFIX`. */
  annotations: Annotation[][]
}

export interface DocInfo {
  /** Primary file path; window key. */
  id: DocId
  path: string
  name: string
  /** Primary source — always present. Additional sources may be registered later. */
  primary: SourceInfo
}

export interface RenderedPageMsg {
  width: number
  height: number
  data: Uint8Array
}
