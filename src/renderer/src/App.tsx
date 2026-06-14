import { useEffect } from 'react'
import { useStore } from './store'
import { Toolbar } from './Toolbar'
import { Thumbnails } from './Thumbnails'
import { Viewport } from './Viewport'
import { SideNav } from './SideNav'
import { SearchBar } from './SearchBar'
import { useKeyboardShortcuts } from './keys'

export function App(): JSX.Element {
  const setDoc = useStore((s) => s.setDoc)
  useKeyboardShortcuts()

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const info = await window.pdf.openCurrent()
      if (cancelled) return
      setDoc(info)
    }
    load()
    const off = window.pdf.onDocAssigned(load)
    return () => {
      cancelled = true
      off()
    }
  }, [setDoc])

  return (
    <div className="app">
      <Toolbar />
      <SearchBar />
      <div className="body">
        <Thumbnails />
        <div className="viewport-container">
          <Viewport />
          <SideNav />
        </div>
      </div>
    </div>
  )
}
