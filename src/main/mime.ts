import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DESKTOP_FILE_NAME = 'pdf-preview.desktop'
const STATE_FLAG = 'mime-registered.flag'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, () => resolve())
  })
}

function desktopBody(appImagePath: string, iconName: string): string {
  // Use %f so xdg-open passes the file path as a single argument.
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=pdf-preview',
    'GenericName=PDF Viewer',
    'Comment=View and edit PDF files',
    `Exec="${appImagePath}" %f`,
    `Icon=${iconName}`,
    'Terminal=false',
    'Categories=Office;Viewer;',
    'MimeType=application/pdf;',
    'StartupWMClass=pdf-preview',
    ''
  ].join('\n')
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
 * Best-effort first-run handler-registration so opening a PDF in the file
 * manager launches us. Runs only:
 *  - when the binary is packaged (AppImage), and
 *  - when we haven't registered before (idempotent via a flag in userData).
 *
 * Every step is fire-and-forget; if xdg-mime or update-desktop-database isn't
 * installed we silently skip — the user can still launch us by hand.
 */
export async function registerMimeAssociation(): Promise<void> {
  if (!app.isPackaged) return
  const appImage = process.env['APPIMAGE']
  if (!appImage || !existsSync(appImage)) return

  const flagPath = join(app.getPath('userData'), STATE_FLAG)
  if (existsSync(flagPath)) return

  const appsDir = join(
    process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'),
    'applications'
  )
  const desktopPath = join(appsDir, DESKTOP_FILE_NAME)
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
