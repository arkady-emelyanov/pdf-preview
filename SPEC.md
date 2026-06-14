# Preview-for-Linux — Spec (v1)

A Linux PDF viewer/editor inspired by macOS Preview, distributed as an AppImage.
Electron shell, **PDFium (WASM) for rendering and text/forms**, **pdf-lib** (and
**qpdf** for tasks pdf-lib can't do) for write-back. PDF.js kept as a per-doc
fallback for XFA forms.

---

## 1. Goals & non-goals

**Goals**
- Open, view, navigate, annotate, edit page structure, fill forms, and print PDFs on Linux.
- Match the "feels obvious" parts of macOS Preview: thumbnail sidebar, drag-to-reorder, one-window-per-doc, fast open.
- Ship as a single self-contained AppImage. No system deps beyond glibc + standard X11/Wayland libs that Electron already requires.
- Fully custom UI — **no Chromium PDF viewer chrome**. PDFium gives us bytes; we own every pixel of UI.

**Non-goals (v1)**
- No cryptographic digital signatures (PAdES/CMS).
- No drawn/image signature library.
- No password protection / encryption on export.
- No redaction (true content removal).
- No freehand ink, no text highlight/underline/strikethrough. *(Future.)*
- No OCR. No scanning.
- No cloud sync / collaboration.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Electron main process (Node)                        │
│   - window mgmt (1 BrowserWindow per document)       │
│   - file I/O, recent files, app menu                 │
│   - PDFium-WASM via @embedpdf/pdfium                  │
│   - System font mapper (FPDF_SetSystemFontInfo)      │
│   - print pipeline (spawn lp/lpr via CUPS)           │
│   - sidecar store (.preview-edits.json)              │
│   - PDF write-back worker (pdf-lib / qpdf)           │
└──────────────────────────────────────────────────────┘
                ▲ IPC (contextBridge)
                ▼
┌──────────────────────────────────────────────────────┐
│  Renderer (Chromium, no PDF plugin)                  │
│   ┌────────────────┐   ┌─────────────────────────┐   │
│   │ Thumbnail rail │   │ Main viewport            │  │
│   │ (virtualized,  │   │  <canvas> per page       │  │
│   │  IO-lazy)      │   │  (virtualized; renders   │  │
│   │                │   │   visible ± buffer)      │  │
│   │                │   │  + overlay <canvas>      │  │
│   │                │   │     for annotations       │  │
│   └────────────────┘   └─────────────────────────┘   │
│   Toolbar · Search · Side nav · Zoom · Page input    │
│   Zustand store per document window                  │
└──────────────────────────────────────────────────────┘
```

**Why PDFium-WASM (not Chromium's built-in `<embed>`):** the embed comes with
its own browser-chrome toolbar that can't be fully suppressed, and gives us no
page-coordinate hooks (needed for the annotation overlay). Running PDFium as a
WASM module in the main process lets us own the UI and get raw RGBA frames per
page that we draw on `<canvas>`.

**Renderer flow.** Main process holds the PDFium document. For each visible
page, the renderer calls `pdf:renderPage(id, idx, scale)` over IPC; main
PDF-renders to a raw RGBA buffer and ships it back. The renderer puts it on a
`<canvas>`. Annotations live on a transparent overlay `<canvas>` over the same
page rect.

**System fonts.** PDFium-WASM ships without system-font access, which breaks
PDFs that reference non-embedded fonts. We install our own
`FPDF_SYSFONTINFO` whose callbacks are bridged through Emscripten's
`addFunction`. The mapper scans system fonts via `fc-list`, then resolves PDF
font names via a substitution table that prefers cmap-compatible substitutes
(Liberation 2.x → Tinos → Nimbus → DejaVu/Noto). For CID Identity-H fonts with
no embedded program and no ToUnicode CMap (e.g. "TimesNewRomanPSMT"), only
real MS Core Fonts render correctly; we look for them first if installed
(`ttf-mscorefonts-installer`).

**XFA fallback:** if PDFium reports a document as XFA (or fails to render
forms), the viewport switches that document to PDF.js with the XFA layer
enabled. Annotations and page ops still work; performance degrades. Document
this as a known limitation.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Shell | Electron | Chromium runtime, but the PDF plugin is unused |
| Language | TypeScript | strict mode |
| Build | electron-vite + Vite | main/preload/renderer pipelines |
| UI | React | strict mode |
| State | Zustand | one store per document window |
| PDF read/render | **@embedpdf/pdfium** (PDFium-WASM) | low-level FPDF_* API, `addFunction` exported (needed for font mapper) |
| Text bbox / search | PDFium `FPDFText_*` | char-level boxes used for search highlights |
| System font mapper | custom `FPDF_SYSFONTINFO` | JS callbacks via Emscripten `addFunction` |
| PDF write | **pdf-lib** | annotations, page ops, AcroForm flatten |
| PDF write (heavy) | **qpdf** (bundled binary) | linearize, repair, things pdf-lib can't |
| XFA fallback | **pdf.js** | only when needed |
| Print | spawn `lp` / `lpr` (CUPS) | custom UI in renderer |
| Packaging | electron-builder → AppImage | `target: AppImage` |
| Tests | Vitest + Playwright (e-2e) | sample-pdfs fixture dir |

**Bundled native binaries:**
- `qpdf` — ELF, ~3 MB, linked against the AppImage's lib dir.
- Optional fallback: `mutool draw` (MuPDF) per page for documents PDFium-WASM
  can't render correctly. ~15 MB. AGPL — opt-in only.

---

## 4. Features (v1 scope)

### 4.1 View & navigation (**implemented in M1**)
- Continuous scroll across the document; virtualized rendering (visible ± buffer).
- Zoom modes: fit-width, fit-page, actual size, custom %. Toolbar select.
- Thumbnail sidebar (IntersectionObserver-lazy thumbnails at 0.25× scale).
- Page input (jump to N), prev/next buttons in toolbar and as floating side chevrons, Ctrl+F search with **per-line highlight rects** drawn from PDFium char boxes.
- Bookmarks: read PDF outline; jump on click. (Editing outline = future.)
- Keyboard shortcuts mirror Preview where sensible (⌘→Ctrl):
  - `Ctrl+F` find, `Ctrl+L` sidebar
  - `Ctrl+0` fit page, `Ctrl+1` actual, `Ctrl+2` fit width, `Ctrl+±` zoom
  - `↑/↓`, `PgUp/PgDn`, `Space`, `Home/End` page nav
  - `Esc` close search
  - `Ctrl+Shift+I` DevTools (hidden), `Ctrl+R` reload (hidden)

### 4.2 Annotations (v1) — *M3 in progress*

Storage: annotations are attached to a `VirtualPage` via an optional
`annotations: Annotation[]` array. Geometry is stored in PDF page points
(origin bottom-left) so it survives zoom changes and re-opens at the same
position. Because annotations live inside the edit-graph snapshot, they
participate in the existing undo/redo stack and dirty-flag plumbing without
new machinery.

Rendering: each `<PdfPage>` overlays a transparent `<AnnotationLayer>` canvas
sized to match the rendered page. The layer redraws on annotation/selection
changes, handles pointer input for the active tool, and shows a dashed blue
marquee around the selected annotation. v1 punt: drawing is disabled on a
virtual page with non-zero rotation delta (same compromise as search
highlights), since reprojection through the rotation isn't worth implementing
twice.

- **Shapes:** rectangle ✅; oval, line, arrow planned. Stroke color, stroke
  width, fill (opt), opacity. Drag to draw. (Resize / rotate handles planned
  in the next slice.)
- **Sticky notes**: planned. Anchored to page coordinate. Click to expand;
  collapsed icon by default. Author from `git config user.name` or OS user.
- **Text boxes**: planned. Free-floating text, font (3–4 bundled), size, color.
- All annotations are selectable, moveable, deletable, undo/redo ✅
  (Ctrl+Z/Y). Select tool: click hit-tests in PDF coords, drag moves.
- Tool palette in toolbar ✅ (Select / Rect for now). `Esc` returns to select
  tool and clears any annotation selection; `R` activates Rect, `V` Select.
- Save bakes rect annotations as standard `/Square` annotation dicts via
  pdf-lib's low-level `context.obj` API (Subtype, Rect, C, CA, BS, M, NM).
  Round-trip tests in `tests/save.test.ts` confirm the dict structure.

### 4.3 Forms — *not yet*
- **AcroForm:** render via PDFium's `renderFormFields` flag; capture filled state on save by re-reading the PDF and copying field values via pdf-lib. Option to flatten on export.
- **XFA:** detect via PDFium failure or `/XFA` key in catalog → switch that doc's viewport to PDF.js with XFA layer. Read-only fill in v1; document the limitation.

### 4.4 Page operations (**implemented in M2 / M2.1 / M2.2**)

Edit model is a list of `VirtualPage {sourceId, sourceIndex, rotation}` stored in
the renderer's Zustand store. `sourceId` is the canonical path of the source PDF
(the primary document on open, or any secondary registered via Insert / Merge).
The renderer also keeps a `sources: Record<sourceId, SourceInfo>` map so layout,
thumbnails, and search can resolve page geometry per source. Each mutation pushes
the prior snapshot to the undo stack and clears redo; `markSaved()` snapshots
current as the "clean" reference. Dirty = current pages ≠ saved snapshot. Dirty
state also feeds Electron's `setDocumentEdited` and prefixes the title with "• ".

- **Multi-select in thumbnails** ✅: click, Ctrl+click toggle, Shift+click range.
- **Rotate** ✅: 90° CW/CCW. Toolbar buttons, `Ctrl+[` / `Ctrl+]`. Operates on selection or current page. PDFium's render flag handles the actual rotation; layout swaps width/height for 90°/270°.
- **Delete** ✅: Toolbar `✕`, `Delete` / `Backspace`. Refuses to delete the last page. Adjusts `currentPage` to stay valid.
- **Reorder** ✅: HTML5 drag-and-drop in the thumbnail rail with above/below drop indicator. If the dragged thumb is in the current selection, the whole selection moves together. `moveIndexMap()` rewrites selection and `currentPage` so they follow the move.
- **Undo / Redo** ✅: `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`). Toolbar buttons. Snapshot-based undo stack capped at 200 entries.
- **Save** ✅: `Ctrl+S`. `pdf-lib` bakes the edit graph by recreating the document via `copyPages` in the requested order and writing absolute `/Rotate` = source rotation + delta. On success, PDFium reopens the file so subsequent renders see the new state.
- **Save As** ✅: `Ctrl+Shift+S` or File menu. `dialog.showSaveDialog` → bake to chosen path. Auto-appends `.pdf`.
- **Export Selection As** ✅: File menu or toolbar `⇲` (enabled when selection ≠ ∅). Writes a subset of pages to a chosen path.
- **Insert from another PDF** ✅: File → "Insert Pages from PDF…" or toolbar `＋`. Opens a file picker, registers the secondary source via `pdf:registerSource` (canonical path is its `sourceId`; PDFium keeps it open alongside the primary), then inserts its identity page list after the current page. Inserted thumbs get a blue inset border so it's obvious which pages came from elsewhere.
- **Merge** ✅: File → "Merge PDFs…". Multi-select file picker, registers each source, appends all pages in pick order to the end of the current edit graph. Output stays in the current window; user saves with Save As to materialize.

Save / Save As / Export Selection As all take a `sources: Record<sourceId, path>` map so the bake (`saveDoc`) can load each source PDF once and copy pages from it. Consecutive pages from the same source are batched into a single `copyPages` call. Metadata is carried over from whichever source the first page references.

All page ops apply to the in-memory edit graph, not the source file, until the user saves. Sidecar (`.preview-edits.json`) for crash recovery is still planned.

### 4.5 Print — *not yet*
Custom print UI (renderer) that drives CUPS:

- Enumerate printers: `lpstat -e` + `lpoptions -p <name> -l` for capabilities.
- Render preview from current document state (post-edits) using pdf-lib to produce a temp PDF; pipe to `lp -d <printer> -o <opts>` (or `lpr`).
- UI controls: printer, copies, page range, page subset (odd/even/custom), duplex, paper size, orientation, scaling (fit / 100% / custom), color/mono.
- Background print job tracked via `lpstat -W not-completed` (best-effort status — non-blocking).

### 4.6 File I/O (**M0 + M2 work, recent files still planned**)
- File → Open menu ✅ (`Ctrl+O`), drag-and-drop onto window ✅, double-click empty placeholder ✅, `app file.pdf` CLI ✅.
- One window per document. Opening same path focuses existing window. Blank window is reused on next Open. ✅
- Save ✅ / Save As ✅ / Export Selection As ✅.
- "Recent" list (last 10, stored in `~/.config/<app>/recent.json`). *(planned)*
- Export Flattened Copy / Export as Images (PNG per page). *(planned, M4 / M6)*

---

## 5. Persistence model

**Two layers:**

1. **Live edit sidecar** — `<doc>.preview-edits.json`, stored next to the PDF (or in `~/.cache/<app>/sidecars/<sha1>.json` if the directory is read-only). Records:
   - Page reorder/rotate/delete operations (as an op list).
   - Annotations (id, page, kind, geometry, style, text, author, timestamp).
   - Form field overrides not yet baked.
   - Schema-versioned (`schemaVersion: 1`).
2. **PDF write-back on Save** — pdf-lib materializes the sidecar into the PDF: page ops via `copyPages`/`removePage`/`setRotation`; annotations as standard PDF annotation dictionaries (`/Square`, `/Circle`, `/Line`, `/FreeText`, `/Text` for sticky notes). After successful write the sidecar is cleared (or kept as `.bak.json` for one undo cycle).

**Why both:** Preview-like instant edits + non-destructive workflow, but the saved file is portable and opens correctly in Acrobat, Preview, Okular.

**Crash recovery:** sidecar is flushed on every mutation (debounced 500ms). On open, if a sidecar exists for a PDF, prompt: "Restore unsaved edits?"

---

## 6. AppImage packaging

- `electron-builder` config, `target: AppImage`, `category: Office`.
- Embed: Node runtime, Chromium, app JS, `qpdf` binary, PDFium WASM, optional MuPDF.
- Desktop integration: `.desktop` file inside AppImage; first-run offers to register MIME (`application/pdf`) via `xdg-mime`.
- **Document MS Core Fonts dependency.** Some PDFs (CID Identity-H with no ToUnicode) only render correctly when MS fonts are installed. README points users at `ttf-mscorefonts-installer`.
- Auto-update: skip in v1 (AppImageUpdate is a separate can of worms). Provide an in-app "Check for updates" that links to releases page.
- CI: GitHub Actions builds AppImage on push to `main`; releases on tag.

---

## 7. Project layout

```
pdf/
├── SPEC.md                  (this file)
├── CLAUDE.md                (orientation notes for Claude / contributors)
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig{,.node,.web}.json
├── src/
│   ├── main/                Electron main
│   │   ├── index.ts         IPC handlers, app lifecycle
│   │   ├── windows.ts       1-window-per-doc registry, blank-window reuse
│   │   ├── menu.ts          application menu
│   │   ├── pdfium.ts        PDFium-WASM wrapper (FPDF_* low-level)
│   │   ├── fonts.ts         system-font mapper (FPDF_SetSystemFontInfo)
│   │   ├── save.ts          pdf-lib bake: copyPages + abs /Rotate
│   │   ├── print.ts         CUPS pipeline                  [planned]
│   │   ├── sidecar.ts                                      [planned]
│   │   └── recent.ts                                       [planned]
│   ├── preload/
│   │   └── index.ts         contextBridge API surface
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.tsx           window-level DnD open
│   │       ├── store.ts          Zustand + edit slice (undo/redo, selection)
│   │       ├── keys.ts           global keyboard shortcuts
│   │       ├── Toolbar.tsx       undo/redo/rotate/delete/save buttons
│   │       ├── SearchBar.tsx
│   │       ├── SideNav.tsx
│   │       ├── Thumbnails.tsx    selection + DnD reorder
│   │       ├── Viewport.tsx      virtualized page list
│   │       ├── PdfPage.tsx       single page + highlight overlay
│   │       └── index.css
│   └── shared/
│       ├── ipc.ts           DocInfo, PageRect, RenderedPageMsg
│       ├── edit.ts          VirtualPage, applyRotate/Delete/Move helpers
│       └── annotations.ts   annotation schema           [planned]
├── resources/
│   ├── icon.png             placeholder
│   └── bin/qpdf             bundled native             [planned]
└── tests/                   Vitest — fonts, store, edit, save, pdfium
```

---

## 8. IPC surface (preload contract)

```ts
// Implemented
window.pdf = {
  // Read
  openCurrent(): Promise<DocInfo | null>,
  renderPage(id, pageIndex, scale, rotation?): Promise<RenderedPageMsg | null>,
  getText(id, pageIndex): Promise<string | null>,
  findMatchRects(id, pageIndex, query): Promise<PageRect[] | null>,

  // Write (M2 / M2.1 / M2.2 — multi-source)
  save(sources: Record<string, string>, destId, pages: VirtualPage[]):
    Promise<{ ok: true } | { ok: false; error: string }>,
  saveAs(sources, pages, defaultName):
    Promise<{ ok: true; path } | { ok: false; error? }>,
  setDirty(dirty): void,

  // Secondary sources (Insert + Merge)
  registerSource(path): Promise<SourceInfo>,
  pickFiles(multi: boolean): Promise<string[]>,

  // File / window
  close(id): void,
  showOpenDialog(): void,
  openPath(path): void,
  pathForDroppedFile(file): string,
  onDocAssigned(cb): () => void,
  onMenu(
    'save' | 'saveAs' | 'extractSelection' | 'insertPages' | 'mergePdfs',
    cb
  ): () => void,
}

// Planned for M3+
window.pdf = {
  // Sidecar (crash recovery)
  pushOps(ops: EditOp[]): Promise<void>,
  getSidecar(): Promise<Sidecar>,

  // Annotations / forms (M3 / M4)
  exportFlattened(path): Promise<void>,
  exportImages(dir, fmt): Promise<void>,

  // Print (M5)
  listPrinters(): Promise<PrinterInfo[]>,
  print(job): Promise<JobId>,
  jobStatus(id): Promise<JobStatus>,
}
```

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

---

## 9. Risks & open questions

- **PDFium-WASM font handling.** We use `FPDF_SetSystemFontInfo` with JS callbacks via Emscripten's `addFunction` — that requires the WASM build to export `addFunction`. `@embedpdf/pdfium` does. If we ever swap WASM builds, verify this export first or the font mapper silently no-ops.
- **CID Identity-H + no ToUnicode** is the hard case. Even cmap-compatible substitutes don't render correctly because glyph-index parity isn't guaranteed. The only complete fix is Microsoft Core Fonts (free to install via `ttf-mscorefonts-installer`, EULA prevents redistribution). README must call this out.
- **`@embedpdf/pdfium` is single-maintainer.** Active (releases every ~5 days), backed by a commercial product. Bus factor is real but lock-in is minimal: ~150 lines in `src/main/pdfium.ts`.
- **WASM cost.** PDFium-WASM init takes ~300–500ms on first open; subsequent opens are fast. Consider preloading at app start.
- **Reaches into PDFium internals.** Our font mapper and char-box code use `mod.pdfium.HEAPU8` / `wasmExports.malloc` etc. directly, which depend on Emscripten conventions. Stable so far but worth pinning the version.
- **XFA**: PDFium-in-Chromium has no XFA. PDF.js fallback works for view + fill but persisting XFA edits is unreliable. Decision: read-only XFA fill in v1, with a banner "XFA forms cannot be saved with edits."
- **AppImage + Electron sandbox** sometimes fights with `chrome-sandbox` perms. Standard fix: `--no-sandbox` is *not* acceptable; ship with `chrome-sandbox` SUID bits set via builder's `linux.executableArgs` config.
- **CUPS variation**: some distros use `cups-filters`, some have `lpr` aliased to BSD `lpr`. Probe at runtime; prefer `lp` (System V).

---

## 10. Milestones

1. **M0 — Skeleton** ✅: Electron + Vite + React boilerplate, 1-window-per-doc with blank-window reuse, PDFium-WASM rendering to `<canvas>`, custom toolbar (no browser chrome), AppImage builds, drag-drop / double-click open.
2. **M1 — Viewport + nav** ✅: virtualized rendering, thumbnail rail, page sync, zoom modes, Ctrl+F search with bbox highlights, full keyboard nav, system font mapper.
3. **M2 — Page ops** ✅: rotate ✅, delete ✅, drag-reorder ✅, multi-select ✅, undo/redo with snapshot stacks ✅, dirty indicator ✅, Save / Save As / Export Selection As ✅ via pdf-lib bake, Insert-from-other-PDF ✅, Merge ✅ (both via multi-source `VirtualPage {sourceId, ...}` and a secondary-source registry in main). Sidecar crash recovery: deferred to M6.
4. **M3 — Annotations** ◐: overlay canvas ✅, rectangle shape ✅ (draw + select + move + delete + undo/redo + `/Square` write-back). Remaining: oval / line / arrow shapes, resize/rotate handles, color picker, sticky notes, text boxes.
5. **M4 — Forms**: AcroForm read-back on save; XFA fallback path with banner.
6. **M5 — Print**: CUPS pipeline, custom dialog, status.
7. **M6 — Polish + AppImage release**: real icon, MIME registration, recent files, sidecar crash recovery, CI release pipeline.
