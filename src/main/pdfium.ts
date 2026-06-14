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

  docs.set(id, { docPtr, bytesPtr, pageCount, pageSizes })
  return pageCount
}

function closeDocInternal(mod: WrappedPdfiumModule, d: OpenDoc): void {
  const raw = em(mod)
  mod.FPDF_CloseDocument(d.docPtr)
  raw.wasmExports.free(d.bytesPtr)
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

  const pagePtr = mod.FPDF_LoadPage(d.docPtr, pageIndex)
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

  const data = new Uint8Array(bufSize)
  data.set(raw.HEAPU8.subarray(bufPtr, bufPtr + bufSize))

  mod.FPDFBitmap_Destroy(bitmap)
  raw.wasmExports.free(bufPtr)
  mod.FPDF_ClosePage(pagePtr)

  return { width, height, data }
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
