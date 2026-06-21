import { app, BrowserWindow, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { getDefaultPromptState, setDefaultPromptState } from './appState'

const DESKTOP_FILE_NAME = 'pdf-preview.desktop'
const MIME = 'application/pdf'

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      resolve({ code: err ? 1 : 0, out: (stdout ?? '').toString().trim() })
    })
  })
}

/** Whether xdg-mime currently reports us as the default PDF handler. */
export async function isPdfDefault(): Promise<boolean> {
  const { code, out } = await run('xdg-mime', ['query', 'default', MIME])
  if (code !== 0) return false
  return out === DESKTOP_FILE_NAME
}

/** Run `xdg-mime default` to make us the default PDF handler. Returns true
 *  on success (best-effort — xdg-mime is missing on some minimal setups). */
export async function setAsPdfDefault(): Promise<boolean> {
  const { code } = await run('xdg-mime', ['default', DESKTOP_FILE_NAME, MIME])
  return code === 0
}

/**
 * Show the "make us the default PDF handler" dialog. Three buttons:
 *   - Make Default
 *   - Later
 *   - "Don't show this again" checkbox (applies to Later only — Make
 *     Default implicitly suppresses further prompts).
 *
 * Returns the new prompt state so the caller can react (e.g. rebuild the
 * Help menu when the Help-menu entry's visibility flips).
 */
export async function showDefaultPrompt(
  parent?: BrowserWindow
): Promise<AppPromptOutcome> {
  if (await isPdfDefault()) {
    // Nothing to do; record agreement so we don't pester again.
    setDefaultPromptState('agreed')
    return { state: 'agreed', changed: true }
  }
  const opts = {
    type: 'question' as const,
    buttons: ['Make Default', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: 'Make pdf-preview the default PDF viewer?',
    detail:
      'PDF files you double-click in your file manager will open in pdf-preview. ' +
      'You can always change this later through your file manager.',
    checkboxLabel: "Don't show this again",
    checkboxChecked: false,
    noLink: true
  }
  // Use the single-arg overload when there's no parent; the
  // `(undefined, opts)` two-arg form silently no-ops on some Linux Electron
  // builds (same quirk we hit with showOpenDialog).
  const res = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts)
  if (res.response === 0) {
    const ok = await setAsPdfDefault()
    setDefaultPromptState(ok ? 'agreed' : 'dismissed')
    return { state: ok ? 'agreed' : 'dismissed', changed: true }
  }
  // "Later" — only persist suppression if the user ticked the checkbox.
  if (res.checkboxChecked) {
    setDefaultPromptState('dismissed')
    return { state: 'dismissed', changed: true }
  }
  return { state: undefined, changed: false }
}

export interface AppPromptOutcome {
  state: 'agreed' | 'dismissed' | undefined
  /** Whether the persisted state changed (so the menu may need rebuilding). */
  changed: boolean
}

/** Whether the Help-menu "Make Default…" item should be visible. */
export function shouldOfferMakeDefault(): boolean {
  return getDefaultPromptState() === 'dismissed'
}

/** First-launch entry point: ask only when packaged, only when state is
 *  still unset, and only when we aren't already the default. */
export async function maybePromptOnStartup(parent?: BrowserWindow): Promise<AppPromptOutcome> {
  if (!app.isPackaged) return { state: undefined, changed: false }
  const ps = getDefaultPromptState()
  if (ps) return { state: ps, changed: false }
  if (await isPdfDefault()) {
    setDefaultPromptState('agreed')
    return { state: 'agreed', changed: true }
  }
  return showDefaultPrompt(parent)
}
