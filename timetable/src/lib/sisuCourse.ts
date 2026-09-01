import { Capacitor, CapacitorHttp } from '@capacitor/core'

const LS_CACHE = 'tt_sisu_course_ids'

const QUERY = (code: string) =>
  JSON.stringify({
    query: `{ course_unit_search(codeQuery: "${code}", resultLimit: 1) { id code name { en } } }`,
  })

/** POST GraphQL ke SISU (native: langsung; browser: proxy/corsproxy) */
export async function sisuGraphql(query: string): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: 'https://sisu.lut.fi/api/',
      headers: { 'Content-Type': 'application/json' },
      data: query,
    })
    return JSON.parse(typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
  }

  try {
    // SISU /api/ mengirim Access-Control-Allow-Origin: * ->
    // browser production bisa langsung, tanpa proxy.
    const res = await fetch('https://sisu.lut.fi/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: query,
    })
    return await res.json()
  } catch {
    const res = await fetch(
      'https://corsproxy.io/?url=' +
        encodeURIComponent('https://sisu.lut.fi/api/'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: query,
      },
    )
    return await res.json()
  }
}

/**
 * Resolve course code -> SISU course page URL.
 * Route (dari bundle SISU): /student/courseunit/:courseUnitId
 * ID di-resolve via GraphQL publik SISU, di-cache di localStorage.
 */
export async function resolveSisuCourseUrl(code: string): Promise<string> {
  const clean = code.trim().toUpperCase()
  const cache: Record<string, string> = JSON.parse(
    localStorage.getItem(LS_CACHE) || '{}',
  )
  if (cache[clean]) {
    return `https://sisu.lut.fi/student/courseunit/${cache[clean]}`
  }

  const json = await sisuGraphql(QUERY(clean))
  const id: string | undefined = json?.data?.course_unit_search?.[0]?.id
  if (!id) throw new Error('not-found')

  cache[clean] = id
  localStorage.setItem(LS_CACHE, JSON.stringify(cache))
  return `https://sisu.lut.fi/student/courseunit/${id}`
}

export interface SisuCourse {
  id: string
  code: string
  name: string
}

/** Cari kursus di katalog SISU (kode atau nama) */
export async function searchSisuCourses(term: string): Promise<SisuCourse[]> {
  const t = term.trim()
  if (!t) return []
  const field = /^[A-Za-z]{2,4}\d/.test(t) ? 'codeQuery' : 'fullTextQuery'
  const q = JSON.stringify({
    query: `{ course_unit_search(${field}: "${t.replace(/"/g, '\\"')}", resultLimit: 8) { id code name { en fi } } }`,
  })
  const json = await sisuGraphql(q)
  const list = json?.data?.course_unit_search
  if (!Array.isArray(list)) return []
  return list.map((c: any) => ({
    id: c.id,
    code: c.code,
    name: c.name?.en || c.name?.fi || '',
  }))
}
