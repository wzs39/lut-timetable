const MOODLE_ORIGIN = 'https://moodle.lut.fi'

/** Normalize a Moodle link to HTTPS and reject non-Moodle destinations. */
export function normalizeMoodleLink(raw: string | null | undefined): string | null {
  const value = raw?.trim().replace(/&amp;/g, '&')
  if (!value) return null
  try {
    const url = new URL(value, `${MOODLE_ORIGIN}/`)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.hostname.toLowerCase() !== 'moodle.lut.fi' ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null
    }
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

/** Canonical course landing page used when a notification has no context URL. */
export function moodleCourseUrl(courseid: number): string | null {
  if (!Number.isSafeInteger(courseid) || courseid <= 0) return null
  return `${MOODLE_ORIGIN}/course/view.php?id=${courseid}`
}
