import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument, degrees } from 'pdf-lib'
import type { VirtualPage } from '../shared/edit'

/**
 * Bake a virtual-page edit graph onto disk via pdf-lib.
 *
 * We re-create the document from scratch: copy the requested source pages in
 * the requested order, and write our rotation as an absolute /Rotate value
 * (source page's own rotation + our delta).
 */
export async function saveDoc(
  sourcePath: string,
  destPath: string,
  pages: VirtualPage[]
): Promise<void> {
  const bytes = await readFile(sourcePath)
  const src = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()

  // Carry over basic metadata so the saved file isn't anonymous.
  try {
    if (src.getTitle()) out.setTitle(src.getTitle()!)
    if (src.getAuthor()) out.setAuthor(src.getAuthor()!)
    if (src.getSubject()) out.setSubject(src.getSubject()!)
    if (src.getCreator()) out.setCreator(src.getCreator()!)
  } catch {
    // metadata is best-effort
  }
  out.setProducer('Preview-for-Linux')
  out.setModificationDate(new Date())

  // copyPages can take a batch; the result preserves order. We do one batch
  // for efficiency.
  const indices = pages.map((p) => p.sourceIndex)
  const copied = await out.copyPages(src, indices)
  for (let i = 0; i < copied.length; i++) {
    const page = copied[i]
    const srcRot = src.getPage(pages[i].sourceIndex).getRotation().angle
    const absolute = (srcRot + pages[i].rotation) % 360
    page.setRotation(degrees(absolute))
    out.addPage(page)
  }

  const outBytes = await out.save({ useObjectStreams: true })
  await writeFile(destPath, outBytes)
}
