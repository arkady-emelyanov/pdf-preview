import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import {
  FREETEXT_LINE_HEIGHT,
  freeTextHeight,
  isFreeText,
  pointToCanvas,
  type FreeTextAnnotation
} from '../../shared/annotations'

interface Props {
  virtualIndex: number
  pageHeightPt: number
  scale: number
}

function cssFontFamily(font: FreeTextAnnotation['font']): string {
  switch (font) {
    case 'Times':
      return '"Liberation Serif", "Tinos", "Times New Roman", Times, serif'
    case 'Courier':
      return '"Liberation Mono", "Cousine", "Courier New", Courier, monospace'
    default:
      return '"Liberation Sans", "Arimo", "Helvetica", Arial, sans-serif'
  }
}

/**
 * In-place editor for the currently selected free-text annotation on this
 * page. A textarea positioned exactly over the annotation bbox edits `body`
 * via the live-edit pattern so one editing session collapses into one undo
 * entry. The bbox height auto-grows with line count. An empty body on blur
 * deletes the annotation — same convention as Preview / Acrobat.
 */
export function FreeTextEditor({
  virtualIndex,
  pageHeightPt,
  scale
}: Props): JSX.Element | null {
  const selected = useStore((s) => s.selectedAnnotation)
  const pages = useStore((s) => s.pages)
  const beginLiveEdit = useStore((s) => s.beginLiveEdit)
  const liveUpdateAnnotation = useStore((s) => s.liveUpdateAnnotation)
  const deleteAnnotation = useStore((s) => s.deleteAnnotation)
  const setSelectedAnnotation = useStore((s) => s.setSelectedAnnotation)
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)

  const ref = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)

  const sel = selected?.page === virtualIndex ? selected : null
  const ann = sel ? pages[virtualIndex]?.annotations?.find((a) => a.id === sel.id) : undefined
  const ft: FreeTextAnnotation | null = ann && isFreeText(ann) ? ann : null

  useEffect(() => {
    if (ft) {
      // Defer focus to the next frame so it lands AFTER the click that
      // placed the annotation has fully unwound — otherwise the trailing
      // pointerup / click event can steal focus right back, the textarea
      // blurs on an empty body, and we end up deleting the freshly-dropped
      // annotation.
      const id = requestAnimationFrame(() => {
        ref.current?.focus()
        const len = ft.body.length
        ref.current?.setSelectionRange(len, len)
      })
      return () => cancelAnimationFrame(id)
    }
    setEditing(false)
    return
  }, [ft?.id])

  if (!ft) return null

  // bbox top-left in canvas px.
  const tl = pointToCanvas(ft.x, ft.y + ft.h, pageHeightPt, scale)
  const wPx = ft.w * scale
  const hPx = ft.h * scale
  const sizePx = ft.fontSize * scale

  return (
    <textarea
      ref={ref}
      className="freetext-editor"
      value={ft.body}
      placeholder="Text"
      style={{
        position: 'absolute',
        left: tl.cx,
        top: tl.cy,
        width: wPx,
        height: hPx,
        zIndex: 5,
        font: `${sizePx}px ${cssFontFamily(ft.font)}`,
        lineHeight: FREETEXT_LINE_HEIGHT,
        color: ft.color,
        opacity: ft.opacity
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={() => {
        if (!editing) {
          beginLiveEdit()
          setEditing(true)
        }
      }}
      onChange={(e) => {
        const body = e.target.value
        liveUpdateAnnotation(virtualIndex, ft.id, {
          body,
          h: freeTextHeight(body, ft.fontSize)
        })
      }}
      onBlur={() => {
        setEditing(false)
        // If the user dropped a free-text and never typed anything, drop it —
        // otherwise an empty bbox would linger on the page.
        if (ft.body.length === 0) {
          deleteAnnotation(virtualIndex, ft.id)
        }
        // Returning to select tool after a placement is the predictable next
        // step; otherwise the next click would drop another text box.
        if (tool === 'freetext') setTool('select')
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          ;(e.currentTarget as HTMLTextAreaElement).blur()
          setSelectedAnnotation(null)
        }
      }}
    />
  )
}
