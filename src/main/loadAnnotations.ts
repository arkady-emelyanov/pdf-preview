/**
 * Read annotations back from a PDF file at open-time so they reappear in the
 * edit graph. We only deserialize annotations whose `/NM` starts with our
 * `OWN_NM_PREFIX` — annotations from other tools (Acrobat, Okular, etc.) are
 * preserved on disk but not surfaced in the editor.
 */
import { readFile } from 'node:fs/promises'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString
} from 'pdf-lib'
import {
  FREETEXT_DEFAULT_COLOR,
  FREETEXT_DEFAULT_FONT,
  FREETEXT_DEFAULT_SIZE,
  OWN_NM_PREFIX,
  type Annotation,
  type FreeTextAnnotation,
  type FreeTextFont,
  type LineAnnotation,
  type NoteAnnotation,
  type OvalAnnotation,
  type RectAnnotation
} from '../shared/annotations'

/** Parse a /FreeText /DA string of the conventional form
 *   `/<FontTag> <size> Tf  r g b rg`
 *  back into our font / size / hex-color triple. Falls back to defaults for
 *  any tokens we can't recover. */
function parseDA(da: string): { font: FreeTextFont; size: number; color: string } {
  let font: FreeTextFont = FREETEXT_DEFAULT_FONT
  let size = FREETEXT_DEFAULT_SIZE
  let color = FREETEXT_DEFAULT_COLOR
  const tfMatch = da.match(/\/(\w+)\s+([0-9.]+)\s+Tf/)
  if (tfMatch) {
    const tag = tfMatch[1].toLowerCase()
    if (tag.startsWith('tiro') || tag.startsWith('times')) font = 'Times'
    else if (tag.startsWith('cour')) font = 'Courier'
    else font = 'Helvetica'
    const n = Number(tfMatch[2])
    if (Number.isFinite(n) && n > 0) size = n
  }
  const rgMatch = da.match(/([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+rg/)
  if (rgMatch) {
    const r = Math.round(Math.max(0, Math.min(1, Number(rgMatch[1]))) * 255)
    const g = Math.round(Math.max(0, Math.min(1, Number(rgMatch[2]))) * 255)
    const b = Math.round(Math.max(0, Math.min(1, Number(rgMatch[3]))) * 255)
    const hex = (n: number): string => n.toString(16).padStart(2, '0')
    color = `#${hex(r)}${hex(g)}${hex(b)}`
  }
  return { font, size, color }
}

function decodeText(v: unknown): string {
  if (v instanceof PDFHexString) return v.decodeText()
  if (v instanceof PDFString) return v.decodeText()
  return ''
}

function readNumber(v: unknown): number {
  if (v instanceof PDFNumber) return v.asNumber()
  if (typeof v === 'object' && v && 'toString' in v) {
    const n = Number((v as { toString(): string }).toString())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Recover the un-rotated bbox (x, y, w, h) given:
 *   - the rotated axis-aligned bbox in page coords [x1, y1, x2, y2] from /Rect
 *   - the rotation angle θ (radians) we wrote alongside it
 * Inverse of `rotatedBBox` in save.ts. Falls back to the axis-aligned rect on
 * a singular angle (multiples of 45° where the linear system has det 0).
 */
function unrotateRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rot: number
): { x: number; y: number; w: number; h: number } {
  const W = Math.abs(x2 - x1)
  const H = Math.abs(y2 - y1)
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  if (rot === 0) return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: W, h: H }
  const c = Math.abs(Math.cos(rot))
  const s = Math.abs(Math.sin(rot))
  const det = c * c - s * s
  let w = W
  let h = H
  if (Math.abs(det) > 1e-6) {
    w = (c * W - s * H) / det
    h = (-s * W + c * H) / det
  } else {
    // 45° / 135° / ... — un-rotated dims are unrecoverable from the bbox
    // alone; fall back to assuming a square.
    const side = (W + H) / 2 / (c + s)
    w = side
    h = side
  }
  if (w < 0) w = 0
  if (h < 0) h = 0
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

function readRgb(arr: PDFArray | undefined, fallback: string): string {
  if (!arr || arr.size() < 3) return fallback
  const r = Math.round(Math.max(0, Math.min(1, readNumber(arr.lookup(0)))) * 255)
  const g = Math.round(Math.max(0, Math.min(1, readNumber(arr.lookup(1)))) * 255)
  const b = Math.round(Math.max(0, Math.min(1, readNumber(arr.lookup(2)))) * 255)
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Parse annotations from a file. Returns `pageCount`-many arrays. */
export async function loadAnnotations(filePath: string): Promise<Annotation[][]> {
  // Annotation parsing is best-effort: a malformed or genuinely-encrypted PDF
  // can blow up anywhere in pdf-lib's lazy page-tree walk (e.g. getPageCount
  // chasing a broken object ref), not just at load(). `ignoreEncryption: true`
  // lets load() succeed where it used to throw, so the parse below must be
  // guarded too — otherwise the failure escapes and takes down pdf:open. On
  // any failure we return no annotations; the document still opens and renders
  // via PDFium.
  try {
    const bytes = await readFile(filePath)
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const out: Annotation[][] = []
    for (let pi = 0; pi < doc.getPageCount(); pi++) {
      const page = doc.getPage(pi)
      const annotsObj = page.node.Annots()
      const list: Annotation[] = []
      if (annotsObj instanceof PDFArray) {
        for (let j = 0; j < annotsObj.size(); j++) {
          const entry = annotsObj.get(j)
          const dict =
            entry instanceof PDFRef ? doc.context.lookup(entry, PDFDict) : (entry as PDFDict)
          if (!(dict instanceof PDFDict)) continue
          const ann = parseAnnotation(dict)
          if (ann) list.push(ann)
        }
      }
      out.push(list)
    }
    return out
  } catch {
    return []
  }
}

function parseAnnotation(dict: PDFDict): Annotation | null {
  const nm = decodeText(dict.lookup(PDFName.of('NM')))
  if (!nm.startsWith(OWN_NM_PREFIX)) return null

  const subtypeNode = dict.lookup(PDFName.of('Subtype'))
  const subtype = subtypeNode ? subtypeNode.toString() : ''
  const rectNode = dict.lookup(PDFName.of('Rect'))
  if (!(rectNode instanceof PDFArray) || rectNode.size() < 4) return null

  const stroke = readRgb(
    dict.lookup(PDFName.of('C')) instanceof PDFArray
      ? (dict.lookup(PDFName.of('C')) as PDFArray)
      : undefined,
    '#d33'
  )
  const bs = dict.lookup(PDFName.of('BS'))
  let strokeWidth = 2
  if (bs instanceof PDFDict) {
    const w = bs.lookup(PDFName.of('W'))
    if (w instanceof PDFNumber) strokeWidth = w.asNumber()
  }
  const ca = dict.lookup(PDFName.of('CA'))
  const opacity = ca instanceof PDFNumber ? ca.asNumber() : 1
  const author = decodeText(dict.lookup(PDFName.of('T'))) || undefined
  // Our custom rotation tag (radians, CCW around bbox center). We expand
  // /Rect to the rotated axis-aligned bbox on save, so to reconstruct the
  // un-rotated (x, y, w, h) we shrink the rect by the rotation.
  const pdfRot = dict.lookup(PDFName.of('PdfRotation'))
  const rotation = pdfRot instanceof PDFNumber ? pdfRot.asNumber() : 0
  const now = Date.now()

  if (subtype === '/Square' || subtype === '/Circle') {
    const x1 = readNumber(rectNode.lookup(0))
    const y1 = readNumber(rectNode.lookup(1))
    const x2 = readNumber(rectNode.lookup(2))
    const y2 = readNumber(rectNode.lookup(3))
    const ic = dict.lookup(PDFName.of('IC'))
    const fill = ic instanceof PDFArray ? readRgb(ic, '#d33') : undefined
    const unrot = unrotateRect(x1, y1, x2, y2, rotation)
    const a: RectAnnotation | OvalAnnotation = {
      id: nm,
      kind: subtype === '/Circle' ? 'oval' : 'rect',
      x: unrot.x,
      y: unrot.y,
      w: unrot.w,
      h: unrot.h,
      stroke,
      strokeWidth,
      fill,
      opacity,
      rotation: rotation || undefined,
      author,
      created: now,
      modified: now
    }
    return a
  }
  if (subtype === '/Line') {
    const L = dict.lookup(PDFName.of('L'))
    if (!(L instanceof PDFArray) || L.size() < 4) return null
    let isArrow = false
    const LE = dict.lookup(PDFName.of('LE'))
    if (LE instanceof PDFArray && LE.size() >= 2) {
      const head = LE.lookup(1)
      if (head) isArrow = head.toString() === '/OpenArrow'
    }
    const a: LineAnnotation = {
      id: nm,
      kind: isArrow ? 'arrow' : 'line',
      x1: readNumber(L.lookup(0)),
      y1: readNumber(L.lookup(1)),
      x2: readNumber(L.lookup(2)),
      y2: readNumber(L.lookup(3)),
      stroke,
      strokeWidth,
      opacity,
      author,
      created: now,
      modified: now
    }
    return a
  }
  if (subtype === '/FreeText') {
    const x1 = readNumber(rectNode.lookup(0))
    const y1 = readNumber(rectNode.lookup(1))
    const x2 = readNumber(rectNode.lookup(2))
    const y2 = readNumber(rectNode.lookup(3))
    const body = decodeText(dict.lookup(PDFName.of('Contents')))
    const da = decodeText(dict.lookup(PDFName.of('DA')))
    const parsed = parseDA(da)
    const unrot = unrotateRect(x1, y1, x2, y2, rotation)
    const a: FreeTextAnnotation = {
      id: nm,
      kind: 'freetext',
      x: unrot.x,
      y: unrot.y,
      w: unrot.w,
      h: unrot.h,
      body,
      font: parsed.font,
      fontSize: parsed.size,
      color: parsed.color,
      opacity,
      rotation: rotation || undefined,
      author,
      created: now,
      modified: now
    }
    return a
  }
  if (subtype === '/Text') {
    const x = readNumber(rectNode.lookup(0))
    const y = readNumber(rectNode.lookup(1))
    const body = decodeText(dict.lookup(PDFName.of('Contents')))
    const a: NoteAnnotation = {
      id: nm,
      kind: 'note',
      x,
      y,
      body,
      // For notes we put the icon color in /C; reuse the stroke helper.
      color: stroke,
      author,
      created: now,
      modified: now
    }
    return a
  }
  return null
}
