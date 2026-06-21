import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

let cached: string | null = null

/**
 * Best-guess author string for annotations: git's user.name if configured,
 * otherwise the OS user. Lazy + cached for the app's lifetime.
 */
export function getAuthor(): string {
  if (cached !== null) return cached
  try {
    const out = execFileSync('git', ['config', '--global', 'user.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (out) {
      cached = out
      return cached
    }
  } catch {
    // git missing or no config — fall through
  }
  try {
    cached = userInfo().username || ''
  } catch {
    cached = ''
  }
  return cached
}
