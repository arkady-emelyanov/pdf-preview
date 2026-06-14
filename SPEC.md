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

### 4.2 Annotations (v1) — *not yet*
- **Shapes:** rectangle, oval, line, arrow. Stroke color, stroke width, fill (opt), opacity. Drag to draw, resize handles, rotate handle.
- **Sticky notes:** anchored to page coordinate. Click to expand; collapsed icon by default. Author name from `git config user.name` or OS user.
- **Text boxes:** free-floating text, font (3–4 bundled), size, color.
- All annotations are selectable, moveable, deletable, undo/redo (Ctrl+Z/Y).
- Tool palette in toolbar; Esc returns to hand/select tool.

### 4.3 Forms — *not yet*
- **AcroForm:** render via PDFium's `renderFormFields` flag; capture filled state on save by re-reading the PDF and copying field values via pdf-lib. Option to flatten on export.
- **XFA:** detect via PDFium failure or `/XFA` key in catalog → switch that doc's viewport to PDF.js with XFA layer. Read-only fill in v1; document the limitation.

### 4.4 Page operations — *not yet*
- Thumbnail rail: **reorder** (drag-and-drop, multi-select), **rotate** 90° CW/CCW, **delete**.
- **Insert from another PDF**: file picker → choose insertion point → append or insert at index. Source pages copied via pdf-lib `copyPages`.
- **Extract / split:** select pages → "Extract to new PDF…" saves a subset.
- **Merge:** File → "Merge PDFs…" opens multi-file picker, concatenates in chosen order, opens result as a new untitled document.

All page ops apply to the in-memory edit graph (sidecar), not the source file, until the user saves.

### 4.5 Print — *not yet*
Custom print UI (renderer) that drives CUPS:

- Enumerate printers: `lpstat -e` + `lpoptions -p <name> -l` for capabilities.
- Render preview from current document state (post-edits) using pdf-lib to produce a temp PDF; pipe to `lp -d <printer> -o <opts>` (or `lpr`).
- UI controls: printer, copies, page range, page subset (odd/even/custom), duplex, paper size, orientation, scaling (fit / 100% / custom), color/mono.
- Background print job tracked via `lpstat -W not-completed` (best-effort status — non-blocking).

### 4.6 File I/O (**partial, M0**)
- File → Open menu **(done)**, drag-drop onto window **(planned)**, `app file.pdf` CLI **(done)**.
- One window per document. Opening same path focuses existing window. Blank window is reused on next Open. **(done)**
- "Recent" list (last 10, stored in `~/.config/<app>/recent.json`). *(planned)*
- Save / Save As / Export Flattened Copy / Export as Images (PNG per page). *(planned)*

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
│   │   ├── print.ts         CUPS pipeline                  [planned]
│   │   ├── pdf-writer.ts    pdf-lib bake worker            [planned]
│   │   ├── sidecar.ts                                      [planned]
│   │   └── recent.ts                                       [planned]
│   ├── preload/
│   │   └── index.ts         contextBridge API surface
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── store.ts         Zustand
│   │       ├── keys.ts          global keyboard shortcuts
│   │       ├── Toolbar.tsx
│   │       ├── SearchBar.tsx
│   │       ├── SideNav.tsx
│   │       ├── Thumbnails.tsx
│   │       ├── Viewport.tsx     virtualized page list
│   │       ├── PdfPage.tsx      single page + highlight overlay
│   │       └── index.css
│   └── shared/
│       ├── ipc.ts           DocInfo, PageRect, RenderedPageMsg
│       ├── ops.ts           edit-op types               [planned]
│       └── annotations.ts   annotation schema           [planned]
├── resources/
│   ├── icon.png             [TODO]
│   └── bin/qpdf             bundled native             [planned]
└── tests/                                              [planned]
```

---

## 8. IPC surface (preload contract)

```ts
// Implemented
window.pdf = {
  openCurrent(): Promise<DocInfo | null>,
  renderPage(id, pageIndex, scale): Promise<RenderedPageMsg | null>,
  getText(id, pageIndex): Promise<string | null>,
  findMatchRects(id, pageIndex, query): Promise<PageRect[] | null>,
  close(id): void,
  onDocAssigned(cb): () => void,   // main → renderer push when a blank
                                   // window gets bound to a path
}

// Planned for M2+
window.pdf = {
  ...
  save(): Promise<void>,
  saveAs(path, opts?): Promise<void>,
  exportFlattened(path): Promise<void>,
  exportImages(dir, fmt): Promise<void>,

  pushOps(ops: EditOp[]): Promise<void>,
  getSidecar(): Promise<Sidecar>,

  rotate(pages, deg): Promise<void>,
  delete(pages): Promise<void>,
  reorder(order): Promise<void>,
  insertFrom(srcPath, atIndex, srcPages?): Promise<void>,
  extract(pages, outPath): Promise<void>,
  mergeMany(paths): Promise<DocId>,

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

1. **M0 — Skeleton** ✅: Electron + Vite + React boilerplate, 1-window-per-doc with blank-window reuse, PDFium-WASM rendering to `<canvas>`, custom toolbar (no browser chrome), AppImage builds.
2. **M1 — Viewport + nav** ✅: virtualized rendering, thumbnail rail, page sync, zoom modes (fit-width/fit-page/actual/custom), Ctrl+F search with bbox highlights, full keyboard nav, system font mapper.
3. **M2 — Page ops**: reorder/rotate/delete in thumbnails, sidecar, pdf-lib bake on save. Insert/extract/merge.
4. **M3 — Annotations**: overlay canvas, shapes, sticky notes, text boxes, undo/redo, write into PDF as standard annotations.
5. **M4 — Forms**: AcroForm read-back on save; XFA fallback path with banner.
6. **M5 — Print**: CUPS pipeline, custom dialog, status.
7. **M6 — Polish + AppImage release**: icons, MIME registration, recent files, drag-drop open, crash recovery, CI release pipeline.
