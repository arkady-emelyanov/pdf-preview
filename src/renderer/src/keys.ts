import { useEffect } from 'react'
import { useStore } from './store'

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA'
      const s = useStore.getState()
      const doc = s.doc

      // Ctrl+F always (even from inputs? skip from inputs to keep native find-in-input)
      if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        s.openSearch()
        return
      }

      if (!doc) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        s.toggleSidebar()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        s.setZoomMode('fit-page')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault()
        s.setZoomMode('actual')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault()
        s.setZoomMode('fit-width')
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        s.setScale(Math.min(6, s.scale + 0.25))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        s.setScale(Math.max(0.25, s.scale - 0.25))
        return
      }

      if (inField) return

      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        s.requestJump(Math.min(doc.pageCount - 1, s.currentPage + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        s.requestJump(Math.max(0, s.currentPage - 1))
      } else if (e.key === 'Home') {
        e.preventDefault()
        s.requestJump(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        s.requestJump(doc.pageCount - 1)
      } else if (e.key === 'Escape') {
        if (s.searchOpen) s.closeSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
