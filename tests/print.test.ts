import { describe, it, expect } from 'vitest'
import {
  buildLpArgs,
  parseJobId,
  parseLpoptions,
  parseRangeSpec,
  selectPages
} from '../src/main/print'
import type { PrintJob } from '../src/shared/ipc'
import type { VirtualPage } from '../src/shared/edit'

const page = (i: number): VirtualPage => ({
  sourceId: '/doc.pdf',
  sourceIndex: i,
  rotation: 0
})

describe('parseRangeSpec', () => {
  it('parses single numbers', () => {
    expect(parseRangeSpec('1,3,5', 10)).toEqual([0, 2, 4])
  })
  it('parses ranges', () => {
    expect(parseRangeSpec('1-3,7-8', 10)).toEqual([0, 1, 2, 6, 7])
  })
  it('handles open-ended trailing range', () => {
    expect(parseRangeSpec('8-', 10)).toEqual([7, 8, 9])
  })
  it('clamps to pageCount', () => {
    expect(parseRangeSpec('9-99', 10)).toEqual([8, 9])
  })
  it('deduplicates and sorts', () => {
    expect(parseRangeSpec('3,1-2,3', 5)).toEqual([0, 1, 2])
  })
  it('skips malformed tokens', () => {
    expect(parseRangeSpec('abc,2,,foo-bar', 5)).toEqual([1])
  })
  it('rejects out-of-range singletons', () => {
    expect(parseRangeSpec('0,12', 5)).toEqual([])
  })
})

describe('selectPages', () => {
  const pages = Array.from({ length: 6 }, (_, i) => page(i))

  it('returns all pages for range=all', () => {
    expect(selectPages(pages, 'all', 'all', 0).length).toBe(6)
  })

  it('returns just the current page for range=current', () => {
    expect(selectPages(pages, 'current', 'all', 3)).toEqual([pages[3]])
  })

  it('applies custom range spec', () => {
    expect(selectPages(pages, { spec: '2-4' }, 'all', 0)).toEqual([
      pages[1],
      pages[2],
      pages[3]
    ])
  })

  it('filters odd subset (1-based)', () => {
    expect(selectPages(pages, 'all', 'odd', 0)).toEqual([pages[0], pages[2], pages[4]])
  })

  it('filters even subset (1-based)', () => {
    expect(selectPages(pages, 'all', 'even', 0)).toEqual([pages[1], pages[3], pages[5]])
  })
})

describe('parseLpoptions', () => {
  it('parses key, label, values, and default', () => {
    const text = [
      'Duplex/Two-Sided Printing: None *DuplexNoTumble DuplexTumble',
      'PageSize/Media Size: *A4 Letter Legal'
    ].join('\n')
    const opts = parseLpoptions(text)
    expect(opts).toHaveLength(2)
    expect(opts[0]).toMatchObject({
      key: 'Duplex',
      label: 'Two-Sided Printing',
      default: 'DuplexNoTumble'
    })
    expect(opts[0].values).toEqual(['None', 'DuplexNoTumble', 'DuplexTumble'])
    expect(opts[1].default).toBe('A4')
  })

  it('falls back to first value when no default marked', () => {
    const opts = parseLpoptions('ColorModel/Output Mode: Gray RGB')
    expect(opts[0].default).toBe('Gray')
  })

  it('handles lines without a friendly label', () => {
    const opts = parseLpoptions('Resolution: 600dpi *1200dpi')
    expect(opts[0].key).toBe('Resolution')
    expect(opts[0].label).toBe('Resolution')
    expect(opts[0].default).toBe('1200dpi')
  })

  it('skips blank / malformed lines', () => {
    expect(parseLpoptions('\n\n   \nno colon here\n')).toEqual([])
  })
})

describe('buildLpArgs', () => {
  const basicJob: PrintJob = {
    printerName: 'HP',
    pages: [page(0)],
    sources: { '/doc.pdf': '/doc.pdf' },
    copies: 1
  }

  it('emits just -d and the file for a minimal job', () => {
    expect(buildLpArgs(basicJob, '/tmp/x.pdf')).toEqual(['-d', 'HP', '/tmp/x.pdf'])
  })

  it('includes copies when > 1', () => {
    const args = buildLpArgs({ ...basicJob, copies: 3 }, '/tmp/x.pdf')
    expect(args.slice(0, 4)).toEqual(['-d', 'HP', '-n', '3'])
  })

  it('forwards CUPS options via -o pairs', () => {
    const args = buildLpArgs(
      {
        ...basicJob,
        duplex: 'DuplexNoTumble',
        media: 'A4',
        colorModel: 'Gray',
        orientation: 'landscape',
        scaling: 'fit'
      },
      '/tmp/x.pdf'
    )
    expect(args).toContain('Duplex=DuplexNoTumble')
    expect(args).toContain('media=A4')
    expect(args).toContain('ColorModel=Gray')
    expect(args).toContain('orientation-requested=4')
    expect(args).toContain('fit-to-page')
    expect(args[args.length - 1]).toBe('/tmp/x.pdf')
  })

  it('uses scaling=N for a custom percent', () => {
    const args = buildLpArgs({ ...basicJob, scaling: 75 }, '/tmp/x.pdf')
    expect(args).toContain('scaling=75')
  })

  it('omits scaling option for actual size', () => {
    const args = buildLpArgs({ ...basicJob, scaling: 'actual' }, '/tmp/x.pdf')
    expect(args.some((a) => a.startsWith('scaling') || a === 'fit-to-page')).toBe(false)
  })
})

describe('parseJobId', () => {
  it('extracts the id from lp stdout', () => {
    expect(parseJobId('request id is HP-123 (1 file(s))\n')).toBe('HP-123')
  })
  it('returns null when missing', () => {
    expect(parseJobId('???')).toBeNull()
  })
})
