import { useStore } from './store'
import { isLine, isNote, type BoxStyle } from '../../shared/annotations'

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
  const updateAnnotation = useStore((s) => s.updateAnnotation)

  const selAnn =
    sel && pages[sel.page]?.annotations?.find((a) => a.id === sel.id)
  const drawingTool = tool === 'rect' || tool === 'oval' || tool === 'arrow' || tool === 'line'
  // Notes don't use the stroke/width/fill model — their popover is their UI.
  // Hide the panel when a note is selected or the note tool is active.
  if (selAnn && isNote(selAnn)) return null
  if (!selAnn && !drawingTool) return null

  const selIsLine = !!selAnn && isLine(selAnn)
  const supportsFill = !!selAnn ? !selIsLine : tool === 'rect' || tool === 'oval'

  const current: BoxStyle = selAnn && !isNote(selAnn)
    ? {
        stroke: selAnn.stroke,
        strokeWidth: selAnn.strokeWidth,
        fill: isLine(selAnn) ? undefined : selAnn.fill,
        opacity: selAnn.opacity
      }
    : toolDefaults

  const apply = (patch: Partial<BoxStyle>): void => {
    if (selAnn && sel) updateAnnotation(sel.page, sel.id, patch)
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
