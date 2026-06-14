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
