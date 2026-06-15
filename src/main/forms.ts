/**
 * PDFium form-fill bridge. Owns one form-fill handle per open document so
 * AcroForm widgets render with values, blink/focus correctly under input, and
 * round-trip on save. Built on `@embedpdf/pdfium`'s `PDFiumExt_*` extension
 * which provides a default FORMFILLINFO struct (timers, page lookup,
 * invalidate-as-no-op) so we don't have to hand-roll callbacks via
 * `addFunction`.
 *
 * Form-type discriminator (from `FPDF_GetFormType`):
 *   0 = NONE, 1 = AcroForm, 2 = XFA Full, 3 = XFA Foreground.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium'

const FORMTYPE_NONE = 0
const FORMTYPE_ACROFORM = 1
const FORMTYPE_XFA_FULL = 2
const FORMTYPE_XFA_FOREGROUND = 3

const FPDF_ANNOT = 1

export interface FormState {
  /** Document handle this form-fill env is bound to. */
  docPtr: number
  /** PDFiumExt FORMFILLINFO struct ptr; needed for tear-down. */
  formInfoPtr: number
  /** Form handle returned by `PDFiumExt_InitFormFillEnvironment`. */
  formHandle: number
  hasForm: boolean
  isXFA: boolean
}

export type FieldType =
  | 'unknown'
  | 'pushbutton'
  | 'checkbox'
  | 'radio'
  | 'combobox'
  | 'listbox'
  | 'text'
  | 'signature'

// Mirrors PDFium's FPDF_FORMFIELD_* enum.
const FIELD_TYPES: Record<number, FieldType> = {
  0: 'unknown',
  1: 'pushbutton',
  2: 'checkbox',
  3: 'radio',
  4: 'combobox',
  5: 'listbox',
  6: 'text',
  7: 'signature'
}

export interface FieldValue {
  /** Qualified field name, e.g. "address.street". */
  name: string
  type: FieldType
  value: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function em(mod: WrappedPdfiumModule): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).pdfium
}

/** Inspect the doc, build a form-fill env if there's an AcroForm. XFA docs
 *  still get a state record so callers can render via FFLDraw, but we mark
 *  `isXFA` so the renderer can disable input + show the banner. */
export function initFormState(mod: WrappedPdfiumModule, docPtr: number): FormState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  const formType = m.FPDF_GetFormType(docPtr) as number
  const hasForm = formType !== FORMTYPE_NONE
  const isXFA = formType === FORMTYPE_XFA_FULL || formType === FORMTYPE_XFA_FOREGROUND
  if (!hasForm) {
    return { docPtr, formInfoPtr: 0, formHandle: 0, hasForm: false, isXFA: false }
  }
  const formInfoPtr = m.PDFiumExt_OpenFormFillInfo() as number
  if (!formInfoPtr) {
    return { docPtr, formInfoPtr: 0, formHandle: 0, hasForm: false, isXFA }
  }
  const formHandle = m.PDFiumExt_InitFormFillEnvironment(docPtr, formInfoPtr) as number
  if (!formHandle) {
    m.PDFiumExt_CloseFormFillInfo(formInfoPtr)
    return { docPtr, formInfoPtr: 0, formHandle: 0, hasForm: false, isXFA }
  }
  return { docPtr, formInfoPtr, formHandle, hasForm: true, isXFA }
}

export function disposeFormState(mod: WrappedPdfiumModule, st: FormState): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  if (st.formHandle) m.PDFiumExt_ExitFormFillEnvironment(st.formHandle)
  if (st.formInfoPtr) m.PDFiumExt_CloseFormFillInfo(st.formInfoPtr)
  st.formHandle = 0
  st.formInfoPtr = 0
  st.hasForm = false
}

/**
 * Walk the doc's widget annotations and pull (name, type, value) for each
 * field. We dedupe by qualified name so radio groups and multi-control fields
 * collapse to a single entry. Returns [] for XFA / form-less docs.
 */
export function readFieldValues(
  mod: WrappedPdfiumModule,
  st: FormState,
  pageCount: number
): FieldValue[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  const raw = em(mod)
  if (!st.hasForm || st.isXFA || !st.formHandle) return []

  const seen = new Map<string, FieldValue>()
  const bufPtr = raw.wasmExports.malloc(2048)
  if (!bufPtr) return []

  const readWideString = (
    call: (h: number, annotPtr: number, buf: number, len: number) => number,
    annotPtr: number
  ): string => {
    // Two-pass: first call returns required buffer length (incl. UTF-16
    // null). Most field names / values are well under 1KB.
    const needed = call(st.formHandle, annotPtr, 0, 0)
    if (needed <= 2) return ''
    const len = Math.min(needed, 2048)
    const got = call(st.formHandle, annotPtr, bufPtr, len)
    if (got <= 2) return ''
    return new TextDecoder('utf-16le').decode(raw.HEAPU8.subarray(bufPtr, bufPtr + got - 2))
  }

  try {
    for (let pi = 0; pi < pageCount; pi++) {
      const pagePtr = m.FPDF_LoadPage(st.docPtr, pi)
      if (!pagePtr) continue
      try {
        const n = m.FPDFPage_GetAnnotCount(pagePtr) as number
        for (let ai = 0; ai < n; ai++) {
          const annotPtr = m.FPDFPage_GetAnnot(pagePtr, ai) as number
          if (!annotPtr) continue
          try {
            const subtype = m.FPDFAnnot_GetSubtype(annotPtr) as number
            // FPDF_ANNOT_WIDGET = 20.
            if (subtype !== 20) continue
            const name = readWideString(m.FPDFAnnot_GetFormFieldName, annotPtr)
            if (!name || seen.has(name)) continue
            const t = m.FPDFAnnot_GetFormFieldType(st.formHandle, annotPtr) as number
            const value = readWideString(m.FPDFAnnot_GetFormFieldValue, annotPtr)
            seen.set(name, { name, type: FIELD_TYPES[t] ?? 'unknown', value })
          } finally {
            m.FPDFPage_CloseAnnot(annotPtr)
          }
        }
      } finally {
        m.FPDF_ClosePage(pagePtr)
      }
    }
  } finally {
    raw.wasmExports.free(bufPtr)
  }
  return [...seen.values()]
}

/** Convert a renderer-side pointer position (already in PDF page points,
 *  origin top-left) to PDFium's "device space" relative to the bitmap. We
 *  pass device coords (the same we use for FFLDraw) so PDFium's hit-test
 *  matches the rendered widget rects. */
export function forwardPointerEvent(
  mod: WrappedPdfiumModule,
  st: FormState,
  pagePtr: number,
  kind: 'down' | 'up' | 'move',
  /** Page-coord X in PDF points, origin bottom-left. */
  pageX: number,
  pageY: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  if (kind === 'down') m.FORM_OnLButtonDown(st.formHandle, pagePtr, 0, pageX, pageY)
  else if (kind === 'up') m.FORM_OnLButtonUp(st.formHandle, pagePtr, 0, pageX, pageY)
  else m.FORM_OnMouseMove(st.formHandle, pagePtr, 0, pageX, pageY)
}

export function forwardChar(
  mod: WrappedPdfiumModule,
  st: FormState,
  pagePtr: number,
  charCode: number,
  modifiers: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  m.FORM_OnChar(st.formHandle, pagePtr, charCode, modifiers)
}

export function forwardKeyDown(
  mod: WrappedPdfiumModule,
  st: FormState,
  pagePtr: number,
  vkey: number,
  modifiers: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  m.FORM_OnKeyDown(st.formHandle, pagePtr, vkey, modifiers)
}

/** Call after a page is loaded so PDFium can attach form-state to it. */
export function notifyPageLoaded(
  mod: WrappedPdfiumModule,
  st: FormState,
  pagePtr: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  m.FORM_OnAfterLoadPage(pagePtr, st.formHandle)
}

export function notifyPageClosed(
  mod: WrappedPdfiumModule,
  st: FormState,
  pagePtr: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  m.FORM_OnBeforeClosePage(pagePtr, st.formHandle)
}

/** Render form widgets on top of a previously-rendered page bitmap. */
export function drawForms(
  mod: WrappedPdfiumModule,
  st: FormState,
  bitmap: number,
  pagePtr: number,
  x: number,
  y: number,
  width: number,
  height: number,
  rotate: number,
  flags: number
): void {
  if (!st.formHandle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any
  m.FPDF_FFLDraw(st.formHandle, bitmap, pagePtr, x, y, width, height, rotate, flags)
}

export { FORMTYPE_NONE, FORMTYPE_ACROFORM, FORMTYPE_XFA_FULL, FORMTYPE_XFA_FOREGROUND, FPDF_ANNOT }
