import { describe, it, expect, beforeEach } from 'vitest'
import {
  __setFontIndexForTest,
  classify,
  key,
  readTtfTable,
  resolveByCharset,
  resolveDefault,
  resolveFontByName,
  type FontEntry
} from '../src/main/fonts'

function entry(
  family: string,
  style = 'Regular',
  file = `/fake/${family.replace(/\s+/g, '')}.ttf`
): FontEntry {
  const sty = style.toLowerCase()
  const fam = family.toLowerCase()
  let weight = 400
  if (/light/.test(sty)) weight = 300
  else if (/medium/.test(sty)) weight = 500
  else if (/bold/.test(sty)) weight = 700
  return {
    file,
    family,
    style,
    familyKey: family.toLowerCase().replace(/\s+/g, ' ').trim(),
    weight,
    italic: /italic|oblique/.test(sty),
    monospace: /mono|courier/.test(fam),
    serif: /serif|times|roman/.test(fam) && !/sans/.test(fam)
  }
}

describe('key()', () => {
  it('lowercases and collapses whitespace', () => {
    expect(key('Times  New  Roman')).toBe('times new roman')
    expect(key('  Arial Bold  ')).toBe('arial bold')
    expect(key('LIBERATION SANS')).toBe('liberation sans')
  })
})

describe('classify()', () => {
  it('detects bold weight', () => {
    expect(classify('Arial', 'Bold').weight).toBe(700)
    expect(classify('Arial', 'Light').weight).toBe(300)
    expect(classify('Arial', 'Black').weight).toBe(900)
    expect(classify('Arial', 'Regular').weight).toBe(400)
  })
  it('detects italic', () => {
    expect(classify('Arial', 'Italic').italic).toBe(true)
    expect(classify('Arial', 'Oblique').italic).toBe(true)
    expect(classify('Arial', 'Regular').italic).toBe(false)
  })
  it('detects monospace by family name', () => {
    expect(classify('Courier New', 'Regular').monospace).toBe(true)
    expect(classify('Liberation Mono', 'Regular').monospace).toBe(true)
    expect(classify('Arial', 'Regular').monospace).toBe(false)
  })
  it('detects serif by family name', () => {
    expect(classify('Times New Roman', 'Regular').serif).toBe(true)
    expect(classify('Liberation Serif', 'Regular').serif).toBe(true)
    // "Sans" overrides serif:
    expect(classify('Liberation Sans', 'Regular').serif).toBe(false)
    expect(classify('DejaVu Sans', 'Regular').serif).toBe(false)
  })
})

describe('resolveFontByName()', () => {
  beforeEach(() => {
    __setFontIndexForTest([])
  })

  it('returns null when index is empty', () => {
    expect(resolveFontByName('Helvetica', 400, false)).toBeNull()
  })

  it('finds exact match (case-insensitive)', () => {
    __setFontIndexForTest([entry('Arial')])
    const r = resolveFontByName('ARIAL', 400, false)
    expect(r?.exact).toBe(true)
    expect(r?.entry.family).toBe('Arial')
  })

  it('picks closest weight for an exact-family match', () => {
    __setFontIndexForTest([entry('Arial', 'Regular'), entry('Arial', 'Bold')])
    const r = resolveFontByName('Arial', 700, false)
    expect(r?.entry.style).toBe('Bold')
  })

  it('prefers italic match', () => {
    __setFontIndexForTest([entry('Arial', 'Regular'), entry('Arial', 'Italic')])
    const r = resolveFontByName('Arial', 400, true)
    expect(r?.entry.style).toBe('Italic')
  })

  it('strips bold/italic suffix from requested name', () => {
    __setFontIndexForTest([entry('Arial', 'Bold')])
    const r = resolveFontByName('Arial-Bold', 700, false)
    expect(r?.entry.family).toBe('Arial')
    expect(r?.exact).toBe(false)
  })

  it('Times-Roman prefers MS Times New Roman when installed', () => {
    __setFontIndexForTest([
      entry('Liberation Serif'),
      entry('Times New Roman'),
      entry('Nimbus Roman'),
      entry('DejaVu Serif')
    ])
    const r = resolveFontByName('Times-Roman', 400, false)
    expect(r?.entry.family).toBe('Times New Roman')
  })

  it('Times-Roman falls back to Liberation Serif when MS fonts missing', () => {
    __setFontIndexForTest([
      entry('Liberation Serif'),
      entry('Nimbus Roman'),
      entry('DejaVu Serif')
    ])
    const r = resolveFontByName('Times-Roman', 400, false)
    expect(r?.entry.family).toBe('Liberation Serif')
  })

  it('Times-Roman falls through to Nimbus when no cmap-compat fonts present', () => {
    __setFontIndexForTest([entry('Nimbus Roman'), entry('DejaVu Serif')])
    const r = resolveFontByName('Times-Roman', 400, false)
    expect(r?.entry.family).toBe('Nimbus Roman')
  })

  it('Helvetica prefers Arial when installed', () => {
    __setFontIndexForTest([
      entry('Liberation Sans'),
      entry('Arial'),
      entry('DejaVu Sans')
    ])
    const r = resolveFontByName('Helvetica', 400, false)
    expect(r?.entry.family).toBe('Arial')
  })

  it('Courier prefers Courier New when installed', () => {
    __setFontIndexForTest([
      entry('Liberation Mono'),
      entry('Courier New'),
      entry('DejaVu Sans Mono')
    ])
    const r = resolveFontByName('Courier', 400, false)
    expect(r?.entry.family).toBe('Courier New')
  })

  it('TimesNewRomanPSMT (no-dash variant) resolves like Times-Roman', () => {
    __setFontIndexForTest([entry('Liberation Serif'), entry('DejaVu Serif')])
    const r = resolveFontByName('TimesNewRomanPSMT', 400, false)
    expect(r?.entry.family).toBe('Liberation Serif')
  })

  it('Symbol resolves to a symbol font when available', () => {
    __setFontIndexForTest([entry('Standard Symbols PS'), entry('DejaVu Sans')])
    const r = resolveFontByName('Symbol', 400, false)
    expect(r?.entry.family).toBe('Standard Symbols PS')
  })

  it('falls back to substring heuristics for unknown sans family', () => {
    __setFontIndexForTest([entry('Liberation Sans'), entry('DejaVu Sans')])
    const r = resolveFontByName('SomeUnknownSwiss721Sans', 400, false)
    expect(r?.entry.family).toBe('Liberation Sans')
  })
})

describe('resolveByCharset()', () => {
  beforeEach(() => __setFontIndexForTest([]))

  it('returns null when no candidates installed', () => {
    expect(resolveByCharset(204, 400, false, false, false)).toBeNull()
  })

  it('Russian charset (204) picks DejaVu when no MS fonts', () => {
    __setFontIndexForTest([entry('DejaVu Sans'), entry('Liberation Sans')])
    const r = resolveByCharset(204, 400, false, false, false)
    expect(r?.family).toBe('DejaVu Sans')
  })

  it('Symbol charset (2) picks symbol font', () => {
    __setFontIndexForTest([entry('Standard Symbols PS'), entry('DejaVu Sans')])
    const r = resolveByCharset(2, 400, false, false, false)
    expect(r?.family).toBe('Standard Symbols PS')
  })

  it('mono hint picks DejaVu Sans Mono', () => {
    __setFontIndexForTest([
      entry('DejaVu Sans Mono', 'Regular'),
      entry('DejaVu Sans', 'Regular'),
      entry('Liberation Mono', 'Regular')
    ])
    const r = resolveByCharset(204, 400, false, true, false)
    expect(r?.family).toBe('DejaVu Sans Mono')
  })
})

describe('resolveDefault()', () => {
  beforeEach(() => __setFontIndexForTest([]))

  it('returns null when index is empty', () => {
    expect(resolveDefault(false, false)).toBeNull()
  })

  it('picks Nimbus Sans for default sans when no MS', () => {
    __setFontIndexForTest([entry('Nimbus Sans'), entry('DejaVu Sans')])
    const r = resolveDefault(false, false)
    expect(r?.family).toBe('Nimbus Sans')
  })

  it('picks mono target when monospace flag is set', () => {
    __setFontIndexForTest([entry('Nimbus Mono PS'), entry('DejaVu Sans Mono')])
    const r = resolveDefault(true, false)
    expect(r?.family).toBe('Nimbus Mono PS')
  })
})

describe('readTtfTable()', () => {
  it('returns null for non-sfnt input', () => {
    expect(readTtfTable(new Uint8Array(4), 0x67617370)).toBeNull()
    expect(readTtfTable(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 0x67617370)).toBeNull()
  })

  it('locates a table by tag in a hand-built sfnt', () => {
    // sfnt header (12 bytes): version=0x00010000, numTables=1, padding...
    // table dir entry (16 bytes): tag, checksum, offset, length
    const tag = 0x61626364 // "abcd"
    const tableBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const buf = new Uint8Array(12 + 16 + tableBytes.length)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, 0x00010000, false) // sfnt version
    dv.setUint16(4, 1, false) // numTables
    dv.setUint16(6, 0, false)
    dv.setUint16(8, 0, false)
    dv.setUint16(10, 0, false)
    // table dir at offset 12
    dv.setUint32(12, tag, false)
    dv.setUint32(16, 0, false) // checksum
    dv.setUint32(20, 12 + 16, false) // offset
    dv.setUint32(24, tableBytes.length, false) // length
    buf.set(tableBytes, 12 + 16)

    const r = readTtfTable(buf, tag)
    expect(r).not.toBeNull()
    expect(Array.from(r!)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('returns null when tag not present', () => {
    const buf = new Uint8Array(12)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, 0x00010000, false)
    dv.setUint16(4, 0, false)
    expect(readTtfTable(buf, 0x61626364)).toBeNull()
  })
})
