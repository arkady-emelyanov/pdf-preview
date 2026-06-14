import { useState } from 'react'
import { useStore } from './store'
import { pagesEqual } from '../../shared/edit'

export function Toolbar(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const pages = useStore((s) => s.pages)
  const savedPages = useStore((s) => s.savedPages)
  const undoStack = useStore((s) => s.undoStack)
  const redoStack = useStore((s) => s.redoStack)
  const scale = useStore((s) => s.scale)
  const zoomMode = useStore((s) => s.zoomMode)
  const currentPage = useStore((s) => s.currentPage)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setScale = useStore((s) => s.setScale)
  const setZoomMode = useStore((s) => s.setZoomMode)
  const requestJump = useStore((s) => s.requestJump)
  const openSearch = useStore((s) => s.openSearch)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const rotateSelection = useStore((s) => s.rotateSelection)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const markSaved = useStore((s) => s.markSaved)
  const [busy, setBusy] = useState(false)

  const dirty = !pagesEqual(pages, savedPages)

  const onSave = async (): Promise<void> => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const res = await window.pdf.save(doc.id, pages)
      if (res.ok) {
        markSaved()
      } else {
        // eslint-disable-next-line no-alert
        alert(`Save failed: ${res.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="toolbar">
      <button
        className="icon-btn"
        title="Toggle sidebar (Ctrl+L)"
        onClick={toggleSidebar}
        aria-pressed={sidebarOpen}
      >
        ☰
      </button>
      <strong className="doc-title">
        {dirty ? '• ' : ''}
        {doc?.name ?? 'Preview'}
      </strong>

      {doc && (
        <>
          <div className="divider" />
          <button onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
          <div className="divider" />
          <button
            onClick={() => rotateSelection(-90)}
            title="Rotate left (Ctrl+[)"
          >
            ⟲
          </button>
          <button
            onClick={() => rotateSelection(90)}
            title="Rotate right (Ctrl+])"
          >
            ⟳
          </button>
          <button onClick={() => deleteSelection()} title="Delete page(s) (Del)">
            ✕
          </button>
          <div className="divider" />
          <button onClick={onSave} disabled={!dirty || busy} title="Save (Ctrl+S)">
            {busy ? '…' : '💾'}
          </button>
        </>
      )}

      <div className="spacer" />

      <button className="icon-btn" title="Find (Ctrl+F)" onClick={openSearch}>
        🔍
      </button>

      <div className="divider" />

      <button onClick={() => setScale(Math.max(0.25, scale - 0.25))}>−</button>
      <select
        value={zoomMode === 'custom' ? 'custom' : zoomMode}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'fit-width' || v === 'fit-page' || v === 'actual') setZoomMode(v)
          else setScale(scale)
        }}
        className="zoom-select"
      >
        <option value="fit-width">Fit Width</option>
        <option value="fit-page">Fit Page</option>
        <option value="actual">Actual Size</option>
        <option value="custom">{Math.round(scale * 100)}%</option>
      </select>
      <button onClick={() => setScale(Math.min(6, scale + 0.25))}>+</button>

      {doc && (
        <>
          <div className="divider" />
          <button
            onClick={() => requestJump(Math.max(0, currentPage - 1))}
            disabled={currentPage <= 0}
            title="Previous page (←)"
          >
            ‹
          </button>
          <span className="meta">
            <input
              type="number"
              min={1}
              max={pages.length}
              value={currentPage + 1}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) requestJump(Math.max(0, Math.min(pages.length - 1, n - 1)))
              }}
              className="page-input"
            />{' '}
            / {pages.length}
          </span>
          <button
            onClick={() => requestJump(Math.min(pages.length - 1, currentPage + 1))}
            disabled={currentPage >= pages.length - 1}
            title="Next page (→)"
          >
            ›
          </button>
        </>
      )}
    </div>
  )
}
