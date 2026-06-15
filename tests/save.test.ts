/**
 * Integration test for the pdf-lib bake path: round-trip a generated PDF
 * through a few edits and verify the output reflects them.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib'
import { saveDoc } from '../src/main/save'
import { makeBox, makeLine, makeNote, makeRect } from '../src/shared/annotations'
import { loadAnnotations } from '../src/main/loadAnnotations'

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

describe('saveDoc (annotations)', () => {
  it('writes a /Square annotation for a rect on a page', async () => {
    const out = join(workDir, 'with-annot.pdf')
    const ann = makeRect({ x: 50, y: 60, w: 120, h: 80, stroke: '#ff0000', strokeWidth: 3 })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [ann] },
      { sourceId: inputA, sourceIndex: 1, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(2)

    const annotsRef = doc.getPage(0).node.Annots()
    expect(annotsRef).toBeInstanceOf(PDFArray)
    const annots = annotsRef as PDFArray
    expect(annots.size()).toBe(1)
    const dict = annots.lookup(0, PDFDict)
    expect(dict.lookup(PDFName.of('Subtype'))?.toString()).toBe('/Square')
    const rect = dict.lookup(PDFName.of('Rect'), PDFArray)
    expect(rect.size()).toBe(4)
    // [x1, y1, x2, y2]
    expect(rect.lookup(0).toString()).toBe('50')
    expect(rect.lookup(1).toString()).toBe('60')
    expect(rect.lookup(2).toString()).toBe('170')
    expect(rect.lookup(3).toString()).toBe('140')

    // Color components serialized as 0..1.
    const color = dict.lookup(PDFName.of('C'), PDFArray)
    expect(color.size()).toBe(3)
    expect(Number(color.lookup(0).toString())).toBeCloseTo(1, 5)
  })

  it('writes a /Line annotation for an arrow with LE [/None /OpenArrow]', async () => {
    const out = join(workDir, 'with-arrow.pdf')
    const ann = makeLine('arrow', {
      x1: 30,
      y1: 40,
      x2: 200,
      y2: 100,
      stroke: '#00ff00',
      strokeWidth: 2
    })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [ann] }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    const arr = doc.getPage(0).node.Annots() as PDFArray
    const dict = arr.lookup(0, PDFDict)
    expect(dict.lookup(PDFName.of('Subtype'))?.toString()).toBe('/Line')
    const L = dict.lookup(PDFName.of('L'), PDFArray)
    expect(L.size()).toBe(4)
    expect(Number(L.lookup(0).toString())).toBe(30)
    expect(Number(L.lookup(1).toString())).toBe(40)
    expect(Number(L.lookup(2).toString())).toBe(200)
    expect(Number(L.lookup(3).toString())).toBe(100)
    const LE = dict.lookup(PDFName.of('LE'), PDFArray)
    expect(LE.size()).toBe(2)
    expect(LE.lookup(0).toString()).toBe('/None')
    expect(LE.lookup(1).toString()).toBe('/OpenArrow')
  })

  it('writes a /Circle annotation for an oval and includes /IC when filled', async () => {
    const out = join(workDir, 'with-oval.pdf')
    const ann = makeBox('oval', {
      x: 10,
      y: 10,
      w: 100,
      h: 100,
      stroke: '#0000ff',
      fill: '#ff0000'
    })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [ann] }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    const arr = doc.getPage(0).node.Annots() as PDFArray
    const dict = arr.lookup(0, PDFDict)
    expect(dict.lookup(PDFName.of('Subtype'))?.toString()).toBe('/Circle')
    const ic = dict.lookup(PDFName.of('IC'), PDFArray)
    expect(ic.size()).toBe(3)
    expect(Number(ic.lookup(0).toString())).toBeCloseTo(1, 5)
    expect(Number(ic.lookup(1).toString())).toBeCloseTo(0, 5)
  })

  it('writes a /Text annotation for a sticky note with body in /Contents', async () => {
    const out = join(workDir, 'with-note.pdf')
    const ann = makeNote({ x: 100, y: 100, body: 'Review this paragraph', color: '#ff8800' })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [ann] }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    const arr = doc.getPage(0).node.Annots() as PDFArray
    const dict = arr.lookup(0, PDFDict)
    expect(dict.lookup(PDFName.of('Subtype'))?.toString()).toBe('/Text')
    expect(dict.lookup(PDFName.of('Name'))?.toString()).toBe('/Note')
    // /Contents stores the body. pdf-lib's PDFHexString decodes to text via decodeText().
    const contents = dict.lookup(PDFName.of('Contents'))
    expect(contents).toBeDefined()
    // The decoded text round-trips through PDFHexString.
    // toString() on a PDFHexString gives the raw <hex>; decode it manually.
    const raw = contents!.toString()
    expect(raw.startsWith('<') && raw.endsWith('>')).toBe(true)
    const hex = raw.slice(1, -1)
    // BOM-prefixed UTF-16BE — pdf-lib's PDFHexString.fromText output.
    const bytes = Buffer.from(hex, 'hex')
    expect(bytes[0]).toBe(0xfe)
    expect(bytes[1]).toBe(0xff)
    // PDF stores UTF-16BE; Node's toString('utf16le') expects little-endian, so
    // swap byte pairs first.
    const body = bytes.subarray(2)
    const swapped = Buffer.alloc(body.length)
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1]
      swapped[i + 1] = body[i]
    }
    expect(swapped.toString('utf16le')).toBe('Review this paragraph')
    // Rect is icon-sized.
    const rect = dict.lookup(PDFName.of('Rect'), PDFArray)
    expect(Number(rect.lookup(0).toString())).toBe(100)
    expect(Number(rect.lookup(1).toString())).toBe(100)
    // Color (orange) — first channel near 1.
    const c = dict.lookup(PDFName.of('C'), PDFArray)
    expect(Number(c.lookup(0).toString())).toBeCloseTo(1, 5)
  })

  it('page without annotations has 0-length or absent /Annots', async () => {
    const out = join(workDir, 'no-annot.pdf')
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0 }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    const annots = doc.getPage(0).node.Annots()
    if (annots instanceof PDFArray) expect(annots.size()).toBe(0)
  })
})

describe('loadAnnotations round-trip', () => {
  it('reads back rect / oval / arrow / note from a saved file', async () => {
    const out = join(workDir, 'mixed-annots.pdf')
    const rect = makeRect({ x: 10, y: 10, w: 50, h: 30, stroke: '#ff0000', strokeWidth: 3 })
    const oval = makeBox('oval', { x: 100, y: 50, w: 60, h: 40, stroke: '#00ff00', fill: '#aaffaa' })
    const arrow = makeLine('arrow', { x1: 10, y1: 100, x2: 90, y2: 150, stroke: '#0000ff' })
    const note = makeNote({ x: 200, y: 80, body: 'hello', color: '#ffaa00' })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [rect, oval, arrow, note] }
    ])
    const loaded = await loadAnnotations(out)
    expect(loaded[0]).toHaveLength(4)
    const byKind = Object.fromEntries(loaded[0].map((a) => [a.kind, a]))
    expect(byKind.rect.id).toBe(rect.id)
    expect(byKind.oval.id).toBe(oval.id)
    expect(byKind.arrow.id).toBe(arrow.id)
    expect(byKind.note.id).toBe(note.id)
    expect((byKind.note as { body: string }).body).toBe('hello')
    expect((byKind.oval as { fill?: string }).fill).toBe('#aaffaa')
    expect((byKind.arrow as { x1: number; x2: number }).x1).toBe(10)
    expect((byKind.arrow as { x1: number; x2: number }).x2).toBe(90)
  })

  it('skips foreign annotations (no /NM with our prefix)', async () => {
    // Inject a synthetic foreign annotation into inputA and verify the loader
    // ignores it.
    const src = await PDFDocument.load(await readFile(inputA))
    const page = src.getPage(0)
    const ctx = src.context
    const foreign = ctx.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [10, 10, 20, 20],
      NM: 'other-tool-id'
    })
    page.node.set(PDFName.of('Annots'), ctx.obj([foreign]))
    const foreignPath = join(workDir, 'foreign.pdf')
    await writeFile(foreignPath, await src.save())
    const loaded = await loadAnnotations(foreignPath)
    expect(loaded[0]).toEqual([])
  })

  it('save → load → save → load keeps exactly one of each annotation', async () => {
    const out = join(workDir, 'resave.pdf')
    const rect = makeRect({ x: 0, y: 0, w: 50, h: 30 })
    await saveDoc({ [inputA]: inputA }, out, [
      { sourceId: inputA, sourceIndex: 0, rotation: 0, annotations: [rect] }
    ])
    const first = await loadAnnotations(out)
    expect(first[0]).toHaveLength(1)
    // Re-save through saveDoc using `out` as the source (the round-trip path
    // the renderer goes through after reopening a file it edited).
    await saveDoc({ [out]: out }, out, [
      { sourceId: out, sourceIndex: 0, rotation: 0, annotations: first[0] }
    ])
    const second = await loadAnnotations(out)
    expect(second[0]).toHaveLength(1)
    expect(second[0][0].id).toBe(rect.id)
  })

  it('save preserves a foreign annotation alongside our edits', async () => {
    const seeded = join(workDir, 'with-foreign.pdf')
    const src = await PDFDocument.load(await readFile(inputA))
    const page = src.getPage(0)
    const ctx = src.context
    const foreign = ctx.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [200, 200, 230, 230],
      NM: 'foreign-tool-marker'
    })
    page.node.set(PDFName.of('Annots'), ctx.obj([foreign]))
    await writeFile(seeded, await src.save())
    // Now save again via our pipeline with one of our annotations.
    const out = join(workDir, 'with-foreign-and-ours.pdf')
    const ours = makeRect({ x: 0, y: 0, w: 10, h: 10 })
    await saveDoc({ [seeded]: seeded }, out, [
      { sourceId: seeded, sourceIndex: 0, rotation: 0, annotations: [ours] }
    ])
    const doc = await PDFDocument.load(await readFile(out))
    const arr = doc.getPage(0).node.Annots() as PDFArray
    expect(arr.size()).toBe(2) // foreign survived + ours added
    // Loader only surfaces ours.
    const loaded = await loadAnnotations(out)
    expect(loaded[0]).toHaveLength(1)
    expect(loaded[0][0].id).toBe(ours.id)
  })
})

describe('saveDoc cleanup', () => {
  it('cleanup', async () => {
    await rm(workDir, { recursive: true, force: true })
  })
})

