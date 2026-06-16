import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Toolbar } from './Toolbar'
import { Thumbnails } from './Thumbnails'
import { Viewport } from './Viewport'
import { SideNav } from './SideNav'
import { SearchBar } from './SearchBar'
import { copyTextSelection, useKeyboardShortcuts } from './keys'
import { pagesEqual } from '../../shared/edit'

export function App(): JSX.Element {
  const setDoc = useStore((s) => s.setDoc)
  const [dragOver, setDragOver] = useState(false)
  useKeyboardShortcuts()

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const info = await window.pdf.openCurrent()
      if (cancelled) return
      setDoc(info)
    }
    load()
    const off = window.pdf.onDocAssigned(load)
    return () => {
      cancelled = true
      off()
    }
  }, [setDoc])

  // Edit > Copy / Cut / Paste. Each fires its own renderer-side handler that
  // chooses between the app's annotation clipboard (or PDF text selection)
  // and the native browser clipboard, based on what's currently in focus.
  useEffect(() => {
    const offs = [
      window.pdf.onMenu('copy', () => void copyTextSelection()),
      window.pdf.onMenu('cut', () => {
        const s = useStore.getState()
        const a = document.activeElement as HTMLElement | null
        const tag = a?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || a?.isContentEditable) {
          document.execCommand('cut')
          return
        }
        if (s.selectedAnnotation) {
          s.cutAnnotation(s.selectedAnnotation.page, s.selectedAnnotation.id)
        }
      }),
      window.pdf.onMenu('paste', () => {
        const s = useStore.getState()
        const a = document.activeElement as HTMLElement | null
        const tag = a?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || a?.isContentEditable) {
          document.execCommand('paste')
          return
        }
        if (s.clipboard) {
          // No specific click point for keyboard paste — drop at the centre
          // of the current page. Right-click → Paste still uses the cursor
          // point for precise placement.
          const vp = s.pages[s.currentPage]
          if (!vp) return
          const sz = s.sourceSize(vp.sourceId, vp.sourceIndex)
          s.pasteAnnotation(s.currentPage, sz.width / 2, sz.height / 2)
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Menu-driven page/edit ops. These all read state fresh from the store, so
  // a single attach with [] deps avoids the stale-closure trap.
  useEffect(() => {
    const offs = [
      window.pdf.onMenu('undo', () => useStore.getState().undo()),
      window.pdf.onMenu('redo', () => useStore.getState().redo()),
      window.pdf.onMenu('rotateLeft', () => useStore.getState().rotateSelection(-90)),
      window.pdf.onMenu('rotateRight', () => useStore.getState().rotateSelection(90)),
      window.pdf.onMenu('deletePages', () => useStore.getState().deleteSelection()),
      window.pdf.onMenu('find', () => useStore.getState().openSearch())
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Push the bits of state that drive menu enablement to main. setMenuState
  // de-dupes, so churning through irrelevant store changes is cheap.
  useEffect(() => {
    const push = (): void => {
      const s = useStore.getState()
      // Editable native focus: real INPUT / TEXTAREA elements, OR any
      // contentEditable surface (NOT FormLayer — keystrokes there go to
      // PDFium, not the browser clipboard).
      const a = document.activeElement as HTMLElement | null
      const tag = a?.tagName
      const hasInputFocus =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (!!a?.isContentEditable && !a.classList.contains('form-layer'))
      window.pdf.setMenuState({
        hasDoc: !!s.doc,
        dirty: !pagesEqual(s.pages, s.savedPages) || s.formDirty,
        canUndo: s.undoStack.length > 0,
        canRedo: s.redoStack.length > 0,
        hasSelection: s.selection.size > 0,
        hasTextSelection: !!s.textSelection,
        hasAnnotationSelection: !!s.selectedAnnotation,
        hasClipboard: !!s.clipboard,
        hasInputFocus
      })
    }
    push() // initial state on first mount
    const unsub = useStore.subscribe(push)
    // Focus changes don't go through Zustand, so listen at the DOM level.
    const onFocus = (): void => push()
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('focusout', onFocus, true)
    return () => {
      unsub()
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('focusout', onFocus, true)
    }
  }, [])

  // Window-level drag-and-drop. preventDefault on dragover is required for drop
  // to fire; without dragleave bookkeeping the overlay flickers as the cursor
  // moves between child elements.
  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      depth++
      setDragOver(true)
    }
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      for (const file of pdfs) {
        const path = window.pdf.pathForDroppedFile(file)
        if (path) window.pdf.openPath(path)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <SearchBar />
      <div className="body">
        <Thumbnails />
        <div className="viewport-container">
          <Viewport />
          <SideNav />
        </div>
      </div>
      {dragOver && <div className="drop-target">Drop PDF to open</div>}
    </div>
  )
}
