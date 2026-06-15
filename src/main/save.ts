import { readFile, writeFile } from 'node:fs/promises'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  type PDFContext,
  type PDFPage
} from 'pdf-lib'
import type { VirtualPage } from '../shared/edit'
import {
  FREETEXT_LINE_HEIGHT,
  NOTE_SIZE_PT,
  OWN_NM_PREFIX,
  lineBBox,
  parseHexColor,
  rotatePoint,
  type Annotation,
  type FreeTextAnnotation,
  type FreeTextFont
} from '../shared/annotations'
import { PDFBool, PDFDict } from 'pdf-lib'

/**
 * Bake a (possibly multi-source) virtual-page edit graph onto disk via pdf-lib.
 *
 * `sources` maps sourceId → file path. Every page in `pages` must reference a
 * sourceId present in that map. We copy each page from its source PDF in
 * order, and write rotation as an absolute /Rotate value (source page's own
 * rotation + our delta).
 */
export async function saveDoc(
  sources: Record<string, string>,
  destPath: string,
  pages: VirtualPage[]
): Promise<void> {
  // Load each unique source once. Order doesn't matter; we'll look up by id.
  const uniqueIds = [...new Set(pages.map((p) => p.sourceId))]
  const loaded = new Map<string, PDFDocument>()
  for (const id of uniqueIds) {
    const path = sources[id]
    if (!path) throw new Error(`No path registered for source ${id}`)
    const bytes = await readFile(path)
    loaded.set(id, await PDFDocument.load(bytes))
  }

  const out = await PDFDocument.create()

  // Carry over basic metadata from the FIRST source the pages reference.
  const firstSrc = loaded.get(pages[0]?.sourceId ?? '')
  if (firstSrc) {
    try {
      if (firstSrc.getTitle()) out.setTitle(firstSrc.getTitle()!)
      if (firstSrc.getAuthor()) out.setAuthor(firstSrc.getAuthor()!)
      if (firstSrc.getSubject()) out.setSubject(firstSrc.getSubject()!)
      if (firstSrc.getCreator()) out.setCreator(firstSrc.getCreator()!)
    } catch {
      // metadata is best-effort
    }
  }
  out.setProducer('Preview-for-Linux')
  out.setModificationDate(new Date())

  // Group consecutive pages from the same source into batches so we can use
  // copyPages with multiple indices at once.
  let i = 0
  while (i < pages.length) {
    const id = pages[i].sourceId
    let j = i
    while (j < pages.length && pages[j].sourceId === id) j++
    const src = loaded.get(id)!
    const batch = pages.slice(i, j)
    const indices = batch.map((p) => p.sourceIndex)
    const copied = await out.copyPages(src, indices)
    for (let k = 0; k < copied.length; k++) {
      const page = copied[k]
      const srcRot = src.getPage(batch[k].sourceIndex).getRotation().angle
      const absolute = (srcRot + batch[k].rotation) % 360
      page.setRotation(degrees(absolute))
      out.addPage(page)
      // copyPages brings over any /Annots on the source page — including ones
      // we wrote on a previous save. Strip the ones we own so the current
      // edit graph is the single source of truth; foreign annotations are
      // left intact.
      stripOwnedAnnotations(page)
      const anns = batch[k].annotations
      if (anns && anns.length > 0) writeAnnotations(out, page, anns)
    }
    i = j
  }

  const outBytes = await out.save({ useObjectStreams: true })
  await writeFile(destPath, outBytes)
}

/** Remove annotations we recognize as our own (via /NM prefix) from a page's
 *  /Annots array. Used before re-writing so re-saves don't duplicate. */
function stripOwnedAnnotations(page: PDFPage): void {
  const annots = page.node.Annots()
  if (!(annots instanceof PDFArray)) return
  for (let i = annots.size() - 1; i >= 0; i--) {
    const entry = annots.get(i)
    const dict =
      entry instanceof PDFArray
        ? null
        : ((entry as unknown) instanceof PDFDict
            ? (entry as unknown as PDFDict)
            : page.doc.context.lookupMaybe(entry, PDFDict))
    if (!(dict instanceof PDFDict)) continue
    const nm = dict.lookup(PDFName.of('NM'))
    const nmStr =
      nm instanceof PDFHexString
        ? nm.decodeText()
        : nm instanceof PDFString
          ? nm.decodeText()
          : ''
    if (nmStr.startsWith(OWN_NM_PREFIX)) annots.remove(i)
  }
}

/** Append our annotations to a copied output page as standard PDF annot dicts. */
function writeAnnotations(doc: PDFDocument, page: PDFPage, anns: Annotation[]): void {
  const ctx = page.doc.context
  // Existing /Annots, if any — preserve them.
  const node = page.node
  const existing = node.Annots()
  const arr = existing instanceof PDFArray ? existing : ctx.obj([])

  // Lazy per-page cache of embedded standard fonts (only built if a rotated
  // free-text annotation needs an AP stream that draws glyphs).
  const fontRefs: Partial<Record<FreeTextFont, PDFRef>> = {}
  const getFontRef = (font: FreeTextFont): PDFRef => {
    if (fontRefs[font]) return fontRefs[font]!
    const std =
      font === 'Times'
        ? StandardFonts.TimesRoman
        : font === 'Courier'
          ? StandardFonts.Courier
          : StandardFonts.Helvetica
    const f = doc.embedStandardFont(std)
    fontRefs[font] = f.ref
    return f.ref
  }

  for (const a of anns) {
    // Notes don't have a stroke — `rgb` is unused on that branch (it derives
    // its color from `a.color` instead). Compute lazily where it's actually
    // needed to keep types honest.
    let dict
    if (a.kind === 'arrow' || a.kind === 'line') {
      const rgb = parseHexColor(a.stroke) ?? [0.8, 0.2, 0.2]
      const bb = lineBBox(a)
      dict = ctx.obj({
        Type: 'Annot',
        Subtype: 'Line',
        Rect: [bb.x, bb.y, bb.x + bb.w, bb.y + bb.h],
        L: [a.x1, a.y1, a.x2, a.y2],
        LE: [PDFName.of('None'), PDFName.of(a.kind === 'arrow' ? 'OpenArrow' : 'None')],
        C: rgb,
        F: 4,
        BS: ctx.obj({ Type: 'Border', W: a.strokeWidth, S: PDFName.of('S') }),
        M: PDFString.of(toPdfDate(new Date(a.modified))),
        T: a.author ? PDFHexString.fromText(a.author) : undefined,
        NM: PDFString.of(a.id)
      })
      if (!a.author) dict.delete(PDFName.of('T'))
      dict.set(PDFName.of('CA'), PDFNumber.of(a.opacity))
    } else if (a.kind === 'note') {
      const x1 = a.x
      const y1 = a.y
      const x2 = a.x + NOTE_SIZE_PT
      const y2 = a.y + NOTE_SIZE_PT
      const noteRgb = parseHexColor(a.color) ?? [1, 0.88, 0.4]
      dict = ctx.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [x1, y1, x2, y2],
        Contents: PDFHexString.fromText(a.body),
        Name: PDFName.of('Note'),
        Open: PDFBool.False,
        C: noteRgb,
        F: 4,
        M: PDFString.of(toPdfDate(new Date(a.modified))),
        T: a.author ? PDFHexString.fromText(a.author) : undefined,
        NM: PDFString.of(a.id)
      })
      if (!a.author) dict.delete(PDFName.of('T'))
    } else if (a.kind === 'freetext') {
      const rgb = parseHexColor(a.color) ?? [0, 0, 0]
      const rot = a.rotation ?? 0
      const bb = rotatedBBox(a.x, a.y, a.w, a.h, rot)
      // DA = default appearance: `/<fontTag> <size> Tf  r g b rg`. Acrobat /
      // Preview / Okular all read this on open to pick the font + color when
      // they regenerate the appearance stream.
      const da = `/${fontTag(a.font)} ${a.fontSize} Tf ${rgb[0]} ${rgb[1]} ${rgb[2]} rg`
      dict = ctx.obj({
        Type: 'Annot',
        Subtype: 'FreeText',
        Rect: [bb.x, bb.y, bb.x + bb.w, bb.y + bb.h],
        Contents: PDFHexString.fromText(a.body),
        DA: PDFString.of(da),
        Q: 0,
        F: 4,
        M: PDFString.of(toPdfDate(new Date(a.modified))),
        T: a.author ? PDFHexString.fromText(a.author) : undefined,
        NM: PDFString.of(a.id)
      })
      if (!a.author) dict.delete(PDFName.of('T'))
      dict.set(PDFName.of('CA'), PDFNumber.of(a.opacity))
      if (rot !== 0) {
        dict.set(PDFName.of('PdfRotation'), PDFNumber.of(rot))
        attachFreeTextAppearance(ctx, dict, a, bb, getFontRef(a.font))
      }
    } else if (a.kind === 'rect' || a.kind === 'oval') {
      const rgb = parseHexColor(a.stroke) ?? [0.8, 0.2, 0.2]
      const rot = a.rotation ?? 0
      const bb = rotatedBBox(a.x, a.y, a.w, a.h, rot)
      const subtype = a.kind === 'oval' ? 'Circle' : 'Square'
      dict = ctx.obj({
        Type: 'Annot',
        Subtype: subtype,
        Rect: [bb.x, bb.y, bb.x + bb.w, bb.y + bb.h],
        C: rgb,
        CA: a.opacity,
        F: 4,
        BS: ctx.obj({ Type: 'Border', W: a.strokeWidth, S: PDFName.of('S') }),
        M: PDFString.of(toPdfDate(new Date(a.modified))),
        T: a.author ? PDFHexString.fromText(a.author) : undefined,
        NM: PDFString.of(a.id)
      })
      if (!a.author) dict.delete(PDFName.of('T'))
      dict.set(PDFName.of('CA'), PDFNumber.of(a.opacity))
      if (a.fill) {
        const fillRgb = parseHexColor(a.fill)
        if (fillRgb) dict.set(PDFName.of('IC'), ctx.obj(fillRgb))
      }
      if (rot !== 0) {
        dict.set(PDFName.of('PdfRotation'), PDFNumber.of(rot))
        attachShapeAppearance(ctx, dict, a, bb)
      }
    } else {
      continue
    }
    arr.push(dict)
  }
  node.set(PDFName.of('Annots'), arr)
}

/** Map our font name to a PDF resource tag used in the /DA string. The
 *  tags we pick are the conventional ones Acrobat uses for the same
 *  Standard-14 families — viewers recognize them without needing a /DR. */
function fontTag(font: FreeTextFont): string {
  switch (font) {
    case 'Times':
      return 'TiRo'
    case 'Courier':
      return 'Cour'
    default:
      return 'Helv'
  }
}

function toPdfDate(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Axis-aligned bbox in page coords for an annotation that is rotated by
 *  `rot` radians (CCW) around the bbox center. Returns the same bbox unchanged
 *  for rot=0. */
function rotatedBBox(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number
): { x: number; y: number; w: number; h: number } {
  if (rot === 0) return { x, y, w, h }
  const cx = x + w / 2
  const cy = y + h / 2
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h]
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [px, py] of corners) {
    const r = rotatePoint(px, py, cx, cy, rot)
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x > maxX) maxX = r.x
    if (r.y > maxY) maxY = r.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Format a number for a PDF content stream — short, no scientific notation. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

/** Escape a string for a PDF literal `(...)` content-stream operand. */
function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Build a Form XObject (/Type/XObject/Subtype/Form) wrapping `contents`, with
 * the appearance space `[0 0 bbox.w bbox.h]`. Returns the PDFRef so callers
 * can use it as an AP /N entry.
 *
 * The bbox here is the *local* form-space bbox; pairing it with the
 * annotation's /Rect (set to the same width/height) means the appearance
 * lands in the page-space rectangle [bb.x, bb.y, bb.x+w, bb.y+h] without any
 * scale surprise from PDF's implicit BBox→Rect alignment.
 */
function buildFormXObject(
  ctx: PDFContext,
  contents: string,
  bboxW: number,
  bboxH: number,
  resources?: PDFDict
): PDFRef {
  const bytes = new TextEncoder().encode(contents)
  const dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, bboxW, bboxH],
    Resources: resources ?? ctx.obj({ ProcSet: [PDFName.of('PDF'), PDFName.of('Text')] }),
    Length: bytes.length
  }) as PDFDict
  const stream = PDFRawStream.of(dict, bytes)
  return ctx.register(stream)
}

/** Common prefix that translates to the rotated-bbox-relative center, rotates
 *  CCW by `rot`, then translates so the un-rotated rect's bottom-left is at
 *  the origin in the local coord system. Returns ops to draw the un-rotated
 *  shape with `x = 0, y = 0, w, h`. */
function rotationPrologue(
  bb: { x: number; y: number; w: number; h: number },
  innerW: number,
  innerH: number,
  rot: number
): string {
  // Local form space origin is bb's bottom-left in page coords. The shape's
  // center in form space sits at (bb.w/2, bb.h/2). Translate the un-rotated
  // shape so its center is at the form-space center, rotate, and we draw it
  // axis-aligned afterwards.
  const cx = bb.w / 2
  const cy = bb.h / 2
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // cm: a b c d e f → multiplies current matrix. We want translate(cx,cy) *
  // rotate(rot) * translate(-innerW/2, -innerH/2), composed right-to-left.
  // PDF cm composes left-to-right; combine ourselves into a single matrix.
  const a = c
  const b = s
  const cc = -s
  const d = c
  const e = cx - (c * (innerW / 2) + -s * (innerH / 2))
  const f = cy - (s * (innerW / 2) + c * (innerH / 2))
  return `${fmt(a)} ${fmt(b)} ${fmt(cc)} ${fmt(d)} ${fmt(e)} ${fmt(f)} cm\n`
}

function attachShapeAppearance(
  ctx: PDFContext,
  dict: PDFDict,
  a: Annotation & { kind: 'rect' | 'oval'; w: number; h: number },
  bb: { x: number; y: number; w: number; h: number }
): void {
  const rot = a.rotation ?? 0
  const rgb = parseHexColor(a.stroke) ?? [0.8, 0.2, 0.2]
  const fillRgb = a.fill ? parseHexColor(a.fill) : null
  let ops = `q\n${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} RG\n`
  if (fillRgb) ops += `${fmt(fillRgb[0])} ${fmt(fillRgb[1])} ${fmt(fillRgb[2])} rg\n`
  ops += `${fmt(a.strokeWidth)} w\n`
  ops += rotationPrologue(bb, a.w, a.h, rot)
  if (a.kind === 'rect') {
    ops += `0 0 ${fmt(a.w)} ${fmt(a.h)} re\n`
    ops += fillRgb ? 'B\n' : 'S\n'
  } else {
    // Approximate ellipse with 4 cubic Béziers. Magic number 0.5522847498 for
    // unit-circle Bezier approximation.
    const k = 0.5522847498
    const w2 = a.w / 2
    const h2 = a.h / 2
    const cx = w2
    const cy = h2
    ops += `${fmt(cx + w2)} ${fmt(cy)} m\n`
    ops += `${fmt(cx + w2)} ${fmt(cy + h2 * k)} ${fmt(cx + w2 * k)} ${fmt(cy + h2)} ${fmt(cx)} ${fmt(cy + h2)} c\n`
    ops += `${fmt(cx - w2 * k)} ${fmt(cy + h2)} ${fmt(cx - w2)} ${fmt(cy + h2 * k)} ${fmt(cx - w2)} ${fmt(cy)} c\n`
    ops += `${fmt(cx - w2)} ${fmt(cy - h2 * k)} ${fmt(cx - w2 * k)} ${fmt(cy - h2)} ${fmt(cx)} ${fmt(cy - h2)} c\n`
    ops += `${fmt(cx + w2 * k)} ${fmt(cy - h2)} ${fmt(cx + w2)} ${fmt(cy - h2 * k)} ${fmt(cx + w2)} ${fmt(cy)} c\n`
    ops += fillRgb ? 'B\n' : 'S\n'
  }
  ops += 'Q\n'
  const ref = buildFormXObject(ctx, ops, bb.w, bb.h)
  dict.set(PDFName.of('AP'), ctx.obj({ N: ref }))
}

function attachFreeTextAppearance(
  ctx: PDFContext,
  dict: PDFDict,
  a: FreeTextAnnotation,
  bb: { x: number; y: number; w: number; h: number },
  fontRef: PDFRef
): void {
  const rot = a.rotation ?? 0
  const rgb = parseHexColor(a.color) ?? [0, 0, 0]
  let ops = `q\n${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} rg\n`
  ops += rotationPrologue(bb, a.w, a.h, rot)
  const lineH = a.fontSize * FREETEXT_LINE_HEIGHT
  const lines = a.body.length === 0 ? [''] : a.body.split('\n')
  // PDF text origin is baseline. Draw each line so the top of its em box sits
  // at (a.h - i*lineH); approximate baseline at (top - fontSize * 0.8).
  ops += 'BT\n'
  ops += `/F1 ${fmt(a.fontSize)} Tf\n`
  for (let i = 0; i < lines.length; i++) {
    const baseline = a.h - i * lineH - a.fontSize * 0.85
    if (baseline < -lineH) break
    ops += `1 0 0 1 0 ${fmt(baseline)} Tm\n`
    ops += `(${escapeStr(lines[i])}) Tj\n`
  }
  ops += 'ET\nQ\n'
  const resources = ctx.obj({
    Font: ctx.obj({ F1: fontRef }),
    ProcSet: [PDFName.of('PDF'), PDFName.of('Text')]
  })
  const ref = buildFormXObject(ctx, ops, bb.w, bb.h, resources)
  dict.set(PDFName.of('AP'), ctx.obj({ N: ref }))
}
