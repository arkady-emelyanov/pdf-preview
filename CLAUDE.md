# Preview-for-Linux — orientation

A macOS-Preview-style PDF viewer/editor for Linux, shipped as an AppImage.
Read `SPEC.md` for the full design. This file is the short version.

## Stack
- **Electron + TypeScript + React + Vite** (via `electron-vite`).
- **PDFium-WASM** via [`@embedpdf/pdfium`](https://npmjs.com/package/@embedpdf/pdfium) for rendering and text APIs. Runs in the main process; the renderer asks for raw RGBA frames over IPC and draws them on `<canvas>`.
- **Zustand** for renderer state, one store per window.
- **pdf-lib** (and bundled **qpdf**) for write-back. Not yet wired up — that's M2.

We do *not* use Chromium's built-in PDF viewer. Every pixel of UI is ours.

## Layout (real, not aspirational)
```
src/
  main/
    index.ts       Electron lifecycle, IPC handlers
    windows.ts     1-window-per-doc, blank-window reuse
    menu.ts        application menu (DevTools hidden)
    pdfium.ts      PDFium-WASM wrapper, low-level FPDF_* calls
    fonts.ts       System-font mapper (FPDF_SetSystemFontInfo)
  preload/index.ts contextBridge → window.pdf API
  renderer/src/
    App.tsx, Toolbar.tsx, Viewport.tsx, PdfPage.tsx,
    Thumbnails.tsx, SideNav.tsx, SearchBar.tsx,
    store.ts (Zustand), keys.ts (shortcuts)
  shared/ipc.ts    Types shared across processes
```

## Running it
```
npm install
npm run dev              # Electron + Vite HMR
npm run dev -- file.pdf  # open a file directly
npm run typecheck
npm run build            # produce out/
npm run build:appimage   # produce release/Preview-x.y.z.AppImage
```

Debug font substitution:
```
PDFIUM_FONT_DEBUG=1 npm run dev
```

## Gotchas worth knowing
- **`@embedpdf/pdfium`'s `init()` returns a wrapper.** The cwrap'd functions live on the top-level object (`mod.FPDF_LoadMemDocument`), but the raw Emscripten module (`HEAPU8`, `wasmExports.malloc`, `addFunction`, `HEAPF64`) lives under `mod.pdfium`. We have an `em(mod)` helper for this.
- **PDFium returns BGRA but `@embedpdf/pdfium` sets `FPDF_REVERSE_BYTE_ORDER`**, so what we get back IS already RGBA. Don't swap channels.
- **`addFunction` requires the WASM build to export it.** `@embedpdf/pdfium` does; `@hyzyla/pdfium` does NOT. The font mapper depends on this.
- **CID Identity-H + no ToUnicode + no embed** is unfixable without the original font. Suggestion in README is `sudo apt install ttf-mscorefonts-installer`. Our substitution table prefers MS Core Fonts when present, then Liberation 2.x / Tinos for cmap parity, then Nimbus for old Type 1 cases.
- **Char-box for search highlights** reaches `mod.pdfium.HEAPF64` directly. PDF points are origin-bottom-left; we convert to origin-top-left for canvas overlay.
- **The renderer does not run Node.** All FS / WASM lives in main. IPC for everything.
- **No `chrome-sandbox` workarounds.** Sandbox stays on; if AppImage fails on a distro, fix the SUID config, don't disable.

## Style
- TypeScript strict mode everywhere.
- No emojis in code or commit messages unless asked.
- Prefer editing existing files; don't create new ones if a place exists.
- Don't write comments that just restate the code. Comments explain *why*, not *what*.
