import { useStore } from './store'

export function SideNav(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const currentPage = useStore((s) => s.currentPage)
  const requestJump = useStore((s) => s.requestJump)

  if (!doc) return null
  const canPrev = currentPage > 0
  const canNext = currentPage < doc.pageCount - 1

  return (
    <>
      <button
        className="side-nav left"
        disabled={!canPrev}
        onClick={() => canPrev && requestJump(currentPage - 1)}
        title="Previous page (←)"
        aria-label="Previous page"
      >
        ‹
      </button>
      <button
        className="side-nav right"
        disabled={!canNext}
        onClick={() => canNext && requestJump(currentPage + 1)}
        title="Next page (→)"
        aria-label="Next page"
      >
        ›
      </button>
    </>
  )
}
