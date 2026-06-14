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

export interface DocInfo {
  id: DocId
  path: string
  name: string
  pageCount: number
  pageSizes: PageSize[]
}

export interface RenderedPageMsg {
  width: number
  height: number
  data: Uint8Array
}
