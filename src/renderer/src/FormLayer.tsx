import { useEffect, useRef } from 'react'
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
 * bitmap. After every input we bump a per-page revision so PdfPage re-renders
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
  const src = sources[sourceId]
  const ref = useRef<HTMLDivElement>(null)

  // Forward keyboard input while the layer has DOM focus.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent): void => {
      const mods = modBits(e)
      // ASCII printables that don't repeat as a `keydown`-only event still
      // need to reach FORM_OnChar; we'll get them via the `keypress` /
      // `beforeinput` path below for character input.
      const vkey = winVKey(e.key)
      if (vkey !== null) {
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'keydown', vkey, mods })
        bumpFormRevision(sourceId, sourceIndex)
        if (vkey >= 8 && vkey <= 46) e.preventDefault()
      }
    }
    const onBeforeInput = (e: InputEvent): void => {
      if (!e.data) return
      for (const ch of e.data) {
        const cp = ch.codePointAt(0) ?? 0
        if (cp === 0) continue
        void window.pdf.formEvent(sourceId, sourceIndex, {
          kind: 'char',
          charCode: cp,
          mods: 0
        })
      }
      bumpFormRevision(sourceId, sourceIndex)
      e.preventDefault()
    }
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('beforeinput', onBeforeInput as EventListener)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('beforeinput', onBeforeInput as EventListener)
    }
  }, [sourceId, sourceIndex, bumpFormRevision])

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
      ref={ref}
      className="form-layer"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      style={{
        position: 'absolute',
        inset: 0,
        width: cssW,
        height: cssH,
        // No background — the rendered field appearances come from the page
        // bitmap underneath. We're just a transparent input capture surface.
        outline: 'none',
        // contentEditable defaults to user-text-cursor; widgets give their
        // own visual feedback via PDFium's caret rendering.
        cursor: 'default',
        // Disable iOS-style touch callouts so PDFium's hit-test wins.
        WebkitUserSelect: 'none',
        userSelect: 'none'
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        ;(e.currentTarget as HTMLDivElement).focus()
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'down', pageX: x, pageY: y })
        bumpFormRevision(sourceId, sourceIndex)
      }}
      onPointerMove={(e) => {
        // Skip when no buttons are down — saves IPC chatter on every hover.
        if (e.buttons === 0) return
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'move', pageX: x, pageY: y })
      }}
      onPointerUp={(e) => {
        const { cx, cy } = localCoords(e)
        const { x, y } = canvasToPagePt(cx, cy)
        void window.pdf.formEvent(sourceId, sourceIndex, { kind: 'up', pageX: x, pageY: y })
        bumpFormRevision(sourceId, sourceIndex)
      }}
    />
  )
}

/** Bit-shifted modifier mask matching PDFium's FWL_EVENTFLAG_* values:
 *  Shift = 1<<0, Ctrl = 1<<1, Alt = 1<<2. */
function modBits(e: KeyboardEvent): number {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0)
}

/** Translate a KeyboardEvent.key into a Win32 virtual-key code as PDFium
 *  expects for FORM_OnKeyDown. Only the keys we care about (navigation,
 *  editing, common modifiers) — character input goes through `beforeinput`
 *  → FORM_OnChar. */
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
    case ' ':
      return 0x20
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
