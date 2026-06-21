# pdf-preview

Linux PDF viewer/editor inspired by macOS Preview. Electron + TypeScript + React.
PDFium-WASM (`@embedpdf/pdfium`) in main, raw RGBA over IPC, custom `<canvas>` renderer.
Zustand state, one store per document window. Ships as an AppImage.

## Run
```
npm run dev               # Electron + Vite HMR
npm run dev -- file.pdf
npm test                  # vitest
npm run typecheck
npm run build:appimage    # → release/pdf-preview-<ver>.AppImage
```

`PDFIUM_FONT_DEBUG=1` logs every MapFont call.

## Architecture

- **Main** owns: PDFium-WASM (open/render/text/forms), system-font mapper
  (`FPDF_SetSystemFontInfo` via Emscripten `addFunction`), `pdf-lib` write
  pipeline, CUPS print, recents, MIME registration, the single shared app
  config. One `BrowserWindow` per document; blank window is reused on next
  Open. Window registry is keyed by `realpathSync(path)`.
- **Renderer** is plain Chromium (PDF plugin not used). For each visible page
  it calls `pdf:renderPage(sourceId, idx, scale, rotation)` and draws the
  returned RGBA on a `<canvas>`. A transparent overlay canvas hosts
  annotations and selection. Renderer has no Node — all FS/WASM lives in main.

## Edit graph

The renderer state is a list of `VirtualPage { sourceId, sourceIndex,
rotation, annotations? }`. `sourceId` is the canonical path of the source PDF
— the primary doc, or any secondary added via Insert / Merge (registered
through `pdf:registerSource`; PDFium keeps each open). Reorder / rotate /
delete / annotate mutate this list; each mutation pushes a snapshot onto the
undo stack (cap 200) and clears redo. `markSaved()` records the clean
reference. Dirty = current ≠ saved snapshot, also flows to
`win.setDocumentEdited` + the title `•` prefix.

Save / Save As / Export Selection As take a `sources: Record<sourceId, path>`
map and bake via `pdf-lib`'s `copyPages` in the requested order, batching
consecutive pages from the same source. Absolute `/Rotate` = source rotation
+ our delta.

## Annotations

Stored on `VirtualPage.annotations[]` in PDF page points (origin bottom-left).
Live drags use `beginLiveEdit` + `liveUpdateAnnotation` so one drag = one
undo entry. Shapes: rect / oval / arrow / line / sticky note / free-text.
Rect/oval/freetext support a `rotation` (radians, CCW around bbox center);
the stored bbox is always un-rotated.

Save writes standard PDF annot dicts via pdf-lib's low-level `context.obj`:
`/Square`, `/Circle`, `/Line`, `/Text`, `/FreeText`. `T` carries the author
(git `user.name` → `$USER`, computed once in main via `getAuthor()` and
threaded through `DocInfo.author`; only stamped if the annotation doesn't
already carry one, so paste preserves the original).

Every annotation also gets a Form XObject `/AP` `/N` appearance stream, baked
to match exactly what our renderer draws (`attachLineAppearance` /
`attachShapeAppearance` / `attachFreeTextAppearance`). This is required, not
optional: PDFium-based viewers (Chromium, Brave) render *nothing* for a `/Line`
without an AP, and synthesize their own border + text layout for `/FreeText`
from `/DA`, both of which diverge from our rendering. We still write the native
dict entries (`/L`, `/LE`, `/C`, `/DA`, `/BS`, `/IC`) as a fallback for viewers
that prefer them. Rotated rect/oval/freetext bake the rotation into the AP via a
`cos sin -sin cos tx ty cm` matrix (`rotationPrologue`) and additionally write
our own `/PdfRotation` (radians) for exact round-trip. NM ids carry
`OWN_NM_PREFIX = 'p4l-'`; `stripOwnedAnnotations` removes only those before
re-writing, so foreign annotations stay byte-for-byte.

## Forms

AcroForm round-trip via PDFium's FormFill env (`FPDFDOC_InitFormFillEnvironment`
+ `FPDF_FFLDraw`). Renderer overlays an invisible focusable layer per page
and forwards pointer/keyboard events as `FORM_OnLButton*` / `FORM_OnChar` /
`FORM_OnKeyDown`. Per-page revision bump in the store triggers re-render
after each input.

**Save routing** (`routeSave` in `index.ts`):
- AcroForm present, non-XFA, edit graph is the identity over a single source
  → PDFium's `SaveAsCopy` (preserves `/AcroForm` + field values).
- Otherwise → pdf-lib pipeline, which drops `/AcroForm`. Form values entered
  in this session are then lost. Known v1 punt.

XFA documents render via PDFium's static appearance; interaction disabled;
banner shown.

## Print

CUPS pipeline: `lpstat -a/-p/-e` enumerate, `lpoptions -p NAME -l` for
capabilities, `lp -d NAME -o KEY=VAL <bake>.pdf` to submit. All `lp*`
spawns force `LC_ALL=C LANG=C` so locale-translated output ("aceptando
trabajos") doesn't break our regex parsers.

## Config & app state

- `~/.config/pdf-preview/state.json` — window geometry + `lastOpenDir` +
  `defaultPrompt` state. Owned by `appState.ts`; one in-memory cache, one
  writer.
- `~/.config/pdf-preview/recents.json` — last 10 opened files.
- `~/.config/pdf-preview/mime-registered.flag` — sentinel for the
  first-run MIME install (`mime.ts`).
- `app.setPath('userData', ...)` is called at the top of `index.ts` after
  `mkdirSync` — older Electron silently no-ops `setPath` if the dir doesn't
  exist, which would route state into Electron's default location.

WM class is locked via `app.commandLine.appendSwitch('class', 'pdf-preview')`
so the running window matches our installed `.desktop`'s
`StartupWMClass=pdf-preview`.

## MIME registration (packaged only)

On first packaged launch (`$APPIMAGE` set + flag missing) `mime.ts` writes
`~/.local/share/applications/pdf-preview.desktop` pointing at `$APPIMAGE`,
copies the icon to `~/.local/share/icons/hicolor/512x512/apps/`, runs
`update-desktop-database` + `gtk-update-icon-cache`. **Does not** call
`xdg-mime default` — picking the default handler is the user's choice and
goes through the first-launch dialog in `defaultHandler.ts`.

On every later packaged launch it reconciles: if the `.desktop`'s `Exec=` no
longer matches the current `$APPIMAGE` (the user moved the binary), it rewrites
the file. The `.desktop` filename is stable, so an existing `xdg-mime default`
keeps resolving once `Exec=` is fixed — we don't re-touch the default. Without
this, a moved AppImage orphans the entry and double-clicking a PDF silently
fails. `$APPIMAGE` (not `argv[0]`/mountpoint) is the stable on-disk path.

## Linux file-dialog quirks

- xdg-desktop-portal's OpenFile method has no "default folder" field;
  Chromium's `defaultPath` is silently dropped under GNOME / KDE / Plasma.
  We work around it via `--xdg-portal-required-version=999`, `--gtk-version=3`,
  and `--enable-features=GtkUi` switches in `index.ts`.
- `dialog.showOpenDialog(undefined, opts)` silently drops `opts` on some
  Linux Electron builds. Always call the single-arg form when there's no
  parent window (see `menu.ts` and `defaultHandler.ts`).

## Gotchas

- `init()` returns a wrapper. cwrap'd `FPDF_*` on the wrapper; raw Emscripten
  module (`HEAPU8`, `wasmExports`, `addFunction`, `HEAPF64`) is at
  `mod.pdfium`. Use the `em()` helper.
- PDFium gives us RGBA, not BGRA — we set `FPDF_REVERSE_BYTE_ORDER`. Don't
  swap channels. (Exception: `exportImages.ts` swaps R↔B because Electron's
  `nativeImage.createFromBitmap` wants BGRA.)
- Font mapper depends on Emscripten `addFunction` being exported by the WASM
  build.
- CID Identity-H + no ToUnicode + no embed → only Microsoft Core Fonts render
  correctly. `ttf-mscorefonts-installer` is the answer; README should call
  this out.
- Char-box coordinates are PDF points, origin bottom-left. Convert before
  drawing.
- Renderer has no Node. Everything FS/WASM lives in main.

## Non-goals (v1)

No cryptographic signatures, drawn signatures, password protection, true
redaction, freehand ink / highlight / underline / strikethrough, OCR, cloud
sync.
