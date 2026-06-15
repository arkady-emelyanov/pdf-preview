import { useRef } from 'react'
import { useStore } from './store'

interface Props {
  sourceId: string
  sourceIndex: number
  pageWidthPt: number
  pageHeightPt: number
  scale: number
}

/**
 * Transparent layer over a page that forwards pointer + keyboard input to
 * PDFium's form-fill env. PDFium owns field focus / cursor / edit state, so
 * the user types into native widgets even though the rendering is just a
 * bitmap. After each input we bump a per-page revision so PdfPage re-renders
 * the bitmap with PDFium's new field state.
 *
 * v1 punts: enabled only when the host page is un-rotated. Rotated form
 * pages still render their values (FFLDraw works regardless), but input is
 * disabled since the pointer-coord conversion isn't worth the complexity.
 */
export function FormLayer({
  sourceId,
  sourceIndex,
  pageWidthPt,
  pageHeightPt,
  scale
}: Props): JSX.Element | null {
  const sources = useStore((s) => s.sources)
  const bumpFormRevision = useStore((s) => s.bumpFormRevision)
  const setFormDirty = useStore((s) => s.setFormDirty)
  const src = sources[sourceId]
  // Throttle move-induced re-renders so dragging a dropdown's scrollbar
  // doesn't flood the IPC + paint queue. ~30fps is fast enough to feel
  // responsive without saturating the WASM thread.
  const lastMoveBumpRef = useRef(0)

  if (!src || !src.hasForm || src.isXFA) return null

  const cssW = pageWidthPt * scale
  const cssH = pageHeightPt * scale

  const canvasToPagePt = (cx: number, cy: number): { x: number; y: number } => ({
    x: cx / scale,
    y: pageHeightPt - cy / scale
  })

  const localCoords = (e: React.PointerEvent): { cx: number; cy: number } => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
  }

  return (
    <div
      className="form-layer"
      tabIndex={0}
      style={{
        position: 'absolute',
        inset: 0,
        width: cssW,
        height: cssH,
        zIndex: 4,
        outline: 'none',
        cursor: 'default',
        WebkitUserSelect: 'none',
        userSelect: 'none'
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        // preventScroll stops the browser from snap-scrolling a partially-
        // visible FormLayer into full view when we focus it on click. The
        // user's intent was to focus a specific widget, not re-frame the
        // page; PDFium handles its own focus visibility inside the bitmap.
        ;(e.currentTarget as HTMLDivElement).focus({ preventScroll: true })
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'down', pageX: x, pageY: y })
      }}
      onPointerMove={(e) => {
        // Skip when no buttons are down — saves IPC chatter on every hover.
        if (e.buttons === 0) return
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'move', pageX: x, pageY: y })
        // Re-render every ~30ms while dragging so widgets that paint mid-
        // drag (combobox listbox scroll, slider thumb) stay in sync. Without
        // this the dropdown scrollbar only redraws on pointerup.
        const now = performance.now()
        if (now - lastMoveBumpRef.current > 33) {
          lastMoveBumpRef.current = now
          bumpFormRevision(sourceId, sourceIndex)
        }
      }}
      onPointerUp={(e) => {
        const canvas = e.currentTarget as HTMLDivElement
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        // Main does a fresh field-value snapshot after PDFium processes
        // the event and returns whether anything differs from the baseline,
        // so a checkbox flip dirties + flipping it back cleans, without any
        // optimistic guessing here.
        void window.pdf
          .formEvent(sourceId, sourceIndex, { kind: 'up', pageX: x, pageY: y })
          .then(setFormDirty)
        bumpFormRevision(sourceId, sourceIndex)
      }}
      onKeyDown={(e) => {
        // Let app shortcuts win for modifier combos (Ctrl+S etc.); keys.ts
        // already lets non-modifier keys through because the host element
        // is focusable. We just need to forward keystrokes.
        if (e.ctrlKey || e.metaKey || e.altKey) return
        // Backspace + Delete: PDFium's CPWL_Edit handles these through
        // FORM_OnChar with their ASCII codes (BS=8, DEL=0x7F), not through
        // FORM_OnKeyDown. Send them as chars.
        const asChar = e.key === 'Backspace' ? 8 : e.key === 'Delete' ? 0x7f : null
        if (asChar !== null) {
          void window.pdf
            .formEvent(sourceId, sourceIndex, { kind: 'char', charCode: asChar, mods: 0 })
            .then(setFormDirty)
          bumpFormRevision(sourceId, sourceIndex)
          e.preventDefault()
          return
        }
        const vkey = winVKey(e.key)
        if (vkey !== null) {
          // Navigation keys (arrows / Home / etc.) reach main but won't
          // change any field value, so the value-comparison comes back
          // false — dirty stays clean exactly as the user expects.
          void window.pdf
            .formEvent(sourceId, sourceIndex, { kind: 'keydown', vkey, mods: modBits(e) })
            .then(setFormDirty)
          bumpFormRevision(sourceId, sourceIndex)
          e.preventDefault()
          return
        }
        // Printable single-character key: forward as FORM_OnChar.
        if (e.key.length === 1) {
          const cp = e.key.codePointAt(0) ?? 0
          if (cp > 0) {
            void window.pdf
              .formEvent(sourceId, sourceIndex, { kind: 'char', charCode: cp, mods: 0 })
              .then(setFormDirty)
            bumpFormRevision(sourceId, sourceIndex)
            e.preventDefault()
          }
        }
      }}
    />
  )
}

function modBits(e: React.KeyboardEvent): number {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0)
}

/** Translate a KeyboardEvent.key into a Win32 virtual-key code as PDFium
 *  expects for FORM_OnKeyDown. Only the keys we care about (navigation,
 *  editing) — character input goes through FORM_OnChar. */
function winVKey(key: string): number | null {
  switch (key) {
    case 'Backspace':
      return 0x08
    case 'Tab':
      return 0x09
    case 'Enter':
      return 0x0d
    case 'Escape':
      return 0x1b
    case 'PageUp':
      return 0x21
    case 'PageDown':
      return 0x22
    case 'End':
      return 0x23
    case 'Home':
      return 0x24
    case 'ArrowLeft':
      return 0x25
    case 'ArrowUp':
      return 0x26
    case 'ArrowRight':
      return 0x27
    case 'ArrowDown':
      return 0x28
    case 'Delete':
      return 0x2e
    default:
      return null
  }
}
