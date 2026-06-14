import type { PdfApi } from './index'

declare global {
  interface Window {
    pdf: PdfApi
  }
}
