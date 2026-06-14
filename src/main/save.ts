import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument, degrees } from 'pdf-lib'
import type { VirtualPage } from '../shared/edit'

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
    }
    i = j
  }

  const outBytes = await out.save({ useObjectStreams: true })
  await writeFile(destPath, outBytes)
}
