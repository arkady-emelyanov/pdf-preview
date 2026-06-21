import { nativeImage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderPage } from './pdfium'
import type { VirtualPage } from '../shared/edit'

/**
 * Render the current edit graph one page at a time and write PNGs to dir.
 *
 * Filenames are `<base>-001.png`, `<base>-002.png`, … using the destination
 * file basename as the prefix; padding is sized to the page count so file
 * managers sort numerically.
 */
export async function exportPagesAsImages(
  pages: VirtualPage[],
  dir: string,
  basename: string,
  scale = 2
): Promise<void> {
  const pad = String(pages.length).length
  for (let i = 0; i < pages.length; i++) {
    const vp = pages[i]
    const rendered = await renderPage(vp.sourceId, vp.sourceIndex, scale, vp.rotation, true)
    if (!rendered) continue
    const png = encodePng(rendered.data, rendered.width, rendered.height)
    const name = `${basename}-${String(i + 1).padStart(pad, '0')}.png`
    await writeFile(join(dir, name), png)
  }
}

/**
 * Encode an RGBA pixel buffer as PNG. PDFium hands us RGBA (we set
 * FPDF_REVERSE_BYTE_ORDER); Electron's nativeImage.createFromBitmap expects
 * BGRA, so we swap the R and B channels into a fresh buffer before handing
 * it off. Cheap relative to the actual export and avoids pulling in a PNG
 * library or hand-rolling one with our own CRC tables.
 */
function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const bgra = Buffer.allocUnsafe(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2]
    bgra[i + 1] = rgba[i + 1]
    bgra[i + 2] = rgba[i]
    bgra[i + 3] = rgba[i + 3]
  }
  const img = nativeImage.createFromBitmap(bgra, { width, height })
  return img.toPNG()
}
