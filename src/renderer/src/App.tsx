import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Toolbar } from './Toolbar'
import { Thumbnails } from './Thumbnails'
import { Viewport } from './Viewport'
import { SideNav } from './SideNav'
import { SearchBar } from './SearchBar'
import { useKeyboardShortcuts } from './keys'

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
