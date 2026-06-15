/**
 * PDFium wrapper built on @embedpdf/pdfium (WASM build with addFunction
 * exported — needed for the system-font mapper).
 *
 * The `init()` return shape:
 *   - mod.FPDF_xxx  → cwrap'd convenience functions
 *   - mod.pdfium    → the raw Emscripten Module (HEAPU8, wasmExports, addFunction, ...)
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { init as initPdfium, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { buildFontIndex, installFontMapper, fontIndexSummary } from './fonts'
import {
  disposeFormState,
  drawForms,
  forwardChar,
  forwardKeyDown,
  forwardPointerEvent,
  initFormState,
  notifyPageClosed,
  notifyPageLoaded,
  readFieldValues,
  type FieldValue,
  type FormState
} from './forms'

const FPDF_REVERSE_BYTE_ORDER = 0x10
const FPDFBitmap_BGRA = 4

export interface RenderedPage {
  width: number
  height: number
  data: Uint8Array
}
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

interface OpenDoc {
  docPtr: number
  /** WASM heap ptr holding the PDF bytes; must outlive the doc. */
  bytesPtr: number
  pageCount: number
  pageSizes: PageSize[]
  form: FormState
  /**
   * Cached page handles. PDFium's form-fill state stores the focused widget's
   * page pointer; if we load + close pages around every event, that pointer
   * dangles and the next keystroke gets dropped. So once a page is touched we
   * keep its handle until the doc closes.
   */
  pageCache: Map<number, number>
  /**
   * Snapshot of every AcroForm field's value at open-time (or after the
   * most recent save). `formDirty` flips by comparing the live values
   * against this. Refreshed by `refreshFormBaseline` after a successful
   * save. `null` for docs without a form.
   */
  formBaseline: Map<string, string> | null
}

const docs = new Map<string, OpenDoc>()
let modPromise: Promise<WrappedPdfiumModule> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function em(mod: WrappedPdfiumModule): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).pdfium
}

async function loadWasmBinary(): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const here =
    typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath((import.meta as any).url))
  const req = createRequire(join(here, 'placeholder'))
  const wasmPath = req.resolve('@embedpdf/pdfium/pdfium.wasm')
  return readFile(wasmPath)
}

async function getModule(): Promise<WrappedPdfiumModule> {
  if (!modPromise) {
    modPromise = (async () => {
      const [wasmBinary] = await Promise.all([loadWasmBinary(), buildFontIndex()])
      const mod = await initPdfium({ wasmBinary })
      mod.PDFiumExt_Init()
      const raw = em(mod)
      if (raw && typeof raw.addFunction === 'function') {
        try {
          installFontMapper(raw)
          const s = fontIndexSummary()
          console.log(`[fonts] mapper installed; ${s.count} fonts indexed`)
        } catch (e) {
          console.warn('[fonts] mapper install failed:', e)
        }
      } else {
        console.warn('[fonts] addFunction not available; system fonts not injected')
      }
      return mod
    })()
  }
  return modPromise
}

function decodeUtf16LE(heap: Uint8Array, ptr: number, byteLen: number): string {
  return new TextDecoder('utf-16le').decode(heap.subarray(ptr, ptr + byteLen))
}

export async function openDoc(id: string, bytes: Uint8Array): Promise<number> {
  const mod = await getModule()
  const raw = em(mod)

  const prior = docs.get(id)
  if (prior) closeDocInternal(mod, prior)

  const bytesPtr = raw.wasmExports.malloc(bytes.length)
  if (!bytesPtr) throw new Error('malloc failed for PDF bytes')
  raw.HEAPU8.set(bytes, bytesPtr)

  const docPtr = mod.FPDF_LoadMemDocument(bytesPtr, bytes.length, '')
  if (!docPtr) {
    raw.wasmExports.free(bytesPtr)
    const err = mod.FPDF_GetLastError()
    throw new Error(`FPDF_LoadMemDocument failed (code ${err})`)
  }

  const pageCount = mod.FPDF_GetPageCount(docPtr)
  const pageSizes: PageSize[] = []
  for (let i = 0; i < pageCount; i++) {
    const pagePtr = mod.FPDF_LoadPage(docPtr, i)
    if (!pagePtr) {
      pageSizes.push({ width: 612, height: 792 })
      continue
    }
    const w = mod.FPDF_GetPageWidthF(pagePtr)
    const h = mod.FPDF_GetPageHeightF(pagePtr)
    pageSizes.push({ width: w, height: h })
    mod.FPDF_ClosePage(pagePtr)
  }

  const form = initFormState(mod, docPtr)
  const baseline = form.hasForm
    ? new Map(readFieldValues(mod, form, pageCount).map((f) => [f.name, f.value]))
    : null
  docs.set(id, {
    docPtr,
    bytesPtr,
    pageCount,
    pageSizes,
    form,
    pageCache: new Map(),
    formBaseline: baseline
  })
  return pageCount
}

/** Refresh the saved-value snapshot after a successful save. */
export async function refreshFormBaseline(id: string): Promise<void> {
  const d = docs.get(id)
  if (!d || !d.form.hasForm) return
  const mod = await getModule()
  d.formBaseline = new Map(readFieldValues(mod, d.form, d.pageCount).map((f) => [f.name, f.value]))
}

/** Compute whether any form field's current value differs from the baseline.
 *  Returns false when the doc has no form. */
export async function computeFormDirty(id: string): Promise<boolean> {
  const d = docs.get(id)
  if (!d || !d.form.hasForm || !d.formBaseline) return false
  const mod = await getModule()
  const current = readFieldValues(mod, d.form, d.pageCount)
  if (current.length !== d.formBaseline.size) return true
  for (const f of current) {
    const orig = d.formBaseline.get(f.name)
    if (orig === undefined || orig !== f.value) return true
  }
  return false
}

/** Load a page through the per-doc cache. Stays alive until the doc closes,
 *  so PDFium's form-state keeps a stable handle across events. */
function loadCachedPage(mod: WrappedPdfiumModule, d: OpenDoc, pageIndex: number): number {
  const cached = d.pageCache.get(pageIndex)
  if (cached) return cached
  const pagePtr = mod.FPDF_LoadPage(d.docPtr, pageIndex)
  if (!pagePtr) return 0
  d.pageCache.set(pageIndex, pagePtr)
  if (d.form.hasForm) notifyPageLoaded(mod, d.form, pagePtr)
  return pagePtr
}

function closeDocInternal(mod: WrappedPdfiumModule, d: OpenDoc): void {
  const raw = em(mod)
  // Release cached pages before tearing down the form-fill env, otherwise
  // FORM_OnBeforeClosePage would be called against a dead handle.
  for (const pagePtr of d.pageCache.values()) {
    if (d.form.hasForm) notifyPageClosed(mod, d.form, pagePtr)
    mod.FPDF_ClosePage(pagePtr)
  }
  d.pageCache.clear()
  disposeFormState(mod, d.form)
  mod.FPDF_CloseDocument(d.docPtr)
  raw.wasmExports.free(d.bytesPtr)
}

export function getFormInfo(id: string): { hasForm: boolean; isXFA: boolean } {
  const d = docs.get(id)
  if (!d) return { hasForm: false, isXFA: false }
  return { hasForm: d.form.hasForm, isXFA: d.form.isXFA }
}

export async function getFormFieldValues(id: string): Promise<FieldValue[]> {
  const d = docs.get(id)
  if (!d) return []
  const mod = await getModule()
  return readFieldValues(mod, d.form, d.pageCount)
}

/**
 * Save the doc through PDFium so form-field values that live in the in-memory
 * form-fill state get baked into the file. Used by the save handler for
 * un-reordered single-source form docs, where pdf-lib's copyPages would
 * otherwise drop the /AcroForm dict.
 */
export async function saveDocViaPdfium(id: string, destPath: string): Promise<void> {
  const d = docs.get(id)
  if (!d) throw new Error(`unknown doc ${id}`)
  const mod = await getModule()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  const raw = em(mod)
  // Flush any pending form-fill state into the doc before saving.
  if (d.form.formHandle) m.FORM_ForceToKillFocus(d.form.formHandle)
  const writer = m.PDFiumExt_OpenFileWriter() as number
  if (!writer) throw new Error('PDFiumExt_OpenFileWriter failed')
  try {
    // SaveAsCopy flag 0 = full save.
    const ok = m.PDFiumExt_SaveAsCopy(d.docPtr, writer) as number
    if (!ok) throw new Error('PDFiumExt_SaveAsCopy failed')
    const size = m.PDFiumExt_GetFileWriterSize(writer) as number
    if (size <= 0) throw new Error('writer produced zero bytes')
    const buf = raw.wasmExports.malloc(size)
    if (!buf) throw new Error('malloc failed for writer buffer')
    try {
      m.PDFiumExt_GetFileWriterData(writer, buf, size)
      const out = new Uint8Array(size)
      out.set(raw.HEAPU8.subarray(buf, buf + size))
      const { writeFile } = await import('node:fs/promises')
      await writeFile(destPath, out)
    } finally {
      raw.wasmExports.free(buf)
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer)
  }
}

export function closeDoc(id: string): void {
  const d = docs.get(id)
  if (!d) return
  if (!modPromise) {
    docs.delete(id)
    return
  }
  modPromise.then((mod) => {
    closeDocInternal(mod, d)
  })
  docs.delete(id)
}

export function getAllPageSizes(id: string): PageSize[] | null {
  return docs.get(id)?.pageSizes ?? null
}

export async function renderPage(
  id: string,
  pageIndex: number,
  scale: number,
  rotation: number = 0
): Promise<RenderedPage | null> {
  const d = docs.get(id)
  if (!d) return null
  const mod = await getModule()
  const raw = em(mod)

  const pagePtr = loadCachedPage(mod, d, pageIndex)
  if (!pagePtr) return null

  const size = d.pageSizes[pageIndex]
  // PDFium's rotate param: 0/1/2/3 = 0/90/180/270 CW. Output bitmap dimensions
  // must reflect the rotated page (swap on 90/270).
  const rotateParam = (((rotation % 360) + 360) % 360) / 90
  const rotated = rotateParam === 1 || rotateParam === 3
  const srcW = rotated ? size.height : size.width
  const srcH = rotated ? size.width : size.height
  const width = Math.max(1, Math.floor(srcW * scale))
  const height = Math.max(1, Math.floor(srcH * scale))
  const stride = width * 4
  const bufSize = stride * height
  const bufPtr = raw.wasmExports.malloc(bufSize)
  if (!bufPtr) {
    mod.FPDF_ClosePage(pagePtr)
    throw new Error('malloc failed for bitmap')
  }
  raw.HEAPU8.fill(0, bufPtr, bufPtr + bufSize)

  const bitmap = mod.FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, bufPtr, stride)
  if (!bitmap) {
    raw.wasmExports.free(bufPtr)
    mod.FPDF_ClosePage(pagePtr)
    throw new Error('FPDFBitmap_CreateEx failed')
  }

  mod.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
  mod.FPDF_RenderPageBitmap(
    bitmap,
    pagePtr,
    0,
    0,
    width,
    height,
    rotateParam,
    FPDF_REVERSE_BYTE_ORDER
  )
  if (d.form.hasForm) {
    drawForms(
      mod,
      d.form,
      bitmap,
      pagePtr,
      0,
      0,
      width,
      height,
      rotateParam,
      FPDF_REVERSE_BYTE_ORDER
    )
  }

  const data = new Uint8Array(bufSize)
  data.set(raw.HEAPU8.subarray(bufPtr, bufPtr + bufSize))

  mod.FPDFBitmap_Destroy(bitmap)
  raw.wasmExports.free(bufPtr)
  // NB: page handle stays in the cache. Closed by closeDocInternal.

  return { width, height, data }
}

/** Forward a single form-input event from the renderer through to PDFium.
 *  Page is loaded fresh each call — cheap relative to the actual user input. */
export async function dispatchFormEvent(
  id: string,
  pageIndex: number,
  ev:
    | { kind: 'down' | 'up' | 'move'; pageX: number; pageY: number }
    | { kind: 'char'; charCode: number; mods: number }
    | { kind: 'keydown'; vkey: number; mods: number }
): Promise<boolean> {
  const d = docs.get(id)
  if (!d || !d.form.hasForm || d.form.isXFA) return false
  const mod = await getModule()
  const pagePtr = loadCachedPage(mod, d, pageIndex)
  if (!pagePtr) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  switch (ev.kind) {
    case 'down':
      // PDFium-WASM's form-fill leaves the previously-focused widget sticky
      // when a fresh OnLButtonDown lands on a different widget — UP comes
      // back true but the focus indicator never moves. Force-killing focus
      // first turns every click into a clean "defocus then focus" sequence,
      // which works around it.
      m.FORM_ForceToKillFocus(d.form.formHandle)
      forwardPointerEvent(mod, d.form, pagePtr, 'down', ev.pageX, ev.pageY)
      break
    case 'up':
    case 'move':
      forwardPointerEvent(mod, d.form, pagePtr, ev.kind, ev.pageX, ev.pageY)
      break
    case 'char':
      forwardChar(mod, d.form, pagePtr, ev.charCode, ev.mods)
      break
    case 'keydown':
      forwardKeyDown(mod, d.form, pagePtr, ev.vkey, ev.mods)
      break
  }
  // Skip the value-comparison pass on pure movement events — they can't
  // change form values, and `move` fires on every pointer wiggle.
  if (ev.kind === 'move') return false
  return await computeFormDirty(id)
}

export async function getPageText(id: string, pageIndex: number): Promise<string | null> {
  const d = docs.get(id)
  if (!d) return null
  const mod = await getModule()
  const raw = em(mod)

  const pagePtr = mod.FPDF_LoadPage(d.docPtr, pageIndex)
  if (!pagePtr) return null
  const textPagePtr = mod.FPDFText_LoadPage(pagePtr)
  if (!textPagePtr) {
    mod.FPDF_ClosePage(pagePtr)
    return ''
  }
  try {
    const charCount = mod.FPDFText_CountChars(textPagePtr)
    if (charCount <= 0) return ''
    const bufBytes = (charCount + 1) * 2
    const buf = raw.wasmExports.malloc(bufBytes)
    if (!buf) return ''
    try {
      const len = mod.FPDFText_GetText(textPagePtr, 0, charCount, buf)
      if (len <= 0) return ''
      return decodeUtf16LE(raw.HEAPU8, buf, (len - 1) * 2)
    } finally {
      raw.wasmExports.free(buf)
    }
  } finally {
    mod.FPDFText_ClosePage(textPagePtr)
    mod.FPDF_ClosePage(pagePtr)
  }
}

/**
 * Per-char text + boxes for one page. `boxes[i]` is the page-coord rect (top-left
 * origin, same convention as PageRect) for character `text.charAt(i)`. Whitespace
 * and other glyphless chars get a zero-area box at the previous baseline.
 */
export async function getPageChars(
  id: string,
  pageIndex: number
): Promise<{ text: string; boxes: PageRect[] } | null> {
  const d = docs.get(id)
  if (!d) return null
  const mod = await getModule()
  const raw = em(mod)
  const pageHeightPts = d.pageSizes[pageIndex].height

  const pagePtr = mod.FPDF_LoadPage(d.docPtr, pageIndex)
  if (!pagePtr) return null
  const textPagePtr = mod.FPDFText_LoadPage(pagePtr)
  if (!textPagePtr) {
    mod.FPDF_ClosePage(pagePtr)
    return { text: '', boxes: [] }
  }
  try {
    const charCount = mod.FPDFText_CountChars(textPagePtr)
    if (charCount <= 0) return { text: '', boxes: [] }

    let text = ''
    const textBufBytes = (charCount + 1) * 2
    const textBuf = raw.wasmExports.malloc(textBufBytes)
    if (!textBuf) return { text: '', boxes: [] }
    try {
      const len = mod.FPDFText_GetText(textPagePtr, 0, charCount, textBuf)
      if (len > 0) text = decodeUtf16LE(raw.HEAPU8, textBuf, (len - 1) * 2)
    } finally {
      raw.wasmExports.free(textBuf)
    }

    const boxes: PageRect[] = new Array(text.length)
    const boxPtr = raw.wasmExports.malloc(32)
    if (!boxPtr) return { text, boxes: [] }
    try {
      let lastBox: PageRect = { x: 0, y: 0, w: 0, h: 0 }
      for (let i = 0; i < text.length; i++) {
        mod.FPDFText_GetCharBox(
          textPagePtr,
          i,
          boxPtr,
          boxPtr + 8,
          boxPtr + 16,
          boxPtr + 24
        )
        const left = raw.HEAPF64[boxPtr / 8]
        const right = raw.HEAPF64[(boxPtr + 8) / 8]
        const bottom = raw.HEAPF64[(boxPtr + 16) / 8]
        const top = raw.HEAPF64[(boxPtr + 24) / 8]
        if (right > left && top > bottom) {
          const box: PageRect = {
            x: left,
            y: pageHeightPts - top,
            w: right - left,
            h: top - bottom
          }
          boxes[i] = box
          lastBox = box
        } else {
          // Whitespace / glyphless: keep position so click-targeting still snaps
          // into the right line, but no width.
          boxes[i] = { x: lastBox.x + lastBox.w, y: lastBox.y, w: 0, h: lastBox.h }
        }
      }
    } finally {
      raw.wasmExports.free(boxPtr)
    }
    return { text, boxes }
  } finally {
    mod.FPDFText_ClosePage(textPagePtr)
    mod.FPDF_ClosePage(pagePtr)
  }
}

export async function findMatchRects(
  id: string,
  pageIndex: number,
  query: string
): Promise<PageRect[] | null> {
  const d = docs.get(id)
  if (!d || !query) return null
  const mod = await getModule()
  const raw = em(mod)
  const pageHeightPts = d.pageSizes[pageIndex].height

  const pagePtr = mod.FPDF_LoadPage(d.docPtr, pageIndex)
  if (!pagePtr) return []
  const textPagePtr = mod.FPDFText_LoadPage(pagePtr)
  if (!textPagePtr) {
    mod.FPDF_ClosePage(pagePtr)
    return []
  }
  const rects: PageRect[] = []
  try {
    const charCount = mod.FPDFText_CountChars(textPagePtr)
    if (charCount <= 0) return []

    const bufBytes = (charCount + 1) * 2
    const textBuf = raw.wasmExports.malloc(bufBytes)
    if (!textBuf) return []
    let fullText = ''
    try {
      const len = mod.FPDFText_GetText(textPagePtr, 0, charCount, textBuf)
      if (len > 0) fullText = decodeUtf16LE(raw.HEAPU8, textBuf, (len - 1) * 2)
    } finally {
      raw.wasmExports.free(textBuf)
    }
    if (!fullText) return []

    const haystack = fullText.toLowerCase()
    const needle = query.toLowerCase()
    if (!needle) return []

    const boxPtr = raw.wasmExports.malloc(32)
    if (!boxPtr) return []
    try {
      const getBox = (
        idx: number
      ): { left: number; right: number; bottom: number; top: number } => {
        mod.FPDFText_GetCharBox(textPagePtr, idx, boxPtr, boxPtr + 8, boxPtr + 16, boxPtr + 24)
        return {
          left: raw.HEAPF64[boxPtr / 8],
          right: raw.HEAPF64[(boxPtr + 8) / 8],
          bottom: raw.HEAPF64[(boxPtr + 16) / 8],
          top: raw.HEAPF64[(boxPtr + 24) / 8]
        }
      }

      let from = 0
      while (true) {
        const idx = haystack.indexOf(needle, from)
        if (idx < 0) break
        let line: { left: number; right: number; bottom: number; top: number } | null = null
        const flushLine = (): void => {
          if (!line) return
          const x = line.left
          const w = Math.max(1, line.right - line.left)
          const h = Math.max(1, line.top - line.bottom)
          const y = pageHeightPts - line.top
          rects.push({ x, y, w, h })
          line = null
        }
        for (let i = idx; i < idx + needle.length; i++) {
          const ch = fullText[i]
          if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
          const b = getBox(i)
          if (b.right <= b.left || b.top <= b.bottom) continue
          if (!line) {
            line = { ...b }
            continue
          }
          const charH = b.top - b.bottom
          const verticalOverlap = Math.min(line.top, b.top) - Math.max(line.bottom, b.bottom)
          if (verticalOverlap >= charH * 0.5) {
            line.left = Math.min(line.left, b.left)
            line.right = Math.max(line.right, b.right)
            line.bottom = Math.min(line.bottom, b.bottom)
            line.top = Math.max(line.top, b.top)
          } else {
            flushLine()
            line = { ...b }
          }
        }
        flushLine()
        from = idx + needle.length
      }
    } finally {
      raw.wasmExports.free(boxPtr)
    }
  } finally {
    mod.FPDFText_ClosePage(textPagePtr)
    mod.FPDF_ClosePage(pagePtr)
  }
  return rects
}
