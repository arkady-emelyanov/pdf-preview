import { useEffect } from 'react'
import { useStore } from './store'

/**
 * Copy the active text selection to the clipboard, with a textarea +
 * execCommand fallback for Wayland contexts where the async clipboard API is
 * unavailable. Returns true if something was copied.
 *
 * If the focused element is an editable input, defer to the platform's native
 * copy (returns false → caller can decide to do nothing or run execCommand).
 */
export async function copyTextSelection(): Promise<boolean> {
  const active = document.activeElement as HTMLElement | null
  const tag = active?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    document.execCommand('copy')
    return true
  }
  const s = useStore.getState()
  const ts = s.textSelection
  if (!ts) return false
  const vp = s.pages[ts.page]
  if (!vp) return false
  const chars = s.pageCharsCache.get(`${vp.sourceId}|${vp.sourceIndex}`)
  if (!chars) return false
  const lo = Math.min(ts.start, ts.end)
  const hi = Math.max(ts.start, ts.end)
  const slice = chars.text.slice(lo, hi + 1)
  try {
    await navigator.clipboard.writeText(slice)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = slice
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  return true
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA'
      const s = useStore.getState()
      const doc = s.doc
      const mod = e.ctrlKey || e.metaKey

      if (!inField && mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        s.openSearch()
        return
      }

      if (!doc) return

      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        s.toggleSidebar()
        return
      }

      if (mod && e.key === '0') {
        e.preventDefault()
        s.setZoomMode('fit-page')
        return
      }
      if (mod && e.key === '1') {
        e.preventDefault()
        s.setZoomMode('actual')
        return
      }
      if (mod && e.key === '2') {
        e.preventDefault()
        s.setZoomMode('fit-width')
        return
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        s.setScale(Math.min(6, s.scale + 0.25))
        return
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        s.setScale(Math.max(0.25, s.scale - 0.25))
        return
      }

      // Edit shortcuts
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (s.pages.length > 0) {
          const res = await window.pdf.save(s.sourcePaths(), doc.id, s.pages)
          if (res.ok) s.markSaved()
        }
        return
      }
      if (mod && e.key === '[') {
        e.preventDefault()
        s.rotateSelection(-90)
        return
      }
      if (mod && e.key === ']') {
        e.preventDefault()
        s.rotateSelection(90)
        return
      }
      if (inField) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (s.selectedAnnotation) {
          s.deleteAnnotation(s.selectedAnnotation.page, s.selectedAnnotation.id)
        } else {
          s.deleteSelection()
        }
        return
      }
      if (e.key.toLowerCase() === 'r' && !mod) {
        e.preventDefault()
        s.setTool('rect')
        return
      }
      if (e.key.toLowerCase() === 'o' && !mod) {
        e.preventDefault()
        s.setTool('oval')
        return
      }
      if (e.key.toLowerCase() === 'a' && !mod) {
        e.preventDefault()
        s.setTool('arrow')
        return
      }
      if (e.key.toLowerCase() === 'v' && !mod) {
        e.preventDefault()
        s.setTool('select')
        return
      }
      if (e.key.toLowerCase() === 't' && !mod) {
        e.preventDefault()
        s.setTool('text')
        return
      }
      if (e.key.toLowerCase() === 'n' && !mod) {
        e.preventDefault()
        s.setTool('note')
        return
      }
      if (e.key.toLowerCase() === 'f' && !mod) {
        e.preventDefault()
        s.setTool('freetext')
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        s.requestJump(Math.min(s.pages.length - 1, s.currentPage + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        s.requestJump(Math.max(0, s.currentPage - 1))
      } else if (e.key === 'Home') {
        e.preventDefault()
        s.requestJump(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        s.requestJump(s.pages.length - 1)
      } else if (e.key === 'Escape') {
        if (s.searchOpen) s.closeSearch()
        if (s.tool !== 'select') s.setTool('select')
        if (s.selectedAnnotation) s.setSelectedAnnotation(null)
        if (s.textSelection) s.setTextSelection(null)
        s.clearSelection()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
