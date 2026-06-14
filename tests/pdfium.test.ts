/**
 * Integration test: generate a tiny PDF with pdf-lib, then verify our
 * PDFium-WASM wrapper can open it, report page sizes, render to RGBA,
 * extract text, and find char-box rects for a query.
 *
 * Slower than the pure unit tests (~1s for WASM init).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  closeDoc,
  findMatchRects,
  getAllPageSizes,
  getPageText,
  openDoc,
  renderPage
} from '../src/main/pdfium'

async function makeHelloPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([300, 200])
  page.drawText('Hello World', { x: 50, y: 100, size: 24, font })
  // Add a second page with different content for multi-page tests.
  const p2 = doc.addPage([400, 300])
  p2.drawText('Second Page', { x: 30, y: 150, size: 18, font })
  return doc.save()
}

describe('pdfium integration', () => {
  const id = '/test/hello.pdf'
  let pdfBytes: Uint8Array

  beforeAll(async () => {
    pdfBytes = await makeHelloPdf()
  })

  it('openDoc returns the page count and caches page sizes', async () => {
    const n = await openDoc(id, pdfBytes)
    expect(n).toBe(2)
    const sizes = getAllPageSizes(id)
    expect(sizes).toHaveLength(2)
    expect(sizes![0].width).toBeCloseTo(300, 0)
    expect(sizes![0].height).toBeCloseTo(200, 0)
    expect(sizes![1].width).toBeCloseTo(400, 0)
    expect(sizes![1].height).toBeCloseTo(300, 0)
  })

  it('renderPage returns RGBA bytes of expected dimensions', async () => {
    const r = await renderPage(id, 0, 2)
    expect(r).not.toBeNull()
    expect(r!.width).toBe(600) // 300 × 2
    expect(r!.height).toBe(400) // 200 × 2
    expect(r!.data.length).toBe(600 * 400 * 4)
    // First page has white background → first pixel near white.
    // (top-left corner is outside any drawn text)
    expect(r!.data[0]).toBeGreaterThan(240)
    expect(r!.data[1]).toBeGreaterThan(240)
    expect(r!.data[2]).toBeGreaterThan(240)
    expect(r!.data[3]).toBe(255)
  })

  it('renderPage produces non-uniform output (text was actually drawn)', async () => {
    const r = await renderPage(id, 0, 2)
    expect(r).not.toBeNull()
    const data = r!.data
    let hasContent = false
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) {
        hasContent = true
        break
      }
    }
    expect(hasContent).toBe(true)
  })

  it('renderPage with 90° rotation swaps output dimensions', async () => {
    const r = await renderPage(id, 0, 1, 90)
    expect(r).not.toBeNull()
    // Page 0 is 300x200; rotated 90° should be 200x300.
    expect(r!.width).toBe(200)
    expect(r!.height).toBe(300)
  })

  it('getPageText extracts text we wrote', async () => {
    const t1 = await getPageText(id, 0)
    expect(t1?.toLowerCase()).toContain('hello world')
    const t2 = await getPageText(id, 1)
    expect(t2?.toLowerCase()).toContain('second page')
  })

  it('findMatchRects locates the search term on the right page', async () => {
    const r1 = await findMatchRects(id, 0, 'Hello')
    expect(r1).not.toBeNull()
    expect(r1!.length).toBeGreaterThan(0)
    // The rect should be inside the page bounds and near where we drew it
    // (y=100 from bottom-left, page height=200 → top-left y ≈ 100 - text height).
    const rect = r1![0]
    expect(rect.x).toBeGreaterThan(0)
    expect(rect.x).toBeLessThan(300)
    expect(rect.y).toBeGreaterThan(0)
    expect(rect.y).toBeLessThan(200)
    expect(rect.w).toBeGreaterThan(0)
    expect(rect.h).toBeGreaterThan(0)
  })

  it('findMatchRects returns empty for missing term', async () => {
    const r = await findMatchRects(id, 0, 'nopenotaword')
    expect(r).toEqual([])
  })

  it('findMatchRects is case-insensitive', async () => {
    const r = await findMatchRects(id, 0, 'HELLO')
    expect(r!.length).toBeGreaterThan(0)
  })

  it('findMatchRects on the wrong page returns empty', async () => {
    const r = await findMatchRects(id, 1, 'Hello World')
    expect(r).toEqual([])
  })

  it('closeDoc removes the doc from the open set', async () => {
    closeDoc(id)
    // Give the async close a tick to settle.
    await new Promise((r) => setTimeout(r, 50))
    expect(getAllPageSizes(id)).toBeNull()
  })
})
