/**
 * Integration test for the pdf-lib bake path: round-trip a generated PDF
 * through a few edits and verify the output reflects them.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { saveDoc } from '../src/main/save'

let workDir: string
let inputPath: string

async function makeMultiPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([400, 300])
    page.drawText(`Page ${i + 1}`, { x: 50, y: 200, size: 24, font })
  }
  // Pre-rotate page index 2 by 90° to verify we preserve source rotation when
  // composing with our delta.
  doc.getPage(2).setRotation(degrees(90))
  return doc.save()
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'preview-save-'))
  inputPath = join(workDir, 'input.pdf')
  await writeFile(inputPath, await makeMultiPagePdf())
})

describe('saveDoc', () => {
  it('writes a 4-page identity copy', async () => {
    const out = join(workDir, 'identity.pdf')
    await saveDoc(inputPath, out, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 3, rotation: 0 }
    ])
    const bytes = await readFile(out)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(4)
  })

  it('deletes pages by omitting them from the spec', async () => {
    const out = join(workDir, 'deleted.pdf')
    await saveDoc(inputPath, out, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 3, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(2)
  })

  it('reorders pages by changing source-index order', async () => {
    const out = join(workDir, 'reordered.pdf')
    await saveDoc(inputPath, out, [
      { sourceIndex: 3, rotation: 0 },
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(4)
    // We can't read text directly via pdf-lib, but the page count + a
    // successful load are a meaningful smoke test for reorder.
  })

  it('records absolute rotation = src + delta', async () => {
    const out = join(workDir, 'rotated.pdf')
    await saveDoc(inputPath, out, [
      { sourceIndex: 0, rotation: 90 }, // src 0  + 90  = 90
      { sourceIndex: 1, rotation: 180 }, // src 0  + 180 = 180
      { sourceIndex: 2, rotation: 90 }, // src 90 + 90  = 180
      { sourceIndex: 3, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(180)
    expect(doc.getPage(2).getRotation().angle).toBe(180)
    expect(doc.getPage(3).getRotation().angle).toBe(0)
  })

  it('survives a no-op when source equals dest path', async () => {
    // Round-trip in place using a copy
    const inPlace = join(workDir, 'inplace.pdf')
    await writeFile(inPlace, await readFile(inputPath))
    await saveDoc(inPlace, inPlace, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(inPlace))
    expect(doc.getPageCount()).toBe(2)
  })

  it('cleanup', async () => {
    await rm(workDir, { recursive: true, force: true })
  })
})
