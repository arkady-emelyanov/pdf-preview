/**
 * System font enumeration + PDFium font mapper.
 *
 * PDFium-WASM ships without system font access, so PDFs that reference
 * non-embedded fonts (Helvetica, Arial, etc.) render as garbled text.
 * This module:
 *   1. Scans system fonts via `fc-list`.
 *   2. Maintains a substitution table mapping common PDF font names to
 *      installed equivalents (Liberation/DejaVu/Noto on Linux).
 *   3. Registers a custom FPDF_SYSFONTINFO with JS-side callbacks bridged
 *      through Emscripten's addFunction, so PDFium can resolve any font
 *      name to a real glyph source.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

interface FontEntry {
  file: string
  family: string
  style: string
  /** Lowercased, whitespace-normalized family name (for matching). */
  familyKey: string
  weight: number
  italic: boolean
  monospace: boolean
  serif: boolean
}

interface LoadedFont {
  handle: number
  bytes: Uint8Array
  faceName: string
  charset: number
}

let fontIndex: FontEntry[] = []
let installed = false

/** Lowercase + collapse whitespace for fuzzy family-name matching. */
function key(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function classify(family: string, style: string): {
  weight: number
  italic: boolean
  monospace: boolean
  serif: boolean
} {
  const fam = family.toLowerCase()
  const sty = style.toLowerCase()
  let weight = 400
  if (/thin|hairline/.test(sty)) weight = 100
  else if (/extralight|ultralight/.test(sty)) weight = 200
  else if (/light/.test(sty)) weight = 300
  else if (/medium/.test(sty)) weight = 500
  else if (/semibold|demibold/.test(sty)) weight = 600
  else if (/extrabold|ultrabold/.test(sty)) weight = 800
  else if (/black|heavy/.test(sty)) weight = 900
  else if (/bold/.test(sty)) weight = 700
  const italic = /italic|oblique/.test(sty)
  const monospace = /mono|courier|consolas/.test(fam)
  const serif = /serif|times|roman|georgia|caslon|garamond/.test(fam) && !/sans/.test(fam)
  return { weight, italic, monospace, serif }
}

export async function buildFontIndex(): Promise<void> {
  if (fontIndex.length > 0) return
  try {
    const { stdout } = await execFileP('fc-list', ['-f', '%{file}\t%{family}\t%{style}\n'], {
      maxBuffer: 16 * 1024 * 1024
    })
    const seen = new Set<string>()
    for (const line of stdout.split('\n')) {
      const [file, family, style] = line.split('\t')
      if (!file || !family) continue
      if (!/\.(ttf|otf|ttc)$/i.test(file)) continue
      // fc-list returns comma-separated families for multi-name fonts; take primary.
      const primary = family.split(',')[0].trim()
      const sty = (style ?? 'Regular').split(',')[0].trim()
      const k = `${file}|${primary}|${sty}`
      if (seen.has(k)) continue
      seen.add(k)
      const meta = classify(primary, sty)
      fontIndex.push({
        file,
        family: primary,
        style: sty,
        familyKey: key(primary),
        ...meta
      })
    }
  } catch (e) {
    console.warn('Font enumeration failed (is fontconfig installed?):', e)
  }
}

/**
 * Preference list: each PDF font name → ordered list of installed family keys to try.
 *
 * Order matters. We prefer fonts whose internal glyph table (cmap) matches the
 * Microsoft Core / PostScript-base14 originals, because PDFs frequently use
 * CID Identity-H encoding with no ToUnicode CMap — for those, character codes
 * index directly into the original font's glyph table, and only a glyph-level
 * compatible substitute will render correctly.
 *
 *   1st choice: Liberation 2.x / Tinos / Arimo / Cousine — TrueType, designed
 *     by Red Hat / Google to be metric AND glyph-id compatible with MS Core
 *     fonts (Times New Roman, Arial, Courier New).
 *   2nd: URW base35 (Nimbus*) — metric-compatible PostScript Type 1; correct
 *     for old PDFs that use base14 names with custom Type 1 encoding.
 *   3rd: DejaVu / Noto — broader Unicode but only metric-compatible, not
 *     glyph-id compatible.
 */
const SUBSTITUTIONS: Record<string, string[]> = {
  // Sans-serif (Helvetica / Arial family). Real MS Arial first (if installed via
  // ttf-mscorefonts-installer), then metric+cmap compatible alternates.
  helvetica: ['arial', 'liberation sans', 'arimo', 'nimbus sans', 'dejavu sans', 'noto sans'],
  'helvetica neue': ['arial', 'liberation sans', 'arimo', 'nimbus sans', 'dejavu sans'],
  arial: ['arial', 'liberation sans', 'arimo', 'nimbus sans', 'dejavu sans', 'noto sans'],
  arialmt: ['arial', 'liberation sans', 'arimo', 'nimbus sans', 'dejavu sans'],
  'arial unicode ms': ['arial unicode ms', 'arial', 'noto sans', 'dejavu sans'],
  arialunicodems: ['arial unicode ms', 'arial', 'noto sans', 'dejavu sans'],
  verdana: ['dejavu sans', 'liberation sans'],
  tahoma: ['dejavu sans', 'liberation sans'],
  'trebuchet ms': ['liberation sans', 'dejavu sans'],
  geneva: ['liberation sans', 'dejavu sans'],
  // Serif (Times family). Real MS Times New Roman first if installed.
  times: ['times new roman', 'liberation serif', 'tinos', 'nimbus roman', 'dejavu serif'],
  'times new roman': [
    'times new roman',
    'liberation serif',
    'tinos',
    'nimbus roman',
    'dejavu serif'
  ],
  timesnewromanpsmt: [
    'times new roman',
    'liberation serif',
    'tinos',
    'nimbus roman',
    'dejavu serif'
  ],
  timesnewroman: [
    'times new roman',
    'liberation serif',
    'tinos',
    'nimbus roman',
    'dejavu serif'
  ],
  'times-roman': [
    'times new roman',
    'liberation serif',
    'tinos',
    'nimbus roman',
    'dejavu serif'
  ],
  'times roman': [
    'times new roman',
    'liberation serif',
    'tinos',
    'nimbus roman',
    'dejavu serif'
  ],
  georgia: ['liberation serif', 'dejavu serif', 'noto serif'],
  garamond: ['liberation serif', 'dejavu serif'],
  palatino: ['p052', 'urw palladio l', 'liberation serif', 'dejavu serif'],
  // Mono (Courier family). Real MS Courier New first if installed.
  courier: [
    'courier new',
    'liberation mono',
    'cousine',
    'nimbus mono ps',
    'nimbus mono',
    'dejavu sans mono'
  ],
  'courier new': [
    'courier new',
    'liberation mono',
    'cousine',
    'nimbus mono ps',
    'dejavu sans mono'
  ],
  couriernew: [
    'courier new',
    'liberation mono',
    'cousine',
    'nimbus mono ps',
    'dejavu sans mono'
  ],
  consolas: ['liberation mono', 'dejavu sans mono'],
  monaco: ['liberation mono', 'dejavu sans mono'],
  // Symbol-ish
  symbol: ['standard symbols ps', 'standardsymbolsps', 'dejavu sans'],
  zapfdingbats: ['d050000l', 'dejavu sans'],
  zapfchancery: ['z003', 'urw chancery l', 'dejavu serif'],
  bookman: ['urw bookman l', 'liberation serif'],
  'century schoolbook': ['c059', 'urw century', 'liberation serif'],
  // Last-resort family names
  sans: ['liberation sans', 'arimo', 'dejavu sans', 'noto sans', 'nimbus sans'],
  'sans-serif': ['liberation sans', 'arimo', 'dejavu sans', 'noto sans', 'nimbus sans'],
  serif: ['liberation serif', 'tinos', 'dejavu serif', 'noto serif', 'nimbus roman'],
  monospace: ['liberation mono', 'cousine', 'dejavu sans mono', 'nimbus mono ps']
}

/** Windows charset constants used by PDFium when calling MapFont. */
const CHARSET_RUSSIAN = 204
const CHARSET_EASTEUROPE = 238
const CHARSET_GREEK = 161
const CHARSET_TURKISH = 162
const CHARSET_HEBREW = 177
const CHARSET_ARABIC = 178
const CHARSET_BALTIC = 186
const CHARSET_VIETNAMESE = 163
const CHARSET_THAI = 222
const CHARSET_SHIFTJIS = 128
const CHARSET_HANGUL = 129
const CHARSET_GB2312 = 134
const CHARSET_CHINESEBIG5 = 136
const CHARSET_SYMBOL = 2

/** Fonts that have good coverage of the given Windows charset. */
function charsetFallback(charset: number, monospace: boolean, serif: boolean): string[] {
  if (charset === CHARSET_SYMBOL) {
    return ['standard symbols ps', 'dejavu sans']
  }
  if (
    charset === CHARSET_RUSSIAN ||
    charset === CHARSET_EASTEUROPE ||
    charset === CHARSET_GREEK ||
    charset === CHARSET_BALTIC ||
    charset === CHARSET_TURKISH ||
    charset === CHARSET_VIETNAMESE
  ) {
    // DejaVu has full coverage of these; Noto is the broadest backup.
    return monospace
      ? ['dejavu sans mono', 'noto sans mono', 'liberation mono']
      : serif
        ? ['dejavu serif', 'noto serif', 'liberation serif']
        : ['dejavu sans', 'noto sans', 'liberation sans']
  }
  if (charset === CHARSET_HEBREW) return ['dejavu sans', 'noto sans hebrew']
  if (charset === CHARSET_ARABIC) return ['noto sans arabic', 'dejavu sans']
  if (charset === CHARSET_THAI) return ['noto sans thai', 'dejavu sans']
  if (charset === CHARSET_SHIFTJIS) return ['noto sans cjk jp', 'noto sans jp']
  if (charset === CHARSET_HANGUL) return ['noto sans cjk kr', 'noto sans kr']
  if (charset === CHARSET_GB2312) return ['noto sans cjk sc', 'noto sans sc']
  if (charset === CHARSET_CHINESEBIG5) return ['noto sans cjk tc', 'noto sans tc']
  return monospace
    ? ['nimbus mono ps', 'dejavu sans mono', 'liberation mono']
    : serif
      ? ['nimbus roman', 'dejavu serif', 'liberation serif']
      : ['nimbus sans', 'dejavu sans', 'liberation sans']
}

function findFamily(familyKey: string, weight: number, italic: boolean): FontEntry | null {
  const candidates = fontIndex.filter((f) => f.familyKey === familyKey)
  if (candidates.length === 0) return null
  // Score: closest weight match, italic match preferred.
  let best: FontEntry | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    const wScore = Math.abs(c.weight - weight)
    const iScore = c.italic === italic ? 0 : 100
    const score = wScore + iScore
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

function resolveFontByName(
  requested: string,
  weight: number,
  italic: boolean
): { entry: FontEntry; exact: boolean } | null {
  const k = key(requested)
  // 1. Exact family match
  let entry = findFamily(k, weight, italic)
  if (entry) return { entry, exact: true }
  // 2. Strip "-Bold", "-Italic", "MT", "PS" suffixes commonly seen in PDF font names
  const stripped = k
    .replace(/[-_\s]?(bold|italic|oblique|regular|light|medium|semibold|extrabold|black|thin)/g, '')
    .replace(/(mt|ps|psmt|bt)$/g, '')
    .trim()
  if (stripped && stripped !== k) {
    entry = findFamily(stripped, weight, italic)
    if (entry) return { entry, exact: false }
  }
  // 3. Substitution table
  const subs = SUBSTITUTIONS[k] ?? SUBSTITUTIONS[stripped]
  if (subs) {
    for (const sub of subs) {
      entry = findFamily(sub, weight, italic)
      if (entry) return { entry, exact: false }
    }
  }
  // 4. Heuristic by substring
  if (/sans|arial|helvetica|swiss|geneva/.test(k)) {
    for (const sub of SUBSTITUTIONS['sans-serif']) {
      entry = findFamily(sub, weight, italic)
      if (entry) return { entry, exact: false }
    }
  }
  if (/serif|times|roman|book/.test(k)) {
    for (const sub of SUBSTITUTIONS['serif']) {
      entry = findFamily(sub, weight, italic)
      if (entry) return { entry, exact: false }
    }
  }
  if (/mono|courier|console|typewriter/.test(k)) {
    for (const sub of SUBSTITUTIONS['monospace']) {
      entry = findFamily(sub, weight, italic)
      if (entry) return { entry, exact: false }
    }
  }
  return null
}

function resolveByCharset(
  charset: number,
  weight: number,
  italic: boolean,
  monospace: boolean,
  serif: boolean
): FontEntry | null {
  for (const t of charsetFallback(charset, monospace, serif)) {
    const e = findFamily(t, weight, italic)
    if (e) return e
  }
  return null
}

function resolveDefault(monospace: boolean, serif: boolean): FontEntry | null {
  const targets = monospace
    ? ['nimbus mono ps', 'dejavu sans mono', 'liberation mono']
    : serif
      ? ['nimbus roman', 'dejavu serif', 'liberation serif', 'noto serif']
      : ['nimbus sans', 'dejavu sans', 'liberation sans', 'noto sans']
  for (const t of targets) {
    const e = findFamily(t, 400, false)
    if (e) return e
  }
  return fontIndex[0] ?? null
}

/**
 * Install a JS-side FPDF_SYSFONTINFO into a PDFium WASM module.
 * Must be called after FPDF_InitLibrary and before any rendering.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installFontMapper(module: any): void {
  if (installed) return
  installed = true

  const loaded = new Map<number, LoadedFont>()
  let nextHandle = 1

  // Read a NUL-terminated C string from heap.
  const readCStr = (ptr: number): string => {
    if (!ptr) return ''
    let end = ptr
    while (module.HEAPU8[end] !== 0) end++
    return new TextDecoder('utf-8').decode(module.HEAPU8.subarray(ptr, end))
  }

  const writeCStr = (ptr: number, bufSize: number, s: string): number => {
    const bytes = new TextEncoder().encode(s)
    const writable = Math.min(bytes.length, bufSize - 1)
    if (ptr && writable > 0) {
      module.HEAPU8.set(bytes.subarray(0, writable), ptr)
      module.HEAPU8[ptr + writable] = 0
    }
    return bytes.length + 1
  }

  // ---- Callbacks ----

  const Release = (_thisPtr: number): void => {
    /* nothing — struct lives forever */
  }

  const EnumFonts = (_thisPtr: number, _mapperPtr: number): void => {
    /* not used */
  }

  const MapFont = (
    _thisPtr: number,
    weight: number,
    bItalic: number,
    charset: number,
    pitch_family: number,
    facePtr: number,
    bExactPtr: number
  ): number => {
    const face = readCStr(facePtr)
    const italic = bItalic !== 0
    // pitch_family bits (Windows-style): 0x01 = fixed pitch, 0x10 = roman (serif),
    // 0x20 = swiss (sans), 0x30 = modern (mono), 0x40 = script, 0x50 = decorative
    const fixedPitch = (pitch_family & 0x01) !== 0
    const familyClass = pitch_family & 0xf0
    const serifHint = familyClass === 0x10
    const monoHint = fixedPitch || familyClass === 0x30

    const resolved = resolveFontByName(face, weight || 400, italic)
    let entry: FontEntry | null = resolved?.entry ?? null
    let exact = resolved?.exact ?? false
    if (!entry) {
      // Charset-aware fallback first, then generic defaults
      entry =
        resolveByCharset(charset, weight || 400, italic, monoHint, serifHint) ??
        resolveDefault(monoHint, serifHint)
      exact = false
    }
    if (process.env.PDFIUM_FONT_DEBUG) {
      console.log(
        `[fonts] MapFont face="${face}" weight=${weight} italic=${bItalic} charset=${charset} pf=0x${pitch_family.toString(16)} → ${entry?.family ?? 'NULL'} (${entry?.file ?? '-'})`
      )
    }
    if (!entry) return 0
    // Async-load font bytes — we need sync access here, so read sync.
    let bytes: Uint8Array
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs')
      bytes = fs.readFileSync(entry.file)
    } catch (e) {
      console.warn('Font read failed:', entry.file, e)
      return 0
    }
    if (bExactPtr) {
      const view = new Int32Array(module.HEAPU8.buffer, bExactPtr, 1)
      view[0] = exact ? 1 : 0
    }
    const handle = nextHandle++
    loaded.set(handle, {
      handle,
      bytes,
      faceName: entry.family,
      charset: 0
    })
    return handle
  }

  const GetFont = (_thisPtr: number, _facePtr: number): number => {
    // We don't pre-install fonts via FPDF_AddInstalledFont, so this always 0.
    return 0
  }

  const GetFontData = (
    _thisPtr: number,
    hFont: number,
    table: number,
    buffer: number,
    buf_size: number
  ): number => {
    const f = loaded.get(hFont)
    if (!f) return 0
    if (table === 0) {
      if (buffer && buf_size >= f.bytes.length) {
        module.HEAPU8.set(f.bytes, buffer)
      }
      return f.bytes.length
    }
    // Per-table read: parse TTF table directory and return that table.
    const tbl = readTtfTable(f.bytes, table)
    if (!tbl) return 0
    if (buffer && buf_size >= tbl.length) {
      module.HEAPU8.set(tbl, buffer)
    }
    return tbl.length
  }

  const GetFaceName = (
    _thisPtr: number,
    hFont: number,
    buffer: number,
    buf_size: number
  ): number => {
    const f = loaded.get(hFont)
    if (!f) return 0
    return writeCStr(buffer, buf_size, f.faceName)
  }

  const GetFontCharset = (_thisPtr: number, hFont: number): number => {
    const f = loaded.get(hFont)
    return f?.charset ?? 0
  }

  const DeleteFont = (_thisPtr: number, hFont: number): void => {
    loaded.delete(hFont)
  }

  // ---- Register callbacks as WASM function pointers ----
  const fpRelease = module.addFunction(Release, 'vi')
  const fpEnumFonts = module.addFunction(EnumFonts, 'vii')
  const fpMapFont = module.addFunction(MapFont, 'iiiiiiii')
  const fpGetFont = module.addFunction(GetFont, 'iii')
  const fpGetFontData = module.addFunction(GetFontData, 'iiiiii')
  const fpGetFaceName = module.addFunction(GetFaceName, 'iiiii')
  const fpGetFontCharset = module.addFunction(GetFontCharset, 'iii')
  const fpDeleteFont = module.addFunction(DeleteFont, 'vii')

  // ---- Allocate and populate FPDF_SYSFONTINFO struct ----
  // 9 i32 fields = 36 bytes
  const structPtr = module.wasmExports.malloc(36)
  const view = new Int32Array(module.HEAPU8.buffer, structPtr, 9)
  view[0] = 1 // version
  view[1] = fpRelease
  view[2] = fpEnumFonts
  view[3] = fpMapFont
  view[4] = fpGetFont
  view[5] = fpGetFontData
  view[6] = fpGetFaceName
  view[7] = fpGetFontCharset
  view[8] = fpDeleteFont

  module._FPDF_SetSystemFontInfo(structPtr)
}

/**
 * Read a single table from a TTF/OTF font buffer by 4-char tag (passed as u32).
 * Returns the table bytes, or null if not found / not a sfnt.
 */
function readTtfTable(buf: Uint8Array, tag: number): Uint8Array | null {
  if (buf.length < 12) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // sfnt version: 0x00010000 (TTF) or 'OTTO' / 'true' / 'typ1' / 'ttcf'
  const sfnt = dv.getUint32(0, false)
  let tableOffset = 12
  if (sfnt === 0x74746366 /* 'ttcf' */) {
    // TTC — use first font
    const numFonts = dv.getUint32(8, false)
    if (numFonts === 0) return null
    const fontOffset = dv.getUint32(12, false)
    return readTtfTable(buf.subarray(fontOffset), tag)
  }
  const numTables = dv.getUint16(4, false)
  for (let i = 0; i < numTables; i++) {
    const off = tableOffset + i * 16
    const t = dv.getUint32(off, false)
    if (t === tag) {
      const tblOff = dv.getUint32(off + 8, false)
      const tblLen = dv.getUint32(off + 12, false)
      if (tblOff + tblLen > buf.length) return null
      return buf.subarray(tblOff, tblOff + tblLen)
    }
  }
  return null
}

/** Diagnostic: how many fonts we found and a few examples. */
export function fontIndexSummary(): { count: number; sample: string[] } {
  return {
    count: fontIndex.length,
    sample: fontIndex.slice(0, 8).map((f) => `${f.family} (${f.style})`)
  }
}

