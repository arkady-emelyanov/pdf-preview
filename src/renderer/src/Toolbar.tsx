import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { identityPages, type VirtualPage } from '../../shared/edit'
import { AnnotationProps } from './AnnotationProps'

function basenameNoExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function Toolbar(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const pages = useStore((s) => s.pages)
  const selection = useStore((s) => s.selection)
  const currentPage = useStore((s) => s.currentPage)
  const scale = useStore((s) => s.scale)
  const zoomMode = useStore((s) => s.zoomMode)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setScale = useStore((s) => s.setScale)
  const setZoomMode = useStore((s) => s.setZoomMode)
  const requestJump = useStore((s) => s.requestJump)
  const openSearch = useStore((s) => s.openSearch)
  const insertPages = useStore((s) => s.insertPages)
  const registerSource = useStore((s) => s.registerSource)
  const sourcePaths = useStore((s) => s.sourcePaths)
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const markSaved = useStore((s) => s.markSaved)
  const renameDoc = useStore((s) => s.renameDoc)
  const [busy, setBusy] = useState(false)

  const doSave = async (): Promise<void> => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const res = await window.pdf.save(sourcePaths(), doc.id, pages)
      if (res.ok) markSaved()
      else alert(`Save failed: ${res.error}`)
    } finally {
      setBusy(false)
    }
  }

  const doSaveAs = async (): Promise<void> => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const def = `${basenameNoExt(doc.name)} copy.pdf`
      const res = await window.pdf.saveAs(sourcePaths(), pages, def)
      if (res.ok) {
        // Adopt the new file as the window's identity: re-bind the window's
        // path in main (title + path registry), register the new path as a
        // source so future saves can write to it, then rename + clear dirty
        // on the renderer side.
        const src = await window.pdf.rebindPath(res.path)
        if (src) registerSource(src)
        renameDoc(res.path, basenameOf(res.path))
      } else if (res.error) {
        alert(`Save As failed: ${res.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const doExtract = async (): Promise<void> => {
    if (!doc || busy || selection.size === 0) return
    setBusy(true)
    try {
      const subset = [...selection]
        .sort((a, b) => a - b)
        .map((i) => pages[i])
        .filter(Boolean)
      const def = `${basenameNoExt(doc.name)} extract.pdf`
      const res = await window.pdf.saveAs(sourcePaths(), subset, def)
      if (res.ok === false && res.error) alert(`Extract failed: ${res.error}`)
    } finally {
      setBusy(false)
    }
  }

  const doInsert = async (): Promise<void> => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const paths = await window.pdf.pickFiles(false)
      if (paths.length === 0) return
      const src = await window.pdf.registerSource(paths[0])
      registerSource(src)
      const inserts: VirtualPage[] = identityPages(src.sourceId, src.pageCount, src.annotations)
      // Insert AFTER currentPage (or at end if no doc).
      const target = pages.length === 0 ? 0 : currentPage + 1
      insertPages(inserts, target)
    } finally {
      setBusy(false)
    }
  }

  const doSaveAndClose = async (): Promise<void> => {
    if (!doc) {
      window.pdf.saveAndCloseResult(true)
      return
    }
    setBusy(true)
    try {
      const res = await window.pdf.save(sourcePaths(), doc.id, pages)
      if (res.ok) {
        markSaved()
        window.pdf.saveAndCloseResult(true)
      } else {
        alert(`Save failed: ${res.error}`)
        window.pdf.saveAndCloseResult(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const doMerge = async (): Promise<void> => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const paths = await window.pdf.pickFiles(true)
      if (paths.length === 0) return
      const aggregated: VirtualPage[] = []
      for (const p of paths) {
        const src = await window.pdf.registerSource(p)
        registerSource(src)
        aggregated.push(...identityPages(src.sourceId, src.pageCount, src.annotations))
      }
      // Append to end.
      insertPages(aggregated, pages.length)
    } finally {
      setBusy(false)
    }
  }

  // Menu IPCs fire after first render, by which point `doc`/`pages`/etc. have
  // shifted from their initial nulls. The effect can only attach once (no
  // good deps to list), so route through a ref that we refresh every render —
  // the IPC handler always invokes the latest closure.
  const handlersRef = useRef({
    doSave,
    doSaveAs,
    doExtract,
    doInsert,
    doMerge,
    doSaveAndClose
  })
  handlersRef.current = { doSave, doSaveAs, doExtract, doInsert, doMerge, doSaveAndClose }

  useEffect(() => {
    const off1 = window.pdf.onMenu('save', () => void handlersRef.current.doSave())
    const off2 = window.pdf.onMenu('saveAs', () => void handlersRef.current.doSaveAs())
    const off3 = window.pdf.onMenu(
      'extractSelection',
      () => void handlersRef.current.doExtract()
    )
    const off4 = window.pdf.onMenu(
      'insertPages',
      () => void handlersRef.current.doInsert()
    )
    const off5 = window.pdf.onMenu(
      'mergePdfs',
      () => void handlersRef.current.doMerge()
    )
    const off6 = window.pdf.onMenu(
      'saveAndClose',
      () => void handlersRef.current.doSaveAndClose()
    )
    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
    }
  }, [])

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

      {doc && (
        <>
          <div className="divider" />
          <button
            onClick={() => setTool('select')}
            aria-pressed={tool === 'select'}
            title="Select tool (V)"
          >
            ↖
          </button>
          <button
            onClick={() => setTool('text')}
            aria-pressed={tool === 'text'}
            title="Select text (T)"
            style={{ fontFamily: 'serif', fontSize: 16 }}
          >
            ⌶
          </button>
          <div className="divider" />
          <button
            onClick={() => setTool('rect')}
            aria-pressed={tool === 'rect'}
            title="Rectangle annotation (R)"
          >
            ▭
          </button>
          <button
            onClick={() => setTool('oval')}
            aria-pressed={tool === 'oval'}
            title="Oval annotation (O)"
          >
            ◯
          </button>
          <button
            onClick={() => setTool('arrow')}
            aria-pressed={tool === 'arrow'}
            title="Arrow annotation (A)"
          >
            ↗
          </button>
          <button
            onClick={() => setTool('note')}
            aria-pressed={tool === 'note'}
            title="Sticky note (N)"
          >
            🗒
          </button>
          <AnnotationProps />
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
