import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import {
  NOTE_SIZE_PT,
  isNote,
  pointToCanvas,
  type NoteAnnotation
} from '../../shared/annotations'

interface Props {
  virtualIndex: number
  pageHeightPt: number
  scale: number
}

/**
 * Editor popover for the selected sticky note on this page. Typing into the
 * textarea live-updates the body using beginLiveEdit / liveUpdateAnnotation,
 * so an editing session lands as a single undo entry — same pattern as
 * drag-resize for shapes.
 */
export function NotePopover({
  virtualIndex,
  pageHeightPt,
  scale
}: Props): JSX.Element | null {
  const selected = useStore((s) => s.selectedAnnotation)
  const pages = useStore((s) => s.pages)
  const beginLiveEdit = useStore((s) => s.beginLiveEdit)
  const liveUpdateAnnotation = useStore((s) => s.liveUpdateAnnotation)
  const setSelectedAnnotation = useStore((s) => s.setSelectedAnnotation)

  const ref = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)

  const sel = selected?.page === virtualIndex ? selected : null
  const ann = sel ? pages[virtualIndex]?.annotations?.find((a) => a.id === sel.id) : undefined
  const note: NoteAnnotation | null = ann && isNote(ann) ? ann : null

  useEffect(() => {
    if (note) {
      ref.current?.focus()
      // Place caret at end on open.
      const len = note.body.length
      ref.current?.setSelectionRange(len, len)
    }
    setEditing(false)
    // Re-mounts when a different note is selected.
  }, [note?.id])

  if (!note) return null

  // Anchor: bottom-left in PDF coords → top-left of icon in canvas px.
  const tl = pointToCanvas(note.x, note.y + NOTE_SIZE_PT, pageHeightPt, scale)
  const iconSize = NOTE_SIZE_PT * scale
  // Place popover just below the icon. If it would overflow the page bottom,
  // place it above instead. (Overflow check is approximate; the viewport
  // scroller hides anything off-page gracefully.)
  const left = tl.cx
  const top = tl.cy + iconSize + 4

  return (
    <div
      className="note-popover"
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 5
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="note-popover-body"
        value={note.body}
        placeholder="Note…"
        onFocus={() => {
          if (!editing) {
            // Snapshot once, so all keystrokes collapse into one undo entry.
            beginLiveEdit()
            setEditing(true)
          }
        }}
        onChange={(e) => liveUpdateAnnotation(virtualIndex, note.id, { body: e.target.value })}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            ;(e.currentTarget as HTMLTextAreaElement).blur()
            setSelectedAnnotation(null)
          }
        }}
      />
    </div>
  )
}
