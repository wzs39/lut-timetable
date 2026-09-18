/**
 * HTML → teks polos (dipakai announcements & notifications).
 * Satu pemilik rantai strip-tag + decode entitas — sebelumnya dua salinan.
 */
export function htmlToText(
  html: string | undefined | null,
  max?: number,
): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  if (max != null && text.length > max) return text.slice(0, max - 1) + '…'
  return text
}
