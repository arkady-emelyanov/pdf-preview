import { readFile, writeFile } from 'node:fs/promises'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  degrees,
  type PDFPage
} from 'pdf-lib'
import type { VirtualPage } from '../shared/edit'
import {
  NOTE_SIZE_PT,
  OWN_NM_PREFIX,
  lineBBox,
  parseHexColor,
  type Annotation
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
      if (anns && anns.length > 0) writeAnnotations(page, anns)
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
function writeAnnotations(page: PDFPage, anns: Annotation[]): void {
  const ctx = page.doc.context
  // Existing /Annots, if any — preserve them.
  const node = page.node
  const existing = node.Annots()
  const arr = existing instanceof PDFArray ? existing : ctx.obj([])

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
    } else if (a.kind === 'rect' || a.kind === 'oval') {
      const rgb = parseHexColor(a.stroke) ?? [0.8, 0.2, 0.2]
      const x1 = a.x
      const y1 = a.y
      const x2 = a.x + a.w
      const y2 = a.y + a.h
      const subtype = a.kind === 'oval' ? 'Circle' : 'Square'
      dict = ctx.obj({
        Type: 'Annot',
        Subtype: subtype,
        Rect: [x1, y1, x2, y2],
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
    } else {
      continue
    }
    arr.push(dict)
  }
  node.set(PDFName.of('Annots'), arr)
}

function toPdfDate(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}
