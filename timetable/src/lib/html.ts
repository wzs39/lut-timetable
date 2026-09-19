/** Entitas bernama yang benar-benar muncul di feed LUT (sisanya dibiarkan). */
const NAMED_ENTITIES: Record<string, string> = {
  raquo: '»',
  laquo: '«',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  times: '×',
  copy: '©',
  deg: '°',
  eacute: 'é',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
}

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
    // Entitas non-ASCII umum: » « … muncul di breadcrumb forum LUT
    // ("Forums » Announcements » Assignment 1"). Peta kecil murni + entitas
    // numerik — tanpa DOM (modul ini juga dipakai di lingkungan node).
    .replace(/&([a-z]+|#x?[0-9a-fA-F]+);/gi, (raw, ent: string) => {
      if (ent[0] === '#') {
        const cp =
          ent[1] === 'x' || ent[1] === 'X'
            ? parseInt(ent.slice(2), 16)
            : parseInt(ent.slice(1), 10)
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : raw
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? raw
    })
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  if (max != null && text.length > max) return text.slice(0, max - 1) + '…'
  return text
}
