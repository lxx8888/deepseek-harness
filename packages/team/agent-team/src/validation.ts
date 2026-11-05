/** Input normalization shared by Team roster and task commands. */

import { TeamError } from './error.ts'

/** Durable member-name shape; the durable name stays the addressing key. */
export const MEMBER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Normalize one required human-authored string.
 * @param value - raw input value.
 * @param field - diagnostic field name.
 * @param maxLength - maximum normalized character count.
 * @returns trimmed non-empty text.
 */
export function requiredText(value: string, field: string, maxLength: number): string {
  const text = value.trim()
  if (text.length === 0) throw new TeamError(`${field} must be non-empty`, 'TEAM_INVALID_ARGUMENT')
  if (text.length > maxLength) {
    throw new TeamError(`${field} exceeds ${maxLength} characters`, 'TEAM_INVALID_ARGUMENT')
  }
  return text
}

/**
 * Validate one deployment display-label map.
 * @param value - configuration map keyed by durable member name.
 * @returns the validated labels keyed by durable member name.
 */
export function displayNameMap(value: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const labels = new Map<string, string>()
  for (const [name, label] of Object.entries(value)) {
    if (!MEMBER_NAME_PATTERN.test(name) || name.length > 64) {
      throw new TeamError(`display name key "${name}" must be lower-kebab-case`, 'TEAM_INVALID_CONFIG')
    }
    const text = label.trim()
    if (text.length === 0 || text.length > 64) {
      throw new TeamError(`display name for "${name}" must be 1 to 64 characters`, 'TEAM_INVALID_CONFIG')
    }
    labels.set(name, text)
  }
  return labels
}

/**
 * Normalize one workspace-relative path prefix without treating it as a lock.
 * @param value - user-authored path prefix.
 * @returns normalized slash-separated prefix.
 */
export function writeScope(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  const segments = normalized.split('/')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TeamError(`invalid workspace-relative write scope ${JSON.stringify(value)}`, 'TEAM_INVALID_WRITE_SCOPE')
  }
  return normalized
}
