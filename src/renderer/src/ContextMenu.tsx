import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  enabled?: boolean
  onClick: () => void
}

interface Props {
  /** Viewport-relative anchor (clientX / clientY of the right-click). */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * Lightweight context-menu popover. Closes on outside-click or Escape, and
 * nudges itself away from the right / bottom viewport edge so it never spills
 * off-screen. Rendered via a portal so parent overflow can't clip it.
 */
export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 4
    const left = Math.min(x, window.innerWidth - width - margin)
    const top = Math.min(y, window.innerHeight - height - margin)
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && ref.current.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture-phase so we close before the new click does anything else.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }}>
      {items.map((item, i) => (
        <button
          key={i}
          className="ctx-menu-item"
          disabled={item.enabled === false}
          onClick={() => {
            if (item.enabled === false) return
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
