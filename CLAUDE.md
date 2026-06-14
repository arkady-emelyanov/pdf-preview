# Preview-for-Linux

Electron + TypeScript + React. PDFium-WASM (`@embedpdf/pdfium`) in main, raw RGBA over IPC, custom `<canvas>` renderer. Zustand state. See `SPEC.md` for design.

## Run
```
npm run dev               # Electron + Vite HMR
npm run dev -- file.pdf
npm test                  # vitest
npm run typecheck
npm run build:appimage
```

`PDFIUM_FONT_DEBUG=1` logs every MapFont call.

## Gotchas
- `init()` returns a wrapper. cwrap'd FPDF_* on the wrapper; raw Emscripten module (`HEAPU8`, `wasmExports`, `addFunction`, `HEAPF64`) is at `mod.pdfium`. Use the `em()` helper.
- PDFium gives us RGBA, not BGRA — we set `FPDF_REVERSE_BYTE_ORDER`. Don't swap channels.
- Font mapper depends on Emscripten `addFunction` being exported by the WASM build.
- CID Identity-H + no ToUnicode + no embed = only Microsoft Core Fonts render correctly. `ttf-mscorefonts-installer` is the answer.
- Char-box coordinates are PDF points, origin bottom-left. Convert before drawing.
- Renderer has no Node. Everything FS/WASM lives in main.
