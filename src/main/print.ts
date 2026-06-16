import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  JobState,
  JobStatus,
  PrintJob,
  PrintResult,
  PrinterInfo,
  PrinterOption
} from '../shared/ipc'
import { saveDoc } from './save'

/** Run a command and capture stdout. Resolves with stdout (trimmed) on exit 0,
 *  rejects with stderr otherwise. We don't shell-interpolate anywhere — args
 *  go straight to spawn — so command-injection is not a concern. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => (out += b.toString()))
    child.stderr.on('data', (b) => (err += b.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `${cmd} exited ${code}`))
    })
  })
}

/** Enumerate printers. `lpstat -e` only returns destinations from
 *  `/etc/cups/printers.conf`, which misses everything cups-browsed /
 *  IPP-everywhere discovers on demand (which is most printers on a modern
 *  desktop). `lpstat -a` ("accepting requests") and `lpstat -p` ("printer
 *  status") both enumerate the full live destination list, so we prefer those
 *  and union with `-e` as a backstop. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const names = new Set<string>()
  // `lpstat -a` lines look like: `HP_LaserJet accepting requests since ...`
  // `lpstat -p` lines look like: `printer HP_LaserJet is idle.  enabled...`
  try {
    const out = await run('lpstat', ['-a'])
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\S+)\s+accepting/i)
      if (m) names.add(m[1])
    }
  } catch {
    // ignore — try the next probe
  }
  try {
    const out = await run('lpstat', ['-p'])
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^printer\s+(\S+)\s+/i)
      if (m) names.add(m[1])
    }
  } catch {
    // ignore
  }
  if (names.size === 0) {
    try {
      const out = await run('lpstat', ['-e'])
      for (const raw of out.split('\n')) {
        const n = raw.trim()
        if (n) names.add(n)
      }
    } catch {
      // ignore — cupsd may not be running
    }
  }
  let defaultName = ''
  try {
    const dout = await run('lpstat', ['-d'])
    const m = dout.match(/system default destination:\s*(\S+)/i)
    if (m) defaultName = m[1]
  } catch {
    // No default — fine. First printer becomes the picker default.
  }
  return [...names].map((name) => ({
    name,
    isDefault: name === defaultName,
    options: []
  }))
}

/** Parse the output of `lpoptions -p <name> -l`. Each line looks like:
 *    `KeyName/Friendly Label: value1 *value2 value3`
 *  where the `*` prefix marks the current default. */
export function parseLpoptions(text: string): PrinterOption[] {
  const out: PrinterOption[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon).trim()
    const tail = line.slice(colon + 1).trim()
    const slash = head.indexOf('/')
    const key = slash >= 0 ? head.slice(0, slash) : head
    const label = slash >= 0 ? head.slice(slash + 1) : head
    const tokens = tail.split(/\s+/).filter(Boolean)
    let def = ''
    const values: string[] = []
    for (const t of tokens) {
      if (t.startsWith('*')) {
        const v = t.slice(1)
        def = v
        values.push(v)
      } else {
        values.push(t)
      }
    }
    if (values.length === 0) continue
    out.push({ key, label, values, default: def || values[0] })
  }
  return out
}

export async function getPrinterOptions(name: string): Promise<PrinterOption[]> {
  try {
    const out = await run('lpoptions', ['-p', name, '-l'])
    return parseLpoptions(out)
  } catch {
    return []
  }
}

/** Build the `lp` argv from a PrintJob (minus the file path, which is the
 *  final positional). Pure for testability. */
export function buildLpArgs(job: PrintJob, tmpFile: string): string[] {
  const args: string[] = ['-d', job.printerName]
  if (job.copies && job.copies > 1) args.push('-n', String(job.copies))
  const o: string[] = []
  if (job.duplex) o.push(`Duplex=${job.duplex}`)
  if (job.media) o.push(`media=${job.media}`)
  if (job.colorModel) o.push(`ColorModel=${job.colorModel}`)
  if (job.orientation === 'landscape') o.push('orientation-requested=4')
  else if (job.orientation === 'portrait') o.push('orientation-requested=3')
  if (job.scaling === 'fit') o.push('fit-to-page')
  else if (typeof job.scaling === 'number') o.push(`scaling=${job.scaling}`)
  // 'actual' → omit (CUPS default is 1:1).
  for (const opt of o) args.push('-o', opt)
  args.push(tmpFile)
  return args
}

/** Parse `lp`'s stdout — typically `request id is HP-123 (1 file(s))` — and
 *  return the job id. */
export function parseJobId(stdout: string): string | null {
  const m = stdout.match(/request id is\s+(\S+)/i)
  return m ? m[1] : null
}

interface ActiveJob {
  jobId: string
  printerName: string
  tmpFile: string
}

const activeJobs = new Map<string, ActiveJob>()

export async function print(job: PrintJob): Promise<PrintResult> {
  if (!job.printerName) return { ok: false, error: 'No printer selected' }
  if (!job.pages || job.pages.length === 0) {
    return { ok: false, error: 'No pages to print' }
  }
  const tmpFile = join(tmpdir(), `preview-print-${randomUUID()}.pdf`)
  try {
    await saveDoc(job.sources, tmpFile, job.pages)
  } catch (e) {
    return { ok: false, error: `Failed to bake PDF: ${(e as Error).message}` }
  }
  const args = buildLpArgs(job, tmpFile)
  let stdout: string
  try {
    stdout = await run('lp', args)
  } catch (e) {
    await unlink(tmpFile).catch(() => undefined)
    return { ok: false, error: (e as Error).message }
  }
  const jobId = parseJobId(stdout) ?? ''
  if (jobId) {
    activeJobs.set(jobId, { jobId, printerName: job.printerName, tmpFile })
    // Best-effort cleanup once the job leaves the queue. We don't await this.
    void watchAndCleanup(jobId, tmpFile)
  } else {
    // No id returned — print probably succeeded synchronously; remove the temp.
    await unlink(tmpFile).catch(() => undefined)
  }
  return { ok: true, jobId }
}

/** Poll `lpstat -W not-completed` for this job id; when it disappears, drop
 *  the temp file. Caps at 5 minutes so a stuck queue can't leak forever. */
async function watchAndCleanup(jobId: string, tmpFile: string): Promise<void> {
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000))
    const s = await getJobStatus(jobId)
    if (s.state === 'done' || s.state === 'cancelled' || s.state === 'error') {
      break
    }
  }
  await unlink(tmpFile).catch(() => undefined)
  activeJobs.delete(jobId)
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  if (!jobId) return { jobId, state: 'done' }
  let out = ''
  try {
    out = await run('lpstat', ['-W', 'not-completed'])
  } catch (e) {
    return { jobId, state: 'error', message: (e as Error).message }
  }
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
  let found = false
  let printing = false
  for (const line of lines) {
    // lpstat lines start with the job id (e.g. "HP-123  ark  10240 ...")
    if (line.split(/\s+/)[0] === jobId) {
      found = true
      // Heuristic: CUPS appends `(printing)` or similar when actively printing.
      if (/printing/i.test(line)) printing = true
      break
    }
  }
  let state: JobState
  if (!found) state = 'done'
  else if (printing) state = 'printing'
  else state = 'pending'
  return { jobId, state }
}

export async function cancelJob(jobId: string): Promise<void> {
  if (!jobId) return
  try {
    await run('cancel', [jobId])
  } catch {
    // ignore — job may already be gone
  }
  const active = activeJobs.get(jobId)
  if (active) {
    await unlink(active.tmpFile).catch(() => undefined)
    activeJobs.delete(jobId)
  }
}

/** Apply user range / subset choices to a virtual page list. Pure; exported
 *  for tests. `pageCount` is `pages.length`; the parser is 1-based. */
export function selectPages<T>(
  pages: T[],
  range: 'all' | 'current' | { spec: string },
  subset: 'all' | 'odd' | 'even',
  currentIndex0Based: number
): T[] {
  let indices: number[]
  if (range === 'all') {
    indices = pages.map((_, i) => i)
  } else if (range === 'current') {
    indices = [currentIndex0Based]
  } else {
    indices = parseRangeSpec(range.spec, pages.length)
  }
  if (subset === 'odd') indices = indices.filter((i) => i % 2 === 0) // 1-based odd = i0 0,2,4
  else if (subset === 'even') indices = indices.filter((i) => i % 2 === 1)
  return indices.map((i) => pages[i]).filter((x): x is T => x !== undefined)
}

/** Parse a range like `"1-5,8,11-"` into 0-based, dedup'd, in-order indices
 *  bounded by `pageCount`. An open-ended trailing `N-` extends to the last
 *  page. Malformed tokens are silently skipped. */
export function parseRangeSpec(spec: string, pageCount: number): number[] {
  const out = new Set<number>()
  for (const raw of spec.split(',')) {
    const tok = raw.trim()
    if (!tok) continue
    const dash = tok.indexOf('-')
    if (dash < 0) {
      const n = Number(tok)
      if (Number.isInteger(n) && n >= 1 && n <= pageCount) out.add(n - 1)
      continue
    }
    const lo = tok.slice(0, dash).trim()
    const hi = tok.slice(dash + 1).trim()
    const loN = lo === '' ? 1 : Number(lo)
    const hiN = hi === '' ? pageCount : Number(hi)
    if (!Number.isInteger(loN) || !Number.isInteger(hiN)) continue
    const a = Math.max(1, loN)
    const b = Math.min(pageCount, hiN)
    for (let i = a; i <= b; i++) out.add(i - 1)
  }
  return [...out].sort((a, b) => a - b)
}
