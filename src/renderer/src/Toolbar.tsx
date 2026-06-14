import { useStore } from './store'

export function Toolbar(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const scale = useStore((s) => s.scale)
  const zoomMode = useStore((s) => s.zoomMode)
  const currentPage = useStore((s) => s.currentPage)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setScale = useStore((s) => s.setScale)
  const setZoomMode = useStore((s) => s.setZoomMode)
  const requestJump = useStore((s) => s.requestJump)
  const openSearch = useStore((s) => s.openSearch)

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
      <strong className="doc-title">{doc?.name ?? 'Preview'}</strong>

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
              max={doc.pageCount}
              value={currentPage + 1}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) requestJump(Math.max(0, Math.min(doc.pageCount - 1, n - 1)))
              }}
              className="page-input"
            />{' '}
            / {doc.pageCount}
          </span>
          <button
            onClick={() => requestJump(Math.min(doc.pageCount - 1, currentPage + 1))}
            disabled={currentPage >= doc.pageCount - 1}
            title="Next page (→)"
          >
            ›
          </button>
        </>
      )}
    </div>
  )
}
