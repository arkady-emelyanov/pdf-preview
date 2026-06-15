import { useStore } from './store'
import {
  FREETEXT_FONTS,
  freeTextHeight,
  isFreeText,
  isLine,
  isNote,
  type BoxStyle,
  type FreeTextAnnotation,
  type FreeTextFont
} from '../../shared/annotations'

const SWATCHES = ['#d33', '#2576d3', '#2da44e', '#1a1a1a']
const WIDTHS = [1, 2, 4]

/**
 * Style picker shown in the toolbar. When an annotation is selected, edits
 * apply to it (via updateAnnotation, which records one undo per change).
 * Otherwise, when a drawing tool is active, edits modify toolDefaults so the
 * next shape gets them.
 */
export function AnnotationProps(): JSX.Element | null {
  const tool = useStore((s) => s.tool)
  const sel = useStore((s) => s.selectedAnnotation)
  const pages = useStore((s) => s.pages)
  const toolDefaults = useStore((s) => s.toolDefaults)
  const setToolDefaults = useStore((s) => s.setToolDefaults)
  const freeTextDefaults = useStore((s) => s.freeTextDefaults)
  const setFreeTextDefaults = useStore((s) => s.setFreeTextDefaults)
  const updateAnnotation = useStore((s) => s.updateAnnotation)

  const selAnn =
    sel && pages[sel.page]?.annotations?.find((a) => a.id === sel.id)

  const freeTextActive = tool === 'freetext' || (!!selAnn && isFreeText(selAnn))
  if (freeTextActive) {
    return (
      <FreeTextPanel
        ann={selAnn && isFreeText(selAnn) ? selAnn : null}
        defaults={freeTextDefaults}
        onChange={(patch) => {
          if (selAnn && sel && isFreeText(selAnn)) {
            // Resizing the font also resizes the bbox so existing text isn't
            // clipped or stranded in white space.
            const full: Partial<FreeTextAnnotation> = { ...patch }
            if (patch.fontSize !== undefined) {
              full.h = freeTextHeight(selAnn.body, patch.fontSize)
            }
            updateAnnotation(sel.page, sel.id, full)
          } else {
            const dpatch: Partial<typeof freeTextDefaults> = {}
            if (patch.font !== undefined) dpatch.font = patch.font
            if (patch.fontSize !== undefined) dpatch.fontSize = patch.fontSize
            if (patch.color !== undefined) dpatch.color = patch.color
            setFreeTextDefaults(dpatch)
          }
        }}
      />
    )
  }

  const drawingTool = tool === 'rect' || tool === 'oval' || tool === 'arrow' || tool === 'line'
  // Notes don't use the stroke/width/fill model — their popover is their UI.
  if (selAnn && isNote(selAnn)) return null
  if (!selAnn && !drawingTool) return null

  const selIsLine = !!selAnn && isLine(selAnn)
  const supportsFill = !!selAnn ? !selIsLine : tool === 'rect' || tool === 'oval'

  const current: BoxStyle = selAnn && !isNote(selAnn) && !isFreeText(selAnn)
    ? {
        stroke: selAnn.stroke,
        strokeWidth: selAnn.strokeWidth,
        fill: isLine(selAnn) ? undefined : selAnn.fill,
        opacity: selAnn.opacity
      }
    : toolDefaults

  const apply = (patch: Partial<BoxStyle>): void => {
    if (selAnn && sel && !isFreeText(selAnn)) updateAnnotation(sel.page, sel.id, patch)
    else setToolDefaults(patch)
  }

  return (
    <div className="annot-props">
      <span className="meta">Style</span>
      {SWATCHES.map((c) => (
        <button
          key={c}
          className="swatch"
          aria-pressed={current.stroke.toLowerCase() === c}
          style={{ background: c }}
          title={`Stroke ${c}`}
          onClick={() => apply({ stroke: c })}
        />
      ))}
      {WIDTHS.map((w) => (
        <button
          key={w}
          aria-pressed={current.strokeWidth === w}
          title={`${w}px stroke`}
          onClick={() => apply({ strokeWidth: w })}
        >
          {w}
        </button>
      ))}
      {supportsFill && (
        <button
          aria-pressed={!!current.fill}
          title={current.fill ? 'Remove fill' : 'Fill with stroke color'}
          onClick={() => apply({ fill: current.fill ? undefined : current.stroke })}
        >
          {current.fill ? '▣' : '▢'}
        </button>
      )}
    </div>
  )
}

interface FreeTextPanelProps {
  ann: FreeTextAnnotation | null
  defaults: { font: FreeTextFont; fontSize: number; color: string }
  onChange: (patch: Partial<FreeTextAnnotation>) => void
}

function FreeTextPanel({ ann, defaults, onChange }: FreeTextPanelProps): JSX.Element {
  const font: FreeTextFont = ann?.font ?? defaults.font
  const size = ann?.fontSize ?? defaults.fontSize
  const color = ann?.color ?? defaults.color
  return (
    <div className="annot-props">
      <span className="meta">Text</span>
      {/* Native color input → on Linux this opens the platform GTK color
          chooser, which is what we want over rolling our own picker. */}
      <input
        type="color"
        className="freetext-color"
        value={color}
        title="Text color"
        onChange={(e) => onChange({ color: e.target.value })}
      />
      <select
        className="zoom-select"
        value={font}
        title="Font"
        onChange={(e) => onChange({ font: e.target.value as FreeTextFont })}
      >
        {FREETEXT_FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <input
        type="number"
        className="page-input"
        min={6}
        max={144}
        step={1}
        value={size}
        title="Font size"
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n > 0) onChange({ fontSize: n })
        }}
      />
    </div>
  )
}
