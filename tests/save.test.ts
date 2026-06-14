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
let inputA: string
let inputB: string

async function makeMultiPagePdf(label: string, count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([400, 300])
    page.drawText(`${label} ${i + 1}`, { x: 50, y: 200, size: 24, font })
  }
  doc.getPage(2).setRotation(degrees(90))
  return doc.save()
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'preview-save-'))
  inputA = join(workDir, 'inputA.pdf')
  inputB = join(workDir, 'inputB.pdf')
  await writeFile(inputA, await makeMultiPagePdf('A', 4))
  await writeFile(inputB, await makeMultiPagePdf('B', 3))
})

describe('saveDoc (single source)', () => {
  it('writes a 4-page identity copy', async () => {
    const out = join(workDir, 'identity.pdf')
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0 },
      { sourceId: inputA, sourceIndex: 1, rotation: 0 },
      { sourceId: inputA, sourceIndex: 2, rotation: 0 },
      { sourceId: inputA, sourceIndex: 3, rotation: 0 }
    ])
    const bytes = await readFile(out)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(4)
  })

  it('deletes pages by omitting them from the spec', async () => {
    const out = join(workDir, 'deleted.pdf')
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0 },
      { sourceId: inputA, sourceIndex: 3, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(2)
  })

  it('reorders pages by changing source-index order', async () => {
    const out = join(workDir, 'reordered.pdf')
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 3, rotation: 0 },
      { sourceId: inputA, sourceIndex: 0, rotation: 0 },
      { sourceId: inputA, sourceIndex: 1, rotation: 0 },
      { sourceId: inputA, sourceIndex: 2, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(4)
  })

  it('records absolute rotation = src + delta', async () => {
    const out = join(workDir, 'rotated.pdf')
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 90 },
      { sourceId: inputA, sourceIndex: 1, rotation: 180 },
      { sourceId: inputA, sourceIndex: 2, rotation: 90 },
      { sourceId: inputA, sourceIndex: 3, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(180)
    expect(doc.getPage(2).getRotation().angle).toBe(180)
    expect(doc.getPage(3).getRotation().angle).toBe(0)
  })

  it('survives a no-op when source equals dest path', async () => {
    const inPlace = join(workDir, 'inplace.pdf')
    await writeFile(inPlace, await readFile(inputA))
    await saveDoc({ [inPlace]: inPlace }, inPlace, [
      { sourceId: inPlace, sourceIndex: 0, rotation: 0 },
      { sourceId: inPlace, sourceIndex: 1, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(inPlace))
    expect(doc.getPageCount()).toBe(2)
  })
})

describe('saveDoc (multi-source)', () => {
  it('merges pages from two source PDFs in order', async () => {
    const out = join(workDir, 'merged.pdf')
    await saveDoc({ [inputA]: inputA, [inputB]: inputB }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0 },
      { sourceId: inputB, sourceIndex: 0, rotation: 0 },
      { sourceId: inputA, sourceIndex: 1, rotation: 0 },
      { sourceId: inputB, sourceIndex: 2, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(4)
  })

  it('interleaved sources still apply rotation correctly', async () => {
    const out = join(workDir, 'interleaved.pdf')
    await saveDoc({ [inputA]: inputA, [inputB]: inputB }, out, [
      { sourceId: inputB, sourceIndex: 0, rotation: 90 },
      { sourceId: inputA, sourceIndex: 2, rotation: 90 } // src page 2 already has 90 rotation → absolute 180
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(180)
  })

  it('rejects pages referencing an unregistered source', async () => {
    const out = join(workDir, 'bad.pdf')
    await expect(
      saveDoc({ [inputA]: inputA }, out, [
        { sourceId: inputA, sourceIndex: 0, rotation: 0 },
        { sourceId: inputB, sourceIndex: 0, rotation: 0 }
      ])
    ).rejects.toThrow(/No path registered/)
  })
})

describe('saveDoc cleanup', () => {

  it('cleanup', async () => {
    await rm(workDir, { recursive: true, force: true })
  })
})

