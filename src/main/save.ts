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
import { parseHexColor, type Annotation } from '../shared/annotations'

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
      const anns = batch[k].annotations
      if (anns && anns.length > 0) writeAnnotations(page, anns)
    }
    i = j
  }

  const outBytes = await out.save({ useObjectStreams: true })
  await writeFile(destPath, outBytes)
}

/** Append our annotations to a copied output page as standard PDF annot dicts. */
function writeAnnotations(page: PDFPage, anns: Annotation[]): void {
  const ctx = page.doc.context
  // Existing /Annots, if any — preserve them.
  const node = page.node
  const existing = node.Annots()
  const arr = existing instanceof PDFArray ? existing : ctx.obj([])

  for (const a of anns) {
    if (a.kind !== 'rect' && a.kind !== 'oval') continue
    const x1 = a.x
    const y1 = a.y
    const x2 = a.x + a.w
    const y2 = a.y + a.h
    const rgb = parseHexColor(a.stroke) ?? [0.8, 0.2, 0.2]
    const subtype = a.kind === 'oval' ? 'Circle' : 'Square'
    const dict = ctx.obj({
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
