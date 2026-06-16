import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { rotatedSize } from '../../shared/edit'
import type {
  PrintJob,
  PrinterInfo,
  PrinterOption
} from '../../shared/ipc'
import type { VirtualPage } from '../../shared/edit'

/** Apply user range / subset choices to a virtual page list. Mirrors the
 *  pure helper in `main/print.ts`; duplicated here because the renderer
 *  doesn't import main code. Kept tiny on purpose. */
function selectPages(
  pages: VirtualPage[],
  range: 'all' | 'current' | 'custom',
  customSpec: string,
  subset: 'all' | 'odd' | 'even',
  currentIndex0Based: number
): VirtualPage[] {
  let idx: number[]
  if (range === 'all') idx = pages.map((_, i) => i)
  else if (range === 'current') idx = [currentIndex0Based]
  else idx = parseRangeSpec(customSpec, pages.length)
  if (subset === 'odd') idx = idx.filter((i) => i % 2 === 0)
  else if (subset === 'even') idx = idx.filter((i) => i % 2 === 1)
  return idx.map((i) => pages[i]).filter((p): p is VirtualPage => !!p)
}

function parseRangeSpec(spec: string, pageCount: number): number[] {
  const out = new Set<number>()
  for (const raw of spec.split(',')) {
    const tok = raw.trim()
    if (!tok) continue
    const dash = tok.indexOf('-')
    if (dash < 0) {
      const n = Number(tok)
      if (Number.isInteger(n) && n >= 1 && n <= pageCount) out.add(n - 1)
      continue
    }
    const lo = tok.slice(0, dash).trim()
    const hi = tok.slice(dash + 1).trim()
    const loN = lo === '' ? 1 : Number(lo)
    const hiN = hi === '' ? pageCount : Number(hi)
    if (!Number.isInteger(loN) || !Number.isInteger(hiN)) continue
    for (let i = Math.max(1, loN); i <= Math.min(pageCount, hiN); i++) {
      out.add(i - 1)
    }
  }
  return [...out].sort((a, b) => a - b)
}

interface Props {
  open: boolean
  onClose: () => void
}

const PREVIEW_W = 240
const PREVIEW_H = 320

/** Best-effort paper-size lookup. Covers the common CUPS / PWG media
 *  keywords. Returns dimensions in PDF points (portrait orientation). */
function paperSizePt(media: string): { width: number; height: number } {
  const m = media.toLowerCase()
  if (m.includes('a3')) return { width: 842, height: 1191 }
  if (m.includes('a5')) return { width: 420, height: 595 }
  if (m.includes('legal')) return { width: 612, height: 1008 }
  if (m.includes('letter')) return { width: 612, height: 792 }
  // Also try to parse a `WxH<mm|in>` suffix in PWG self-describing names.
  const mmMatch = m.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm/)
  if (mmMatch) {
    return {
      width: Number(mmMatch[1]) * 2.83465,
      height: Number(mmMatch[2]) * 2.83465
    }
  }
  const inMatch = m.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)in/)
  if (inMatch) {
    return { width: Number(inMatch[1]) * 72, height: Number(inMatch[2]) * 72 }
  }
  // Default: A4.
  return { width: 595, height: 842 }
}

/** Small canvas that renders one virtual page at a scale that fits a fixed
 *  preview box. Re-renders whenever the page identity / rotation / box size
 *  changes; cancelled in-flight if the prop changes mid-render. */
function PreviewPage({
  vp,
  boxW,
  boxH,
  extraRotation,
  paperWPt,
  paperHPt,
  scaling,
  customScale
}: {
  vp: VirtualPage
  boxW: number
  boxH: number
  /** Render-time rotation layered on top of the page's edit rotation —
   *  drives the landscape preview. */
  extraRotation: number
  /** Paper size in PDF points, already oriented (landscape swaps w/h). */
  paperWPt: number
  paperHPt: number
  scaling: 'fit' | 'actual' | 'custom'
  /** Percent (e.g. 75 = 75%) — only consulted when scaling === 'custom'. */
  customScale: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceSize = useStore((s) => s.sourceSize)

  useEffect(() => {
    let cancelled = false
    const effective = (((vp.rotation + extraRotation) % 360) + 360) % 360
    const raw = sourceSize(vp.sourceId, vp.sourceIndex)
    const pageRot = rotatedSize(raw, effective as 0 | 90 | 180 | 270)

    // Display scale: paper points → preview pixels. Picked so the paper sheet
    // fills (and fits within) the preview box, preserving aspect ratio.
    const display = Math.min(boxW / paperWPt, boxH / paperHPt)
    const paperPxW = paperWPt * display
    const paperPxH = paperHPt * display

    // Page-on-paper scale (1 = page-at-natural-size lands at natural-size on
    // paper). fit → scale the page to fill the paper (aspect-preserving);
    // actual → 1:1 page-pt to paper-pt; custom → percent multiplier.
    let pageOnPaper: number
    if (scaling === 'fit') {
      pageOnPaper = Math.min(paperWPt / pageRot.width, paperHPt / pageRot.height)
    } else if (scaling === 'actual') {
      pageOnPaper = 1
    } else {
      pageOnPaper = Math.max(0.01, customScale / 100)
    }

    // Pixel size of the page bitmap inside the preview, and its top-left
    // placement (centered on the paper).
    const pageScalePx = display * pageOnPaper
    const pagePxW = pageRot.width * pageScalePx
    const pagePxH = pageRot.height * pageScalePx
    const pageX = (paperPxW - pagePxW) / 2
    const pageY = (paperPxH - pagePxH) / 2

    ;(async () => {
      // Render at a slightly higher resolution than the displayed size so the
      // preview looks crisp when the page is small on a large paper.
      const renderScale = Math.max(pageScalePx, 0.2)
      const res = await window.pdf.renderPage(
        vp.sourceId,
        vp.sourceIndex,
        renderScale,
        effective,
        /* noFormHighlight */ true
      )
      if (cancelled || !res || !canvasRef.current) return
      const canvas = canvasRef.current
      canvas.width = Math.max(1, Math.round(paperPxW))
      canvas.height = Math.max(1, Math.round(paperPxH))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // Paper background.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // Stage the page bitmap on an offscreen canvas, then drawImage onto
      // the paper at the placed rect — drawImage handles down/up-scaling and
      // clipping when the page overflows the paper bounds.
      const off = document.createElement('canvas')
      off.width = res.width
      off.height = res.height
      const offCtx = off.getContext('2d')
      if (!offCtx) return
      const buf = new ArrayBuffer(res.data.length)
      const rgba = new Uint8ClampedArray(buf)
      rgba.set(res.data)
      const img = new ImageData(
        rgba as Uint8ClampedArray<ArrayBuffer>,
        res.width,
        res.height
      )
      offCtx.putImageData(img, 0, 0)
      // Clip to paper so an actual-size page bigger than paper doesn't bleed.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, canvas.width, canvas.height)
      ctx.clip()
      ctx.drawImage(off, pageX, pageY, pagePxW, pagePxH)
      ctx.restore()
    })()
    return () => {
      cancelled = true
    }
  }, [
    vp.sourceId,
    vp.sourceIndex,
    vp.rotation,
    extraRotation,
    boxW,
    boxH,
    paperWPt,
    paperHPt,
    scaling,
    customScale,
    sourceSize
  ])

  return <canvas ref={canvasRef} className="print-preview-canvas" />
}

/** Find a PrinterOption by any of several CUPS key aliases. Different
 *  drivers expose duplex as `Duplex`, `sides`, etc. */
function findOpt(opts: PrinterOption[], keys: string[]): PrinterOption | undefined {
  const lower = keys.map((k) => k.toLowerCase())
  return opts.find((o) => lower.includes(o.key.toLowerCase()))
}

export function PrintDialog({ open, onClose }: Props): JSX.Element | null {
  const pages = useStore((s) => s.pages)
  const currentPage = useStore((s) => s.currentPage)
  const sourcePaths = useStore((s) => s.sourcePaths)

  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printer, setPrinter] = useState<string>('')
  const [options, setOptions] = useState<PrinterOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)

  const [copies, setCopies] = useState(1)
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('all')
  const [customSpec, setCustomSpec] = useState('')
  const [subset, setSubset] = useState<'all' | 'odd' | 'even'>('all')
  const [duplex, setDuplex] = useState<string>('')
  const [media, setMedia] = useState<string>('')
  const [colorModel, setColorModel] = useState<string>('')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [scaling, setScaling] = useState<'fit' | 'actual' | 'custom'>('fit')
  const [customScale, setCustomScale] = useState(100)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState(0)

  const firstFocusRef = useRef<HTMLSelectElement>(null)

  // Load printers when the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    window.pdf.listPrinters().then((list) => {
      if (cancelled) return
      setPrinters(list)
      const def = list.find((p) => p.isDefault) ?? list[0]
      setPrinter(def?.name ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // Load capabilities when the selected printer changes.
  useEffect(() => {
    if (!open || !printer) {
      setOptions([])
      return
    }
    let cancelled = false
    setOptionsLoading(true)
    window.pdf.printerOptions(printer).then((opts) => {
      if (cancelled) return
      setOptions(opts)
      setOptionsLoading(false)
      // Reset choices to printer defaults whenever we switch.
      const dup = findOpt(opts, ['Duplex', 'sides'])
      setDuplex(dup?.default ?? '')
      const mediaOpt = findOpt(opts, ['media', 'PageSize'])
      setMedia(mediaOpt?.default ?? '')
      const color = findOpt(opts, ['ColorModel', 'print-color-mode'])
      setColorModel(color?.default ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [open, printer])

  // Esc / focus on open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    setTimeout(() => firstFocusRef.current?.focus(), 0)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const selectedPages = useMemo(
    () => selectPages(pages, range, customSpec, subset, currentPage),
    [pages, range, customSpec, subset, currentPage]
  )

  // Keep the preview index inside the selection as the user fiddles with
  // range / subset.
  useEffect(() => {
    if (previewIdx >= selectedPages.length) setPreviewIdx(0)
  }, [selectedPages.length, previewIdx])

  // Paper dimensions oriented per the user's choice. Drives the preview.
  const paper = useMemo(() => {
    const portrait = paperSizePt(media)
    return orientation === 'landscape'
      ? { width: portrait.height, height: portrait.width }
      : portrait
  }, [media, orientation])

  const duplexOpt = findOpt(options, ['Duplex', 'sides'])
  const mediaOpt = findOpt(options, ['media', 'PageSize'])
  const colorOpt = findOpt(options, ['ColorModel', 'print-color-mode'])

  const submit = async (): Promise<void> => {
    if (busy || selectedPages.length === 0 || !printer) return
    setBusy(true)
    setError(null)
    try {
      const job: PrintJob = {
        printerName: printer,
        pages: selectedPages,
        sources: sourcePaths(),
        copies: Math.max(1, copies | 0),
        duplex: duplex || undefined,
        media: media || undefined,
        colorModel: colorModel || undefined,
        orientation,
        scaling:
          scaling === 'fit'
            ? 'fit'
            : scaling === 'actual'
              ? 'actual'
              : Math.max(1, customScale | 0)
      }
      const res = await window.pdf.print(job)
      if (!res.ok) {
        setError(res.error ?? 'Print failed')
      } else {
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal print-dialog" role="dialog" aria-label="Print">
        <h2>Print</h2>

        <div className="print-body">
          <div className="print-controls">

        <div className="row">
          <label>Printer</label>
          {printers.length === 0 ? (
            <div className="inline" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="meta">No printers found.</span>
              <button
                onClick={async () => {
                  const list = await window.pdf.listPrinters()
                  setPrinters(list)
                  const def = list.find((p) => p.isDefault) ?? list[0]
                  setPrinter(def?.name ?? '')
                }}
              >
                Refresh
              </button>
            </div>
          ) : (
            <select
              ref={firstFocusRef}
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
            >
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="row">
          <label>Copies</label>
          <input
            type="number"
            min={1}
            max={999}
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div className="row">
          <label>Pages</label>
          <div className="inline">
            <label className="radio">
              <input
                type="radio"
                checked={range === 'all'}
                onChange={() => setRange('all')}
              />
              All ({pages.length})
            </label>
            <label className="radio">
              <input
                type="radio"
                checked={range === 'current'}
                onChange={() => setRange('current')}
              />
              Current
            </label>
            <label className="radio">
              <input
                type="radio"
                checked={range === 'custom'}
                onChange={() => setRange('custom')}
              />
              Custom
            </label>
            <input
              type="text"
              placeholder="e.g. 1-5,8,11-"
              value={customSpec}
              onChange={(e) => {
                setCustomSpec(e.target.value)
                if (e.target.value) setRange('custom')
              }}
              style={{ width: 160 }}
            />
          </div>
        </div>

        <div className="row">
          <label>Subset</label>
          <select value={subset} onChange={(e) => setSubset(e.target.value as 'all')}>
            <option value="all">All pages in range</option>
            <option value="odd">Odd pages only</option>
            <option value="even">Even pages only</option>
          </select>
        </div>

        {optionsLoading ? (
          <div className="row">
            <span className="meta">Loading printer capabilities…</span>
          </div>
        ) : (
          <>
            {duplexOpt && (
              <div className="row">
                <label>Duplex</label>
                <select value={duplex} onChange={(e) => setDuplex(e.target.value)}>
                  {duplexOpt.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {mediaOpt && (
              <div className="row">
                <label>Paper</label>
                <select value={media} onChange={(e) => setMedia(e.target.value)}>
                  {mediaOpt.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {colorOpt && (
              <div className="row">
                <label>Color</label>
                <select
                  value={colorModel}
                  onChange={(e) => setColorModel(e.target.value)}
                >
                  {colorOpt.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <div className="row">
          <label>Orientation</label>
          <select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as 'portrait')}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>

        <div className="row">
          <label>Scaling</label>
          <div className="inline">
            <select value={scaling} onChange={(e) => setScaling(e.target.value as 'fit')}>
              <option value="fit">Fit to page</option>
              <option value="actual">Actual size</option>
              <option value="custom">Custom %</option>
            </select>
            {scaling === 'custom' && (
              <input
                type="number"
                min={1}
                max={400}
                value={customScale}
                onChange={(e) =>
                  setCustomScale(Math.max(1, Number(e.target.value) || 100))
                }
                style={{ width: 70 }}
              />
            )}
          </div>
        </div>

          </div>

          <div className="print-preview">
            {selectedPages.length === 0 ? (
              <div className="print-preview-empty meta">No pages selected</div>
            ) : (
              <>
                <div
                  className="print-preview-box"
                  style={{ width: PREVIEW_W, height: PREVIEW_H }}
                >
                  <PreviewPage
                    vp={selectedPages[previewIdx]}
                    boxW={PREVIEW_W}
                    boxH={PREVIEW_H}
                    extraRotation={0}
                    paperWPt={paper.width}
                    paperHPt={paper.height}
                    scaling={scaling}
                    customScale={customScale}
                  />
                </div>
                <div className="print-preview-nav">
                  <button
                    onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                    disabled={previewIdx === 0}
                    title="Previous"
                  >
                    ‹
                  </button>
                  <span className="meta">
                    {previewIdx + 1} / {selectedPages.length}
                  </span>
                  <button
                    onClick={() =>
                      setPreviewIdx((i) => Math.min(selectedPages.length - 1, i + 1))
                    }
                    disabled={previewIdx >= selectedPages.length - 1}
                    title="Next"
                  >
                    ›
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {error && <div className="row error">{error}</div>}

        <div className="row buttons">
          <span className="meta">
            {selectedPages.length} page{selectedPages.length === 1 ? '' : 's'} to print
          </span>
          <div className="spacer" />
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || selectedPages.length === 0 || !printer}
          >
            {busy ? 'Sending…' : 'Print'}
          </button>
        </div>
      </div>
    </div>
  )
}
