import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DESKTOP_FILE_NAME = 'pdf-preview.desktop'
const STATE_FLAG = 'mime-registered.flag'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, () => resolve())
  })
}

// Use %f so xdg-open passes the file path as a single argument. AppImages get
// a fresh mountpoint each launch, but $APPIMAGE is the stable on-disk path, so
// this is what we bake in — and what we reconcile against when it moves.
function execLine(appImagePath: string): string {
  return `Exec="${appImagePath}" %f`
}

function desktopBody(appImagePath: string, iconName: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=pdf-preview',
    'GenericName=PDF Viewer',
    'Comment=View and edit PDF files',
    execLine(appImagePath),
    `Icon=${iconName}`,
    'Terminal=false',
    'Categories=Office;Viewer;',
    'MimeType=application/pdf;',
    'StartupWMClass=pdf-preview',
    ''
  ].join('\n')
}

/**
 * True when the installed .desktop exists and its Exec= already points at the
 * current AppImage. False when it's missing, unreadable, or stale (the user
 * moved the binary) — in which case we rewrite it.
 */
function desktopIsCurrent(desktopPath: string, appImagePath: string): boolean {
  try {
    const want = execLine(appImagePath)
    return readFileSync(desktopPath, 'utf8')
      .split('\n')
      .some((l) => l === want)
  } catch {
    return false
  }
}

/**
 * Copy the bundled icon into the user's icon theme so the taskbar / launcher
 * has something to show. We use `pdf-preview` as the icon name and rely on the
 * theme lookup (`~/.local/share/icons/hicolor/512x512/apps/pdf-preview.png`).
 * Returns the icon name to use in the .desktop Icon= field, or falls back to a
 * generic name if copy fails.
 */
function installIcon(): string {
  const src = join(process.resourcesPath, 'icon.png')
  if (!existsSync(src)) return 'application-pdf'
  const dataHome = process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share')
  const dir = join(dataHome, 'icons', 'hicolor', '512x512', 'apps')
  const dest = join(dir, 'pdf-preview.png')
  try {
    mkdirSync(dir, { recursive: true })
    copyFileSync(src, dest)
    return 'pdf-preview'
  } catch {
    return 'application-pdf'
  }
}

/**
 * Best-effort handler-registration so opening a PDF in the file manager
 * launches us. Runs only when packaged (AppImage). On first run it writes the
 * .desktop and refreshes the desktop/icon caches (idempotent via a flag in
 * userData). On every subsequent run it reconciles the .desktop's Exec= against
 * the current $APPIMAGE and rewrites it if the binary has moved — so the
 * association self-heals instead of silently pointing at a path that no longer
 * exists.
 *
 * Every step is fire-and-forget; if update-desktop-database isn't installed we
 * silently skip — the user can still launch us by hand. We deliberately never
 * touch the user's default-handler choice here (the .desktop filename is
 * stable, so an existing default keeps resolving once Exec= is fixed).
 */
export async function registerMimeAssociation(): Promise<void> {
  if (!app.isPackaged) return
  const appImage = process.env['APPIMAGE']
  if (!appImage || !existsSync(appImage)) return

  const appsDir = join(
    process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'),
    'applications'
  )
  const desktopPath = join(appsDir, DESKTOP_FILE_NAME)
  const flagPath = join(app.getPath('userData'), STATE_FLAG)
  const firstRun = !existsSync(flagPath)

  // Already registered and the Exec= still points at us — nothing to do.
  if (!firstRun && desktopIsCurrent(desktopPath, appImage)) return

  const iconName = installIcon()
  try {
    mkdirSync(appsDir, { recursive: true })
    writeFileSync(desktopPath, desktopBody(appImage, iconName), 'utf8')
  } catch {
    // Couldn't write the .desktop — bail without flagging so we retry next run.
    return
  }

  // Just refresh the application database — that's enough for the file
  // manager to list us under "Open with…" because the .desktop above
  // declares MimeType=application/pdf. Don't run `xdg-mime default`: that
  // would hijack the user's existing default PDF handler, which is
  // invasive — picking a new default is the user's choice, made through
  // their file manager.
  await run('update-desktop-database', [appsDir])
  // Refresh the icon cache so the freshly-installed pdf-preview.png is picked
  // up without requiring a session restart. Best-effort: the binary isn't on
  // every distro, and the taskbar will catch up on its own eventually.
  await run('gtk-update-icon-cache', [
    '-f',
    '-t',
    join(process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'), 'icons', 'hicolor')
  ])

  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(flagPath, appImage, 'utf8')
  } catch {
    // best-effort
  }
}
