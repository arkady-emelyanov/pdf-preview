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
  /** True if the PDF has an AcroForm or XFA form. Drives FormLayer display. */
  hasForm: boolean
  /** True for XFA forms — we render the static fallback but disable
   *  interaction and surface a banner. */
  isXFA: boolean
}

export type FormFieldType =
  | 'unknown'
  | 'pushbutton'
  | 'checkbox'
  | 'radio'
  | 'combobox'
  | 'listbox'
  | 'text'
  | 'signature'

export interface FormFieldValue {
  name: string
  type: FormFieldType
  value: string
}

export type FormEvent =
  | { kind: 'down' | 'up' | 'move'; pageX: number; pageY: number }
  | { kind: 'char'; charCode: number; mods: number }
  | { kind: 'keydown'; vkey: number; mods: number }

export interface DocInfo {
  /** Primary file path; window key. */
  id: DocId
  path: string
  name: string
  /** Primary source — always present. Additional sources may be registered later. */
  primary: SourceInfo
  /** Best-guess author string stamped on new annotations (git user.name, else $USER). */
  author: string
}

export interface RenderedPageMsg {
  width: number
  height: number
  data: Uint8Array
}

/** A single PPD/IPP option exposed by `lpoptions -p <name> -l`, e.g. media,
 *  Duplex, ColorModel. `values` are the raw CUPS keywords (`one-sided`,
 *  `DuplexNoTumble`, …); we map a few well-known ones to friendlier labels in
 *  the dialog. `default` is the value marked with `*` in lpoptions output. */
export interface PrinterOption {
  key: string
  label: string
  values: string[]
  default: string
}

export interface PrinterInfo {
  name: string
  isDefault: boolean
  description?: string
  options: PrinterOption[]
}

export interface PrintJob {
  printerName: string
  /** Pages from the renderer's edit graph, in print order, already filtered to
   *  the user's page-range / odd-even / custom subset choice. */
  pages: import('./edit').VirtualPage[]
  sources: Record<string, string>
  copies: number
  /** Raw CUPS keyword values; left undefined when the user kept "printer
   *  default" so we don't override the queue's default. */
  duplex?: string
  media?: string
  colorModel?: string
  orientation?: 'portrait' | 'landscape'
  /** 'fit' → `fit-to-page`; 'actual' → no scaling; number → `scaling=N`. */
  scaling?: 'fit' | 'actual' | number
}

export type JobState = 'pending' | 'printing' | 'done' | 'cancelled' | 'error'

export interface JobStatus {
  jobId: string
  state: JobState
  message?: string
}

export interface PrintResult {
  ok: boolean
  jobId?: string
  error?: string
}
